/**
 * 奶蛋弹弓 —— 愤怒的小鸟式弹射游戏。
 * 奶蛋们（毛绒蛋）= 小鸟，各有技能；奶蛙 = 猪；木箱/冰砖/石块 = 可破坏结构。
 * 支持：手工第一关、无尽模式（每关随机生成）、开场动画（左右展示我方与敌方）。
 * 物理用 Matter.js，渲染用自己的 Canvas 绘制（方便做挤压拉伸、粒子、镜头运动）。
 */
(() => {
  const { Engine, Bodies, Body, Composite, Events, Vector } = Matter;
  // ---------------------------------------------------------------- 资源
  const ASSET_FILES = {
    naidan_idle: 'naidan_idle.png',
    naidan_blink: 'naidan_blink.png',
    naidan_dash: 'naidan_dash.png',
    naidan_split: 'naidan_split.png',
    naidan_bomb: 'naidan_bomb.png',
    naidan_heavy: 'naidan_heavy.png',
    naidan_milk: 'naidan_milk.png',
    naidan_back: 'naidan_back.png',
    naidan_seek: 'naidan_seek.png',
    naidan_nuke: 'naidan_nuke.png',
    naiwa_angry: 'naiwa_angry.png',
    naiwa_happy: 'naiwa_happy.png',
    boss_idle: 'boss_idle.png',
    boss_laugh: 'boss_laugh.png',
  };
  const ASSET_BASE = window.ASSET_BASE || 'assets/';
  // 唯一一个"真实音频素材"：击败 boss 的那声大笑（见 tools/make-boss-laugh.mjs）。
  // 其余音效全是 WebAudio 现场合成的，所以这里单独走一条 <audio> 的路子。
  const AUDIO_FILES = { boss_laugh: 'boss_laugh.mp3' };
  const audioUrl = (name) => (window.INLINE_AUDIO && window.INLINE_AUDIO[name]) || ASSET_BASE + AUDIO_FILES[name];
  const assetUrl = (name) => (window.INLINE_ASSETS && window.INLINE_ASSETS[name]) || ASSET_BASE + ASSET_FILES[name];
  const IMG = {};
  const loadImages = () =>
    Promise.all(
      Object.keys(ASSET_FILES).map(
        (k) =>
          new Promise((resolve) => {
            const im = new Image();
            im.onload = () => resolve();
            im.onerror = () => {
              console.warn('素材加载失败：', assetUrl(k));
              resolve();
            };
            im.src = assetUrl(k);
            IMG[k] = im;
          })
      )    );
  // boss 那声大笑：一个 <audio> 元素就够（file:// 下能读同目录音频，跟 <img> 一样；
  // 单文件版会换成 base64 内联，完全不碰网络）
  let bossLaughEl = null;
  let bossLaughAttempts = 0;
  let bossLaughPlays = 0;
  const loadAudio = () => {
    bossLaughEl = new Audio(audioUrl('boss_laugh'));
    bossLaughEl.preload = 'auto';
    bossLaughEl.volume = 0.85;
  };
  /** 放真实的那声大笑；没加载好（或者静音中）就返回 false，让合成音效兜底 */
  const playBossLaugh = () => {
    bossLaughAttempts += 1;
    if (!bossLaughEl || AudioKit.muted || bossLaughEl.readyState < 2) return false;
    try {
      bossLaughEl.currentTime = 0;
    } catch (e) { /* 还没拿到时长，忽略 */ }
    bossLaughEl.play().then(() => { bossLaughPlays += 1; }).catch(() => {});
    return true;
  };
  // ---------------------------------------------------------------- 常量
  const W = 1280;
  const H = 720;
  const STEP = 1000 / 60;
  const GRAVITY_PER_TICK = 0.2778; // Matter 默认重力下每 tick 的速度增量，用于预测弹道
  const AIM_ASSIST = {
    fill: '#8ed8ff',
    stroke: 'rgba(35,139,220,0.72)',
    fullFill: '#d8f5ff',
    fullStroke: 'rgba(0,120,220,0.92)',
  };
  const FILL_W = 8600;               // 背景绘制铺满用（要盖过最长的地图）
  const MIN_ZOOM = 0.45;             // 缩到最小能一眼看完整张地图
  const MAX_ZOOM = 1.7;
  const MAX_PULL = 132;
  const LAUNCH_K = 0.195;
  // 立绘和碰撞体的对齐参数（K = 立绘高度 / 半径，ANCHOR_Y = 立绘里"身体中心"的高度占比）
  const BIRD_SPRITE_K = 3.42;
  const BIRD_ANCHOR_Y = 0.66;
  const PIG_SPRITE_K = 2.62;
  const PIG_ANCHOR_Y = 0.62;
  const BIRDS = window.BIRDS;
  // 镜头：正常 1.0 倍固定视野，开场动画会临时拉近/平移
  const CAM = { x: 0, y: 0, zoom: 1, shake: 0, targetX: 0, targetZoom: 1 };
  const viewW = () => W / CAM.zoom;
  const viewH = () => H / CAM.zoom;
  /** 镜头能活动的范围：视野比地图还大时就居中，避免露边 */
  const worldW = () => level.worldW || 2720; // 地图长度：随关卡难度增长，最长 7200
  const camBounds = () => {
    const vw = viewW();
    const vh = viewH();
    return {
      minX: Math.min(0, worldW() - vw),
      maxX: Math.max(0, worldW() - vw),
      minY: Math.min(0, H - vh),
      maxY: Math.max(0, H - vh),
    };
  };
  const clampCamX = (x) => {
    const b = camBounds();
    return clamp(x, b.minX, b.maxX);
  };
  const clampCamY = (y) => {
    const b = camBounds();
    return clamp(y, b.minY, b.maxY);
  };
  /** 静止时镜头该待的高度：视野比地图高就居中 */
  const defaultCamY = () => clampCamY((H - viewH()) / 2);
  const MATS = window.MATERIALS;
  const GROUND_Y = 636;
  let level = window.LEVEL1; // 当前关卡数据（无尽模式每次重新生成）
  // 弹弓位置：长关卡会分成几段，清完一段就把弹弓（连同待发的奶蛋）往前推
  let sling = { x: 186, y: 470 };
  let stageIndex = 0;
  const stageCount = () => (level.launchPoints ? level.launchPoints.length : 1);
  const slingAnchor = () => sling;
  const slingGeom = () => ({ x: sling.x, baseY: GROUND_Y, prongTopY: 442, anchor: { x: sling.x, y: sling.y } });
  /** 静止时镜头该停在的位置：弹弓左边留一点余量 */
  const homeCamX = () => clampCamX(sling.x - 240);
  const setStage = (i) => {
    stageIndex = Math.max(0, Math.min(i, stageCount() - 1));
    const pt = (level.launchPoints || [{ x: 186, y: 470 }])[stageIndex];
    sling = { x: pt.x, y: pt.y || 470 };
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const deg = (d) => (d * Math.PI) / 180;
  // ---------------------------------------------------------------- 状态
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const el = {
    score: document.getElementById('score'),
    ammo: document.getElementById('ammo'),
    hint: document.getElementById('hint'),
    title: document.getElementById('titleScreen'),
    hud: document.getElementById('hud'),
    end: document.getElementById('endScreen'),
    endTitle: document.getElementById('endTitle'),
    endStars: document.getElementById('endStars'),
    endScore: document.getElementById('endScore'),
    endNote: document.getElementById('endNote'),
    slingshotSubmit: document.getElementById('slingshotSubmit'),
    slingshotName: document.getElementById('slingshotName'),
    btnSubmitSlingshot: document.getElementById('btnSubmitSlingshot'),
    slingshotSubmitMsg: document.getElementById('slingshotSubmitMsg'),
    toast: document.getElementById('toast'),
    btnWorkshop: document.getElementById('btnWorkshop'),
    btnLeaderboard: document.getElementById('btnLeaderboard'),
    btnEndLeaderboard: document.getElementById('btnEndLeaderboard'),
    btnAgain: document.getElementById('btnAgain'),
    btnRestart: document.getElementById('btnRestart'),
    btnSound: document.getElementById('btnSound'),
    btnEndless: document.getElementById('btnEndless'),
    btnResumeEndless: document.getElementById('btnResumeEndless'),
    btnBackMenu: document.getElementById('btnBackMenu'),
    btnBackEditor: document.getElementById('btnBackEditor'),
    btnEndWorkshop: document.getElementById('btnEndWorkshop'),
    // 创意工坊
    workshop: document.getElementById('workshopScreen'),
    wkDrafts: document.getElementById('wkDrafts'),
    wkPaste: document.getElementById('wkPaste'),
    wkFile: document.getElementById('wkFile'),
    wkTabCommunity: document.getElementById('wkTabCommunity'),
    wkTabMine: document.getElementById('wkTabMine'),
    wkMineCount: document.getElementById('wkMineCount'),
    wkCommunityPane: document.getElementById('wkCommunityPane'),
    wkMinePane: document.getElementById('wkMinePane'),
    wkCommunity: document.getElementById('wkCommunity'),
    wkWeekly: document.getElementById('wkWeekly'),
    wkWeeklySection: document.getElementById('wkWeeklySection'),
    wkMoreTitle: document.getElementById('wkMoreTitle'),
    wkSearch: document.getElementById('wkSearch'),
    wkSort: document.getElementById('wkSort'),
    btnWkRefresh: document.getElementById('btnWkRefresh'),
    btnWkNew: document.getElementById('btnWkNew'),
    btnWkPaste: document.getElementById('btnWkPaste'),
    btnWkImport: document.getElementById('btnWkImport'),
    btnWkClose: document.getElementById('btnWkClose'),
    // 编辑器
    editor: document.getElementById('editorScreen'),
    edStatus: document.getElementById('edStatus'),
    edPlay: document.getElementById('edPlay'),
    edBlockProps: document.getElementById('edBlockProps'),
    edPigProps: document.getElementById('edPigProps'),
    edPigBonus: document.getElementById('edPigBonus'),
    edStageVal: document.getElementById('edStageVal'),
    edBirdsBtn: document.getElementById('edBirdsBtn'),
    edUndo: document.getElementById('edUndo'),
    edRedo: document.getElementById('edRedo'),
    edShare: document.getElementById('edShare'),
    edSubmit: document.getElementById('edSubmit'),
    edExport: document.getElementById('edExport'),
    edWkBack: document.getElementById('edWkBack'),
    edStageMinus: document.getElementById('edStageMinus'),
    edStagePlus: document.getElementById('edStagePlus'),
    // 奶蛋阵容
    birdPicker: document.getElementById('birdPicker'),
    bpRows: document.getElementById('bpRows'),
    bpTotal: document.getElementById('bpTotal'),
    bpOk: document.getElementById('bpOk'),
    bpReset: document.getElementById('bpReset'),
    bpCancel: document.getElementById('bpCancel'),
    submitDialog: document.getElementById('submitDialog'),
    subLevelNameInput: document.getElementById('subLevelNameInput'),
    subAuthor: document.getElementById('subAuthor'),
    subStatus: document.getElementById('subStatus'),
    subSend: document.getElementById('subSend'),
    subCancel: document.getElementById('subCancel'),
    restartDialog: document.getElementById('restartDialog'),
    btnRestartConfirm: document.getElementById('btnRestartConfirm'),
    btnRestartCancel: document.getElementById('btnRestartCancel'),
    btnExitLevel: document.getElementById('btnExitLevel'),
    edToolBlock: document.getElementById('edToolBlock'),
    edToolPig: document.getElementById('edToolPig'),
    edToolMove: document.getElementById('edToolMove'),
    edToolErase: document.getElementById('edToolErase'),
    edMatWood: document.getElementById('edMatWood'),
    edMatIce: document.getElementById('edMatIce'),
    edMatStone: document.getElementById('edMatStone'),
    edSizeS: document.getElementById('edSizeS'),
    edSizeM: document.getElementById('edSizeM'),
    edSizeL: document.getElementById('edSizeL'),
    edSizeLong: document.getElementById('edSizeLong'),
    edRotate: document.getElementById('edRotate'),
    edRotateFloat: document.getElementById('edRotateFloat'),
    levelChip: document.getElementById('levelChip'),
    skillChip: document.getElementById('skillChip'),
    skillChipImg: document.querySelector('#skillChip img'),
    skillChipText: document.querySelector('#skillChip span'),
    introLabel: document.getElementById('introLabel'),
    introTag: document.querySelector('#introLabel .tag'),
    introSub: document.querySelector('#introLabel .sub'),
    skipTip: document.getElementById('skipTip'),
    roster: document.getElementById('roster'),
    pick: document.getElementById('pickScreen'),
    pickRoster: document.getElementById('pickRoster'),
    pickSub: document.getElementById('pickSub'),
    btnPickRandom: document.getElementById('btnPickRandom'),
    bossBar: document.getElementById('bossBar'),
    bossBarName: document.getElementById('bossBarName'),
    bossBarFill: document.getElementById('bossBarFill'),
    zoomLabel: document.getElementById('zoomLabel'),
    buildStamp: document.getElementById('buildStamp'),
    btnZoomIn: document.getElementById('btnZoomIn'),
    btnZoomOut: document.getElementById('btnZoomOut'),
    btnZoomFit: document.getElementById('btnZoomFit'),
    boardScreen: document.getElementById('boardScreen'),
    scoreBoardNotice: document.getElementById('scoreBoardNotice'),
    scoreBoardList: document.getElementById('scoreBoardList'),
    scoreBoardEmpty: document.getElementById('scoreBoardEmpty'),
    btnScoreAll: document.getElementById('btnScoreAll'),
    btnScoreWeek: document.getElementById('btnScoreWeek'),
    btnScoreBoardClose: document.getElementById('btnScoreBoardClose'),
  };
  const engine = Engine.create({ positionIterations: 10, velocityIterations: 8 });
  engine.gravity.y = 1;
  const world = engine.world;
  /** 版本戳：每次改完随手改一下，标题页角落和 window.__nai.build 都能看到，
   *  方便确认浏览器里跑的是不是最新那份（file:// 打开时页面不会自己刷新） */
  const BUILD = '2026-10-21 · 弹弓榜结算修复';
  let state = 'title'; // title | pick | intro | aim | fly | settling | clearing | restartConfirm | over
  let score = 0;
  let birdsLeft = 0;
  let birdQueue = [];      // 还没上弓的奶蛋类型
  let levelBirds = [];     // 这一关的完整阵容（无尽模式含"开局选蛋"挑出来的那颗），开场动画和弹药显示都看它
  let pickChoice = null;   // 玩家在"开局选蛋"里挑的那颗：同一局后面几关自动沿用它，不再问
  let autoPickSession = false; // 调试/自动流程里不弹"开局选蛋"，也不记玩家的选择
  let currentBird = 'naidan';
  let skillUsed = false;
  let bombs = [];          // 奶泡蛋丢下来的奶泡炸弹
  let explosions = [];     // 冲击波表现
  let sparks = [];         // 技能特效（冲刺残影、分身星点）
  let inFlight = [];       // 本次发射中所有还在场上的奶蛋（含分身）
  // 模式与进度
  let mode = 'level1';     // level1 | endless
  let endlessLevel = 1;
  let matchSeed = 1;
  let totalScore = 0;      // 无尽模式的累计分
  let levelStartScore = 0; // 进这一关时的分数（重打 boss 关要退回）
  let bossRetryUsed = false; // boss 关的重打机会用掉了没
  let retryPending = false;  // 结算面板上点"再来一次"是重打 boss 关
  let carriedNuke = 0;       // 无尽模式未使用的核爆蛋，保留到下一关
  let nukeFlash = 0;
  let endlessResume = null;   // 中途退出无尽时的暂停点（同一页面内恢复）
  let resumePaused = false;
  let pausedCallbacks = [];
  const runStats = { pigs: 0, blocks: 0, bosses: 0, bonus: 0 };
  let levelStartStats = { ...runStats };
  let runStartedAt = 0;
  let scoreSubmitted = false;
  let scoreSubmitBusy = false;
  let finalRunStats = null;
  let finalRunLevel = 1;
  let finalRunSeconds = 0;
  let finalRunScore = 0;
  let scoreBoardKind = 'all';
  let scoreBoardReturn = 'title';
  let restartPrevState = null;
  let restartUiPaused = false;
  let intro = null;        // 开场动画时间轴
  let lightning = 0;       // boss 关的闪电亮度
  let lightningTimer = 4200;
  let cutInStrength = 0;   // boss 登场特写的强度（在 step 里算，在 render 里画）
  let pigs = [];
  let blocks = [];
  let birds = [];
  let activeBird = null;
  let trail = [];
  let particles = [];
  let floaters = [];
  let flyingPigs = [];
  let flyingBosses = [];
  let dustPuffs = [];
  let aimMarks = [];       // 制导奶蛋点过的位置（靶心标记）
  let drag = null;
  let pan = null;          // 拖动地图（按住空白处平移镜头）
  let queueHover = -1;     // 鼠标悬停在等候区第几颗上（只是画个高亮）
  // 调试/验收用：最近的发射记录 + "不该发生的输入状态"记录（抓偶发怪弹道全靠它）
  const launchLog = [];
  const oddLog = [];
  const noteOdd = (msg) => { if (oddLog.length < 60) oddLog.push(`${Math.round(timeMs)}ms 第${stageIndex + 1}段 ${msg}`); };
  let calmFrames = 0;
  let shotTimer = 0;
  let blinkTimer = 0;
  let blinking = false;
  let timeMs = 0;
  let hintHidden = false;
  let levelToken = 0; // 换关/重开时自增，用来作废上一关遗留的延后回调

  /** 只在同一关内生效的延后回调（防止重开后上一关的定时器把流程搅乱） */
  const afterDelay = (ms, fn) => {
    const token = levelToken;
    setTimeout(() => {
      if (token !== levelToken) return;
      if (resumePaused || restartUiPaused) { pausedCallbacks.push({ token, fn }); return; }
      fn();
    }, ms);
  };
  // ---------------------------------------------------------------- 画布尺寸
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fitCanvas = () => {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = Math.round(W * scale) + 'px';
    canvas.style.height = Math.round(H * scale) + 'px';
  };
  window.addEventListener('resize', fitCanvas);
  fitCanvas();
  // ---------------------------------------------------------------- 关卡搭建
  const tag = (body, info) => {
    body.game = info;
    return body;
  };
  /** immediateLoad=false 时只搭场景、不上弹（留给"开局选蛋"界面来装第一颗） */
  const buildLevel = (def = level, immediateLoad = true) => {
    level = def;
    levelToken += 1; // 换关/重开：作废上一关遗留的延后回调（比如"推进到下一段""下一关"）
    Composite.clear(world, false, true);
    pigs = [];
    blocks = [];
    birds = [];
    bombs = [];
    explosions = [];
    sparks = [];
    inFlight = [];   // 换关时别忘了把上一发的奶蛋从"飞行中"名单里清掉，否则会画出一只幽灵
    activeBird = null;
    trail = [];
    particles = [];
    floaters = [];
    flyingPigs = [];
    flyingBosses = [];
    dustPuffs = [];
    aimMarks = [];
    drag = null;
    // 换关/重开一律先把"开局选蛋"面板收掉（promptPick 会在搭好场景之后再把它叫出来）
    pendingPick = null;
    el.pick.classList.add('hide');
    calmFrames = 0;
    winQueued = false;
    skillUsed = false;
    setStage(0);
    CAM.zoom = 1;
    CAM.targetZoom = 1;
    CAM.x = homeCamX();
    CAM.targetX = CAM.x;
    CAM.y = 0;
    updateScore();
    const ground = Bodies.rectangle(worldW() / 2, GROUND_Y + 60, worldW() + 800, 120, {
      isStatic: true,
      friction: 0.9,
      label: 'ground',
    });
    const leftWall = Bodies.rectangle(-120, H / 2, 240, H * 3, { isStatic: true, label: 'wall' });
    const rightWall = Bodies.rectangle(worldW() + 120, H / 2, 240, H * 3, { isStatic: true, label: 'wall' });
    Composite.add(world, [ground, leftWall, rightWall]);
    level.blocks.forEach((b) => {
      const mat = MATS[b.material];
      const body = Bodies.rectangle(b.x, b.y, b.w, b.h, {
        density: mat.density,
        friction: mat.friction,
        frictionStatic: mat.frictionStatic ?? 1,
        restitution: mat.restitution,
        label: 'block',
      });
      if (b.angle) Body.setAngle(body, b.angle);
      // 血量按面积缩放：标准件（约 6000 平方像素）拿满血，小件按比例打折
      const scale = 0.42 + 0.58 * ((b.w * b.h) / 6000);
      const hp = mat.hp * scale * (b.hpScale || 1);
      tag(body, { kind: 'block', material: b.material, hp, maxHp: hp, w: b.w, h: b.h, stage: b.stage || 0 });
      blocks.push(body);
      Composite.add(world, body);
    });
    level.pigs.forEach((p) => {
      const isBoss = !!p.boss;
      const body = Bodies.circle(p.x, p.y, p.r, {
        density: isBoss ? 0.0011 : 0.0011,
        friction: isBoss ? 0.99 : 0.92,
        frictionStatic: isBoss ? 2.2 : 1.4,
        frictionAir: 0.01,
        restitution: isBoss ? 0.03 : 0.08,
        label: 'pig',
      });
      const hp = 85 + (p.hpBonus || 0);
      const stats = window.BossLevel.STATS[p.bossTier || 1];
      tag(body, {
        kind: 'pig',
        boss: isBoss,
        bonus: !!p.bonus, // 补给奶蛙：打掉补一颗奶蛋
        bossTier: p.bossTier || 0,
        directK: isBoss ? stats.direct : 1,
        blastK: isBoss ? stats.blast : 1,
        fallK: isBoss ? stats.fall : 0,
        hp: isBoss ? p.hp : hp,
        maxHp: isBoss ? p.hp : hp,
        r: p.r,
        hurt: 0,
        alive: true,
        born: timeMs,
        stage: p.stage || 0,
      });
      pigs.push(body);
      Composite.add(world, body);
    });
    levelBirds = level.birds.slice();
    birdQueue = levelBirds.slice();
    birdsLeft = birdQueue.length;
    levelStartScore = score; // 重打 boss 关时把分数退回到这一关开始的时候
    levelStartStats = { ...runStats };
    updateAmmo();
    updateBossBar();
    if (immediateLoad) loadBird();
  };
  const birdShape = (type, scale = 1) => {
    const t = BIRDS[type] || BIRDS.naidan;
    return Bodies.circle(slingAnchor().x, slingAnchor().y, t.r * scale, {
      density: t.density * (scale < 1 ? window.BIRD_CHILD.densityScale : 1),
      friction: 0.5,
      frictionAir: t.frictionAir,
      restitution: t.restitution,
      label: 'bird',
    });
  };
  /** 把某种奶蛋架上弹弓（不动队列）；正常上膛和"点等候区换弹"都走这里 */
  const mountBird = (type) => {
    // 兜底清场：场上不该有"没发射的奶蛋"残留（正常流程会在换弹时收掉它）。
    // 万一哪条路径漏了一颗，它就会挂在半空——玩家看到的就是"奶蛋掉在原来点击的位置"。
    birds.filter((b) => !b.game.launched).forEach((b) => removeBird(b));
    if (activeBird) removeBird(activeBird);
    currentBird = type;
    const body = birdShape(type);
    Body.setStatic(body, true);
    Body.setPosition(body, slingAnchor());
    tag(body, { kind: 'bird', type, launched: false, squash: 0, spin: 0, child: false });
    body.game.plow = 0;
    activeBird = body;
    birds.push(body);
    Composite.add(world, body);
    skillUsed = false;
    updateSkillChip();
    state = 'aim';
  };
  const loadBird = () => {
    // 弓上已经有一颗"没发射"的奶蛋（拉弓被转波次/结算打断时留下的）：留着它，别再换一颗。
    // 换弹 = 把它从队列里顶掉，玩家手里那颗就"凭空消失"、还白吃一颗。
    if (activeBird && !activeBird.game.launched) {
      state = 'aim';
      return;
    }
    if (!birdQueue.length) {
      // 兜底：没弹可上就说明这一局打不下去了，别再让回合空转
      if (state === 'over' || state === 'clearing' || state === 'title') return;
      roundToken += 1;   // 回合在这里也要收尾，延后的结算回调同样作废
      if (pigs.length === 0) win(0);
      else lose();
      return;
    }
    mountBird(birdQueue.shift());
  };
  // ---------------------------------------------------------------- 伤害
  const MAX_IMPACT_SPEED = 46;
  /** 拆障碍物加成：奶蛋打方块额外 ×1.35（打奶蛙不加，避免顺手把关卡手感改掉） */
  const BLOCK_DMG = 1.35;
  /** 撞碎方块后保留多少速度，以及一发最多连拆几块 */
  const PLOW_KEEP = 0.86;
  const PLOW_MAX = 3;
  /** 物块摔落伤害：只要自己正在往下砸，就按"自身质量 × 下坠速度"算动能，再乘这个加成 */
  const FALL_DMG = 2.4;
  const FALL_MIN_V = 3.5;
  const handleCollision = (pairs) => {
    pairs.forEach((pair) => {
      const { bodyA, bodyB } = pair;
      // 奶泡炸弹一碰就炸；爆奶蛋撞上东西之后点引信（过一会儿自己炸）
      for (const [a, b] of [[bodyA, bodyB], [bodyB, bodyA]]) {
        if (a.game && a.game.kind === 'bomb' && !a.game.dead) {
          if (b.game && b.game.kind === 'bird') continue; // 刚脱手的奶泡别自己撞自己
          a.game.dead = true;
          Composite.remove(world, a);
          explode(a.position.x, a.position.y, MILK_BOOM);
          return;
        }
        if (a.game && a.game.kind === 'bird' && a.game.type === 'bomb' && a.game.launched && !a.game.exploded) {
          const info = b.game;
          const strong = info && info.kind !== 'bird';
          if (strong && !a.game.armed) {
            a.game.armed = true;
            a.game.fuse = 170;
          }
        }
      }
      for (const [self, other] of [[bodyA, bodyB], [bodyB, bodyA]]) {
        const info = self.game;
        if (!info || info.kind === 'bird' || info.dead) continue;
        const rv = Vector.sub(bodyA.velocity, bodyB.velocity);
        const speed = Math.min(MAX_IMPACT_SPEED, Vector.magnitude(rv));
        const m = other.isStatic ? 7 : Math.max(0.4, other.mass);
        const energy = 0.5 * m * speed * speed;
        if (energy < 20) continue;
        let dmg = (energy - 20) * 0.115;
        // 物块自己摔下来：动能按它自己的质量算（原来固定按 7 算，等于白摔），
        // 而且砸到什么（地面还是别的方块）都算，这样塌方会一路碎下来
        if (info.kind === 'block') {
          const vDown = other.isStatic ? speed : Math.max(0, self.velocity.y);
          if (vDown > FALL_MIN_V) {
            const selfEnergy = 0.5 * self.mass * vDown * vDown;
            dmg = Math.max(dmg, (selfEnergy - 20) * 0.115) * FALL_DMG;
          }
        }
        // 是奶蛋撞的：吃它的伤害倍率（胖奶蛋更狠），打方块再吃拆障碍物加成
        const attacker = other.game;
        const byBird = !!(attacker && attacker.kind === 'bird');
        if (byBird) {
          const t = BIRDS[attacker.type] || BIRDS.naidan;
          dmg *= attacker.child ? window.BIRD_CHILD.damage : t.damage || 1;
          if (info.kind === 'block') dmg *= BLOCK_DMG;
        }
        if (info.boss) {
          // boss：直接挨打打折（摔伤在每帧逻辑里单独判，见 bossLandingDamage）
          dmg = dmg * info.directK;
          info.lastImpact = { kind: 'direct', dmg: Math.round(dmg) };
        } else {
          // 重的东西砸下来比同样速度的小碎块疼得多
          if (info.kind === 'pig') dmg += m * 3.4;
        }
        const vBefore = byBird ? { x: other.velocity.x, y: other.velocity.y } : null;
        hitBody(self, dmg, energy, other);
        // 撞碎方块之后保留大部分速度：一发奶蛋能连着拆好几块（有次数上限，别飞个没完）
        if (vBefore && info.kind === 'block' && info.dead && attacker && (attacker.plow || 0) < PLOW_MAX) {
          Body.setVelocity(other, { x: vBefore.x * PLOW_KEEP, y: vBefore.y * PLOW_KEEP });
          attacker.plow = (attacker.plow || 0) + 1;
          addSpark(other.position.x, other.position.y, 8, '#ffe9b0', 'star');
        }
      }
    });
  };
  const hitBody = (body, dmg, energy, other) => {
    const info = body.game;
    if (!info || info.dead || info.kind === 'bird') return;
    const mat = info.kind === 'block' ? MATS[info.material] : null;
    if (mat) dmg *= mat.toughness ?? 1;
    info.hp -= dmg;
    info.flash = Math.min(1, 0.25 + dmg / 120);
    if (info.kind === 'pig') info.hurt = Math.min(1, info.hurt + dmg / 90);
    const strength = clamp(energy / 420, 0.18, 1.3);
    AudioKit.thud(strength * (mat ? 1 : 0.8));
    if (mat && mat.sfx && dmg > 6) AudioKit[mat.sfx]();
    spawnDebris(body, strength, mat ? mat.color : '#ffe08a', 3 + Math.round(strength * 5));
    if (info.boss) {
      updateBossBar(true);
      if (dmg > 30) AudioKit.bossHurt();
    }
    if (info.hp <= 0) destroy(body);
  };
  const destroy = (body) => {
    const info = body.game;
    if (!info || info.dead) return;
    info.dead = true;
    if (info.kind === 'pig') {
      pigs = pigs.filter((p) => p !== body);
      if (info.boss) {
        // boss 死法：仰天大笑，慢悠悠翻着飞出画面
        if (state !== 'over' && state !== 'clearing') {
          score += 30000;
          runStats.bosses += 1;
        }
        addFloater(body.position.x, body.position.y - 90, 'BOSS +30000', '#ff9a3c');
        flyingBosses.push({
          x: body.position.x,
          y: body.position.y,
          vx: 3.2,
          vy: -13,
          spin: 0.06,
          angle: -0.12,
          life: 1,
          r: info.r,
        });
        // 倒下这一下放那声真实的大笑（素材前 3 秒，见 tools/make-boss-laugh.mjs）。
        // 万一音频没加载好 / 被静音，就退回合成的"长笑 + 奶蛙起哄"，别让这一下哑掉。
        if (!playBossLaugh()) {
          AudioKit.bossLaugh();
          afterDelay(420, () => AudioKit.laugh());
          afterDelay(1500, () => AudioKit.laugh());
          pigs.slice(0, 2).forEach((p, i) => afterDelay(700 + i * 180, () => AudioKit.laugh()));
        }
        burst(body.position.x, body.position.y, 40, '#ffe9a8', 'cream');
        confetti(body.position.x, body.position.y, 70);
        shake(20);
        winQueued = false;
        updateScore();
        Composite.remove(world, body);
        maybeFinish();
        return;
      }
      if (state !== 'over' && state !== 'clearing') {
        score += 5000;
        runStats.pigs += 1;
      }
      addFloater(body.position.x, body.position.y - 40, '+5000', '#ff6f3c');
      // 补给奶蛙：随机往队列里塞一颗奶蛋
      if (info.bonus) {
        const pool = window.birdPoolFor(endlessLevel || 1).map(([k]) => k);
        const pick = pool[Math.abs(Math.round(body.position.x)) % pool.length];
        birdQueue.push(pick);
        birdsLeft += 1;
        updateAmmo();
        const gained = (BIRDS[pick] || BIRDS.naidan).name;
        addFloater(body.position.x, body.position.y - 82, `补给 +1 ${gained}`, '#3aa76d');
        burst(body.position.x, body.position.y - 40, 16, '#c8f0a0', 'star');
        AudioKit.ready();
      }
      flyingPigs.push({
        x: body.position.x,
        y: body.position.y,
        vx: rand(2, 5) * (Math.random() < 0.5 ? -1 : 1) + 1.5,
        vy: rand(-9, -5),
        spin: rand(-0.22, 0.22),
        angle: rand(-0.3, 0.3),
        life: 1,
        r: info.r,
      });
      AudioKit.pop();
      AudioKit.laugh();
      burst(body.position.x, body.position.y, 22, '#ffe9a8', 'cream');
      shake(9);
    } else {
      blocks = blocks.filter((b) => b !== body);
      if (state !== 'over' && state !== 'clearing') {
        score += 500;
        runStats.blocks += 1;
      }
      addFloater(body.position.x, body.position.y - 20, '+500', '#c98a4b');
      const mat = MATS[info.material];
      burst(body.position.x, body.position.y, 16, mat.color, 'chunk');
      AudioKit[mat.sfx]();
      shake(6);
    }
    Composite.remove(world, body);
    updateScore();
    if (info.kind === 'pig') maybeFinish();
  };

  // 最后一只奶蛙翻车之后，让它的笑声在屏幕上多飞一会儿再结算
  let winQueued = false;
  // 每一发（回合）自增一次。下面那个"等 0.95 秒再结算"的回调只认自己那一发的 token：
  // 这一发要是早就结算过了（奶蛋自己停下来 → endShot），回调就什么都别做。
  let roundToken = 0;
  /** 当前这一段的奶蛙是不是都翻车了（后面几段的奶蛙不算） */
  const stageCleared = () => pigs.every((p) => (p.game.stage || 0) > stageIndex);
  const maybeFinish = () => {
    if (state === 'title' || state === 'over' || winQueued) return;
    if (!stageCleared()) return;
    winQueued = true;
    const token = roundToken;
    afterDelay(950, () => {
      winQueued = false;
      if (state === 'title' || state === 'over') return;
      // 这 0.95 秒里回合可能已经结束了（奶蛋停下 → endShot → 推进/清场/结算）。
      // 以前这里会再补一次 endShot：把下一段的瞄准硬生生打断（手上的拉弓被作废、
      // 已上弓的奶蛋被收走又换一颗 = 白白少吃一颗），清场时还会重复结算、连跳两关。
      if (token !== roundToken) return;
      endShot();
    });
  };

  /**
   * 从当前段往后找"第一个还有奶蛙的段"，没有就返回 -1。
   * 为什么要往后扫而不是直接 +1：玩家可能先用大弧线把**后面的段**清了
   * （比如第 1 发就砸掉最后一段），这时候再按 +1 推进，就会把弹弓推到一段空地上——
   * 玩家必须再补一发才结算，看着就像"打空了还不结束"。
   */
  const nextStageWithPigs = () => {
    for (let s = stageIndex + 1; s < stageCount(); s++) {
      if (pigs.some((p) => (p.game.stage || 0) === s)) return s;
    }
    return -1;
  };
  /** 一段清完了：把弹弓（连同待发的奶蛋）往前推到下一段 */
  const advanceStage = (target) => {
    const next = target === undefined ? nextStageWithPigs() : target;
    if (next < 0) {
      // 保险：后面已经一段不剩了（后面的段提前被打光），直接结算，别空推
      win(Math.max(0, birdsLeft));
      return;
    }
    // 弹弓马上要整根挪到下一段：手上正攥着的拉弓作废（奶蛋要跟着回到弓上）
    dropDrag('转波次');
    setStage(next);
    // 弓上还架着一颗没发射的：把它一起挪到新弹弓上（它要跟着走，不是被换掉）
    if (activeBird && !activeBird.game.launched) {
      Body.setPosition(activeBird, slingAnchor());
      activeBird.positionPrev.x = slingAnchor().x;
      activeBird.positionPrev.y = slingAnchor().y;
    }
    updateLevelChip();
    toast(stageCount() > 1 ? `推进到第 ${stageIndex + 1} / ${stageCount()} 段！` : '前进！', 1500);
    AudioKit.levelUp();
    burst(sling.x, GROUND_Y - 40, 18, '#ffe9a8', 'cream');
    state = 'settling';
    CAM.targetX = homeCamX();
    afterDelay(900, () => {
      if (state !== 'settling') return;
      loadBird();
    });
  };
  // ---------------------------------------------------------------- 粒子 / 文本
  const burst = (x, y, n, color, kind) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(1.5, 7);
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - rand(1, 4),
        r: kind === 'cream' ? rand(5, 11) : rand(3, 8),
        life: 1,
        decay: rand(0.012, 0.026),
        color,
        kind,
        rot: rand(0, 6.28),
        spin: rand(-0.3, 0.3),
      });
    }  };
  const spawnDebris = (body, strength, color, n) => {
    for (let i = 0; i < n; i++) {
      particles.push({
        x: body.position.x + rand(-14, 14),
        y: body.position.y + rand(-14, 14),
        vx: rand(-3, 3),
        vy: rand(-5, -0.5),
        r: rand(2, 5) * strength,
        life: 1,
        decay: rand(0.02, 0.04),
        color,
        kind: 'chunk',
        rot: 0,
        spin: 0,
      });
    }  };
  const addFloater = (x, y, text, color) => floaters.push({ x, y, text, color, life: 1 });
  /** 彩带：boss 倒下时撒的（纯粹的排面） */
  const confetti = (x, y, n) => {
    const colors = ['#ff8a5b', '#ffd45f', '#7ed6a5', '#7fb2ff', '#ff9ecb', '#fff3d6'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(2, 11);
      particles.push({
        x: x + rand(-40, 40),
        y: y + rand(-40, 40),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - rand(2, 6),
        r: rand(5, 11),
        life: 1,
        decay: rand(0.006, 0.014),
        color: colors[Math.floor(Math.random() * colors.length)],
        kind: 'confetti',
        rot: rand(0, 6.28),
        spin: rand(-0.35, 0.35),
      });
    }
  };
  const shake = (v) => { CAM.shake = Math.min(22, CAM.shake + v); };
  const toast = (text, ms = 1400) => {
    el.toast.textContent = text;
    el.toast.style.transition = 'none';
    el.toast.style.opacity = '1';
    el.toast.style.transform = 'translateX(-50%) scale(1.15)';
    requestAnimationFrame(() => {
      el.toast.style.transition = 'opacity .5s ease, transform .5s cubic-bezier(.2,1.6,.4,1)';
      el.toast.style.transform = 'translateX(-50%) scale(1)';
      setTimeout(() => { el.toast.style.opacity = '0'; }, ms);
    });
  };
  // ---------------------------------------------------------------- 弹弓 / 输入
  const pointerToWorld = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const nx = (ev.clientX - rect.left) / rect.width;
    const ny = (ev.clientY - rect.top) / rect.height;
    return { x: CAM.x + nx * viewW(), y: CAM.y + ny * viewH() };
  };
  /**
   * 把"手指位置"折算成合法的后拉偏移：长度封顶 MAX_PULL，方向只准往左后方。
   * 拖动过程中和松手发射时用的是同一份计算——松手那一下要是自己算一遍，
   * 中间弹弓挪过位置（转波次）就会算出个反向的巨大拉力。
   */
  const pullOffset = (p) => {
    const d = Vector.sub(p, slingAnchor());
    const len = Vector.magnitude(d);
    const clamped = len > MAX_PULL ? Vector.mult(Vector.normalise(d), MAX_PULL) : d;
    return clamped.x > 30 ? { x: 30, y: clamped.y } : clamped;
  };
  const onDown = (ev) => {
    AudioKit.unlock();
    if (state === 'edit') { edDown(ev); ev.preventDefault(); return; }
    if (state === 'workshop') return;
    if (state === 'intro') { skipIntro(); ev.preventDefault(); return; }
    // 飞行中点屏幕 = 放技能；制导奶蛋要的是"点在哪里"，所以把世界坐标一起传进去
    if (state === 'fly') { activateSkill(pointerToWorld(ev)); ev.preventDefault(); return; }
    if (state !== 'aim' || !activeBird) return;
    const p = pointerToWorld(ev);
    // 等候区里那一排奶蛋是可以点的：点谁谁上弓（只有它们露在外面的时候才管用）
    if (!drag && promoteQueue(queueHit(p))) {
      hideHint();
      ev.preventDefault();
      return;
    }
    const near = Vector.magnitude(Vector.sub(p, activeBird.position)) < 150;
    // 从弹弓右侧的空白处按下 = 拖地图（松手后镜头自己滑回弹弓）
    if (!near && p.x > slingAnchor().x + 300) {
      pan = { pointerId: ev.pointerId, startWorld: p, startCamX: CAM.x, startCamY: CAM.y };
      canvas.setPointerCapture?.(ev.pointerId);
      ev.preventDefault();
      return;
    }
    if (!near && p.x > slingAnchor().x + 260) return;
    // stage 记下来：这一拖要是跨过了"转波次"，松手时就不认它了
    drag = { pointerId: ev.pointerId, x: slingAnchor().x, y: slingAnchor().y, lastSound: 0, power: 0, charge: 0, full: false, stage: stageIndex };
    canvas.setPointerCapture?.(ev.pointerId);
    hideHint();
    ev.preventDefault();
  };
  const onMove = (ev) => {
    if (state === 'edit') { edMove(ev); return; }
    if (pan && ev.pointerId === pan.pointerId) {
      const p = pointerToWorld(ev);
      CAM.x = clampCamX(pan.startCamX + (pan.startWorld.x - p.x));
      CAM.y = clampCamY(pan.startCamY + (pan.startWorld.y - p.y));
      CAM.targetX = CAM.x;
      ev.preventDefault();
      return;
    }
    if (!drag && !pan && ev.pointerType !== 'touch') {
      // 鼠标悬在等候区的奶蛋上时换成"能点"的手型
      queueHover = state === 'aim' ? queueHit(pointerToWorld(ev)) : -1;
      canvas.style.cursor = queueHover >= 0 ? 'pointer' : '';
    }
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const p = pointerToWorld(ev);
    // 只允许往左后方拉（否则会朝左发射）
    const dir = pullOffset(p);
    drag.x = slingAnchor().x + dir.x;
    drag.y = slingAnchor().y + dir.y;
    const pull = Vector.magnitude({ x: drag.x - slingAnchor().x, y: drag.y - slingAnchor().y });
    if (pull - drag.lastSound > 34) {
      AudioKit.stretch(clamp(pull / MAX_PULL, 0, 1));
      drag.lastSound = pull;
    }
    ev.preventDefault();
  };
  const onUp = (ev) => {
    if (state === 'edit') {
      if (ev && ev.type === 'pointercancel') { if (editor) { editor.press = null; editor.drag = null; } return; }
      edUp();
      return;
    }
    if (pan && ev.pointerId === pan.pointerId) {
      pan = null;
      ev.preventDefault();
      return;
    }
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const dropped = drag;
    drag = null;
    // 只有"瞄准中、而且这一拖没跨过转波次"才算发射。
    // 转波次会把弹弓整根挪到下一段，玩家手上却还攥着上一段的那一拖：
    // 那一下的松手既不该发射（会从新弹弓位置倒着甩出去），也不该去动奶蛋。
    const stale = dropped.stage !== stageIndex;
    if (state !== 'aim' || !activeBird || stale) {
      if (stale) noteOdd('松手时才发现这一拖跨了段（已作废）');
      else if (state !== 'aim') noteOdd(`松手时状态已经是 ${state}（已作废）`);
      if (activeBird) {
        Body.setPosition(activeBird, slingAnchor());
        activeBird.game.squash = 0;
      }
      return;
    }
    // 用和拖动时同一份夹取算拉力：哪怕中途镜头挪过、坐标已经对不上，也只会得到一个合法的后拉
    const off = pullOffset({ x: dropped.x, y: dropped.y });
    const pullVec = { x: -off.x, y: -off.y };
    const pull = Vector.magnitude(pullVec);
    if (pull < 16) {
      Body.setPosition(activeBird, slingAnchor());
      activeBird.game.squash = 0;
      return;
    }
    launch(pullVec.x * LAUNCH_K, pullVec.y * LAUNCH_K);
  };
  const followCam = (b) => {
    CAM.targetX = clampCamX(b.position.x - viewW() * 0.38);
  };

  /** 以视野中心为锚点缩放：滚轮、按键、双指捏合、HUD 按钮都走这里 */
  const setZoom = (z, anchor = null) => {
    const next = clamp(z, MIN_ZOOM, MAX_ZOOM);
    const cx = anchor ? anchor.x : CAM.x + viewW() / 2;
    const cy = anchor ? anchor.y : CAM.y + viewH() / 2;
    CAM.zoom = next;
    CAM.targetZoom = next;
    CAM.x = clampCamX(cx - viewW() / 2);
    CAM.y = clampCamY(cy - viewH() / 2);
    CAM.targetX = CAM.x;
    updateZoomLabel();
  };
  const updateZoomLabel = () => {
    if (el.zoomLabel) el.zoomLabel.textContent = `${Math.round(CAM.zoom * 100)}%`;
  };
  // ---------------------------------------------------------------- boss 技能
  /**
   * 每打出去 3 发奶蛋，奶皇就喊一只奶蛙站到自己跟前，并回 25% 血。
   * "跟前"= 塔前那片空地（跟已有护卫错开站位），新来的正好挡在塔腿前面：
   * 想继续拆塔就得先处理它——不过塔塌下来也会顺手把它压在下面。
   */
  const BOSS_SUMMON_EVERY = 3;
  const BOSS_SUMMON_HEAL = 0.25;
  // 同时最多留两只护卫：多了之后它会变成"永远够不着 boss"的死局
  // （塔倒了以后你平射过去全被护卫吃掉，而它每 3 发又补一只 + 回血，等于打不完）
  const BOSS_SUMMON_CAP = 2;
  const summonSpot = () => {
    const arenaX = level.boss ? level.boss.arenaX : 900;
    let x = arenaX - 130;
    for (let i = 0; i < 8; i++) {
      const p = { x, y: GROUND_Y - 36 };
      const tooClose = pigs.some((o) => Math.hypot(o.position.x - p.x, o.position.y - p.y) < 82);
      const inBlock = blocks.some((b) => {
        const info = b.game;
        return Math.abs(b.position.x - p.x) < (info.w || 0) / 2 + 40 && Math.abs(b.position.y - p.y) < (info.h || 0) / 2 + 40;
      });
      if (!tooClose && !inBlock) return p;
      x -= 92;   // 站满了就往弹弓那边退一格，排成一列
    }
    return { x: arenaX - 130 - 92 * 8, y: GROUND_Y - 36 };
  };
  const bossSummon = (boss) => {
    const heal = Math.round(boss.game.maxHp * BOSS_SUMMON_HEAL);
    const before = boss.game.hp;
    boss.game.hp = Math.min(boss.game.maxHp, boss.game.hp + heal);
    const got = Math.round(boss.game.hp - before);
    // 站位越高叫得越多：Lv3 一次喊两只，塔前直接多一堵人墙（但不许堆成拆不掉的一整排）
    const stats = window.BossLevel.STATS[boss.game.bossTier || 1];
    const live = pigs.filter((p) => p.game.summoned && !p.game.dead).length;
    const count = Math.min(stats.guards || 1, Math.max(0, BOSS_SUMMON_CAP - live));
    for (let i = 0; i < count; i++) {
      const spot = summonSpot();
      const body = Bodies.circle(spot.x, spot.y, 36, {
        density: 0.0011,
        friction: 0.92,
        frictionStatic: 1.4,
        frictionAir: 0.01,
        restitution: 0.08,
        label: 'pig',
      });
      tag(body, { kind: 'pig', summoned: true, hp: 85, maxHp: 85, r: 36, hurt: 0, alive: true, born: timeMs, stage: boss.game.stage });
      pigs.push(body);
      Composite.add(world, body);
      burst(spot.x, spot.y, 14, '#ffe9a8', 'cream');
    }
    boss.game.summons = (boss.game.summons || 0) + 1;
    // 表现：boss 身上一圈召唤波，新奶蛙落地一圈尘
    burst(boss.position.x, boss.position.y - 50, 20, '#ffb0c8', 'star');
    addSpark(boss.position.x, boss.position.y - 40, 16, '#ffd6e2', 'star');
    shake(10);
    // 回血不写字：血条会当场往回跳一下、再冒一层绿光就够了
    // （只在第 1 次触发时给一句提示，把规则说清楚，之后不再啰嗦）
    if (got > 0) {
      addSpark(boss.position.x, boss.position.y - 30, 18, '#8ef0b6', 'star');
      burst(boss.position.x, boss.position.y - 70, 10, '#c8f7d8', 'cream');
    }
    if (boss.game.summons === 1) toast(`每 3 发奶蛋，${window.BOSS_NAME}就喊帮手 + 回 25% 血`, 2400);
    AudioKit.bossSummon();
    setTimeout(() => AudioKit.laugh(), 260);
    updateBossBar(true);
  };
  /** 记一发：数够 3 发就让 boss 放技能（只在 boss 那一段里算，前哨那波不算） */
  const bossSkillTick = () => {
    const boss = pigs.find((p) => p.game.boss);
    if (!boss || boss.game.dead) return;
    if ((boss.game.stage || 0) !== stageIndex) return;
    boss.game.shots = (boss.game.shots || 0) + 1;
    if (boss.game.shots % BOSS_SUMMON_EVERY === 0) bossSummon(boss);
  };
  const launch = (vx, vy) => {
    const b = activeBird;
    b.game.launched = true;
    // 调试/验收用：记下这一发的初速度（用来抓"反向发射"这类偶发怪弹道）
    launchLog.push({
      t: Math.round(timeMs),
      vx: Math.round(vx * 100) / 100,
      vy: Math.round(vy * 100) / 100,
      speed: Math.round(Vector.magnitude({ x: vx, y: vy }) * 100) / 100,
      slingX: Math.round(sling.x),
      stage: stageIndex + 1,
      bird: currentBird,
    });
    if (launchLog.length > 30) launchLog.shift();
    b.game.squash = 1;
    b.game.launchAt = timeMs;
    Body.setStatic(b, false);
    Body.setVelocity(b, { x: vx, y: vy });
    // 不给随机旋转：同一发角度+力度每次结果一致，玩家才能"学"这一关
    Body.setAngularVelocity(b, 0.02 * Math.sign(vx || 1));
    state = 'fly';
    shotTimer = 0;
    calmFrames = 0;
    trail = [];
    inFlight = [b];
    // 奶蛋在发射瞬间就被消耗掉（后面那颗才会上弓）
    birdsLeft -= 1;
    updateAmmo();
    bossSkillTick();   // boss 关：数到第 3 发就喊帮手 + 回血
    followCam(b);
    AudioKit.launch();
    AudioKit.flyStart();
    updateSkillChip();
    if (b.game.type === 'nuke') {
      afterDelay(260, () => {
        if (!b.game.dead && b.game.launched) nuclearBlast(b);
      });
    }
  };

  // ---------------------------------------------------------------- 技能
  const addSpark = (x, y, n, color, kind) => {
    for (let i = 0; i < n; i++) {
      sparks.push({
        x, y,
        vx: rand(-6, 6), vy: rand(-6, 6),
        life: 1, decay: rand(0.02, 0.05), r: rand(3, 9), color, kind,
      });
    }
  };

  /** 爆奶蛋的爆炸参数：范围大、伤害高，一发能掀掉一片 */
  const BOOM = { radius: 250, dmg: 560, push: 0.085, color: '#ffb04a', n: 46 };
  // 奶泡蛋丢下来的那颗奶泡：威力提上来（以前太温柔，炸不动东西）
  const MILK_BOOM = { radius: 215, dmg: 430, push: 0.072, color: '#dff1ff', n: 32 };

  /** 爆炸：范围伤害 + 冲击推开 + 冲击波表现 */
  const explode = (x, y, opts = {}) => {
    const { radius, push, dmg, color, n, shakeAmt, nuke = false } = { ...BOOM, ...opts };
    shake(shakeAmt === undefined ? 14 + radius * 0.055 : shakeAmt);
    AudioKit.boom();
    burst(x, y, n, color, 'chunk');
    burst(x, y, Math.round(n * 0.6), '#fff3d6', 'cream');
    addSpark(x, y, Math.round(n * 0.4), '#ffd98a', 'star');
    explosions.push({ x, y, life: 1, radius, nuke });
    for (const b of [...blocks, ...pigs]) {
      if (b.game.dead) continue;
      const d = Vector.magnitude(Vector.sub(b.position, { x, y }));
      if (d > radius) continue;
      const f = 1 - d / radius;
      // 衰减别太陡：爆炸边缘也要真的能拆掉东西，不然"炸了个响"
      // boss 另算折扣：它能靠爆炸被硬砸掉的话，"摔伤是主要解法"就不成立了
      const k = b.game.blastK === undefined ? 1 : b.game.blastK;
      hitBody(b, dmg * Math.pow(f, 1.3) * k, 300 * f, null);
      const dir = d < 0.001 ? { x: 0, y: -1 } : Vector.normalise(Vector.sub(b.position, { x, y }));
      Body.applyForce(b, b.position, { x: dir.x * push * f * b.mass, y: (dir.y - 0.3) * push * f * b.mass });
    }
  };

  /** 核爆奶蛋：发射后短暂飞行即引爆，按整张地图半径强制清场 */
  const nuclearBlast = (bird) => {
    if (!bird || bird.game.dead) return;
    bird.game.exploded = true;
    bird.game.dead = true;
    const x = bird.position.x;
    const y = bird.position.y;
    nukeFlash = 1;
    explode(x, y, {
      radius: Math.max(worldW() * 1.4, H * 3),
      dmg: 999999,
      push: 0.14,
      color: '#dff8ff',
      n: 120,
      shakeAmt: 28,
      nuke: true,
    });
    addSpark(x, y, 42, '#bdefff', 'star');
    removeBird(bird);
  };

  /** 冲击波：中心白光 + 向外扩散的环 */
  const drawExplosions = () => {
    explosions.forEach((e) => {
      const k = 1 - e.life; // 0 → 1
      ctx.save();
      const core = ctx.createRadialGradient(e.x, e.y, 2, e.x, e.y, e.radius * 0.62);
      core.addColorStop(0, `rgba(${e.nuke ? '230,252,255' : '255,255,240'},${0.9 * e.life})`);
      core.addColorStop(0.5, `rgba(${e.nuke ? '120,220,255' : '255,200,110'},${0.5 * e.life})`);
      core.addColorStop(1, e.nuke ? 'rgba(60,160,255,0)' : 'rgba(255,150,60,0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * 0.62, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 2; i++) {
        const ph = clamp(k * 1.35 - i * 0.18, 0, 1);
        if (ph <= 0) continue;
        ctx.globalAlpha = (1 - ph) * (i ? 0.5 : 0.95);
        if (e.nuke && typeof ctx.createConicGradient === 'function') {
          const rainbow = ctx.createConicGradient(timeMs / 260 + i, e.x, e.y);
          ['#ff5f6d', '#ffc371', '#f8ff72', '#56ff9a', '#55ddff', '#8e7dff', '#ff6ee7', '#ff5f6d']
            .forEach((color, n, arr) => rainbow.addColorStop(n / (arr.length - 1), color));
          ctx.strokeStyle = rainbow;
        } else {
          ctx.strokeStyle = e.nuke ? (i ? '#8bdcff' : '#effdff') : (i ? '#ffd9a0' : '#fff6de');
        }
        ctx.lineWidth = (i ? 3 : 7) * (1 - ph) + 1;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius * (0.22 + ph * 0.95), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    });
  };

  /** 飞行中点击屏幕 = 放技能 */
  const activateSkill = (pt) => {
    if (state !== 'fly' || !activeBird || skillUsed) return false;
    const t = BIRDS[activeBird.game.type] || BIRDS.naidan;
    if (!t.skill) return false;
    const b = activeBird;
    skillUsed = true;
    if (t.skill === 'dash') {
      const v = b.velocity;
      const len = Vector.magnitude(v) || 1;
      const nx = v.x / len;
      const ny = v.y / len;
      const boosted = clamp(len * 1.75, 26, 34);
      Body.setVelocity(b, { x: nx * boosted, y: ny * boosted + 1.2 });
      b.game.squash = 1;
      for (let i = 0; i < 12; i++) {
        sparks.push({ x: b.position.x - nx * i * 7, y: b.position.y - ny * i * 7, vx: -nx * 3, vy: rand(-1, 1), life: 1, decay: 0.05, r: rand(4, 9), color: '#ffd9a0', kind: 'streak' });
      }
      shake(7);
      AudioKit.dash();
    } else if (t.skill === 'split') {
      const child = window.BIRD_CHILD;
      const v = b.velocity;
      const baseAng = Math.atan2(v.y, v.x);
      const speed = Math.max(9, Vector.magnitude(v)) * 1.04;
      for (const off of [-child.spreadDeg, child.spreadDeg]) {
        const a = baseAng + deg(off);
        const body = birdShape(t.key, child.rScale);
        Body.setPosition(body, { x: b.position.x + Math.cos(a) * 26, y: b.position.y + Math.sin(a) * 26 });
        Body.setStatic(body, false);
        Body.setVelocity(body, { x: Math.cos(a) * speed, y: Math.sin(a) * speed });
        Body.setAngularVelocity(body, 0.02);
        tag(body, { kind: 'bird', type: t.key, launched: true, squash: 1, child: true, launchAt: timeMs });
        birds.push(body);
        inFlight.push(body);
        Composite.add(world, body);
      }
      addSpark(b.position.x, b.position.y, 16, '#bfe9ff', 'star');
      AudioKit.split();
    } else if (t.skill === 'boom') {
      b.game.exploded = true;
      explode(b.position.x, b.position.y, BOOM);
      removeBird(b);
    } else if (t.skill === 'milk') {
      const drop = Bodies.circle(b.position.x, b.position.y + (b.circleRadius || t.r) + 34, 16, {
        density: 0.005,
        friction: 0.4,
        frictionAir: 0.002,
        restitution: 0.1,
        label: 'bomb',
      });
      Body.setVelocity(drop, { x: b.velocity.x * 0.25, y: 7 });
      tag(drop, { kind: 'bomb', fuse: 2600 });
      bombs.push(drop);
      Composite.add(world, drop);
      Body.setVelocity(b, { x: b.velocity.x * 0.55, y: -4.5 });
      AudioKit.plop();
    } else if (t.skill === 'back') {
      // 回旋：水平方向直接掉头，速度不掉（还略微加一点），高度压平一点
      const v = b.velocity;
      const away = v.x >= 0 ? -1 : 1;
      const speed = Math.max(11, Math.abs(v.x)) * 1.06;
      Body.setVelocity(b, { x: speed * away, y: v.y * 0.78 });
      b.game.squash = 1;
      b.game.turned = (b.game.turned || 0) + 1;
      addSpark(b.position.x, b.position.y, 20, '#e2d4ff', 'star');
      for (let i = 0; i < 12; i++) {
        sparks.push({
          x: b.position.x + rand(-18, 18),
          y: b.position.y + rand(-18, 18),
          vx: -away * rand(2, 6),
          vy: rand(-3, 3),
          life: 1,
          decay: 0.045,
          r: rand(3, 8),
          color: '#c9b3ff',
          kind: 'streak',
        });
      }
      shake(6);
      AudioKit.boomer();
    } else if (t.skill === 'seek') {
      // 制导：朝玩家点到的那个位置直线加速冲过去。
      // 方向当场定死（就是"直线"），到点或者超时就把控制权交回物理。
      // 没给点（空格触发 / 自动化）就顺着当前方向指一个远处的点，效果等同于加力冲刺。
      const target = pt || { x: b.position.x + (b.velocity.x || 1) * 60, y: b.position.y + b.velocity.y * 60 };
      const dx = target.x - b.position.x;
      const dy = target.y - b.position.y;
      const len = Math.hypot(dx, dy) || 1;
      b.game.seek = {
        nx: dx / len,
        ny: dy / len,
        tx: target.x,
        ty: target.y,
        t: 0,
        dur: 50,
        from: Math.max(5, Vector.magnitude(b.velocity)),
        top: 30,
      };
      b.game.squash = 1;
      aimMarks.push({ x: target.x, y: target.y, fromX: b.position.x, fromY: b.position.y, life: 1 });
      addSpark(b.position.x, b.position.y, 12, '#ffd0e4', 'star');
      AudioKit.dash();
    }
    updateSkillChip();
    return true;
  };

  const removeBird = (b) => {
    Composite.remove(world, b);
    birds = birds.filter((x) => x !== b);
    inFlight = inFlight.filter((x) => x !== b);
    if (activeBird === b) activeBird = null;
  };

  /** 技能提示条：只在"能放技能但还没放"的时候亮着 */
  const updateSkillChip = () => {
    const t = BIRDS[currentBird] || BIRDS.naidan;
    const show = state === 'fly' && !skillUsed && !!t.skill;
    el.skillChip.classList.toggle('on', show);
    if (!show) return;
    const img = IMG[t.sprite];
    if (img && img.width) el.skillChipImg.src = img.src;
    el.skillChipText.innerHTML = `<b>${t.name}</b> · ${t.skillTip || `点一下${t.skillName}`}`;
  };
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  // 手势被系统取消（来电、系统手势…）不是"松手发射"：按"作废"处理，别替玩家把这一发打出去
  window.addEventListener('pointercancel', (ev) => {
    if (pan && ev.pointerId === pan.pointerId) {
      pan = null;
      return;
    }
    if (drag && ev.pointerId === drag.pointerId) dropDrag('手势被系统取消');
  });

  // 滚轮缩放（以光标位置为锚点）；触屏双指捏合同样走这里
  canvas.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      const anchor = pointerToWorld(ev);
      setZoom(CAM.targetZoom * (ev.deltaY > 0 ? 0.9 : 1.1), anchor);
    },
    { passive: false }
  );
  const touches = new Map();
  let pinch = null;
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'touch') return;
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: CAM.targetZoom };
      dropDrag('双指缩放');
      pan = null;
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'touch' || !touches.has(ev.pointerId)) return;
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setZoom(pinch.zoom * (d / Math.max(1, pinch.dist)), {
        x: CAM.x + viewW() / 2,
        y: CAM.y + viewH() / 2,
      });
    }
  });
  const endTouch = (ev) => {
    touches.delete(ev.pointerId);
    if (touches.size < 2) pinch = null;
  };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);
  const hideHint = () => {
    if (hintHidden) return;
    hintHidden = true;
    el.hint.style.opacity = '0';
    setTimeout(() => el.hint.classList.add('hide'), 600);
  };
  /**
   * 手上这一拖作废：把奶蛋放回弹弓。
   * 只把 drag 清掉是不够的——奶蛋每帧都被摆在"拉弓的位置"上（`Body.setPosition(activeBird, drag)`），
   * 直接扔掉 drag 会让它**留在那个位置**：静态刚体不会掉下去，也没人再管它，
   * 于是画面上就多出一颗卡在半空的奶蛋（玩家看到的就是"奶蛋掉在拉弓的点击位置"）。
   */
  const dropDrag = (why) => {
    if (!drag) return false;
    drag = null;
    queueHover = -1;
    if (activeBird && !activeBird.game.launched) {
      Body.setPosition(activeBird, slingAnchor());
      activeBird.positionPrev.x = slingAnchor().x;
      activeBird.positionPrev.y = slingAnchor().y;
      activeBird.game.squash = 0;
      activeBird.angle = 0;
      activeBird.anglePrev = 0;                  // 同上
    }
    if (why) noteOdd(`拉弓被打断：${why}`);
    return true;
  };
  // ---------------------------------------------------------------- 回合流程
  const endShot = () => {
    roundToken += 1;   // 这一发到此为止，延后的"等你笑完再结算"回调就此作废
    AudioKit.flyStop();
    // 这一发结束了：瞄准被打断，手上残留的拉弓作废（奶蛋回弓上）
    dropDrag('回合结束');
    const used = activeBird;
    inFlight.forEach((b) => {
      burst(b.position.x, b.position.y, 6, '#fff3d6', 'cream');
      removeBird(b);
    });
    inFlight = [];
    // 注意：这里**不动**"上弓但还没发射"的那颗。转波次/结算打断拉弓时，
    // 直接把它 removeBird 掉就等于让它凭空消失（而且白白吃掉一颗），
    // 后面 loadBird 也会把它换成队列里的下一颗 —— 现在改成"留在弓上"（见 loadBird）。
    // 飞出去的那颗已经收掉了；"还在弓上、没发射"的那颗要接着用，不能清
    if (used && used.game.launched) activeBird = null;
    const remaining = Math.max(0, birdsLeft);
    // 这一段清完了：还有下一段就推着弹弓往前走，否则结算本关
    if (stageCleared()) {
      // 后面还得"真剩着奶蛙"才往前推——玩家要是先把后面几段清了，就别把他推到空地上
      const next = nextStageWithPigs();
      // 有下一段、而且还有奶蛋，才往前推；否则当场结算
      // （这里以前漏判了 remaining，推进完没弹可上，loadBird 直接 return，回合就卡在 settling 不动了）
      if (next >= 0 && remaining > 0) {
        advanceStage(next);
        return;
      }
      if (pigs.length === 0) {
        win(remaining);
        return;
      }
      lose();
      return;
    }
    if (remaining <= 0) {
      lose();
      return;
    }
    state = 'settling';
    afterDelay(620, () => {
      if (state !== 'settling') return;
      CAM.targetX = homeCamX();
      loadBird();
    });
  };
  /** 清场：第一关给结算面板，无尽模式直接滚到下一关 */
  const win = (remaining) => {
    AudioKit.flyStop();
    // 自制关卡：通关一次 = 拿到"可发布"资格（指纹就是它的分享码，改一个方块就失效）
    if (mode === 'custom' && customDef) {
      passedCode = window.WorkshopLevel.pack(customDef);
      const list = drafts();
      const i = list.findIndex((x) => x.id === customDef.id);
      if (i >= 0) { list[i].passed = passedCode; saveDrafts(list); renderDrafts(); }
    }
    const unusedNukes = mode === 'endless'
      ? (activeBird && !activeBird.game.launched && activeBird.game.type === 'nuke' ? 1 : 0)
        + birdQueue.filter((type) => type === 'nuke').length
      : 0;
    if (unusedNukes) {
      carriedNuke = unusedNukes;
      toast(`${unusedNukes} 颗核爆奶蛋已保留到下一关`, 1800);
    }
    const bonus = Math.max(0, remaining - unusedNukes) * 10000;
    if (bonus) {
      score += bonus;
      runStats.bonus += bonus;
      updateScore();
      addFloater(slingAnchor().x + 120, slingAnchor().y - 60, `剩弹奖励 +${bonus}`, '#3aa76d');
    }
    totalScore = score;
    setTimeout(() => {
      AudioKit.win();
      burst(W / 2, H * 0.45, 40, '#ffe9a8', 'cream');
    }, 260);
    if (mode === 'endless') {
      state = 'clearing';
      AudioKit.levelUp();
      toast(`第 ${endlessLevel} 关清场！`, 1500);
      afterDelay(2100, () => nextEndlessLevel());
      return;
    }
    state = 'over';
    // 星星按总分给：光清场不够，还得把结构拆得漂亮、省着用奶蛋
    const stars = score >= 25000 ? 3 : score >= 18000 ? 2 : 1;
    showEnd(true, stars, remaining);
  };
  const lose = () => {
    state = 'over';
    AudioKit.flyStop();
    AudioKit.lose();
    // boss 关给一次重打机会：先别结束整局，让他再来一次
    if (mode === 'endless' && level.boss && !bossRetryUsed) {
      bossRetryUsed = true;
      retryPending = true;
      const boss = pigs.find((p) => p.game.boss);
      const left = boss ? Math.ceil((boss.game.hp / boss.game.maxHp) * 100) : 0;
      AudioKit.bossHurt();
      showEnd(true, 0, 0, {
        title: `${window.BOSS_NAME} 还站着…`,
        scoreLabel: `${totalScore} 分`,
        note: `它还剩 ${left}% 血 · 还有一次机会，这一关重打`,
        retry: true,
      });
      return;
    }
    if (mode === 'endless') {
      Object.assign(runStats, levelStartStats);
      score = totalScore;
      updateScore();
      freezeSlingshotResult();
      saveEndlessBest();
      showEnd(true, 0, 0, {
        title: '无尽模式结束',
        scoreLabel: `${totalScore} 分`,
        note: `打到第 ${endlessLevel} 关 · 最好成绩：第 ${bestEndless().level} 关`,
      });
      prepareSlingshotSubmission();
      return;
    }
    showEnd(false, 0);
  };
  const showEnd = (won, stars, remaining = 0, custom = null) => {
    el.boardScreen.classList.add('hide');
    el.slingshotSubmit.classList.add('hide');
    el.btnEndLeaderboard.classList.add('hide');
    el.slingshotSubmitMsg.textContent = '';
    el.slingshotSubmitMsg.classList.remove('bad');
    el.end.classList.remove('hide');
    // 从编辑器点"试玩"进来的，结算面板给一个"回编辑器"
    el.btnBackEditor.classList.toggle('hide', !cameFromEditor);
    el.btnEndWorkshop.classList.toggle('hide', !(mode === 'custom' && !cameFromEditor));
    if (custom) {
      el.endTitle.textContent = custom.title;
      el.endStars.textContent = '';
      el.endScore.textContent = custom.scoreLabel;
      el.endNote.textContent = custom.note;
      el.btnAgain.textContent = custom.retry ? '再打一次（最后一次）' : '再来一次';
      return;
    }
    el.btnAgain.textContent = '再来一次';
    el.endTitle.textContent = won ? '奶蛙全部翻车！' : '奶蛋用完了…';
    el.endStars.textContent = won ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '☆☆☆';
    el.endScore.textContent = `${score} 分`;
    el.endNote.textContent = won
      ? remaining > 0
        ? `还剩 ${remaining} 发奶蛋，收工。`
        : '奶蛙们笑得更大声了。'
      : `还有 ${pigs.length} 只奶蛙在偷笑。`;
  };
  const updateScore = () => { el.score.textContent = String(score); };

  /** boss 血条：只在 boss 关出现，缩放看全图时也照样清楚（所以放在 DOM 上） */
  const updateBossBar = (flash = false) => {
    const boss = pigs.find((p) => p.game.boss);
    if (!boss) {
      el.bossBar.classList.add('hide');
      return;
    }
    el.bossBar.classList.remove('hide');
    el.bossBarName.textContent = `${level.boss ? level.boss.name : 'BOSS'}${level.boss && level.boss.tier > 1 ? ` Lv.${level.boss.tier}` : ''}`;
    el.bossBarFill.style.width = `${Math.max(0, (boss.game.hp / boss.game.maxHp) * 100).toFixed(1)}%`;
    if (flash) {
      el.bossBar.classList.remove('flash');
      void el.bossBar.offsetWidth;
      el.bossBar.classList.add('flash');
    }
  };

  // 左上角剩余奶蛋
  const updateAmmo = () => {
    const n = Math.max(0, birdsLeft);
    if (el.ammo.childElementCount === n) return;
    el.ammo.innerHTML = '';
    for (let i = 0; i < n; i++) el.ammo.appendChild(document.createElement('i'));
  };
  // ---------------------------------------------------------------- 模式与进度
  const BEST_KEY = 'naidan-endless-best';
  const bestEndless = () => {
    try {
      return JSON.parse(localStorage.getItem(BEST_KEY)) || { level: 0, score: 0 };
    } catch (e) {
      return { level: 0, score: 0 };
    }
  };
  const saveEndlessBest = () => {
    const b = bestEndless();
    const next = { level: Math.max(b.level, endlessLevel), score: Math.max(b.score, totalScore) };
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(next));
    } catch (e) { /* 隐私模式下存不了，忽略 */ }
  };
  const resetRunStats = () => {
    Object.assign(runStats, { pigs: 0, blocks: 0, bosses: 0, bonus: 0 });
    levelStartStats = { ...runStats };
    runStartedAt = Date.now();
    scoreSubmitted = false;
    scoreSubmitBusy = false;
    finalRunStats = null;
    finalRunLevel = 1;
    finalRunSeconds = 0;
    finalRunScore = 0;
    if (el.slingshotSubmit) el.slingshotSubmit.classList.add('hide');
    if (el.slingshotSubmitMsg) {
      el.slingshotSubmitMsg.textContent = '';
      el.slingshotSubmitMsg.classList.remove('bad');
    }
  };

  // ---------------------------------------------------------------- 无尽榜（Supabase，免登录）
  // 表结构和真正兜底在 supabase/slingshot_scores.sql；这里只负责体验和即时提示。
  const SCORE_SUPABASE_REST = 'https://buueozmrxfjqcaiqyzhq.supabase.co/rest/v1';
  const SCORE_SUPABASE_KEY = 'sb_publishable_dN25ruwymHdivLup377eLg_9WTi1cOt';
  const SCORE_NAME_KEY = 'naidan-slingshot-score-name-v1';
  const storedScoreName = () => {
    try { return localStorage.getItem(SCORE_NAME_KEY) || ''; } catch (e) { return ''; }
  };
  const rememberScoreName = (name) => {
    try { localStorage.setItem(SCORE_NAME_KEY, name); } catch (e) { /* 隐私模式忽略 */ }
  };
  const scoreWeekStart = () => {
    const bj = new Date(Date.now() + 8 * 3600e3);
    const day = (bj.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate() - day) - 8 * 3600e3).toISOString();
  };
  const scoreRest = async (path, opts = {}) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      return await fetch(`${SCORE_SUPABASE_REST}${path}`, {
        ...opts,
        signal: ctrl.signal,
        cache: 'no-store',
        headers: { apikey: SCORE_SUPABASE_KEY, Accept: 'application/json', ...(opts.headers || {}) },
      });
    } finally {
      clearTimeout(timer);
    }
  };
  const computedRunScore = () =>
    runStats.pigs * 5000 + runStats.blocks * 500 + runStats.bosses * 30000 + runStats.bonus;
  const freezeSlingshotResult = () => {
    finalRunStats = { ...runStats };
    finalRunLevel = endlessLevel;
    finalRunSeconds = Math.max(1, Math.ceil((Date.now() - runStartedAt) / 1000));
    finalRunScore = finalRunStats.pigs * 5000 + finalRunStats.blocks * 500
      + finalRunStats.bosses * 30000 + finalRunStats.bonus;
    return finalRunScore;
  };
  const scorePayload = (name) => {
    const stats = finalRunStats || runStats;
    return {
      name,
      score: stats.pigs * 5000 + stats.blocks * 500 + stats.bosses * 30000 + stats.bonus,
      level: finalRunStats ? finalRunLevel : endlessLevel,
      pigs: stats.pigs,
      blocks: stats.blocks,
      bosses: stats.bosses,
      bonus: stats.bonus,
      run_seconds: finalRunStats ? finalRunSeconds : Math.max(1, Math.ceil((Date.now() - runStartedAt) / 1000)),
    };
  };
  const scoreRow = (text, className = '') => {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  };
  const renderScoreRows = (list) => {
    el.scoreBoardList.innerHTML = '';
    const me = storedScoreName().toLowerCase();
    for (const [i, row] of list.entries()) {
      const li = document.createElement('li');
      if (String(row.name || '').toLowerCase() === me) li.className = 'me';
      li.append(
        scoreRow(String(i + 1), 'rk'),
        scoreRow(String(row.name || '匿名玩家'), 'nm'),
        scoreRow(Number(row.score || 0).toLocaleString('zh-CN'), 'sc'),
        scoreRow(`第 ${Number(row.level || 0)} 关`, 'lv'),
      );
      el.scoreBoardList.appendChild(li);
    }
  };
  const loadScoreBoard = async (kind = scoreBoardKind) => {
    scoreBoardKind = kind === 'week' ? 'week' : 'all';
    el.btnScoreAll.classList.toggle('ghost', scoreBoardKind !== 'all');
    el.btnScoreWeek.classList.toggle('ghost', scoreBoardKind !== 'week');
    el.scoreBoardNotice.classList.remove('bad');
    el.scoreBoardNotice.textContent = '加载中…';
    el.scoreBoardEmpty.classList.add('hide');
    el.scoreBoardList.innerHTML = '';
    let path = '/slingshot_scores?select=name,score,level,created_at&order=score.desc&limit=300';
    if (scoreBoardKind === 'week') path += `&created_at=gte.${encodeURIComponent(scoreWeekStart())}`;
    try {
      const res = await scoreRest(path);
      if (res.status === 404) {
        el.scoreBoardNotice.textContent = '';
        el.scoreBoardEmpty.textContent = '排行榜还没开通，等作者建好表就能用啦';
        el.scoreBoardEmpty.classList.remove('hide');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const rows = await res.json();
      const seen = new Set();
      const list = [];
      for (const row of rows) {
        const key = String(row.name || '').toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        list.push(row);
        if (list.length >= 50) break;
      }
      el.scoreBoardNotice.textContent = list.length ? '前 50 名 · 同昵称只显示最高分' : '';
      if (!list.length) {
        el.scoreBoardEmpty.textContent = '还没有人上榜，去无尽模式打一把！';
        el.scoreBoardEmpty.classList.remove('hide');
        return;
      }
      renderScoreRows(list);
    } catch (e) {
      el.scoreBoardNotice.textContent = '连不上排行榜，稍后再试';
      el.scoreBoardNotice.classList.add('bad');
    }
  };
  const openScoreBoard = (kind = 'all') => {
    scoreBoardReturn = state === 'over' ? 'end' : 'title';
    el.boardScreen.classList.remove('hide');
    loadScoreBoard(kind);
  };
  const closeScoreBoard = () => {
    el.boardScreen.classList.add('hide');
    if (scoreBoardReturn === 'end') el.end.classList.remove('hide');
    else el.title.classList.remove('hide');
  };
  const submitSlingshotScore = async () => {
    if (scoreSubmitBusy) return;
    if (mode !== 'endless' || state !== 'over' || scoreSubmitted) return;
    const name = (el.slingshotName.value || '').trim();
    const say = (text, bad = false) => {
      el.slingshotSubmitMsg.textContent = text;
      el.slingshotSubmitMsg.classList.toggle('bad', bad);
    };
    if (!name) return say('先填个昵称', true);
    if (name.length > 12) return say('昵称最多 12 个字', true);
    const mod = window.WorkshopModeration && window.WorkshopModeration.check(name);
    if (mod && !mod.ok) return say(`昵称${mod.reason}`, true);
    const payload = scorePayload(name);
    if (!finalRunStats || payload.score !== finalRunScore) {
      return say('成绩校验失败，请重新打一局', true);
    }
    if (payload.score <= 0) return say('分数为 0，暂时不能上榜', true);
    rememberScoreName(name);
    scoreSubmitBusy = true;
    el.btnSubmitSlingshot.disabled = true;
    say('上传中…');
    try {
      const res = await scoreRest('/slingshot_scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        scoreSubmitted = true;
        el.slingshotSubmit.classList.add('hide');
        say(`已上传：${name} · 第 ${endlessLevel} 关 · ${payload.score} 分`);
        return;
      }
      if (res.status === 404) return say('排行榜还没开通（等作者在 Supabase 建表）', true);
      const text = await res.text();
      if (/违禁|广告/.test(text)) return say('昵称包含违禁词或联系方式', true);
      if (/成绩|分数|异常|拒绝/.test(text)) return say('成绩校验未通过，已拒绝提交', true);
      say('上传失败，稍后再试', true);
    } catch (e) {
      say('连不上排行榜，稍后再试', true);
    } finally {
      scoreSubmitBusy = false;
      el.btnSubmitSlingshot.disabled = false;
    }
  };
  const prepareSlingshotSubmission = () => {
    const canSubmit = mode === 'endless' && state === 'over' && !retryPending
      && !scoreSubmitted && !!finalRunStats && finalRunScore > 0;
    el.slingshotSubmit.classList.toggle('hide', !canSubmit);
    el.btnEndLeaderboard.classList.toggle('hide', !(mode === 'endless' && state === 'over' && !retryPending));
    el.slingshotName.value = storedScoreName();
    if (!canSubmit) el.slingshotSubmitMsg.textContent = '';
  };

  const updateLevelChip = () => {
    if (mode === 'endless') {
      el.levelChip.classList.remove('hide');
      // 左上角只留关卡号：地形/结构/分段这些信息交给开场和推进提示，别堆在这儿
      el.levelChip.textContent = `第 ${endlessLevel} 关`;
    } else {
      el.levelChip.classList.add('hide');
    }
    updateAmmo();
  };

  const updateExitButton = () => {
    const inLevel = ['pick', 'intro', 'aim', 'fly', 'settling', 'clearing'].includes(state);
    el.btnExitLevel.classList.toggle('hide', !inLevel);
    if (!inLevel) return;
    if (mode === 'custom') {
      el.btnExitLevel.textContent = cameFromEditor ? '← 编辑器' : '← 创意工坊';
      el.btnExitLevel.title = cameFromEditor ? '返回编辑器' : '返回创意工坊';
    } else {
      el.btnExitLevel.textContent = '← 主菜单';
      el.btnExitLevel.title = '返回主菜单';
    }
  };

  const clearEndlessResume = () => {
    endlessResume = null;
    resumePaused = false;
    pausedCallbacks = [];
    if (el.btnResumeEndless) el.btnResumeEndless.classList.add('hide');
  };

  const openRestartConfirm = () => {
    if (restartPrevState || state === 'title') return false;
    restartPrevState = state;
    restartUiPaused = true;
    state = 'restartConfirm';
    el.restartDialog.classList.remove('hide');
    return true;
  };

  const closeRestartConfirm = (confirmed = false) => {
    if (!restartPrevState) return false;
    const target = restartPrevState;
    restartPrevState = null;
    restartUiPaused = false;
    el.restartDialog.classList.add('hide');
    if (confirmed) {
      pausedCallbacks = [];
      state = target;
      startRun('endless');
      return true;
    }
    state = target;
    const queued = pausedCallbacks;
    pausedCallbacks = [];
    queued.forEach((item) => {
      if (item.token === levelToken) item.fn();
    });
    updateExitButton();
    return true;
  };

  /**
   * 无尽模式中途退出：不重建世界，也不丢当前局面。
   * 物理在 state='title' 时本来就会暂停；把暂停期间到点的回合回调排队，继续时再执行。
   */
  const pauseEndlessToMenu = () => {
    if (mode !== 'endless') return false;
    endlessResume = {
      state,
      level: endlessLevel,
      birdsLeft,
    };
    resumePaused = true;
    AudioKit.flyStop();
    el.end.classList.add('hide');
    el.title.classList.remove('hide');
    el.hud.classList.add('hide');
    el.btnExitLevel.classList.add('hide');
    el.btnResumeEndless.textContent = `继续无尽 · 第 ${endlessLevel} 关`;
    el.btnResumeEndless.classList.remove('hide');
    state = 'title';
    return true;
  };

  const resumeEndlessRun = () => {
    if (!endlessResume) return false;
    const target = endlessResume.state;
    endlessResume = null;
    resumePaused = false;
    el.btnResumeEndless.classList.add('hide');
    el.title.classList.add('hide');
    el.end.classList.add('hide');
    el.hud.classList.remove('hide');
    state = target;
    updateLevelChip();
    updateScore();
    updateExitButton();
    const queued = pausedCallbacks;
    pausedCallbacks = [];
    queued.forEach((item) => {
      if (item.token === levelToken) item.fn();
    });
    toast(`继续第 ${endlessLevel} 关`, 1500);
    return true;
  };

  /** auto=true 时跳过"开局选蛋"面板（调试/自动流程用） */
  const startRun = (which, auto = false) => {
    clearEndlessResume();
    AudioKit.unlock();
    el.boardScreen.classList.add('hide');
    carriedNuke = 0;
    resetRunStats();
    mode = which;
    el.hud.classList.remove('hide');
    el.title.classList.add('hide');
    el.end.classList.add('hide');
    el.endStars.textContent = '';
    hintHidden = false;
    el.hint.classList.remove('hide');
    el.hint.style.opacity = '1';
    score = 0;
    totalScore = 0;
    bossRetryUsed = false;
    retryPending = false;
    pickChoice = null;   // 新的一局：重新挑一次
    updateScore();
    if (which === 'endless') {
      endlessLevel = 1;
      matchSeed = Math.floor(Math.random() * 1e9);
      promptPick(window.Endless.generate(endlessLevel, matchSeed), { quick: true, auto, ask: true });
    } else {
      promptPick(window.LEVEL1, { quick: false, auto, ask: true });
    }
    updateExitButton();
  };

  const nextEndlessLevel = () => {
    endlessLevel += 1;
    bossRetryUsed = false; // 新的一关，重打机会刷新
    retryPending = false;
    // 这一关多带的奶蛋照旧让玩家挑（自动流程沿用上一关的选择方式）
    const def = window.Endless.generate(endlessLevel, matchSeed);
    if (carriedNuke) {
      const count = carriedNuke;
      carriedNuke = 0;
      for (let i = 0; i < count; i++) {
        def.birds.splice(Math.min(1 + i, def.birds.length), 0, 'nuke');
      }
    }
    promptPick(def, { quick: true });
  };

  const restart = (auto = false) => {
    el.end.classList.add('hide');
    el.boardScreen.classList.add('hide');
    AudioKit.flyStop();
    resetRunStats();
    pickChoice = null;   // 重开也算新的一局
    if (mode === 'custom') {
      // 重开自制关卡：同一份关卡数据重建
      score = 0;
      updateScore();
      promptPick(customDef || window.LEVEL1, { quick: true, auto, ask: true, extra: false });
    } else if (mode === 'endless') {
      score = 0;
      totalScore = 0;
      carriedNuke = 0;
      endlessLevel = 1;
      matchSeed = Math.floor(Math.random() * 1e9);
      updateScore();
      promptPick(window.Endless.generate(endlessLevel, matchSeed), { quick: true, auto, ask: true });
    } else {
      score = 0;
      updateScore();
      promptPick(window.LEVEL1, { quick: false, auto, ask: true });
    }
  };

  const backToMenu = () => {
    clearEndlessResume();
    el.end.classList.add('hide');
    el.boardScreen.classList.add('hide');
    el.title.classList.remove('hide');
    el.btnExitLevel.classList.add('hide');
    el.hint.classList.add('hide');
    state = 'title';
    AudioKit.flyStop();
    buildLevel(window.LEVEL1);
    state = 'title';
  };

  // ---------------------------------------------------------------- 开场动画
  /** 当前关卡里所有结构/奶蛙的包围盒，开场动画按它取景（地图长了也不会拍空） */
  const levelBounds = () => {
    let minX = Infinity;
    let maxX = -Infinity;
    let topY = GROUND_Y;
    [...level.blocks, ...level.pigs].forEach((o) => {
      const halfW = o.w ? o.w / 2 : o.r;
      minX = Math.min(minX, o.x - halfW);
      maxX = Math.max(maxX, o.x + halfW);
      topY = Math.min(topY, o.y - (o.h ? o.h / 2 : o.r));
    });
    if (!Number.isFinite(minX)) {
      minX = 700;
      maxX = 1200;
    }
    return { minX, maxX, topY, cx: (minX + maxX) / 2, span: maxX - minX };
  };

  /** 开场动画关键帧：我方特写 → 平移到敌方（距离越远推得越久）→ 拉回弹弓 */
  const buildIntroKeys = () => {
    const b = levelBounds();
    const allyCx = sling.x + 130;
    const homeCx = homeCamX() + viewW() / 2;
    // boss 关：先给我方一个特写，然后猛推近 boss 来一段"登场特写"
    if (level.boss) {
      const bx = level.boss.x || level.boss.arenaX + 150;
      // 对准 boss 本人取景，别只拍到它的肚子
      const by = clamp((level.boss.y || b.topY) - 20, 180, 520);
      return {
        boss: true,
        keys: [
          { t: 0, cx: allyCx, cy: 520, zoom: 1.9 },
          { t: 1.0, cx: allyCx, cy: 520, zoom: 1.9 },
          { t: 1.75, cx: bx, cy: by, zoom: 2.35 },   // 猛地推近
          { t: 3.5, cx: bx, cy: by, zoom: 2.02 },    // 慢慢压近
          { t: 4.6, cx: bx - 130, cy: 430, zoom: 1.06 },
          { t: 5.5, cx: homeCx, cy: 360, zoom: 1 },
        ],
        labels: [
          { from: 0.1, to: 1.45, kind: 0, tag: '我方', sub: () => `奶蛋 ${levelBirds.length} 发 · ${birdNameList()}` },
          {
            from: 1.5,
            to: 4.35,
            kind: 3,
            boss: true,
            tag: 'BOSS',
            sub: () => `${level.boss.name} · 别硬怼，打它脚下的塔`,
          },
        ],
        dur: 5.5,
      };
    }
    const travel = clamp((b.cx - allyCx) / 900, 0.9, 3.2);
    const holdAlly = 1.2;
    const tEnemy = holdAlly + travel;
    const tEnemyEnd = tEnemy + 1.5;
    const tEnd = tEnemyEnd + 1.2;
    return {
      keys: [
        { t: 0, cx: allyCx, cy: 520, zoom: 1.9 },
        { t: holdAlly, cx: allyCx, cy: 520, zoom: 1.9 },
        { t: tEnemy, cx: b.cx, cy: clamp(b.topY + 40, 240, 560), zoom: clamp(W / (b.span + 260), MIN_ZOOM, 1.45) },
        { t: tEnemyEnd, cx: b.cx, cy: clamp(b.topY + 40, 240, 560), zoom: clamp(W / (b.span + 260), MIN_ZOOM, 1.45) },
        { t: tEnd, cx: homeCx, cy: 360, zoom: 1 },
      ],
      labels: [
        { from: 0.12, to: holdAlly + 0.5, kind: 0, tag: '我方', sub: () => `奶蛋 ${levelBirds.length} 发 · ${birdNameList()}` },
        {
          from: tEnemy - 0.15,
          to: tEnemyEnd + 0.35,
          kind: 1,
          tag: '敌方',
          sub: () => `${level.pigs.length} 只奶蛙 · ${level.blocks.length} 块建材${stageCount() > 1 ? ` · 共 ${stageCount()} 段` : ''}`,
        },
      ],
      dur: tEnd,
    };
  };
  const birdNameList = () => {
    const names = [];
    (levelBirds.length ? levelBirds : level.birds).forEach((k) => {
      const n = (BIRDS[k] || BIRDS.naidan).name;
      if (!names.includes(n)) names.push(n);
    });
    return names.join('、');
  };
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  const startIntro = (quick) => {
    const scale = quick ? 0.66 : 1;
    const built = buildIntroKeys();
    intro = { t: 0, scale, dur: built.dur * scale, shown: -1, keys: built.keys, labels: built.labels, boss: !!built.boss, roared: false };
    el.introLabel.classList.toggle('boss', !!built.boss);
    state = 'intro';
    el.skipTip.classList.add('on');
    el.hint.classList.add('hide');
    applyIntro();
    AudioKit.intro(0);
  };

  // ---------------------------------------------------------------- 开局选蛋
  // 无尽模式每关的奶蛋数在原基础上 +1，这一颗由玩家在一局开头挑；创意工坊用作者配置的最终阵容
  const PICK_ORDER = ['naidan', 'dash', 'split', 'bomb', 'heavy', 'milk', 'back', 'seek'];
  let pendingPick = null; // { def, quick, auto, silent, ask, extra }
  const defaultPickOf = () => {
    // 自动流程用：从这一关原有阵容里挑一颗，假装是玩家挑的
    const base = (pendingPick && pendingPick.def ? pendingPick.def.birds : level.birds) || [];
    return base && base.length ? base[base.length - 1] : 'naidan';
  };
  /**
   * 搭好这一关，再决定那颗"多带的奶蛋"怎么来。
   * ask=true 的那一关（一局的第 1 关）弹面板让玩家挑一次；之后每关直接沿用挑过的那颗。
   * auto=true 不弹面板也不记选择（调试/自动流程），silent=true 连开场动画都跳过（调试跳关）。
   * extra=false 用在创意工坊：奶蛋阵容就是作者配的数量，不弹开局选蛋、也不额外加一颗。
   */
  const promptPick = (def, options = {}) => {
    const quick = !!options.quick;
    const auto = options.auto === undefined ? autoPickSession : !!options.auto;
    const silent = !!options.silent;
    const extra = options.extra !== false;
    const ask = extra && !auto && options.ask !== false && !pickChoice;
    buildLevel(def, false);        // 先搭场景、不上弹，等挑完再装
    levelBirds = [];
    birdQueue = [];
    birdsLeft = def.birds.length + (extra ? 1 : 0); // 面板上先按最终数量显示，免得数字跳一下
    updateLevelChip();
    pendingPick = { def, quick, auto, silent, ask, extra };
    if (ask) {
      el.pickSub.textContent = mode === 'endless'
        ? `第 1 关 · 这一关总共 ${birdsLeft} 发；挑中的这颗首发，后面每关也照样多带一颗它`
        : `这一关总共 ${birdsLeft} 发；挑中的这颗首发`;
      el.pick.classList.remove('hide');
      el.hint.classList.add('hide');
      state = 'pick';
      return;
    }
    confirmPick(auto ? defaultPickOf() : (pickChoice || defaultPickOf()));
  };
  const confirmPick = (type) => {
    const p = pendingPick || {};
    const base = (p.def || level).birds || [];
    const quick = !!p.quick;
    const silent = !!p.silent;
    const extra = p.extra !== false;
    const lead = !!p.ask;          // 只有玩家亲手挑的那次才首发；其余情况挂在队尾当备用
    pendingPick = null;
    autoPickSession = !!p.auto;
    if (lead) pickChoice = type;   // 一局只挑一次：后面几关都带它
    el.pick.classList.add('hide');
    // 无尽模式：玩家选的那颗 + 这一关原本的阵容 = 原基础上 +1
    // 创意工坊：extra=false，直接用作者配置的阵容，不加隐藏弹
    levelBirds = extra ? (lead ? [type, ...base] : [...base, type]) : [...base];
    birdQueue = levelBirds.slice();
    birdsLeft = birdQueue.length;
    updateAmmo();
    loadBird();
    // 核爆蛋固定从第 5 个等候位开始排；有多颗时依次往后，普通蛋顺序尽量不变
    if (birdQueue.includes('nuke')) {
      const nukes = birdQueue.filter((k) => k === 'nuke');
      const others = birdQueue.filter((k) => k !== 'nuke');
      const head = Math.min(4, others.length);
      birdQueue = [
        ...others.slice(0, head),
        ...nukes,
        ...others.slice(head),
      ];
    }
    if (silent) { state = 'aim'; return; }
    if (!hintHidden) {
      el.hint.classList.remove('hide');
      el.hint.style.opacity = '1';
    }
    startIntro(quick);
  };
  const buildPickRoster = () => {
    el.pickRoster.innerHTML = '';
    PICK_ORDER.forEach((key) => {
      const t = BIRDS[key] || BIRDS.naidan;
      const card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';
      const img = document.createElement('img');
      img.alt = t.name;
      img.src = assetUrl(t.sprite);
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = t.name;
      const sk = document.createElement('div');
      sk.className = 'sk';
      sk.textContent = t.skillName ? `技能 · ${t.skillName}` : '无技能';
      card.append(img, nm, sk);
      card.addEventListener('click', () => {
        AudioKit.unlock();
        AudioKit.ready();
        confirmPick(key);
      });
      el.pickRoster.appendChild(card);
    });
  };
  buildPickRoster();                 // 面板一开局就摆好，省得进关时现做 DOM
  el.btnPickRandom.addEventListener('click', () => {
    AudioKit.unlock();
    AudioKit.ready();
    confirmPick(PICK_ORDER[Math.floor(Math.random() * PICK_ORDER.length)]);
  });
  const applyIntro = () => {
    if (!intro) return;
    const t = intro.t / intro.scale;
    const keys = intro.keys;
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const a = keys[i];
    const b = keys[Math.min(keys.length - 1, i + 1)];
    const k = easeInOut(clamp((t - a.t) / Math.max(0.001, b.t - a.t), 0, 1));
    CAM.zoom = lerp(a.zoom, b.zoom, k);
    const cx = lerp(a.cx, b.cx, k);
    const cy = lerp(a.cy, b.cy, k);
    CAM.x = clampCamX(cx - viewW() / 2);
    CAM.y = clampCamY(cy - viewH() / 2);
    CAM.targetX = CAM.x;
    CAM.targetZoom = CAM.zoom;
    updateZoomLabel();
    const active = intro.labels.findIndex((L) => t >= L.from && t <= L.to);
    if (active !== intro.shown) {
      intro.shown = active;
      if (active >= 0) {
        const L = intro.labels[active];
        el.introTag.textContent = L.tag;
        el.introSub.textContent = L.sub();
        el.introLabel.classList.add('on');
        if (L.boss) AudioKit.roar();
        else AudioKit.intro(L.kind);
      } else {
        el.introLabel.classList.remove('on');
      }
    }
    // boss 特写期间：压暗 + 放射线 + 一道白光
    cutInStrength = 0;
    if (intro.boss) {
      const cut = t > 1.45 && t < 4.4 ? clamp(Math.min(t - 1.45, 4.4 - t) / 0.35, 0, 1) : 0;
      if (cut > 0) {
        if (!intro.roared) {
          intro.roared = true;
          shake(9);
        }
        cutInStrength = cut;
      }
    }
  };

  /** boss 特写的画面效果：压暗 + 从四边射向中心的放射线 */
  const drawBossCutIn = (strength, t) => {
    const vx = CAM.x;
    const vy = CAM.y;
    const vw = viewW();
    const vh = viewH();
    ctx.save();
    ctx.fillStyle = `rgba(12,3,14,${0.42 * strength})`;
    ctx.fillRect(vx - 4, vy - 4, vw + 8, vh + 8);
    ctx.translate(vx + vw / 2, vy + vh / 2);
    ctx.globalAlpha = 0.5 * strength;
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + Math.sin(i * 3.7) * 0.09;
      const inner = Math.min(vw, vh) * (0.3 + ((i * 37) % 17) / 100);
      const outer = inner + Math.max(vw, vh) * (0.35 + ((i * 53) % 23) / 100);
      ctx.strokeStyle = i % 3 === 0 ? '#3a0d14' : '#12040f';
      ctx.lineWidth = 6 + ((i * 29) % 22);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      ctx.stroke();
    }
    ctx.restore();
  };
  const finishIntro = () => {
    intro = null;
    CAM.zoom = 1;
    CAM.targetZoom = 1;
    CAM.x = 0;
    CAM.y = 0;
    CAM.targetX = 0;
    updateZoomLabel();
    el.skipTip.classList.remove('on');
    el.introLabel.classList.remove('on');
    state = 'aim';
    if (!hintHidden) {
      el.hint.classList.remove('hide');
      el.hint.style.opacity = '1';
    }
    updateSkillChip();
  };
  const skipIntro = () => {
    if (!intro) return;
    intro.t = intro.dur;
    applyIntro();
    finishIntro();
  };

  el.btnWorkshop.addEventListener('click', () => openWorkshop());
  el.btnEndless.addEventListener('click', () => startRun('endless'));
  el.btnResumeEndless.addEventListener('click', () => resumeEndlessRun());
  el.btnLeaderboard.addEventListener('click', () => openScoreBoard('all'));
  el.btnEndLeaderboard.addEventListener('click', () => openScoreBoard(scoreBoardKind));
  el.btnScoreAll.addEventListener('click', () => loadScoreBoard('all'));
  el.btnScoreWeek.addEventListener('click', () => loadScoreBoard('week'));
  el.btnScoreBoardClose.addEventListener('click', closeScoreBoard);
  el.btnSubmitSlingshot.addEventListener('click', submitSlingshotScore);
  el.btnAgain.addEventListener('click', () => {
    if (retryPending) {
      // 重打 boss 关：用同一份关卡数据重建，布局完全一样，分数退回进关时
      retryPending = false;
      el.end.classList.add('hide');
      score = levelStartScore;
      totalScore = score;
      Object.assign(runStats, levelStartStats);
      scoreSubmitted = false;
      updateScore();
      promptPick(level, { quick: false });   // 多带的那颗照旧（沿用开局挑的那颗）
      return;
    }
    if (mode === 'endless') startRun('endless');
    else restart();
  });
  el.btnBackMenu.addEventListener('click', backToMenu);
  el.btnRestart.addEventListener('click', () => {
    if (state === 'title' || state === 'pick') return;
    if (mode === 'endless') openRestartConfirm();
    else restart();
  });
  el.btnRestartCancel.addEventListener('click', () => closeRestartConfirm(false));
  el.btnRestartConfirm.addEventListener('click', () => closeRestartConfirm(true));
  el.btnSound.addEventListener('click', () => {
    if (state === 'pick') return;
    const m = AudioKit.toggle();
    el.btnSound.textContent = m ? '🔇' : '🔊';
  });
  el.btnZoomIn.addEventListener('click', () => { if (state !== 'pick') setZoom(CAM.targetZoom * 1.2); });
  el.btnZoomOut.addEventListener('click', () => { if (state !== 'pick') setZoom(CAM.targetZoom / 1.2); });
  el.btnZoomFit.addEventListener('click', () => { if (state !== 'pick') setZoom(MIN_ZOOM); });

  window.addEventListener('keydown', (e) => {
    if (!el.boardScreen.classList.contains('hide')) {
      if (e.key === 'Escape') closeScoreBoard();
      return;
    }
    if (state === 'edit') {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editor && editor.selected) { editorErase(editor.selected); e.preventDefault(); }
        return;
      }
      if (e.key === 'Escape') { leaveEditor(); return; }
      if (e.key === 'z' || e.key === 'Z') { undoEditor(); return; }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        rotateSelectedBlock(e.shiftKey ? 45 : 15);
        return;
      }
      return;
    }
    if (state === 'workshop') return;
    if (state === 'pick') return;
    if (state === 'restartConfirm') {
      if (e.key === 'Escape') closeRestartConfirm(false);
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      if (state === 'title') return;
      if (mode === 'endless') openRestartConfirm();
      else restart();
    }
    if (e.key === 'Enter' && state === 'title') {
      if (endlessResume) resumeEndlessRun();
      else startRun('endless');
    }
    if ((e.key === ' ' || e.key === 'Spacebar') && state !== 'title') {
      e.preventDefault();
      if (state === 'intro') skipIntro();
      else if (state === 'fly') activateSkill();
    }
    if (state === 'title') return;
    // 缩放地图：+/- 微调，0 复位，F 一键看全图
    if (e.key === '=' || e.key === '+' || e.key === ']') setZoom(CAM.targetZoom * 1.15);
    if (e.key === '-' || e.key === '_' || e.key === '[') setZoom(CAM.targetZoom / 1.15);
    if (e.key === '0') setZoom(1);
    if (e.key === 'f' || e.key === 'F') setZoom(MIN_ZOOM);
  });

  // ---------------------------------------------------------------- 每帧逻辑
  const step = () => {
    timeMs += STEP;
    if (nukeFlash > 0) nukeFlash = Math.max(0, nukeFlash - 0.018);
    if (state === 'edit' || state === 'workshop' || state === 'restartConfirm') return;
    Engine.update(engine, STEP);
    blinkTimer += STEP;
    if (blinkTimer > 2600) {
      blinkTimer = 0;
      blinking = true;
      setTimeout(() => { blinking = false; }, 130);
    }
    // 拉弓只可能在"瞄准"里存在：状态被别人切走（转波次、结算、切关）时，
    // 手上那一拖当场作废——绝不能让奶蛋被摆在拉弓的位置上然后就没人管了
    if (drag && state !== 'aim') dropDrag(`状态切到 ${state}`);
    if (state === 'aim' && activeBird && !drag) {
      Body.setPosition(activeBird, slingAnchor());
      activeBird.positionPrev.x = slingAnchor().x;
      activeBird.positionPrev.y = slingAnchor().y;
      activeBird.angle = Math.sin(timeMs / 420) * 0.05;
      activeBird.anglePrev = activeBird.angle;   // 摆姿势也要对齐 anglePrev（同上：别被当成在转）
    }
    if (drag && activeBird && state === 'aim') {
      Body.setPosition(activeBird, { x: drag.x, y: drag.y });
      activeBird.positionPrev.x = drag.x;
      activeBird.positionPrev.y = drag.y;
      const pullVec = { x: slingAnchor().x - drag.x, y: slingAnchor().y - drag.y };
      activeBird.angle = Math.atan2(pullVec.y, pullVec.x) + Math.PI;
      activeBird.anglePrev = activeBird.angle;   // 同上
      const power = clamp(Vector.magnitude(pullVec) / MAX_PULL, 0, 1);
      activeBird.game.squash = power;
      // 蓄力值按帧涨，拉满之后越攒越亮（跟鼠标动不动无关）
      drag.power = power;
      drag.charge = clamp(drag.charge + ((power >= 0.93 ? 1 : 0) - drag.charge) * 0.12, 0, 1);
      if (!drag.full && power >= 0.985) {
        drag.full = true;
        AudioKit.ready();
        addSpark(activeBird.position.x, activeBird.position.y, 16, '#ffe6a8', 'star');
        shake(3.2);
      }
      // 满弓时弓身嗡嗡发抖（0.18 会让相机抖稳定在 ±1.5px 左右；
      // 原来是 0.34 ≈ ±2.8px，抖得有点晕，这里收细一点，保留"绷紧了"的手感）
      if (drag.charge > 0.05) shake(0.18 * drag.charge);
    }

    // 开场动画：镜头按时间轴走，物理照常跑（让结构自己落稳）
    if (state === 'intro' && intro) {
      intro.t += STEP / 1000;
      applyIntro();
      if (intro.t >= intro.dur) finishIntro();
    }

    if (state === 'fly') {
      shotTimer += STEP;
      let moving = false;
      inFlight = inFlight.filter((b) => !b.game.dead);
      for (const b of inFlight) {
        // 制导奶蛋：每一帧把速度重新压回"朝目标点的那条直线"上。
        // Matter 0.20 不支持按刚体关重力（这也是当初不敢动全局重力的原因），
        // 所以用"覆盖速度"的办法把重力抵消掉——飞出来就是一条笔直的线；
        // 越过目标点或超时就把控制交回物理。
        if (b.game.seek) {
          const sk = b.game.seek;
          sk.t += 1;
          const past = (sk.tx - b.position.x) * sk.nx + (sk.ty - b.position.y) * sk.ny <= 0;
          if (past || sk.t > sk.dur) {
            delete b.game.seek;
          } else {
            const speed = lerp(sk.from, sk.top, Math.min(1, sk.t / 8)); // 前 8 帧加速到顶速
            Body.setVelocity(b, { x: sk.nx * speed, y: sk.ny * speed });
            Body.setAngularVelocity(b, 0);
            if (sk.t % 3 === 0) addSpark(b.position.x, b.position.y, 1, '#ffd0e4', 'streak');
          }
        }
        const sp = Vector.magnitude(b.velocity);
        if (b === activeBird && !b.game.child) AudioKit.flyLevel(sp / 24);
        b.game.squash = Math.max(0, b.game.squash - 0.04);
        // 飞行姿态：脑袋朝速度方向倾过去；速度慢下来后交回物理去滚。
        // 注意 angle 和 anglePrev 要一起挪：Matter 的速度是从"这一帧和上一帧的位置差"推出来的，
        // 只改 angle 不改 anglePrev，等于每帧都在告诉它"我刚才转了这么多"——角速度就这么叠上去了，
        // 落地之后表现为奶蛋自己越转越快（而且几乎停不下来，airFriction 只有 0.0025）。
        if (sp > 4.5) {
          b.angle = lerp(b.angle, Math.atan2(b.velocity.y, b.velocity.x), 0.16);
          b.anglePrev = b.angle;
        }
        // 角速度封顶 + 持续收敛：地面带着它滚是正常的，但绝不允许"越转越快"那种转法
        if (Math.abs(b.angularVelocity) > 0.3) b.angularVelocity = Math.sign(b.angularVelocity) * 0.3;
        b.angularVelocity *= 0.992;
        if (b.position.y > GROUND_Y - 44 && sp < 6.5 && Math.abs(b.velocity.y) < 3.4 && Math.random() < 0.32) {
          dustPuffs.push({ x: b.position.x, y: GROUND_Y - 2, r: rand(6, 14), life: 1, vx: -b.velocity.x * 0.15 });
        }
        if (timeMs - (b.game.lastTrail || 0) > 46) {
          b.game.lastTrail = timeMs;
          trail.push({ x: b.position.x, y: b.position.y, life: 1 });
        }
        // 爆奶蛋撞上东西之后点着引信，过一会儿自己炸
        if (b.game.armed && !b.game.exploded) {
          b.game.fuse -= STEP;
          if (b.game.fuse <= 0) {
            b.game.exploded = true;
            b.game.dead = true;
            explode(b.position.x, b.position.y, BOOM);
          }
        }
        const gone = b.position.x > worldW() + 120 || b.position.x < -140 || b.position.y > H + 240 || b.position.y < -430;
        if (gone || b.game.dead) { removeBird(b); continue; }
        // 地图变长之后奶蛋能滚很远，滚动阈值放宽一点，免得一发要等 9 秒才换下一只
        if (sp > 2.2 || Math.abs(b.angularVelocity) > 0.12) moving = true;
      }
      const camOn = activeBird && !activeBird.game.dead ? activeBird : inFlight[0];
      if (camOn) followCam(camOn);
      for (const o of [...blocks, ...pigs, ...bombs]) {
        if (Vector.magnitude(o.velocity) > 1.15 || Math.abs(o.angularVelocity) > 0.06) { moving = true; break; }
      }
      const nothingLeft = inFlight.length === 0 && bombs.length === 0;
      calmFrames = moving ? 0 : calmFrames + 1;
      if (nothingLeft || calmFrames > 34 || shotTimer > 9000) { endShot(); return; }
    }
    // 奶蛙：慢慢平复，但如果被重物压着就持续掉血（被压住的奶蛙会一直挣扎）
    pigs.forEach((p) => {
      p.game.hurt = Math.max(0, p.game.hurt - 0.012);
      if (p.game.boss) {
        // boss 的摔伤：它常常是"坐在楼板上一起掉"，自己不会撞到东西，
        // 所以按"下坠速度被硬生生停住"来判定，而不是靠碰撞事件。
        const info = p.game;
        const vy = p.velocity.y;
        // 记"这一跳里最快的下坠速度"，被楼板缓一下也能算准
        info.peakVy = Math.max(info.peakVy || 0, vy);
        // 它是个大胖子，被打到也不该满地滚：横向速度直接封顶
        if (Math.abs(p.velocity.x) > 2.2) {
          Body.setVelocity(p, { x: Math.sign(p.velocity.x) * 2.2, y: vy });
        }
        if (info.peakVy > 3.5 && vy < info.peakVy * 0.5) {
          const fall = (info.peakVy - 3.5) * info.fallK;
          info.lastImpact = { kind: 'fall', vDown: Math.round(info.peakVy * 100) / 100, fall: Math.round(fall) };
          info.peakVy = 0;
          if (fall > 40) {
            AudioKit.slam();
            shake(16 + fall * 0.05);
            burst(p.position.x, GROUND_Y - 6, 22, '#f6e2bd', 'chunk');
            addFloater(p.position.x, p.position.y - 80, `摔伤 ${Math.round(fall)}`, '#ff7a3c');
            info.hurt = Math.min(1, info.hurt + 0.6);
            hitBody(p, fall, fall * 2, null);
          }
        }
        return; // boss 不吃"被压住慢慢掉血"这套，不然架根梁上去就能白嫖
      }
      let load = 0;
      for (const b of blocks) {
        if (b.game.dead) continue;
        const dx = b.position.x - p.position.x;
        const bottomEdge = b.position.y + b.game.h / 2;
        // 真压在头上才算：方块中心在奶蛙上方，且底沿已经压到奶蛙头顶
        const above = b.position.y < p.position.y;
        const touching = bottomEdge >= p.position.y - p.game.r * 0.92;
        const overlapping = Math.abs(dx) < b.game.w / 2 + p.game.r * 0.7;
        if (above && touching && overlapping) load += b.mass;
      }
      if (load > 1.6) {
        p.game.hp -= load * 0.08;
        p.game.hurt = Math.min(1, p.game.hurt + 0.05);
        if (p.game.hp <= 0) destroy(p);
      }
    });
    // 奶泡炸弹：碰到东西就炸（上面碰撞回调里处理），落地或超时也炸
    bombs = bombs.filter((b) => {
      if (b.game.dead) return false; // 碰撞回调里炸掉的，这里只负责从名单里去掉
      b.game.fuse -= STEP;
      if (b.position.y > GROUND_Y - 20 || b.game.fuse <= 0) {
        b.game.dead = true;
        explode(b.position.x, Math.min(b.position.y, GROUND_Y - 16), MILK_BOOM);
        Composite.remove(world, b);
        return false;
      }
      return true;
    });

    // 技能火花
    sparks = sparks.filter((s) => {
      s.x += s.vx;
      s.y += s.vy;
      s.vx *= 0.94;
      s.vy *= 0.94;
      s.life -= s.decay;
      return s.life > 0;
    });

    // 冲击波
    explosions = explosions.filter((e) => {
      e.life -= 0.035;
      return e.life > 0;
    });

    // boss 关的闪电：隔一阵打一道，配雷声
    if (isBossMood()) {
      lightningTimer -= STEP;
      if (lightningTimer <= 0) {
        lightningTimer = rand(5000, 11000);
        lightning = 1;
        AudioKit.thunder();
      }
      if (lightning > 0) lightning = Math.max(0, lightning - 0.06);
    } else if (lightning > 0) {
      lightning = 0;
    }

    // 镜头（开场动画期间由时间轴直接控制）
    if (state !== 'over' && state !== 'intro') {
      CAM.zoom = lerp(CAM.zoom, CAM.targetZoom, 0.12);
      CAM.x = lerp(CAM.x, CAM.targetX, pan ? 0.45 : 0.08);
      if (!pan) CAM.y = lerp(CAM.y, defaultCamY(), 0.06);
      if (state !== 'fly' && !pan) CAM.targetX = lerp(CAM.targetX, homeCamX(), 0.03);
      if (Math.abs(CAM.zoom - CAM.targetZoom) > 0.001) updateZoomLabel();
    }

    CAM.shake *= 0.88;
    if (CAM.shake < 0.1) CAM.shake = 0;
    // 粒子
    particles = particles.filter((p) => {
      p.vy += 0.34;
      p.vx *= 0.992;
      p.x += p.vx;
      p.y += p.vy;
      if (p.kind === 'chunk') {
        p.rot += p.spin;
        if (p.y > GROUND_Y - 3) { p.y = GROUND_Y - 3; p.vy *= -0.3; p.vx *= 0.7; }
      } else if (p.kind === 'confetti') {
        p.rot += p.spin;
        p.vx *= 0.97;
        p.vy = Math.min(p.vy + 0.1, 2.2); // 彩带飘得慢，别像石头一样砸下来
        if (p.y > GROUND_Y - 4) { p.y = GROUND_Y - 4; p.vy = 0; p.vx *= 0.9; }
      } else if (p.kind === 'cream' && p.y > GROUND_Y - 2) {
        p.y = GROUND_Y - 2;
        p.vy *= -0.36;
        p.vx *= 0.82;
      }      p.life -= p.decay;
      return p.life > 0;
    });
    trail = trail.filter((t) => { t.life -= 0.0075; return t.life > 0; });
    floaters = floaters.filter((f) => { f.life -= 0.012; f.y -= 0.75; return f.life > 0; });
    dustPuffs = dustPuffs.filter((d) => { d.life -= 0.045; d.x += d.vx; d.r += 0.5; return d.life > 0; });
    aimMarks = aimMarks.filter((m) => { m.life -= 0.016; return m.life > 0; });
    flyingPigs = flyingPigs.filter((f) => {
      f.vy += 0.55;
      f.x += f.vx;
      f.y += f.vy;
      f.angle += f.spin;
      f.life -= 0.011;
      return f.life > 0 && f.y < H + 300;
    });
    flyingBosses = flyingBosses.filter((f) => {
      f.vy += 0.42;
      f.x += f.vx;
      f.y += f.vy;
      f.angle += f.spin;
      f.vx *= 0.995;
      f.life = Math.max(0, f.life - 0.0035);
      return f.life > 0 && f.y < H + 420;
    });
    if (flyingBosses.length) {
      const f = flyingBosses[0];
      CAM.targetX = clampCamX(f.x - viewW() * 0.45);
    }
  };
  // ---------------------------------------------------------------- 渲染
  const skyGrad = () => {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    if (isBossMood()) {
      // boss 关：压得人喘不过气的黄昏
      g.addColorStop(0, '#3d2a4a');
      g.addColorStop(0.45, '#7a3b46');
      g.addColorStop(1, '#c25a2c');
    } else {
      g.addColorStop(0, '#ffe7bd');
      g.addColorStop(0.42, '#ffd9a8');
      g.addColorStop(1, '#ffc9a0');
    }
    return g;
  };
  const isBossMood = () => level.mood === 'boss';
  const drawSky = () => {
    ctx.fillStyle = skyGrad();
    // 缩到最小看全图时天空也要铺满整个可见区域
    ctx.fillRect(-700, -1600, FILL_W + 1600, GROUND_Y + 1600);
    // 远景：两层奶茶色小山（越远越淡，带视差）+ 云
    ctx.save();
    const hills = isBossMood()
      ? [
        { amp: 66, parallax: 0.18, base: 130, color: 'rgba(92,52,66,0.9)' },
        { amp: 48, parallax: 0.34, base: 82, color: 'rgba(120,64,60,0.92)' },
      ]
      : [
        { amp: 58, parallax: 0.18, base: 122, color: 'rgba(255,238,212,0.92)' },
        { amp: 42, parallax: 0.34, base: 76, color: 'rgba(255,225,188,0.95)' },
      ];
    hills.forEach((h) => {
      ctx.fillStyle = h.color;
      ctx.beginPath();
      ctx.moveTo(-260, GROUND_Y + 8);
      for (let x = -260; x < FILL_W + 320; x += 24) {
        const t = (x + CAM.x * h.parallax) / 300;
        const y = GROUND_Y - h.base - Math.sin(t) * h.amp - Math.sin(t * 3.1) * h.amp * 0.3;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(FILL_W + 320, GROUND_Y + 8);
      ctx.closePath();
      ctx.fill();
    });
    // 云按地图长度铺开：缩到最小看全图时天上也得有东西
    ctx.fillStyle = isBossMood() ? 'rgba(150,120,150,0.5)' : 'rgba(255,255,255,0.85)';
    const cloudCount = Math.max(4, Math.round(FILL_W / 340));
    for (let i = 0; i < cloudCount; i++) {
      const cx = 180 + i * 330 + ((i * 97) % 70);
      const cy = 96 + ((i * 53) % 96);
      const s = 0.8 + ((i * 37) % 40) / 100;
      const x = cx - CAM.x * 0.34 + Math.sin((timeMs / 5200) + i) * 14;
      ctx.beginPath();
      ctx.ellipse(x, cy, 62 * s, 34 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 54 * s, cy + 8 * s, 46 * s, 26 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x - 52 * s, cy + 10 * s, 40 * s, 22 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };
  const drawGround = () => {
    ctx.save();
    // 奶油草地：先铺一层厚草皮，再压一层焦糖土
    const g = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 200);
    if (isBossMood()) {
      g.addColorStop(0, '#7d5a45');
      g.addColorStop(0.3, '#6b4a3a');
      g.addColorStop(1, '#54382c');
    } else {
      g.addColorStop(0, '#e8bd8a');
      g.addColorStop(0.3, '#dcae78');
      g.addColorStop(1, '#c99a63');
    }
    ctx.fillStyle = g;
    // 往下铺得够深：缩到最小看全图时地平线以下也要有地
    ctx.fillRect(-600, GROUND_Y, FILL_W + 1400, 1500);

    const grass = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 26);
    grass.addColorStop(0, isBossMood() ? '#6e8f4a' : '#a8d472');
    grass.addColorStop(1, isBossMood() ? '#4f6b34' : '#83b854');
    ctx.fillStyle = grass;
    ctx.beginPath();
    ctx.moveTo(-300, GROUND_Y + 26);
    for (let x = -300; x <= FILL_W + 400; x += 34) {
      ctx.lineTo(x, GROUND_Y + Math.sin(x / 42) * 5);
    }
    ctx.lineTo(FILL_W + 400, GROUND_Y + 26);
    ctx.closePath();
    ctx.fill();

    // 点缀小草
    ctx.strokeStyle = 'rgba(108,164,74,0.75)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let x = -100; x < FILL_W + 300; x += 12) {
      const hh = 8 + ((x * 13) % 11);
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 3);
      ctx.lineTo(x + 2, GROUND_Y + 3 - hh);
      ctx.stroke();
    }

    // 草地边缘的奶油高光
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-300, GROUND_Y + 1.5);
    for (let x = -300; x <= FILL_W + 400; x += 34) ctx.lineTo(x, GROUND_Y + 1.5 + Math.sin(x / 42) * 5);
    ctx.stroke();
    ctx.restore();
  };
  const roundRect = (x, y, w, h, r) => {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  };
  const drawBlock = (b) => {
    const info = b.game;
    const mat = MATS[info.material];
    const w = info.w;
    const h = info.h;
    const dmg = 1 - clamp(info.hp / info.maxHp, 0, 1);
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    // 满弓时奶蛋自己也在抖
    if (drag && drag.charge > 0.15 && state === 'aim') {
      const j = drag.charge * 1.3;   // 原来是 2.4，跟着一起收细
      ctx.translate(rand(-j, j), rand(-j, j));
    }
    ctx.rotate(b.angle);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(120,80,40,0.18)';
    roundRect(-w / 2 + 2, -h / 2 + 5, w, h, 7);
    ctx.fill();
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, mat.color);
    g.addColorStop(1, mat.colorDark);
    ctx.fillStyle = g;
    roundRect(-w / 2, -h / 2, w, h, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    roundRect(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3, 6);
    ctx.stroke();
    if (info.material === 'wood') {
      ctx.strokeStyle = 'rgba(120,72,28,0.35)';
      ctx.lineWidth = 2;
      const along = w > h ? 'x' : 'y';
      ctx.beginPath();
      if (along === 'x') {
        ctx.moveTo(-w / 2 + 8, -h / 6);
        ctx.lineTo(w / 2 - 8, -h / 6);
        ctx.moveTo(-w / 2 + 8, h / 6);
        ctx.lineTo(w / 2 - 8, h / 6);
      } else {
        ctx.moveTo(-w / 6, -h / 2 + 8);
        ctx.lineTo(-w / 6, h / 2 - 8);
        ctx.moveTo(w / 6, -h / 2 + 8);
        ctx.lineTo(w / 6, h / 2 - 8);
      }      ctx.stroke();
    }    if (info.material === 'ice') {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 6, h / 2 - 6);
      ctx.lineTo(-w / 2 + 6, -h / 2 + 6);
      ctx.lineTo(w / 4, -h / 2 + 6);
      ctx.closePath();
      ctx.fill();
    }    if (dmg > 0.18) {
      ctx.strokeStyle = `rgba(60,35,15,${0.25 + dmg * 0.55})`;
      ctx.lineWidth = 2.2;
      const cracks = Math.round(dmg * 4) + 1;
      for (let i = 0; i < cracks; i++) {
        const sx = ((i * 37) % 100) / 100 - 0.5;
        const sy = ((i * 61) % 100) / 100 - 0.5;
        ctx.beginPath();
        ctx.moveTo(sx * w * 0.7, sy * h * 0.7);
        ctx.lineTo(sx * w * 0.7 + w * 0.16, sy * h * 0.7 + h * 0.12);
        ctx.lineTo(sx * w * 0.7 + w * 0.06, sy * h * 0.7 + h * 0.3);
        ctx.stroke();
      }    }
    if (info.flash > 0) {
      ctx.globalAlpha = clamp(info.flash, 0, 0.6);
      ctx.fillStyle = '#fff';
      roundRect(-w / 2, -h / 2, w, h, 7);
      ctx.fill();
      info.flash -= 0.05;
    }    ctx.restore();
  };
  const drawPig = (p) => {
    const info = p.game;
    const r = info.r;
    const isBoss = !!info.boss;
    const spriteH = isBoss ? r * 3.0 : r * PIG_SPRITE_K;
    const spriteW = isBoss ? spriteH * (494 / 560) : spriteH * (390 / 512);
    const sp = Vector.magnitude(p.velocity);
    const squash = clamp(sp / 26, 0, 0.2);
    const hurtWobble = info.hurt * 0.1;
    // 呼吸感：静止时慢慢鼓一下
    const breath = 1 + Math.sin(timeMs / 620 + p.id) * 0.012;
    ctx.save();
    ctx.translate(p.position.x, p.position.y);
    // 影子
    ctx.save();
    ctx.globalAlpha *= 0.16;
    ctx.fillStyle = '#7a4b22';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.96, r * 0.92, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.rotate(clamp(p.angle * 0.45, -0.5, 0.5) + Math.sin(timeMs / 190 + p.id) * hurtWobble * 0.4);
    const sx = (1 + squash * 0.55 + hurtWobble * Math.sin(timeMs / 160)) * breath;
    const sy = (1 - squash * 0.5) / breath;
    ctx.scale(sx, sy);
    const img = isBoss ? IMG.boss_idle : info.bonus ? IMG.naiwa_happy : IMG.naiwa_angry;
    if (img && img.width) {
      // 让立绘的脚底刚好贴住碰撞体的底边，别陷进木板里
      if (isBoss) ctx.drawImage(img, -spriteW / 2, -spriteH * 0.5 - r * 0.06, spriteW, spriteH);
      else ctx.drawImage(img, -spriteW / 2, -spriteH * PIG_ANCHOR_Y, spriteW, spriteH);
    } else {
      ctx.fillStyle = '#ffd94a';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (info.hurt > 0.22) {
      ctx.globalAlpha = Math.min(0.34, info.hurt) * (isBoss ? 0.4 : 0.55);
      ctx.fillStyle = '#ff5a5a';
      ctx.beginPath();
      ctx.ellipse(0, -r * (isBoss ? 0.1 : 0.16), r * 0.86, r * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // 补给奶蛙：头顶一圈光环 + 光环里浮着一颗奶蛋（一眼认出来打它）
    if (info.bonus) {
      const bob = Math.sin(timeMs / 460 + p.id) * 4;
      const shine = 0.7 + 0.3 * Math.sin(timeMs / 320 + p.id);
      ctx.save();
      ctx.globalAlpha = shine;
      ctx.strokeStyle = '#ffd75e';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(0, -r * 1.16 + bob, r * 0.72, r * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = shine * 0.35;
      ctx.strokeStyle = '#fff3c0';
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.translate(0, -r * 1.02 + bob);
      ctx.fillStyle = '#fff6e0';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.26, r * 0.33, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e8a83c';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.ellipse(-r * 0.08, -r * 0.1, r * 0.08, r * 0.1, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // boss 还有一层"受伤裂纹感"：血越少越红
    if (isBoss && info.hp / info.maxHp < 0.6) {
      ctx.globalAlpha = (1 - info.hp / info.maxHp) * 0.22;
      ctx.fillStyle = '#ff3b3b';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.08, r * 0.8, r * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };
  const drawFlyingPig = (f) => {
    const spriteH = f.r * PIG_SPRITE_K;
    const spriteW = spriteH * (390 / 512);
    ctx.save();
    ctx.globalAlpha = clamp(f.life * 1.6, 0, 1);
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    const img = IMG.naiwa_happy;
    if (img && img.width) {
      ctx.drawImage(img, -spriteW / 2, -spriteH * PIG_ANCHOR_Y, spriteW, spriteH);
    }
    ctx.restore();
  };

  /** 倒下的 boss：大笑、翻着、慢悠悠飞出画面（压轴镜头） */
  const drawFlyingBoss = (f) => {
    const img = IMG.boss_laugh;
    const spriteH = f.r * 3.0;
    const spriteW = spriteH * (494 / 560);
    ctx.save();
    ctx.globalAlpha = clamp(f.life * 1.35, 0, 1);
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    if (img && img.width) ctx.drawImage(img, -spriteW / 2, -spriteH * 0.5, spriteW, spriteH);
    ctx.restore();
  };
  const drawBird = (b) => {
    const info = b.game;
    const type = BIRDS[info.type] || BIRDS.naidan;
    const squash = info.squash || 0;
    const radius = b.circleRadius || type.r;
    const spriteH = radius * BIRD_SPRITE_K;
    const spriteW = spriteH * (388 / 512);
    const canBlink = type.blink && state === 'aim' && !drag && blinking;
    const img = canBlink ? IMG[type.blink] : IMG[type.sprite];
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);
    ctx.scale(1 + squash * 0.16, 1 - squash * 0.12);
    if (state === 'fly' && !info.child) {
      ctx.globalAlpha = clamp((timeMs - (info.launchAt || 0)) / 120, 0, 1);
    }
    if (info.type === 'nuke') {
      const pulse = 0.72 + 0.28 * Math.sin(timeMs / 150);
      const glow = ctx.createRadialGradient(0, 0, radius * 0.55, 0, 0, radius * 2.25);
      glow.addColorStop(0, `rgba(180,255,220,${0.34 * pulse})`);
      glow.addColorStop(0.45, `rgba(80,220,255,${0.24 * pulse})`);
      glow.addColorStop(0.75, `rgba(255,110,240,${0.12 * pulse})`);
      glow.addColorStop(1, 'rgba(40,180,255,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 2.25, 0, Math.PI * 2);
      ctx.fill();
      if (typeof ctx.createConicGradient === 'function') {
        // 彩色环用正常混合，别和底下的高光一起被“加亮”成白色
        ctx.globalCompositeOperation = 'source-over';
        const rainbow = ctx.createConicGradient(timeMs / 720, 0, 0);
        ['#ff5f6d', '#ffc371', '#f8ff72', '#56ff9a', '#55ddff', '#8e7dff', '#ff6ee7', '#ff5f6d']
          .forEach((color, i, a) => rainbow.addColorStop(i / (a.length - 1), color));
        ctx.strokeStyle = rainbow;
        ctx.globalAlpha = 0.98;
        ctx.lineWidth = 6.5;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.82, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.42;
        ctx.lineWidth = 16;
        ctx.stroke();
      } else {
        ctx.strokeStyle = `rgba(180,255,220,${0.75 * pulse})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.65, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (img && img.width) {
      if (info.type === 'nuke') {
        ctx.filter = `hue-rotate(${((timeMs * 0.055) % 360).toFixed(1)}deg) saturate(1.16)`;
      }
      ctx.drawImage(img, -spriteW / 2, -spriteH * BIRD_ANCHOR_Y, spriteW, spriteH);
      if (info.type === 'nuke') ctx.filter = 'none';
    } else {
      ctx.fillStyle = '#ffe27a';
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  /** 便宜的伪随机（同参数永远同结果），给每只等候的奶蛋配一套专属节奏 */
  const rnd01 = (n) => {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };

  /**
   * 等候中的奶蛋的待机动作：原地起跳，空中翻一整圈，落地压一下再回弹。
   * 纯按 timeMs 计算，不存状态；每只的周期/高度/翻滚方向都由序号推出来，所以不会整齐划一。
   */
  const QUEUE_AIR = 0.44; // 一轮里腾空的时间占比
  const queueIdlePose = (i, typeKey) => {
    const key = i * 3.1 + (typeKey ? typeKey.length * 0.73 : 0);
    const period = i === 0 ? 1.2 : 1.55 + rnd01(key) * 0.85;
    // 跳得比立绘还高一点，翻到倒立的时候才不会蹭地
    const height = (i === 0 ? 54 : 42) + rnd01(key + 9) * 16;
    const dir = rnd01(key + 3) < 0.5 ? 1 : -1;
    const phase = ((timeMs / 1000) / period + rnd01(key + 5)) % 1;
    if (phase < QUEUE_AIR) {
      const air = phase / QUEUE_AIR;
      const squash = Math.cos(Math.PI * air); // 起跳压、落地也压
      return {
        dy: -Math.sin(Math.PI * air) * height,
        rot: dir * air * Math.PI * 2,
        sx: 1 + 0.14 * squash,
        sy: 1 - 0.14 * squash,
        air: true,
      };
    }
    const rest = (phase - QUEUE_AIR) / (1 - QUEUE_AIR);
    const squash = Math.max(0, 1 - rest * 3.4);
    return { dy: 0, rot: 0, sx: 1 + 0.17 * squash, sy: 1 - 0.17 * squash, air: false };
  };

  const QUEUE_MAX_DRAW = 6;
  /** 弹弓脚边排队等着的奶蛋：一眼看出还剩什么货色，而且点谁谁上弓 */
  /** 等候区第 i 颗奶蛋站的位置（画图和点击判定共用同一份计算，别两处各写一遍） */
  const queueSlotPos = (i) => ({ x: sling.x + 64 + i * 44, y: GROUND_Y + 4 });
  /** 点到等候区第几颗了？没点中返回 -1 */
  const queueHit = (p) => {
    const n = Math.min(birdQueue.length, QUEUE_MAX_DRAW);
    for (let i = 0; i < n; i++) {
      const s = queueSlotPos(i);
      // 判定框放宽：立绘会跳会翻，别让玩家点了个空
      if (Math.abs(p.x - s.x) <= 24 && p.y >= s.y - 82 && p.y <= s.y + 12) return i;
    }
    return -1;
  };
  /**
   * 点等候区里的奶蛋 = 让它先上弓。
   * 架上正好架着一颗的时候（瞄准中）就跟它换位子：点谁谁立刻能打，原来那颗退回队列原来的格子。
   */
  const promoteQueue = (i) => {
    if (i < 0 || i >= Math.min(birdQueue.length, QUEUE_MAX_DRAW)) return false;
    if (!birdQueue.length) return false;
    const type = birdQueue[i];
    const onSling = !!activeBird && !activeBird.game.launched && (state === 'aim' || state === 'intro');
    if (onSling) {
      if (type === currentBird) return false;   // 就是它，别白换一下
      birdQueue[i] = currentBird;
      const wasIntro = state === 'intro';       // 开场动画还在放的话别把状态打断
      mountBird(type);
      if (wasIntro) state = 'intro';
      addSpark(queueSlotPos(i).x, queueSlotPos(i).y - 40, 10, '#ffe9b0', 'star');
      burst(queueSlotPos(i).x, queueSlotPos(i).y - 26, 8, '#fff3d6', 'cream');
    } else {
      if (i === 0) return false;                // 已经在最前面了
      birdQueue.splice(i, 1);
      birdQueue.unshift(type);
    }
    AudioKit.ready();
    updateAmmo();
    return true;
  };
  const drawQueue = () => {
    if (state !== 'aim' && state !== 'intro') return;
    birdQueue.slice(0, QUEUE_MAX_DRAW).forEach((typeKey, i) => {
      const t = BIRDS[typeKey] || BIRDS.naidan;
      const img = IMG[t.sprite];
      const scale = 0.34 - i * 0.018;
      const spriteH = t.r * BIRD_SPRITE_K * scale * 2;
      const spriteW = spriteH * (388 / 512);
      // 排在弹弓右后方：拉满弓时奶蛋会贴到左边，摆左边会撞在一起
      const { x, y } = queueSlotPos(i);
      const pose = queueIdlePose(i, typeKey);
      const lift = Math.max(0, -pose.dy);
      const centerY = y + spriteH * 0.06 - spriteH * 0.5 + pose.dy;
      // 提示"这一排可以点"：脚下一圈淡虚线；鼠标悬上去的那颗加亮
      const hot = i === queueHover;
      ctx.save();
      ctx.globalAlpha = hot ? 0.8 : 0.15;
      ctx.strokeStyle = hot ? '#fff3d6' : '#6b4a30';
      ctx.lineWidth = hot ? 3 : 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.ellipse(x, y + 3, spriteW * 0.46, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      // 地面影子：跳起来就缩小变淡
      ctx.save();
      ctx.globalAlpha = 0.2 * (1 - lift / 52);
      ctx.fillStyle = '#7a4b22';
      ctx.beginPath();
      ctx.ellipse(x, y + 3, spriteW * 0.36 * (1 - lift / 110), 4.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // 落地砸出的一圈尘
      if (!pose.air && pose.sy < 0.965) {
        const k = clamp((1 - pose.sy) / 0.17, 0, 1);
        ctx.save();
        ctx.globalAlpha = 0.4 * (1 - k);
        ctx.strokeStyle = '#fff6e0';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.ellipse(x, y + 3, 12 + k * 30, (12 + k * 30) * 0.32, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = 0.92 - i * 0.09;
      ctx.translate(x, centerY);
      ctx.rotate(pose.rot);
      ctx.scale(pose.sx, pose.sy);
      if (typeKey === 'nuke') {
        const pulse = 0.72 + 0.28 * Math.sin(timeMs / 150 + i);
        const glow = ctx.createRadialGradient(0, 0, spriteW * 0.2, 0, 0, spriteW * 0.78);
        glow.addColorStop(0, `rgba(190,255,225,${0.35 * pulse})`);
        glow.addColorStop(0.55, `rgba(120,210,255,${0.2 * pulse})`);
        glow.addColorStop(1, 'rgba(255,100,240,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, spriteW * 0.78, 0, Math.PI * 2);
        ctx.fill();
        if (typeof ctx.createConicGradient === 'function') {
          const rainbow = ctx.createConicGradient(timeMs / 900 + i, 0, 0);
          ['#ff5f6d', '#ffc371', '#f8ff72', '#56ff9a', '#55ddff', '#8e7dff', '#ff6ee7', '#ff5f6d']
            .forEach((color, n, arr) => rainbow.addColorStop(n / (arr.length - 1), color));
          ctx.strokeStyle = rainbow;
          ctx.globalAlpha *= 0.85;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(0, 0, spriteW * 0.63, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (img && img.width) {
        if (typeKey === 'nuke') {
          ctx.filter = `hue-rotate(${((timeMs * 0.055) % 360).toFixed(1)}deg) saturate(1.16)`;
        }
        ctx.drawImage(img, -spriteW / 2, -spriteH * 0.5, spriteW, spriteH);
        if (typeKey === 'nuke') ctx.filter = 'none';
      }
      ctx.restore();
    });
  };

  /** 制导奶蛋的靶心：点哪儿就出现一个收拢的准星，外加一条从发射处指过去的虚线 */
  const drawAimMarks = () => {
    aimMarks.forEach((m) => {
      const k = 1 - m.life; // 0 → 1
      const a = clamp(m.life, 0, 1);
      const r = 34 - k * 14;
      ctx.save();
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = '#ff7fb0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(m.x + dx * (r + 5), m.y + dy * (r + 5));
        ctx.lineTo(m.x + dx * (r + 19), m.y + dy * (r + 19));
      }
      ctx.stroke();
      ctx.globalAlpha = a * 0.4;
      ctx.setLineDash([9, 9]);
      ctx.beginPath();
      ctx.moveTo(m.fromX, m.fromY);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
      ctx.restore();
    });
  };

  const drawSparks = () => {
    sparks.forEach((s) => {
      ctx.save();
      ctx.globalAlpha = clamp(s.life, 0, 1) * 0.95;
      ctx.translate(s.x, s.y);
      if (s.kind === 'streak') {
        ctx.rotate(Math.atan2(s.vy, s.vx));
        ctx.fillStyle = s.color;
        ctx.fillRect(-s.r * 2.2, -s.r * 0.35, s.r * 4.4, s.r * 0.7);
      } else {
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(0, 0, s.r * s.life, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  };

  /** 还没炸的奶泡炸弹 */
  const drawBombs = () => {
    bombs.forEach((b) => {
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0, 0, 17, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(150,200,240,0.75)';
      ctx.beginPath();
      ctx.ellipse(-4, -3, 7, 5, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8fc6ee';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
  };
  const drawSlingshot = (layer) => {
    const s = slingGeom();
    const curR = (BIRDS[currentBird] || BIRDS.naidan).r;
    const forkY = s.prongTopY + 78; // 分叉点
    const tipBack = { x: s.x - 27, y: s.prongTopY + 4 };
    const tipFront = { x: s.x + 27, y: s.prongTopY + 6 };
    ctx.save();
    ctx.lineCap = 'round';
    const strokeWood = (w, c1) => { ctx.lineWidth = w; ctx.strokeStyle = c1; ctx.stroke(); };

    const drawPole = () => {
      // 树干立柱 + 底座
      ctx.beginPath();
      ctx.moveTo(s.x, s.baseY + 6);
      ctx.lineTo(s.x, forkY);
      strokeWood(28, '#8b5a2b');
      ctx.beginPath();
      ctx.moveTo(s.x - 11, s.baseY - 4);
      ctx.lineTo(s.x - 11, forkY);
      strokeWood(6, 'rgba(255,236,200,0.28)');
      ctx.fillStyle = '#7d5127';
      ctx.beginPath();
      ctx.ellipse(s.x, s.baseY + 2, 34, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,236,200,0.2)';
      ctx.beginPath();
      ctx.ellipse(s.x - 8, s.baseY - 2, 18, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    };

    if (layer === 'back') {
      drawPole();
      ctx.beginPath();
      ctx.moveTo(s.x, forkY + 4);
      ctx.lineTo(tipBack.x, tipBack.y);
      strokeWood(21, '#7d4f26');
    } else {
      ctx.beginPath();
      ctx.moveTo(s.x, forkY + 10);
      ctx.lineTo(tipFront.x, tipFront.y);
      strokeWood(21, '#9c6733');
    }

    // 皮筋：从叉尖拉到奶蛋身上
    const held = activeBird && (state === 'aim' || state === 'settling');
    const target = held ? activeBird.position : slingAnchor();
    const tip = layer === 'back' ? tipBack : tipFront;
    // 皮筋止于奶蛋外沿，别糊在它脸上
    const trimTo = (from, to, radius) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const t = Math.max(0, (len - radius) / len);
      return { x: from.x + dx * t, y: from.y + dy * t };
    };
    const end = trimTo(tip, target, curR * (layer === 'back' ? 1.02 : 1.18));
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(end.x, end.y);
    strokeWood(13, layer === 'back' ? '#4f3218' : '#6b4520');
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(end.x, end.y);
    strokeWood(6, layer === 'back' ? '#6d4726' : '#8a5c30');

    if (layer === 'back') {
      // 后叉尖的小圆头
      ctx.fillStyle = '#5f3c1c';
      ctx.beginPath();
      ctx.arc(tipBack.x, tipBack.y, 9, 0, Math.PI * 2);
      ctx.fill();
      if (held) {
        // 皮兜画在奶蛋身后，别糊在它肚子上
        ctx.save();
        ctx.translate(target.x, target.y);
        ctx.rotate(activeBird.angle);
        ctx.fillStyle = '#5f3a19';
        roundRect(-17, -curR * 0.95, 34, 22, 9);
        ctx.fill();
        ctx.restore();
      }
    } else {
      ctx.fillStyle = '#7a4d24';
      ctx.beginPath();
      ctx.arc(tipFront.x, tipFront.y, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };
  const drawTrailAndAim = () => {
    trail.forEach((t) => {
      const a = clamp(t.life, 0, 1);
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = '#fffdf3';
      ctx.beginPath();
      ctx.arc(t.x, t.y, 4 + a * 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a * 0.35;
      ctx.strokeStyle = '#e2ab68';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    if (drag && activeBird) {
      const pullVec = { x: slingAnchor().x - drag.x, y: slingAnchor().y - drag.y };
      const v0 = { x: pullVec.x * LAUNCH_K, y: pullVec.y * LAUNCH_K };
      let px = drag.x;
      let py = drag.y;
      let vx = v0.x;
      let vy = v0.y;
      const dots = 9;
      for (let i = 0; i < dots * 6; i++) {
        vx *= 1 - 0.0025;
        vy = (vy + GRAVITY_PER_TICK) * (1 - 0.0025);
        px += vx;
        py += vy;
        if (i % 6 === 0) {
          const age = i / (dots * 6);
          ctx.globalAlpha = (1 - age) * 0.9;
          // 瞄准辅助线统一用蓝色；拉满弓时提高亮度和描边强度
          ctx.fillStyle = drag.charge > 0.35 ? AIM_ASSIST.fullFill : AIM_ASSIST.fill;
          ctx.beginPath();
          ctx.arc(px, py, 7 - age * 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = drag.charge > 0.35 ? AIM_ASSIST.fullStroke : AIM_ASSIST.stroke;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      drawChargeFx(drag.charge || 0);
      // 拉力提示条
      const power = clamp(Vector.magnitude(pullVec) / MAX_PULL, 0, 1);
      ctx.save();
      ctx.translate(slingAnchor().x - 58, GROUND_Y + 36);
      ctx.fillStyle = drag.full ? 'rgba(150,90,20,0.45)' : 'rgba(90,60,30,0.28)';
      roundRect(0, 0, 156, 16, 8);
      ctx.fill();
      const pg = ctx.createLinearGradient(0, 0, 156, 0);
      if (drag.charge > 0.4) {
        pg.addColorStop(0, '#fff3b0');
        pg.addColorStop(1, '#ff8a1f');
      } else {
        pg.addColorStop(0, '#ffe07a');
        pg.addColorStop(1, '#ff6f3c');
      }
      ctx.fillStyle = pg;
      roundRect(2, 2, Math.max(10, 152 * power), 12, 6);
      ctx.fill();
      ctx.restore();
      if (drag.full) {
        const pulse = 0.78 + 0.22 * Math.sin(timeMs / 110);
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.font = '800 20px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#ff9a1f';
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 4;
        ctx.textAlign = 'left';
        ctx.strokeText('满弓！', slingAnchor().x - 58, GROUND_Y + 28);
        ctx.fillText('满弓！', slingAnchor().x - 58, GROUND_Y + 28);
        ctx.restore();
      }
    }
  };

  /**
   * 满弓力量特效：身周光晕 + 双圈脉冲环 + 往里吸的能量线 + 脚下扬尘，
   * 全部按 timeMs 走相位，不需要额外状态。
   */
  /** 满弓时整屏边缘泛暖光，拉满这件事一眼就能看出来 */
  const drawChargeVignette = () => {
    const charge = drag ? drag.charge || 0 : 0;
    if (charge <= 0.03) return;
    const cx = CAM.x + viewW() / 2;
    const cy = CAM.y + viewH() / 2;
    const g = ctx.createRadialGradient(cx, cy, viewW() * 0.22, cx, cy, viewW() * 0.66);
    const pulse = 0.75 + 0.25 * Math.sin(timeMs / 110);
    g.addColorStop(0, 'rgba(255,180,80,0)');
    g.addColorStop(0.6, `rgba(255,166,60,${0.1 * charge * pulse})`);
    g.addColorStop(1, `rgba(255,132,32,${0.34 * charge * pulse})`);
    ctx.fillStyle = g;
    ctx.fillRect(CAM.x - 4, CAM.y - 4, viewW() + 8, viewH() + 8);
  };

  /** boss 关常驻的压迫感：四角压暗 + 偶尔一道闪电 */
  const drawBossMood = () => {
    if (!isBossMood()) return;
    const cx = CAM.x + viewW() / 2;
    const cy = CAM.y + viewH() / 2;
    const g = ctx.createRadialGradient(cx, cy, viewW() * 0.16, cx, cy, viewW() * 0.62);
    g.addColorStop(0, 'rgba(20,6,20,0)');
    g.addColorStop(0.65, 'rgba(20,6,20,0.22)');
    g.addColorStop(1, 'rgba(14,4,16,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(CAM.x - 4, CAM.y - 4, viewW() + 8, viewH() + 8);
    if (lightning > 0) {
      ctx.fillStyle = `rgba(255,240,255,${Math.min(0.55, lightning * 0.55)})`;
      ctx.fillRect(CAM.x - 4, CAM.y - 4, viewW() + 8, viewH() + 8);
    }
  };

  const drawChargeFx = (charge) => {
    const b = activeBird;
    if (!b || charge <= 0.02) return;
    const x = b.position.x;
    const y = b.position.y;
    const t = timeMs / 1000;
    ctx.save();
    // 光晕
    const glow = ctx.createRadialGradient(x, y, 4, x, y, 78);
    glow.addColorStop(0, `rgba(255,246,205,${0.5 * charge})`);
    glow.addColorStop(0.45, `rgba(255,176,60,${0.3 * charge})`);
    glow.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 78, 0, Math.PI * 2);
    ctx.fill();
    // 双圈脉冲
    for (let i = 0; i < 2; i++) {
      const ph = (t * 1.5 + i * 0.5) % 1;
      ctx.globalAlpha = (1 - ph) * 0.8 * charge;
      ctx.strokeStyle = i ? '#fff2c0' : '#ffb03a';
      ctx.lineWidth = 1.5 + 3.5 * (1 - ph);
      ctx.beginPath();
      ctx.arc(x, y, 22 + ph * 52, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 往里吸的能量线
    const n = 12;
    for (let i = 0; i < n; i++) {
      const ph = (t * 2.4 + i * 0.137) % 1;
      const a = (i / n) * Math.PI * 2 + t * 2.1;
      const r0 = 86 * (1 - ph * 0.72);
      const a2 = a + ph * 0.6;
      ctx.globalAlpha = (1 - ph) * 0.85 * charge;
      ctx.strokeStyle = i % 2 ? '#fff6cf' : '#ffb44a';
      ctx.lineWidth = 1 + 2.4 * (1 - ph);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a2) * r0, y + Math.sin(a2) * r0);
      ctx.lineTo(x + Math.cos(a2) * (r0 - 24), y + Math.sin(a2) * (r0 - 24));
      ctx.stroke();
    }
    // 脚下扬起的奶油尘
    ctx.globalAlpha = 0.5 * charge;
    for (let i = 0; i < 6; i++) {
      const ph = (t * 1.1 + i / 6) % 1;
      const rr = 18 + ph * 66;
      ctx.beginPath();
      ctx.arc(x + Math.cos(i * 2.4) * rr * 0.8, GROUND_Y - 4 - ph * 16, 5 + ph * 9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,246,220,0.7)';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };
  const drawParticles = () => {
    particles.forEach((p) => {
      ctx.save();
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.kind === 'cream') {
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.beginPath();
        ctx.arc(-p.r * 0.28, -p.r * 0.3, p.r * 0.32, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.8);
      }      ctx.restore();
    });
    dustPuffs.forEach((d) => {
      ctx.globalAlpha = clamp(d.life, 0, 1) * 0.5;
      ctx.fillStyle = '#fff6e0';
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  };
  const drawFloaters = () => {
    floaters.forEach((f) => {
      ctx.save();
      ctx.globalAlpha = clamp(f.life * 1.4, 0, 1);
      ctx.font = '800 30px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    });
  };
  const render = () => {
    const scale = dpr * CAM.zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const shakeX = CAM.shake ? rand(-CAM.shake, CAM.shake) : 0;
    const shakeY = CAM.shake ? rand(-CAM.shake, CAM.shake) : 0;
    ctx.setTransform(scale, 0, 0, scale, -(CAM.x * scale) + shakeX * dpr, -(CAM.y * scale) + shakeY * dpr);
    drawSky();
    drawGround();
    drawBossMood();
    drawChargeVignette();
    if (state !== 'title' && state !== 'over') drawQueue();
    drawSlingshot('back');
    blocks.forEach(drawBlock);
    pigs.forEach(drawPig);
    drawBombs();
    drawExplosions();
    drawSparks();
    drawAimMarks();
    if (activeBird) drawBird(activeBird);
    inFlight.forEach((b) => { if (b !== activeBird) drawBird(b); });
    drawSlingshot('front');
    drawTrailAndAim();
    drawParticles();
    flyingPigs.forEach(drawFlyingPig);
    flyingBosses.forEach(drawFlyingBoss);
    drawFloaters();
    if (cutInStrength > 0) drawBossCutIn(cutInStrength, timeMs / 1000);
    if (nukeFlash > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(225,250,255,${0.68 * nukeFlash})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (state === 'edit') drawEditorOverlay();   // 网格 / 发射点 / 选中高亮
  };
  Events.on(engine, 'collisionStart', (e) => handleCollision(e.pairs));
  let acc = 0;
  let last = performance.now();
  const frame = (t) => {
    const dt = Math.min(64, t - last);
    last = t;
    if (state !== 'title') {
      acc += dt;
      let guard = 0;
      while (acc >= STEP && guard++ < 5) {
        step();
        acc -= STEP;
      }    } else {
      timeMs += dt;
    }

    render();
    requestAnimationFrame(frame);
  };
  // ---------------------------------------------------------------- 创意工坊
  const WK_KEY = 'naidan-workshop-v1';
  const BLOCK_SIZES = { s: [60, 60], m: [90, 60], l: [120, 90], long: [180, 34] };
  let editor = null;          // 编辑器状态
  let cameFromEditor = false; // 从编辑器点"试玩"进来的 → 结算面板给一个"回编辑器"
  let customDef = null;       // 当前在玩的自制关卡
  let customSource = 'community'; // editor | community | share
  let shareBox = null;
  let wkEntries = [];         // 社区关卡（目录 + 解出来的 def）
  let wkStats = {};           // id → { likes, plays }
  let wkWeeklyIds = [];       // 本周锁定的点赞前 6
  let wkWeeklyKey = '';
  let wkSort = 'latest';
  let wkQuery = '';
  let wkTab = 'community';
  let wkCatalogState = 'idle'; // idle | loading | ready | error
  let wkRemoteState = 'unknown'; // unknown | ready | missing | error
  let wkStatsLoading = false;
  let submitDef = null;
  // "试玩通关"的那一份关卡（分享码即指纹）：内容一改就对不上，得重新通关才允许发布
  let passedCode = null;
  const gateOpen = () => !!(editor && passedCode && window.WorkshopLevel.pack(editor.def) === passedCode);
  const moderation = (text) => window.WorkshopModeration.check(text);
  const editorErrors = () => {
    if (!editor) return [];
    const errs = window.WorkshopLevel.validate(editor.def).slice();
    const nameCheck = moderation(editor.def.name);
    if (!nameCheck.ok) errs.push(`关卡名${nameCheck.reason}`);
    return errs;
  };
  /** 只刷新状态栏和发布按钮：改关卡名时光标不能因为重设 input.value 跳到末尾 */
  const refreshPublishState = () => {
    if (!editor) return;
    const errs = editorErrors();
    const warns = window.WorkshopLevel.warnings(editor.def);
    const passed = gateOpen();
    el.edStatus.textContent = errs.length
      ? `⚠️ ${errs[0]}${errs.length > 1 ? `（还有 ${errs.length - 1} 处）` : ''}`
      : `✅ 可以玩了${warns.length ? ` · ${warns[0]}` : ''}${passed ? '' : ' · 发布前需试玩通关'}`;
    el.edStatus.classList.toggle('bad', errs.length > 0);
    el.edPlay.disabled = errs.length > 0;
    el.edPlay.style.opacity = errs.length ? 0.45 : 1;
    el.edShare.disabled = errs.length > 0 || !passed;
    el.edShare.style.opacity = errs.length > 0 || !passed ? 0.45 : 1;
    el.edShare.title = passed ? '把链接发给别人' : '先试玩通关，才能发布';
    el.edSubmit.disabled = errs.length > 0 || !passed;
    el.edSubmit.style.opacity = errs.length > 0 || !passed ? 0.45 : 1;
    el.edSubmit.title = passed ? '提交到社区工坊（需要 GitHub 账号）' : '先试玩通关，才能投稿';
  };

  const communityStat = (entry) => wkStats[entry.id] || { likes: 0, plays: 0 };
  const fmtCount = (n) => {
    const v = Math.max(0, Number(n) || 0);
    return v >= 10000 ? `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}万` : String(v);
  };
  /** 卡片上的小地图：照着真实方块/奶蛙位置画一个缩略图，比纯文字好找 */
  const drawCommunityPreview = (canvas, def) => {
    const wide = canvas.width;
    const high = canvas.height;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, wide, high);
    const grad = g.createLinearGradient(0, 0, 0, high);
    grad.addColorStop(0, '#ffe5b7');
    grad.addColorStop(1, '#fff7e5');
    g.fillStyle = grad;
    g.fillRect(0, 0, wide, high);
    const xs = [
      ...def.blocks.map((b) => b.x - b.w / 2),
      ...def.blocks.map((b) => b.x + b.w / 2),
      ...def.pigs.map((p) => p.x - p.r),
      ...def.pigs.map((p) => p.x + p.r),
      ...def.launchPoints.map((p) => p.x),
    ];
    const minX = Math.min(...xs) - 90;
    const maxX = Math.max(...xs) + 90;
    const span = Math.max(500, maxX - minX);
    const scale = wide / span;
    const px = (x) => (x - minX) * scale;
    const ground = high - 18;
    g.fillStyle = '#8cc55c';
    g.fillRect(0, ground - 4, wide, 22);
    g.fillStyle = '#9a663c';
    g.fillRect(0, ground + 12, wide, high - ground);
    const colors = { wood: '#b5763f', ice: '#8ed8ed', stone: '#8d8b86' };
    def.blocks.forEach((b) => {
      g.fillStyle = colors[b.material] || colors.wood;
      const w = Math.max(3, b.w * scale);
      const h = Math.max(4, b.h * scale);
      g.save();
      g.translate(px(b.x), ground - ((def.groundY || 636) - b.y) * scale);
      g.rotate(b.angle || 0);
      g.fillRect(-w / 2, -h / 2, w, h);
      g.restore();
    });
    def.pigs.forEach((p) => {
      const py = ground - ((def.groundY || 636) - p.y) * scale;
      g.fillStyle = p.bonus ? '#ffd86e' : '#f3c852';
      g.beginPath();
      g.arc(px(p.x), py, Math.max(5, p.r * scale), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#5a3a26';
      g.fillRect(px(p.x) - 3, py - 2, 2, 2);
      g.fillRect(px(p.x) + 1, py - 2, 2, 2);
    });
    const sling = def.launchPoints[0];
    g.strokeStyle = '#82512f';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(px(sling.x), ground);
    g.lineTo(px(sling.x), ground - 28);
    g.stroke();
  };
  const communityCard = (entry) => {
    const stat = communityStat(entry);
    const card = document.createElement('article');
    card.className = `wkCard${wkStatsLoading ? ' wkLoading' : ''}`;
    card.dataset.levelId = entry.id;
    const preview = document.createElement('canvas');
    preview.className = 'wkPreview';
    preview.width = 360;
    preview.height = 150;
    drawCommunityPreview(preview, entry.def);
    const body = document.createElement('div');
    body.className = 'wkCardBody';
    const title = document.createElement('div');
    title.className = 'wkCardTitle';
    title.textContent = entry.name;
    title.title = entry.name;
    const author = document.createElement('div');
    author.className = 'wkCardAuthor';
    author.textContent = `作者 · ${entry.author}`;
    const meta = document.createElement('div');
    meta.className = 'wkCardMeta wkCardInfo';
    meta.textContent = `${entry.def.pigs.length} 奶蛙 · ${entry.def.blocks.length} 方块 · ${entry.def.birds.length} 发 · ${entry.def.launchPoints.length} 段`;
    const counts = document.createElement('div');
    counts.className = 'wkCardMeta';
    const playLabel = document.createElement('span');
    playLabel.className = 'wkStat';
    playLabel.title = '游玩人数（同一浏览器去重）';
    playLabel.textContent = `▶ ${fmtCount(stat.plays)}`;
    const likeLabel = document.createElement('span');
    likeLabel.className = 'wkStat';
    likeLabel.title = '点赞数';
    likeLabel.textContent = `♥ ${fmtCount(stat.likes)}`;
    counts.append(playLabel, likeLabel);
    const foot = document.createElement('div');
    foot.className = 'wkCardFoot';
    const play = document.createElement('button');
    play.className = 'wkPlay';
    play.textContent = '开玩';
    play.addEventListener('click', () => {
      window.WorkshopCommunity.recordPlay(entry).then((res) => {
        if (res.ok && !res.already && Number.isFinite(res.value)) {
          wkStats[entry.id] = { ...communityStat(entry), plays: res.value };
          renderCommunity();
        }
      });
      startCustom(entry.def, { source: 'community' });
      toast(`社区关卡：${entry.name}`, 1800);
    });
    const like = document.createElement('button');
    const already = window.WorkshopCommunity.isLiked(entry.code);
    const likeLimitReached = !already && stat.likes >= stat.plays;
    like.className = `wkLike${already ? ' liked' : ''}`;
    like.textContent = already ? `♥ ${fmtCount(stat.likes)} 已赞` : `♥ ${fmtCount(stat.likes)}`;
    like.title = already
      ? '再点一次取消点赞'
      : likeLimitReached
        ? '点赞数不能超过游玩数，先玩一次再来点赞'
        : '给这张图点个赞';
    like.disabled = likeLimitReached;
    like.addEventListener('click', async () => {
      if (like.disabled) return;
      if (!window.WorkshopCommunity.isLiked(entry.code) && communityStat(entry).likes >= communityStat(entry).plays) {
        toast('点赞数不能超过游玩数，先玩一次再来点赞', 1900);
        return;
      }
      const wasLiked = window.WorkshopCommunity.isLiked(entry.code);
      const previous = { ...communityStat(entry) };
      // 先立即更新 UI，网络计数在后台同步；避免慢请求期间按钮像“点不动”
      const request = wasLiked
        ? window.WorkshopCommunity.unlike(entry)
        : window.WorkshopCommunity.like(entry);
      const delta = Number(wasLiked ? -1 : 1);
      wkStats[entry.id] = { ...previous, likes: Math.max(0, previous.likes + delta) };
      renderCommunity();
      const res = await request;
      if (!res.ok) {
        wkStats[entry.id] = previous;
        renderCommunity();
        toast(wasLiked ? '取消点赞失败，稍后再试' : '点赞服务暂时不可用，稍后再试', 1900);
        return;
      }
      toast(wasLiked ? '已取消点赞' : '谢谢点赞！', 1200);
    });
    foot.append(play, like);
    body.append(title, author, meta, counts, foot);
    card.append(preview, body);
    return card;
  };
  const renderCommunity = () => {
    if (!el.wkCommunity || wkTab !== 'community') return;
    const q = wkQuery.trim().toLowerCase();
    const filtered = wkEntries.filter((entry) =>
      !q || entry.name.toLowerCase().includes(q) || entry.author.toLowerCase().includes(q)
    );
    const when = (entry) => new Date(entry.submittedAt || 0).getTime() || 0;
    const pinned = wkWeeklyIds.map((id) => filtered.find((entry) => entry.id === id)).filter(Boolean);
    const pinnedSet = new Set(wkWeeklyIds);
    const list = filtered.filter((entry) => !pinnedSet.has(entry.id));
    list.sort((a, b) => {
      if (wkSort === 'plays') return communityStat(b).plays - communityStat(a).plays || when(b) - when(a);
      if (wkSort === 'likes') return communityStat(b).likes - communityStat(a).likes || when(b) - when(a);
      return when(b) - when(a);
    });
    el.wkMoreTitle.textContent = wkSort === 'plays' ? '最多游玩' : wkSort === 'likes' ? '最多点赞' : '最新关卡';
    el.wkWeekly.innerHTML = '';
    el.wkCommunity.innerHTML = '';
    const weeklyVisible = pinned.length > 0 && wkCatalogState === 'ready';
    el.wkWeeklySection.classList.toggle('hide', !weeklyVisible);
    if (weeklyVisible) pinned.forEach((entry) => el.wkWeekly.appendChild(communityCard(entry)));
    if (wkCatalogState === 'loading' && !wkEntries.length) {
      const tip = document.createElement('div');
      tip.className = 'empty';
      tip.textContent = '正在加载社区关卡…';
      el.wkCommunity.appendChild(tip);
      return;
    }
    if (wkCatalogState === 'error') {
      const tip = document.createElement('div');
      tip.className = 'empty';
      tip.textContent = '社区目录没加载出来，点「刷新」再试一次';
      el.wkCommunity.appendChild(tip);
      return;
    }
    if (!list.length) {
      const tip = document.createElement('div');
      tip.className = 'empty';
      tip.textContent = q
        ? '没有找到更多匹配的关卡'
        : pinned.length
          ? '本周前 6 已在上方；新关卡会出现在这里'
          : '社区里还没有关卡';
      el.wkCommunity.appendChild(tip);
      return;
    }
    list.forEach((entry) => el.wkCommunity.appendChild(communityCard(entry)));
  };

  /** 每周快照：点赞前 6 只在本周五 24:00 重算，新关卡不会把本周名单挤掉 */
  const prepareWeekly = async () => {
    const period = window.WorkshopCommunity.weeklyPeriod();
    wkWeeklyKey = period.key;
    const loaded = await window.WorkshopCommunity.loadWeeklySnapshot(period.key);
    const when = (entry) => new Date(entry.submittedAt || 0).getTime() || 0;
    const positive = wkEntries
      .filter((entry) => communityStat(entry).likes > 0)
      .sort((a, b) =>
        communityStat(b).likes - communityStat(a).likes
        || communityStat(b).plays - communityStat(a).plays
        || when(b) - when(a)
      )
      .map((entry) => entry.id);
    let ids = Array.isArray(loaded)
      ? loaded.filter((id) => positive.includes(id)).slice(0, 6)
      : [];
    if (ids.length < 6) {
      ids.push(...positive.filter((id) => !ids.includes(id)).slice(0, 6 - ids.length));
    }
    wkWeeklyIds = ids;
    if (ids.length && (!loaded || ids.some((id, i) => loaded[i] !== id) || ids.length !== loaded.length)) {
      await window.WorkshopCommunity.saveWeeklySnapshot(period.key, ids);
    }
  };

  const loadCommunity = async (force = false) => {
    if (wkCatalogState === 'loading') return;
    if (wkCatalogState === 'ready' && !force) return;
    wkCatalogState = 'loading';
    renderCommunity();
    try {
      const catalog = await window.WorkshopCommunity.loadCatalog();
      wkEntries = catalog.levels || [];
      wkRemoteState = catalog.remoteState || window.WorkshopCommunity.remoteState();
      wkCatalogState = 'ready';
      wkStatsLoading = true;
      renderCommunity();
      const loaded = await window.WorkshopCommunity.loadStats(wkEntries, { force });
      wkStats = loaded.values || {};
      await prepareWeekly();
      wkStatsLoading = false;
      renderCommunity();
    } catch (e) {
      wkCatalogState = 'error';
      wkStatsLoading = false;
      renderCommunity();
    }
  };
  const setWorkshopTab = (tab) => {
    wkTab = tab === 'mine' ? 'mine' : 'community';
    el.wkTabCommunity.classList.toggle('on', wkTab === 'community');
    el.wkTabMine.classList.toggle('on', wkTab === 'mine');
    el.wkCommunityPane.classList.toggle('hide', wkTab !== 'community');
    el.wkMinePane.classList.toggle('hide', wkTab !== 'mine');
    if (wkTab === 'community') {
      renderCommunity();
      if (wkCatalogState === 'idle') loadCommunity();
    }
  };

  const drafts = () => {
    try {
      const o = JSON.parse(localStorage.getItem(WK_KEY) || '{}');
      return Array.isArray(o.drafts) ? o.drafts : [];
    } catch (e) { return []; }
  };
  const saveDrafts = (list) => {
    try { localStorage.setItem(WK_KEY, JSON.stringify({ drafts: list.slice(0, 30) })); } catch (e) { /* 隐私模式存不了 */ }
  };
  /** 编辑中的关卡随手存草稿（每次改动都存，最多 30 份） */
  const persistDraft = () => {
    if (!editor) return;
    const d = window.WorkshopLevel.normalize(editor.def);
    editor.def = d;
    const list = drafts();
    const i = list.findIndex((x) => x.id === d.id);
    const entry = { id: d.id, name: d.name, def: d, updated: Date.now() };
    if (i >= 0) list[i] = entry; else list.unshift(entry);
    saveDrafts(list);
    renderDrafts();
  };
  const fmtTime = (t) => {
    const d = new Date(t);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const renderDrafts = () => {
    if (!el.wkDrafts) return;
    const list = drafts();
    if (el.wkMineCount) el.wkMineCount.textContent = String(list.length);
    el.wkDrafts.innerHTML = '';
    if (!list.length) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = '还没有自己搭的关卡——点「新建关卡」开始';
      el.wkDrafts.appendChild(d);
      return;
    }
    list.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'draft';
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = entry.name || '未命名';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${(entry.def.blocks || []).length} 方块 · ${(entry.def.pigs || []).length} 奶蛙 · ${fmtTime(entry.updated)}`;
      const open = document.createElement('button');
      open.textContent = '打开';
      open.addEventListener('click', () => openEditor(entry.def, { passed: entry.passed }));
      const share = document.createElement('button');
      share.className = 'ghost';
      const passed = entry.passed && entry.passed === window.WorkshopLevel.pack(entry.def);
      share.textContent = passed ? '发布' : '未通关';
      share.title = passed ? '复制发布链接' : '先打开这一关试玩通关，才能发布';
      share.addEventListener('click', () => {
        if (!passed) { toast('这一关还没试玩通关，先「打开」玩通一次', 2400); return; }
        copyText(shareLink(entry.def), '发布链接已复制');
      });
      const submit = document.createElement('button');
      submit.className = 'ghost';
      submit.textContent = passed ? '投稿' : '未通关';
      submit.disabled = !passed;
      submit.style.opacity = passed ? 1 : 0.45;
      submit.addEventListener('click', () => {
        if (!passed) { toast('先打开这一关试玩通关，才能投稿', 2200); return; }
        openWorkshopSubmit(entry.def);
      });
      const del = document.createElement('button');
      del.className = 'ghost';
      del.textContent = '删';
      del.addEventListener('click', () => {
        saveDrafts(drafts().filter((x) => x.id !== entry.id));
        renderDrafts();
        toast('草稿删掉了', 1200);
      });
      row.append(nm, meta, open, submit, share, del);
      el.wkDrafts.appendChild(row);
    });
  };

  const shareLink = (def) => `${location.href.split('#')[0]}#level=${window.WorkshopLevel.pack(def)}`;
  /** 匿名投稿：只需要一个公开的 Supabase publishable key，不打开外部页面 */
  const openWorkshopSubmit = (def) => {
    submitDef = window.WorkshopLevel.normalize(def);
    el.subLevelNameInput.value = submitDef.name;
    try { el.subAuthor.value = localStorage.getItem('naidan-workshop-author') || ''; } catch (e) { el.subAuthor.value = ''; }
    el.subStatus.textContent = wkRemoteState === 'missing'
      ? '投稿服务还没初始化，请先在 Supabase 执行建表脚本'
      : '关卡会立即出现在社区列表，投稿后不能自行修改或删除。';
    el.subStatus.classList.toggle('bad', wkRemoteState === 'missing');
    el.subSend.disabled = false;
    el.subSend.textContent = '确认投稿';
    el.submitDialog.classList.remove('hide');
    setTimeout(() => el.subLevelNameInput.focus(), 30);
  };
  const fallbackCopy = (text) => {
    if (!shareBox) {
      shareBox = document.createElement('textarea');
      shareBox.id = 'shareBox';
      shareBox.style.cssText = 'position:fixed;left:50%;bottom:7%;transform:translateX(-50%);width:min(82vw,720px);height:62px;z-index:60;border-radius:12px;padding:8px 10px;font-size:11.5px;border:2px solid rgba(206,152,42,.4);background:#fffdf5;color:#6b4a30';
      document.getElementById('stage').appendChild(shareBox);
    }
    shareBox.value = text;
    shareBox.classList.remove('hide');
    shareBox.focus();
    shareBox.select();
    toast('链接已选中，Ctrl+C 复制', 2600);
  };
  /** 复制文本：https 下走剪贴板；file:// 没有剪贴板权限，退回到"选中一段文本" */
  const copyText = (text, okMsg) => {
    if (window.isSecureContext && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => toast(okMsg || '已复制', 1600)).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  };

  const openWorkshop = () => {
    clearEndlessResume();
    AudioKit.unlock();
    AudioKit.ready();
    el.title.classList.add('hide');
    el.end.classList.add('hide');
    el.editor.classList.add('hide');
    el.workshop.classList.remove('hide');
    state = 'workshop';
    intro = null;
    floaters = [];
    el.introLabel.classList.remove('on');
    el.skipTip.classList.remove('on');
    el.pick.classList.add('hide');
    el.hint.classList.add('hide');
    el.hud.classList.add('hide');
    el.btnExitLevel.classList.add('hide');
    renderDrafts();
    setWorkshopTab('community');
  };
  const closeWorkshop = () => {
    el.workshop.classList.add('hide');
    el.title.classList.remove('hide');
    el.hud.classList.remove('hide');
    state = 'title';
  };
  /** 新建关卡的起点：一个小门洞 + 一只奶蛙，保证一进去就能试玩 */
  const starterLevel = () => {
    const d = window.WorkshopLevel.blank();
    d.blocks = [
      { x: 900, y: 571, w: 34, h: 130, material: 'wood' },
      { x: 1040, y: 571, w: 34, h: 130, material: 'wood' },
      { x: 970, y: 489, w: 190, h: 34, material: 'wood' },
    ];
    d.pigs = [{ x: 970, y: 600, r: 36 }];
    return d;
  };

  /** 编辑器里的方块/奶蛙是"假刚体"：只为了让现有渲染函数直接画出来，不进物理世界 */
  const rebuildEditorScene = () => {
    level = editor.def;
    setStage(0);
    blocks = editor.def.blocks.map((b) => ({
      position: { x: b.x, y: b.y }, angle: b.angle || 0, velocity: { x: 0, y: 0 }, angularVelocity: 0, circleRadius: 0,
      game: { kind: 'block', material: b.material, w: b.w, h: b.h, hp: 1, maxHp: 1, flash: 0, stage: b.stage },
    }));
    pigs = editor.def.pigs.map((p) => ({
      position: { x: p.x, y: p.y }, angle: 0, velocity: { x: 0, y: 0 }, angularVelocity: 0, circleRadius: p.r,
      game: { kind: 'pig', r: p.r, hp: 1, maxHp: 1, hurt: 0, bonus: !!p.bonus, born: 0, stage: p.stage },
    }));
  };
  const syncEditorUI = () => {
    if (!editor) return;
    [[el.edToolBlock, 'block'], [el.edToolPig, 'pig'], [el.edToolMove, 'move'], [el.edToolErase, 'erase']]
      .forEach(([b, t]) => { b.classList.toggle('on', editor.tool === t); b.classList.toggle('ghost', editor.tool !== t); });
    [[el.edMatWood, 'wood'], [el.edMatIce, 'ice'], [el.edMatStone, 'stone']]
      .forEach(([b, t]) => { b.classList.toggle('on', editor.material === t); b.classList.toggle('ghost', editor.material !== t); });
    [[el.edSizeS, 's'], [el.edSizeM, 'm'], [el.edSizeL, 'l'], [el.edSizeLong, 'long']]
      .forEach(([b, t]) => { b.classList.toggle('on', editor.size === t); b.classList.toggle('ghost', editor.size !== t); });
    const selectedBlock = editor.selected && editor.selected.kind === 'block'
      ? editor.def.blocks[editor.selected.index]
      : null;
    const canRotate = !!selectedBlock;
    el.edRotate.disabled = !canRotate;
    el.edRotateFloat.disabled = !canRotate;
    el.edRotateFloat.classList.toggle('hide', !canRotate);
    if (canRotate) {
      const degrees = Math.round((selectedBlock.angle || 0) * 180 / Math.PI) % 360;
      el.edRotate.title = `当前 ${degrees}°；点击旋转 15°，Shift+点击旋转 45°`;
    } else {
      el.edRotate.title = '先选中一个方块';
    }
    el.edBlockProps.style.display = editor.tool === 'block' ? 'flex' : 'none';
    el.edPigProps.style.display = editor.tool === 'pig' ? 'flex' : 'none';
    el.edPigBonus.checked = !!editor.bonus;
    el.edStageVal.textContent = String(editor.def.launchPoints.length);
    const counts = rosterOf(editor.def);
    el.edBirdsBtn.textContent = `${editor.def.birds.length} 发 ▾`;
    el.edBirdsBtn.title = window.WorkshopLevel.BIRDS.filter((k) => counts[k])
      .map((k) => `${(window.BIRDS[k] || {}).name || k}${counts[k] > 1 ? '×' + counts[k] : ''}`)
      .join(' · ') || '选奶蛋';
    const errs = editorErrors();
    el.edPlay.disabled = errs.length > 0;
    el.edPlay.style.opacity = errs.length ? 0.45 : 1;
    refreshPublishState();
    el.edUndo.classList.toggle('ghost', !editor.undo.length);
    el.edRedo.classList.toggle('ghost', !editor.redo.length);
  };
  const openEditor = (def, opts = {}) => {
    clearEndlessResume();
    passedCode = opts.passed || null;
    const raw = def || starterLevel();
    const overBlocks = Array.isArray(raw.blocks) && raw.blocks.length > window.WorkshopLevel.LIMITS.blocks;
    const overPigs = Array.isArray(raw.pigs) && raw.pigs.length > window.WorkshopLevel.LIMITS.pigs;
    editor = {
      def: window.WorkshopLevel.normalize(raw),
      tool: 'block', material: 'wood', size: 'm', bonus: false,
      selected: null, undo: [], redo: [], press: null, drag: null,
    };
    el.workshop.classList.add('hide');
    el.title.classList.add('hide');
    el.end.classList.add('hide');
    el.editor.classList.remove('hide');
    if (shareBox) shareBox.classList.add('hide');
    el.hint.classList.add('hide');
    el.btnExitLevel.classList.add('hide');
    state = 'edit';
    rebuildEditorScene();
    // 编辑时的视野：别为了塞下整张图把镜头缩到看不清——保持 0.8~1 倍，
    // 横向靠拖动查看（滚轮也能缩），纵向让地面落在画面下沿附近，别留半屏土。
    CAM.zoom = clamp(W / (editor.def.worldW + 400), 0.8, 1);
    CAM.targetZoom = CAM.zoom;
    CAM.x = clampCamX(-60);
    CAM.targetX = CAM.x;
    CAM.y = clampCamY(GROUND_Y - viewH() * 0.85);
    updateZoomLabel();
    syncEditorUI();
    persistDraft();
    if (overBlocks || overPigs) {
      toast(
        overBlocks && overPigs
          ? '关卡超过上限，只保留前 200 方块和 40 奶蛙'
          : overBlocks
            ? '方块超过上限，只保留前 200 块'
            : '奶蛙超过上限，只保留前 40 只',
        3000
      );
    }
  };
  const leaveEditor = () => {
    el.editor.classList.add('hide');
    if (shareBox) shareBox.classList.add('hide');
    openWorkshop();
  };

  const editorSnapshot = () => {
    editor.undo.push(JSON.stringify(editor.def));
    if (editor.undo.length > 40) editor.undo.shift();
    editor.redo.length = 0;
  };
  const editorChanged = () => {
    editor.def = window.WorkshopLevel.normalize(editor.def);   // 取整 + 重算分段/世界长度
    rebuildEditorScene();
    syncEditorUI();
    persistDraft();
  };
  const rotateSelectedBlock = (degrees = 15) => {
    if (!editor || !editor.selected || editor.selected.kind !== 'block') return false;
    const block = editor.def.blocks[editor.selected.index];
    if (!block) return false;
    const candidate = { ...block, angle: (block.angle || 0) + degrees * Math.PI / 180 };
    if (blockCollides(candidate, editor.selected.index)) {
      toast('旋转后会和其他方块或奶蛙重叠', 2000);
      return false;
    }
    editorSnapshot();
    block.angle = candidate.angle;
    editorChanged();
    const turned = editor.def.blocks[editor.selected.index];
    const value = turned ? Math.round((turned.angle || 0) * 180 / Math.PI) % 360 : 0;
    toast(`旋转到 ${value}°`, 1000);
    return true;
  };
  const editorHit = (p) => {
    for (let i = pigs.length - 1; i >= 0; i--) {
      if (Math.hypot(p.x - pigs[i].position.x, p.y - pigs[i].position.y) <= pigs[i].game.r + 10) return { kind: 'pig', index: i };
    }
    for (let i = blocks.length - 1; i >= 0; i--) {
      const g = blocks[i].game;
      const a = -(blocks[i].angle || 0);
      const dx = p.x - blocks[i].position.x;
      const dy = p.y - blocks[i].position.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= g.w / 2 + 4 && Math.abs(ly) <= g.h / 2 + 4) return { kind: 'block', index: i };
    }
    return null;
  };
  const blockCollides = (candidate, ignoreIndex = -1) => {
    const W = window.WorkshopLevel;
    if (editor.def.blocks.some((other, i) => i !== ignoreIndex && W.blocksOverlap(candidate, other))) return true;
    return editor.def.pigs.some((pig) => W.circleHitsBlock(pig, candidate));
  };
  const pigCollides = (candidate, ignoreIndex = -1) => {
    const W = window.WorkshopLevel;
    if (editor.def.blocks.some((block) => W.circleHitsBlock(candidate, block))) return true;
    return editor.def.pigs.some((other, i) =>
      i !== ignoreIndex && Math.hypot(candidate.x - other.x, candidate.y - other.y) < (candidate.r + other.r) * 0.8
    );
  };
  const editorPlace = (p) => {
    const x = Math.round(p.x / 10) * 10;
    const y = Math.round(p.y / 10) * 10;
    if (editor.tool === 'block') {
      if (editor.def.blocks.length >= window.WorkshopLevel.LIMITS.blocks) {
        toast(`方块已达上限（${window.WorkshopLevel.LIMITS.blocks} 块），请先删除一块`, 2400);
        return;
      }
      const [w, h] = BLOCK_SIZES[editor.size] || BLOCK_SIZES.m;
      const candidate = { x, y, w, h, material: editor.material, angle: 0, stage: 0 };
      if (blockCollides(candidate)) {
        toast('这里会和已有方块或奶蛙重叠', 2000);
        return;
      }
      editorSnapshot();
      editor.def.blocks.push({ x: Math.max(40, x), y: Math.min(GROUND_Y - h / 2, y), w, h, material: editor.material, angle: 0 });
      editor.selected = { kind: 'block', index: editor.def.blocks.length - 1 };
      editorChanged();
    } else if (editor.tool === 'pig') {
      if (editor.def.pigs.length >= window.WorkshopLevel.LIMITS.pigs) {
        toast(`奶蛙已达上限（${window.WorkshopLevel.LIMITS.pigs} 只），请先删除一只`, 2400);
        return;
      }
      const pig = { x: Math.max(300, x), y: Math.min(GROUND_Y - 36, y), r: 36, ...(editor.bonus ? { bonus: true } : {}) };
      if (pigCollides(pig)) {
        toast('这里会和已有奶蛙或方块重叠', 2000);
        return;
      }
      editorSnapshot();
      editor.def.pigs.push(pig);
      editor.selected = { kind: 'pig', index: editor.def.pigs.length - 1 };
      editorChanged();
    }
  };
  const editorErase = (sel) => {
    if (!sel) return false;
    editorSnapshot();
    if (sel.kind === 'block') editor.def.blocks.splice(sel.index, 1);
    else editor.def.pigs.splice(sel.index, 1);
    editor.selected = null;
    editorChanged();
    return true;
  };
  const editorMoveItem = (sel, p) => {
    const list = sel.kind === 'block' ? editor.def.blocks : editor.def.pigs;
    const it = list[sel.index];
    if (!it) return;
    it.x = Math.round(Math.max(40, p.x) / 10) * 10;
    it.y = Math.round(Math.min(GROUND_Y - (sel.kind === 'block' ? it.h / 2 : it.r), p.y) / 10) * 10;
  };
  const edDownAt = (p) => {
    const hit = editorHit(p);
    if (editor.tool === 'erase' && hit) {
      editor.selected = hit;
      syncEditorUI();
      editorErase(hit);
      return;
    }
    if (hit) {
      const it = hit.kind === 'block' ? blocks[hit.index] : pigs[hit.index];
      editorSnapshot();                       // 记下"拖动之前"，松手时才有得撤销
      editor.selected = hit;
      editor.drag = {
        sel: hit,
        dx: p.x - it.position.x,
        dy: p.y - it.position.y,
        origin: { x: it.position.x, y: it.position.y, angle: it.angle || 0 },
      };
      syncEditorUI();
      return;
    }
    editor.press = { p, cam: { x: CAM.x, y: CAM.y }, moved: false };
  };
  const edDown = (ev) => edDownAt(pointerToWorld(ev));
  const edMoveAt = (p) => {
    if (editor.drag) {
      const { sel } = editor.drag;
      editorMoveItem(sel, { x: p.x - editor.drag.dx, y: p.y - editor.drag.dy });
      rebuildEditorScene();
      return;
    }
    if (!editor.press) return;
    const dx = p.x - editor.press.p.x;
    const dy = p.y - editor.press.p.y;
    if (!editor.press.moved && Math.hypot(dx, dy) * CAM.zoom < 8) return;
    editor.press.moved = true;
    CAM.x = clampCamX(editor.press.cam.x - dx);
    CAM.targetX = CAM.x;
    CAM.y = clampCamY(editor.press.cam.y - dy);
  };
  const edMove = (ev) => { edMoveAt(pointerToWorld(ev)); ev.preventDefault(); };
  const edUp = () => {
    if (!editor) return;
    if (editor.drag) {
      const { sel, origin } = editor.drag;
      const list = sel.kind === 'block' ? editor.def.blocks : editor.def.pigs;
      const item = list[sel.index];
      const blocked = item && (sel.kind === 'block'
        ? blockCollides(item, sel.index)
        : pigCollides(item, sel.index));
      if (blocked && item) {
        item.x = origin.x;
        item.y = origin.y;
        if (sel.kind === 'block') item.angle = origin.angle;
        toast('移动后会和其他物体重叠，已退回原位', 2200);
      }
      editor.drag = null;
      editorChanged();
      return;
    }
    if (!editor.press) return;
    const press = editor.press;
    editor.press = null;
    if (!press.moved) editorPlace(press.p);
  };
  const drawEditorOverlay = () => {
    if (!editor) return;
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = '#6b4a30';
    ctx.lineWidth = 1;
    for (let x = 0; x <= editor.def.worldW; x += 100) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GROUND_Y); ctx.stroke();
    }
    for (let y = 100; y < GROUND_Y; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(editor.def.worldW, y); ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.textAlign = 'center';
    editor.def.launchPoints.forEach((pt, i) => {
      ctx.fillStyle = i === 0 ? '#ff8a5b' : '#c98a4b';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6b4a30';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(`第${i + 1}段`, pt.x, pt.y - 16);
    });
    ctx.restore();
    const sel = editor.selected;
    if (!sel) return;
    const it = (sel.kind === 'block' ? blocks : pigs)[sel.index];
    if (!it) return;
    ctx.save();
    ctx.strokeStyle = '#ff8a5b';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    if (sel.kind === 'block') {
      ctx.translate(it.position.x, it.position.y);
      ctx.rotate(it.angle || 0);
      ctx.strokeRect(-it.game.w / 2 - 4, -it.game.h / 2 - 4, it.game.w + 8, it.game.h + 8);
    } else {
      ctx.beginPath(); ctx.arc(it.position.x, it.position.y, it.game.r + 6, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  };

  /** 开始玩一份自制关卡：用作者配置的最终阵容，不弹开局选蛋；preview 时连开场一起跳过 */
  const startCustom = (def, opts = {}) => {
    clearEndlessResume();
    carriedNuke = 0;
    customDef = window.WorkshopLevel.normalize(def);
    mode = 'custom';
    customSource = opts.source || (opts.fromEditor ? 'editor' : 'community');
    cameFromEditor = customSource === 'editor';
    el.hud.classList.remove('hide');
    el.workshop.classList.add('hide');
    el.editor.classList.add('hide');
    el.title.classList.add('hide');
    el.end.classList.add('hide');
    score = 0;
    totalScore = 0;
    pickChoice = null;
    bossRetryUsed = false;
    retryPending = false;
    updateScore();
    promptPick(customDef, { quick: true, silent: !!opts.preview, extra: false });
    updateLevelChip();
    updateExitButton();
  };
  /**
   * #level=… 分享码入口。首次打开和同页改 hash 都走这里——
   * 只监听加载事件的话，已经开着的页面再粘贴分享链接只会改 hash、不会重载脚本，关卡就打不开。
   */
  let lastSharedCode = null;
  const openSharedLink = (fromHashChange = false) => {
    const m = /(?:^|[#&])level=([^&]+)/.exec(location.hash || '');
    if (!m) {
      lastSharedCode = null;
      return false;
    }
    const code = m[1];
    if (fromHashChange && code === lastSharedCode) return false;
    const shared = window.WorkshopLevel.unpack(code);
    if (!shared) {
      toast('这条分享链接里的关卡损坏了', 2400);
      return false;
    }
    lastSharedCode = code;
    startCustom(shared, { source: 'share' });
    toast(`载入分享关卡：${shared.name}`, 2800);
    return true;
  };
  window.addEventListener('hashchange', () => openSharedLink(true));
  const playtest = () => {
    if (!editor) return;
    const errs = editorErrors();
    if (errs.length) { toast(errs[0], 2200); return; }
    persistDraft();
    startCustom(editor.def, { preview: true, fromEditor: true });
  };
  const exportJSON = (def) => {
    const blob = new Blob([window.WorkshopLevel.toJSON(def)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${String(def.name || 'naidan-level').replace(/[\\/:*?"<>|]/g, '_')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  const importText = (text) => {
    const def = window.WorkshopLevel.fromJSON(text);
    if (!def) { toast('这段内容不是关卡', 2000); return false; }
    closeWorkshop();
    openEditor(def);
    return true;
  };

  const undoEditor = () => {
    if (!editor || !editor.undo.length) return;
    editor.redo.push(JSON.stringify(editor.def));
    editor.def = JSON.parse(editor.undo.pop());
    editor.selected = null;
    rebuildEditorScene();
    syncEditorUI();
    persistDraft();
  };
  const redoEditor = () => {
    if (!editor || !editor.redo.length) return;
    editor.undo.push(JSON.stringify(editor.def));
    editor.def = JSON.parse(editor.redo.pop());
    editor.selected = null;
    rebuildEditorScene();
    syncEditorUI();
    persistDraft();
  };

  // 工坊入口
  el.btnWkNew.addEventListener('click', () => openEditor(starterLevel()));
  el.wkTabCommunity.addEventListener('click', () => setWorkshopTab('community'));
  el.wkTabMine.addEventListener('click', () => setWorkshopTab('mine'));
  el.wkSearch.addEventListener('input', () => {
    wkQuery = el.wkSearch.value;
    renderCommunity();
  });
  el.wkSort.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-sort]');
    if (!btn) return;
    wkSort = btn.dataset.sort;
    el.wkSort.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    renderCommunity();
  });
  el.btnWkRefresh.addEventListener('click', () => loadCommunity(true));
  el.btnWkClose.addEventListener('click', closeWorkshop);
  el.subCancel.addEventListener('click', () => {
    submitDef = null;
    el.submitDialog.classList.add('hide');
    el.subStatus.textContent = '';
  });
  el.subSend.addEventListener('click', async () => {
    if (!submitDef || el.subSend.disabled) return;
    el.subSend.disabled = true;
    el.subSend.textContent = '正在投稿…';
    el.subStatus.textContent = '';
    el.subStatus.classList.remove('bad');
    const name = el.subLevelNameInput.value.trim().slice(0, 24);
    if (!name) {
      el.subStatus.classList.add('bad');
      el.subStatus.textContent = '关卡名不能为空';
      el.subSend.disabled = false;
      el.subSend.textContent = '确认投稿';
      return;
    }
    const nameCheck = moderation(name);
    if (!nameCheck.ok) {
      el.subStatus.classList.add('bad');
      el.subStatus.textContent = `关卡名${nameCheck.reason}`;
      el.subSend.disabled = false;
      el.subSend.textContent = '确认投稿';
      return;
    }
    const author = el.subAuthor.value.trim().slice(0, 30);
    const authorCheck = moderation(author || '匿名玩家');
    if (!authorCheck.ok) {
      el.subStatus.classList.add('bad');
      el.subStatus.textContent = `用户名${authorCheck.reason}`;
      el.subSend.disabled = false;
      el.subSend.textContent = '确认投稿';
      return;
    }
    const updated = window.WorkshopLevel.normalize({ ...submitDef, name });
    const res = await window.WorkshopCommunity.submitLevel(updated, author);
    if (res.ok) {
      try { localStorage.setItem('naidan-workshop-author', author || '匿名玩家'); } catch (e) { /* 隐私模式 */ }
      const passed = window.WorkshopLevel.pack(updated);
      if (editor && editor.def.id === updated.id) {
        editor.def = updated;
        passedCode = passed;
        syncEditorUI();
      }
      const list = drafts();
      const i = list.findIndex((entry) => entry.id === updated.id);
      if (i >= 0) {
        list[i] = { ...list[i], name: updated.name, def: updated, updated: Date.now(), passed };
        saveDrafts(list);
        renderDrafts();
      }
      el.subStatus.textContent = '投稿成功，正在刷新社区列表…';
      await loadCommunity(true);
      toast('投稿成功，已经出现在社区里了', 2200);
      setTimeout(() => {
        el.submitDialog.classList.add('hide');
        submitDef = null;
      }, 350);
      return;
    }
    el.subStatus.classList.add('bad');
    el.subStatus.textContent = res.duplicate
      ? '这张关卡已经在社区里了'
      : res.setup
        ? '投稿表还没启用：请在 Supabase SQL Editor 执行 supabase/workshop.sql'
        : (res.error || '投稿失败，稍后再试');
    el.subSend.disabled = false;
    el.subSend.textContent = '确认投稿';
  });
  el.btnWkImport.addEventListener('click', () => el.wkFile.click());
  el.wkFile.addEventListener('change', () => {
    const f = el.wkFile.files && el.wkFile.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { importText(String(r.result || '')); el.wkFile.value = ''; };
    r.readAsText(f);
  });
  el.btnWkPaste.addEventListener('click', () => {
    if (!el.wkPaste.value.trim()) { toast('先把关卡内容粘进来', 1600); return; }
    importText(el.wkPaste.value);
  });
  // 编辑器工具条
  const setTool = (t) => { if (!editor) return; editor.tool = t; editor.selected = null; syncEditorUI(); };
  el.edToolBlock.addEventListener('click', () => setTool('block'));
  el.edToolPig.addEventListener('click', () => setTool('pig'));
  el.edToolMove.addEventListener('click', () => setTool('move'));
  el.edToolErase.addEventListener('click', () => setTool('erase'));
  const setMat = (m) => { if (editor) { editor.material = m; syncEditorUI(); } };
  el.edMatWood.addEventListener('click', () => setMat('wood'));
  el.edMatIce.addEventListener('click', () => setMat('ice'));
  el.edMatStone.addEventListener('click', () => setMat('stone'));
  const setSize = (s) => { if (editor) { editor.size = s; syncEditorUI(); } };
  el.edSizeS.addEventListener('click', () => setSize('s'));
  el.edSizeM.addEventListener('click', () => setSize('m'));
  el.edSizeL.addEventListener('click', () => setSize('l'));
  el.edSizeLong.addEventListener('click', () => setSize('long'));
  el.edRotate.addEventListener('click', (ev) => rotateSelectedBlock(ev.shiftKey ? 45 : 15));
  el.edRotateFloat.addEventListener('click', () => rotateSelectedBlock(15));
  el.edPigBonus.addEventListener('change', () => { if (editor) editor.bonus = el.edPigBonus.checked; });
  const setStages = (n) => {
    if (!editor) return;
    const next = clamp(n, 1, 3);
    if (next === editor.def.launchPoints.length) return;
    editorSnapshot();
    editor.def.stages = next;
    editor.def.launchPoints = [];        // 清掉旧发射点 → normalize 会按段数重算
    editorChanged();
  };
  el.edStageMinus.addEventListener('click', () => setStages(editor ? editor.def.launchPoints.length - 1 : 1));
  el.edStagePlus.addEventListener('click', () => setStages(editor ? editor.def.launchPoints.length + 1 : 1));
  // ---- 奶蛋阵容：每种最多 4 发，总数 2~8 ----
  const DEFAULT_ROSTER = { naidan: 1, dash: 1, bomb: 1 };
  const rosterOf = (def) => {
    const out = {};
    def.birds.forEach((k) => { out[k] = (out[k] || 0) + 1; });
    return out;
  };
  const rosterList = (counts) => window.WorkshopLevel.BIRDS.filter((k) => counts[k] > 0)
    .flatMap((k) => Array.from({ length: counts[k] }, () => k));
  let bpDraft = null;   // 阵容弹窗里正在编辑的计数
  const bpCount = () => Object.values(bpDraft || {}).reduce((a, b) => a + b, 0);
  const renderBirdPicker = () => {
    el.bpRows.innerHTML = '';
    window.WorkshopLevel.BIRDS.forEach((key) => {
      const t = window.BIRDS[key] || window.BIRDS.naidan;
      const row = document.createElement('div');
      row.className = 'bpRow';
      const img = document.createElement('img');
      img.src = assetUrl(t.sprite);
      img.alt = t.name;
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = t.name;
      const minus = document.createElement('button');
      minus.className = 'ghost';
      minus.textContent = '−';
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = String(bpDraft[key] || 0);
      const plus = document.createElement('button');
      plus.textContent = '＋';
      const bump = (d) => {
        const next = (bpDraft[key] || 0) + d;
        if (next < 0 || next > 4) return;
        if (d > 0 && bpCount() >= 8) { toast('最多 8 发', 1200); return; }
        bpDraft[key] = next;
        if (!bpDraft[key]) delete bpDraft[key];
        renderBirdPicker();
      };
      minus.addEventListener('click', () => bump(-1));
      plus.addEventListener('click', () => bump(1));
      row.append(img, nm, minus, n, plus);
      el.bpRows.appendChild(row);
    });
    const total = bpCount();
    el.bpTotal.textContent = total < 2 ? `共 ${total} 发（至少 2 发）` : `共 ${total} 发`;
    el.bpOk.disabled = total < 2;
    el.bpOk.style.opacity = total < 2 ? 0.45 : 1;
  };
  const openBirdPicker = () => {
    if (!editor) return;
    bpDraft = { ...rosterOf(editor.def) };
    renderBirdPicker();
    el.birdPicker.classList.remove('hide');
  };
  /** 直接设置阵容（验收/调试用） */
  const setRoster = (counts = {}) => {
    if (!editor) return false;
    const clean = {};
    window.WorkshopLevel.BIRDS.forEach((k) => {
      const n = clamp(Math.round(Number(counts[k]) || 0), 0, 4);
      if (n) clean[k] = n;
    });
    if (Object.values(clean).reduce((a, b) => a + b, 0) < 2) return false;
    editor.def.birds = rosterList(clean);
    editorChanged();
    return true;
  };
  el.edBirdsBtn.addEventListener('click', openBirdPicker);
  el.bpOk.addEventListener('click', () => {
    if (!editor || bpCount() < 2) return;
    editorSnapshot();
    editor.def.birds = rosterList(bpDraft);
    el.birdPicker.classList.add('hide');
    editorChanged();
  });
  el.bpCancel.addEventListener('click', () => { bpDraft = null; el.birdPicker.classList.add('hide'); });
  el.bpReset.addEventListener('click', () => { bpDraft = { ...DEFAULT_ROSTER }; renderBirdPicker(); });
  el.edUndo.addEventListener('click', undoEditor);
  el.edRedo.addEventListener('click', redoEditor);
  el.edPlay.addEventListener('click', playtest);
  el.edShare.addEventListener('click', () => {
    if (!editor) return;
    if (editorErrors().length) { toast(editorErrors()[0], 2200); return; }
    if (!gateOpen()) { toast('先点「试玩」通关一次，才能发布链接', 2200); return; }
    copyText(shareLink(editor.def), '发布链接已复制');
  });
  el.edSubmit.addEventListener('click', () => {
    if (!editor) return;
    if (!gateOpen()) { toast('先试玩通关一次，才能投稿到社区', 2200); return; }
    openWorkshopSubmit(editor.def);
  });
  el.edExport.addEventListener('click', () => { if (editor) { persistDraft(); exportJSON(editor.def); } });
  el.edWkBack.addEventListener('click', () => { persistDraft(); leaveEditor(); });
  el.btnBackEditor.addEventListener('click', () => {
    el.end.classList.add('hide');
    openEditor(customDef || window.LEVEL1, { passed: passedCode });
  });
  el.btnEndWorkshop.addEventListener('click', () => {
    el.end.classList.add('hide');
    openWorkshop();
  });
  // 关卡内通用返回：编辑器试玩 → 编辑器；社区/分享关卡 → 工坊；无尽 → 主菜单
  el.btnExitLevel.addEventListener('click', () => {
    AudioKit.flyStop();
    el.end.classList.add('hide');
    if (mode === 'custom') {
      if (cameFromEditor) openEditor(customDef || window.LEVEL1, { passed: passedCode });
      else openWorkshop();
    } else if (mode === 'endless') {
      pauseEndlessToMenu();
    } else {
      backToMenu();
    }
  });
  window.__nai = {
    ready: true,
    /** 创意工坊（验收/调试用）：和界面按钮走同一套函数 */
    workshop: {
      open: () => { openWorkshop(); return state; },
      create: () => { openEditor(starterLevel()); return !!editor; },
      edit: (def) => { openEditor(def); return !!editor; },
      community: () => ({
        state: wkCatalogState,
        remoteState: wkRemoteState,
        tab: wkTab,
        sort: wkSort,
        query: wkQuery,
        loadingStats: wkStatsLoading,
        weeklyKey: wkWeeklyKey,
        weeklyIds: wkWeeklyIds.slice(),
        weeklyResetAt: window.WorkshopCommunity.weeklyPeriod().nextResetMs,
        entries: wkEntries.map((e) => ({
          id: e.id, code: e.code, name: e.name, author: e.author, submittedAt: e.submittedAt,
          stats: communityStat(e), liked: window.WorkshopCommunity.isLiked(e.code),
          played: window.WorkshopCommunity.isPlayed(e.code),
        })),
      }),
      setCommunitySort: (s) => {
        wkSort = ['latest', 'plays', 'likes'].includes(s) ? s : 'latest';
        el.wkSort.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.sort === wkSort));
        renderCommunity();
        return wkSort;
      },
      searchCommunity: (q) => {
        wkQuery = String(q || '');
        el.wkSearch.value = wkQuery;
        renderCommunity();
        return wkQuery;
      },
      refreshCommunity: () => loadCommunity(true),
      info: () => (editor ? {
        tool: editor.tool, material: editor.material, size: editor.size, bonus: !!editor.bonus,
        name: editor.def.name,
        blocks: editor.def.blocks.length,
        blockAngles: editor.def.blocks.map((b) => Math.round((b.angle || 0) * 180 / Math.PI)),
        pigs: editor.def.pigs.length,
        stages: editor.def.launchPoints.length,
        birds: editor.def.birds.length,
        pigStages: editor.def.pigs.map((p) => p.stage),
        errors: editorErrors(),
        selected: editor.selected,
        undo: editor.undo.length,
        redo: editor.redo.length,
      } : null),
      setTool: (t) => { if (editor) { editor.tool = t; syncEditorUI(); } return editor && editor.tool; },
      setMaterial: (m) => { if (editor) { editor.material = m; syncEditorUI(); } return editor && editor.material; },
      setSize: (s) => { if (editor) { editor.size = s; syncEditorUI(); } return editor && editor.size; },
      setBonus: (b) => { if (editor) { editor.bonus = !!b; syncEditorUI(); } return editor && editor.bonus; },
      rotateBlock: (degrees = 15) => rotateSelectedBlock(Number(degrees) || 15),
      setName: (n) => {
        if (editor) {
          editor.def.name = String(n).slice(0, 24);
          persistDraft();
          refreshPublishState();
        }
        return editor && editor.def.name;
      },
      setStages: (n) => { setStages(n); return editor && editor.def.launchPoints.length; },
      /** 直接设置阵容，例如 { naidan: 2, bomb: 1 } */
      setRoster: (counts) => { const ok = setRoster(counts || {}); return ok ? editor.def.birds.slice() : false; },
      roster: () => (editor ? rosterOf(editor.def) : null),
      /** 试玩通关之后才有；返回发布链接（没通关返回空串） */
      publish: () => (gateOpen() ? shareLink(editor.def) : ''),
      gateOpen: () => gateOpen(),
      /** 在世界坐标"点一下"（放置/删除/选中），和真实点击走同一条逻辑 */
      tap: (x, y) => { edDownAt({ x, y }); edUp(); return editor && editor.def; },
      undo: () => { undoEditor(); return editor ? editor.undo.length : 0; },
      redo: () => { redoEditor(); return editor ? editor.redo.length : 0; },
      playtest: () => { playtest(); return state; },
      code: () => (editor ? window.WorkshopLevel.pack(editor.def) : ''),
      json: () => (editor ? window.WorkshopLevel.toJSON(editor.def) : ''),
      link: () => (editor ? shareLink(editor.def) : ''),
      loadText: (text) => importText(text),
      back: () => { if (editor) leaveEditor(); return state; },
      drafts: () => drafts().map((d) => ({ id: d.id, name: d.name })),
      clearDrafts: () => saveDrafts([]),
    },
    build: BUILD,
    state: () => ({
      state,
      mode,
      endlessLevel,
      matchSeed,
      carriedNuke,
      runStats: { ...runStats },
      computedScore: computedRunScore(),
      scoreSubmitted,
      nukeFlash: Math.round(nukeFlash * 100) / 100,
      nukeColorFlow: Math.round((timeMs * 0.055) % 360),
      endlessResume: endlessResume ? {
        state: endlessResume.state,
        level: endlessResume.level,
        birdsLeft: endlessResume.birdsLeft,
      } : null,
      levelName: level.name,
      score,
      totalScore,
      pigsAlive: pigs.length,
      birdsLeft,
      birdQueue: birdQueue.slice(),
      levelBirds: levelBirds.slice(),
      pickShown: !el.pick.classList.contains('hide'),
      currentBird,
      skillUsed,
      introT: intro ? Math.round(intro.t * 100) / 100 : null,
      camZoom: Math.round(CAM.zoom * 1000) / 1000,
      camY: Math.round(CAM.y),
      worldW: worldW(),
      stage: stageIndex + 1,
      stageCount: stageCount(),
      slingX: Math.round(sling.x),
      stagePigs: pigs.filter((p) => (p.game.stage || 0) === stageIndex).length,
      isBossLevel: !!level.boss,
      launchPoints: (level.launchPoints || [{ x: sling.x, y: sling.y }]).map((p) => Math.round(p.x)),
      bombs: bombs.length,
      explosions: explosions.length,
      charge: drag ? Math.round((drag.charge || 0) * 100) / 100 : 0,
      aimAssist: drag ? {
        fill: drag.charge > 0.35 ? AIM_ASSIST.fullFill : AIM_ASSIST.fill,
        stroke: drag.charge > 0.35 ? AIM_ASSIST.fullStroke : AIM_ASSIST.stroke,
      } : null,
      camShake: Math.round(CAM.shake * 100) / 100,
      /** boss 笑声素材的状态（测试用：确认它真的加载了、真的被播了） */
      bossLaugh: {
        ready: bossLaughEl ? bossLaughEl.readyState : -1,
        attempts: bossLaughAttempts,
        plays: bossLaughPlays,
        muted: AudioKit.muted,
      },
      pullPower: drag ? Math.round((drag.power || 0) * 100) / 100 : 0,
      /** 等候区奶蛋的待机姿态（测试用：能看出它们是不是真的在动、有没有翻整圈） */
      queueIdle: birdQueue.slice(0, 3).map((k, i) => {
        const pose = queueIdlePose(i, k);
        return { dy: Math.round(pose.dy * 10) / 10, deg: Math.round((pose.rot * 180) / Math.PI), air: pose.air };
      }),
      /** 等候区每一颗的位置（测试用：照着它点屏幕就能验"点谁谁上弓"） */
      queueSlots: birdQueue.slice(0, QUEUE_MAX_DRAW).map((k, i) => {
        const s = queueSlotPos(i);
        return { type: k, x: Math.round(s.x), y: Math.round(s.y) };
      }),
      queueHover,
      pickChoice,
      launchLog: launchLog.slice(),
      oddLog: oddLog.slice(),
      inFlight: inFlight.length,
      skillChipOn: el.skillChip.classList.contains('on'),
      introLabel: el.introLabel.classList.contains('on') ? el.introTag.textContent : null,
      blocksAlive: blocks.length,
      camX: CAM.x,
      timeMs,
      pigPositions: pigs.map((p) => ({ x: Math.round(p.position.x), y: Math.round(p.position.y) })),
      pigStages: pigs.map((p) => p.game.stage || 0),
      pigBonus: pigs.map((p) => !!p.game.bonus),
      bossIndex: pigs.findIndex((p) => p.game.boss),
      pigHp: pigs.map((p) => Math.round(p.game.hp)),
      blockPositions: blocks.map((b) => ({ x: Math.round(b.position.x), y: Math.round(b.position.y), hp: Math.round(b.game.hp) })),
      blockSpeeds: blocks.map((b) => Math.round(Vector.magnitude(b.velocity) * 100) / 100),
      bird: activeBird
        ? {
          x: Math.round(activeBird.position.x),
          y: Math.round(activeBird.position.y),
          v: Math.round(Vector.magnitude(activeBird.velocity)),
          vx: Math.round(activeBird.velocity.x * 100) / 100,
          av: Math.round(activeBird.angularVelocity * 1000) / 1000,
        }
        : null,
      /** 场上所有奶蛋刚体的位置（测试用：抓"被丢在拉弓位置上没人管"的奶蛋） */
      birdBodies: birds.map((b) => ({
        x: Math.round(b.position.x),
        y: Math.round(b.position.y),
        launched: !!b.game.launched,
        type: b.game.type,
      })),
      dragActive: !!drag,
      dragPull: drag ? Math.round(Vector.magnitude({ x: sling.x - drag.x, y: sling.y - drag.y })) : 0,
      /** 制导奶蛋的当前状态（测试用：验它是不是真的朝点击位置直线飞） */
      seek: activeBird && activeBird.game.seek
        ? {
          nx: Math.round(activeBird.game.seek.nx * 1000) / 1000,
          ny: Math.round(activeBird.game.seek.ny * 1000) / 1000,
          tx: Math.round(activeBird.game.seek.tx),
          ty: Math.round(activeBird.game.seek.ty),
          t: activeBird.game.seek.t,
        }
        : null,
      aimMarks: aimMarks.length,
      maxSpeed: Math.max(
        0,
        ...[...blocks, ...pigs, ...bombs].map((b) => Vector.magnitude(b.velocity)),
        ...inFlight.map((b) => Vector.magnitude(b.velocity))
      ),
    }),
    scoreboard: {
      open: (kind = 'all') => { openScoreBoard(kind); return kind; },
      close: () => { closeScoreBoard(); return state; },
      payload: (name = '验收玩家') => scorePayload(name),
      stats: () => ({
        ...runStats,
        score,
        totalScore,
        computedScore: computedRunScore(),
        finalScore: finalRunScore,
        finalStats: finalRunStats ? { ...finalRunStats } : null,
        endlessLevel,
        submitted: scoreSubmitted,
      }),
      submit: async (name = '验收玩家') => {
        el.slingshotName.value = name;
        await submitSlingshotScore();
        return {
          submitted: scoreSubmitted,
          message: el.slingshotSubmitMsg.textContent,
          formVisible: !el.slingshotSubmit.classList.contains('hide'),
        };
      },
    },
    start: (which = 'level1') => startRun(which, true),
    /** 开局选蛋：面板上那颗由脚本点下去（type 省略时相当于点"随便来一颗"） */
    pick: (type) => {
      if (state !== 'pick') return null;
      confirmPick(type || PICK_ORDER[Math.floor(Math.random() * PICK_ORDER.length)]);
      return currentBird;
    },
    pickOptions: () => PICK_ORDER.slice(),
    setAutoPick: (on = true) => { autoPickSession = !!on; return autoPickSession; },
    clearLogs: () => { launchLog.length = 0; oddLog.length = 0; },
    startIntro,
    skipIntro,
    activateSkill,
    birdTypes: () => Object.values(BIRDS).map((b) => ({ key: b.key, name: b.name, skill: b.skill, r: b.r })),
    birdNameList,
    setZoom: (z) => { setZoom(z); return CAM.zoom; },
    zoomRange: () => ({ min: MIN_ZOOM, max: MAX_ZOOM }),
    /** 直接清掉当前这一段的奶蛙，用来测"分段推进" */
    clearStage: () => {
      pigs.filter((p) => (p.game.stage || 0) === stageIndex).forEach((p) => destroy(p));
      return stageIndex + 1;
    },
    /** 清掉指定的那一段（默认当前段）——用来复现"先把后面的波次打光" */
    clearStageAt: (s) => {
      const at = s === undefined ? stageIndex : s;
      pigs.filter((p) => (p.game.stage || 0) === at).forEach((p) => destroy(p));
      return at + 1;
    },
    /** boss 关测试用：把当前 boss 的塔腿全打断，看它一层层摔下来 */
    breakTower: () => {
      const legs = blocks.filter((b) => b.game.w === 40);
      legs.slice(0, Math.ceil(legs.length / 2)).forEach((b) => destroy(b));
      return legs.length;
    },
    bossInfo: () => {
      const boss = pigs.find((p) => p.game.boss);
      const legs = blocks.filter((b) => b.game.w === 40);
      // 注意字段结构要一致：有 boss 时 boss=true，没有时 false（测试里靠它判断）
      return {
        boss: !!boss,
        alive: !!boss,
        name: level.boss ? level.boss.name : '',
        tier: level.boss ? level.boss.tier : 0,
        hp: boss ? Math.round(boss.game.hp) : 0,
        maxHp: boss ? boss.game.maxHp : 0,
        x: boss ? Math.round(boss.position.x) : 0,
        y: boss ? Math.round(boss.position.y) : 0,
        vy: boss ? Math.round(boss.velocity.y * 100) / 100 : 0,
        legs: legs.length,
        retryUsed: bossRetryUsed,
        barShown: !el.bossBar.classList.contains('hide'),
        barWidth: el.bossBarFill.style.width,
        lastImpact: boss ? boss.game.lastImpact : null,
        shots: boss ? boss.game.shots || 0 : 0,
        summons: boss ? boss.game.summons || 0 : 0,
        directK: boss ? boss.game.directK : 0,
        blastK: boss ? boss.game.blastK : 0,
        fallK: boss ? boss.game.fallK : 0,
      };
    },
    /** 测试用：把剩下的奶蛋一口气用光（走正常的判负流程） */
    /** 测试用：从指定高度扔一块方块下去，返回它在 blocks 里的下标（用来量摔落伤害） */
    dropTest: (material = 'wood', w = 90, h = 60, height = 320, x = 420) => {
      const mat = MATS[material];
      const body = Bodies.rectangle(x, GROUND_Y - height, w, h, {
        density: mat.density,
        friction: mat.friction,
        frictionStatic: mat.frictionStatic ?? 1,
        restitution: mat.restitution,
        label: 'block',
      });
      const scale = 0.42 + 0.58 * ((w * h) / 6000);
      const hp = mat.hp * scale;
      tag(body, { kind: 'block', material, hp, maxHp: hp, w, h, stage: 0, test: true });
      blocks.push(body);
      Composite.add(world, body);
      return { index: blocks.length - 1, hp: Math.round(hp), y: Math.round(body.position.y) };
    },
    hurtBoss: (n = 999) => {
      const b = pigs.find((p) => p.game.boss);
      if (!b) return 0;
      hitBody(b, n, 600, null);
      return Math.round(b.game.hp);
    },
    /** boss 关测试用：在 boss 身上原地炸一颗爆奶蛋，量"爆炸对它实际生效多少" */
    boomAtBoss: () => {
      const b = pigs.find((p) => p.game.boss);
      if (!b) return null;
      const before = b.game.hp;
      explode(b.position.x, b.position.y, BOOM);
      return { before: Math.round(before), after: Math.round(b.game.hp), dmg: Math.round(before - b.game.hp) };
    },
    drainBirds: () => {
      birdsLeft = 0;
      updateAmmo();
      if (state === 'fly' || state === 'aim') endShot();
      return birdsLeft;
    },
    /** 测试用：结算面板上点一下"再来一次" */
    clickAgain: () => {
      el.btnAgain.click();
      return state;
    },
    endless: (n, seed) => window.Endless.generate(n, seed),
    /** 技能试验场：一块木头小墙 + 一只奶蛙，专门用来验证各种技能效果 */
    sandbox: (type) => {
      clearEndlessResume();
      mode = 'level1';
      el.title.classList.add('hide');
      el.end.classList.add('hide');
      buildLevel({
        id: 'sandbox',
        name: '技能试验场',
        groundY: GROUND_Y,
        worldW: 2720,
        launchPoints: [{ x: 186, y: 470 }],
        birds: [type, type, type], // 多发几颗，免得试完技能就直接判负
        blocks: [
          // 横排三块，专门用来看"一发能不能连着拆穿"（穿透效果）
          { x: 940, y: 540, w: 90, h: 60, material: 'wood' },
          { x: 1040, y: 540, w: 90, h: 60, material: 'wood' },
          { x: 1140, y: 540, w: 90, h: 60, material: 'ice' },
        ],
        pigs: [{ x: 1250, y: 600, r: 36 }],
      });
      state = 'aim';
      return type;
    },
    /** 直接跳进无尽模式的第 n 关（指定种子，方便复现和自动化测试） */
    loadEndless: (n, seed) => {
      clearEndlessResume();
      carriedNuke = 0;
      resetRunStats();
      mode = 'endless';
      endlessLevel = n;
      matchSeed = seed;
      score = 0;
      totalScore = 0;
      bossRetryUsed = false;
      retryPending = false;
      updateScore();
      el.title.classList.add('hide');
      el.end.classList.add('hide');
      autoPickSession = true; // 自动化流程不弹面板，免得每个用例都要点一次
      promptPick(window.Endless.generate(n, seed), { auto: true, silent: true });
      return { pigs: pigs.length, blocks: blocks.length, birds: levelBirds.length };
    },
    loadEndlessNuke: (n, seed, at = 1, count = 1) => {
      clearEndlessResume();
      carriedNuke = 0;
      resetRunStats();
      mode = 'endless';
      endlessLevel = n;
      matchSeed = seed;
      score = 0;
      totalScore = 0;
      bossRetryUsed = false;
      retryPending = false;
      updateScore();
      el.title.classList.add('hide');
      el.end.classList.add('hide');
      autoPickSession = true;
      const def = window.Endless.generate(n, seed);
      def.birds = def.birds.filter((k) => k !== 'nuke');
      const start = clamp(Math.round(at), 0, def.birds.length);
      const nukes = clamp(Math.round(count), 1, 6);
      for (let i = 0; i < nukes; i++) def.birds.splice(start + i, 0, 'nuke');
      promptPick(def, { auto: true, silent: true });
      return { pigs: pigs.length, blocks: blocks.length, birds: levelBirds.length };
    },
    equipQueueType: (type) => {
      const i = birdQueue.indexOf(type);
      return i >= 0 ? promoteQueue(i) : false;
    },
    restart: () => restart(true),
    shoot: (angleDeg, power = 1) => {
      if (state !== 'aim' || !activeBird) return false;
      const rad = (angleDeg * Math.PI) / 180;
      const pull = MAX_PULL * clamp(power, 0, 1);
      drag = { pointerId: -1, x: slingAnchor().x - Math.cos(rad) * pull, y: slingAnchor().y + Math.sin(rad) * pull };
      const pullVec = { x: slingAnchor().x - drag.x, y: slingAnchor().y - drag.y };
      drag = null;
      launch(pullVec.x * LAUNCH_K, pullVec.y * LAUNCH_K);
      return true;
    },
    settleNow: () => { calmFrames = 999; },
    forceEnd: () => { if (state === 'fly') endShot(); },
    loadImages,
    imagesReady: () => Object.keys(IMG).length === Object.keys(ASSET_FILES).length,
    imageStatus: () => Object.fromEntries(Object.entries(IMG).map(([k, im]) => [k, im.naturalWidth || 0])),
    skipToEnd: () => { pigs.forEach((p) => destroy(p)); },
    forceWin: () => { pigs.forEach((p) => destroy(p)); },
  };

  /** 标题页的角色一览：奶蛋们都摆出来，让玩家先认识一下 */
  const buildRoster = () => {
    el.roster.innerHTML = '';
    Object.values(BIRDS).filter((t) => t.key !== 'nuke').forEach((t) => {
      const card = document.createElement('div');
      card.className = 'card';
      const img = document.createElement('img');
      img.alt = t.name;
      const bare = {
        naidan: '基础款，撞就完了',
        dash: '点一下冲刺，专拆木板',
        split: '点一下分身，三只一起糊上去',
        bomb: '点一下爆炸，石头也能掀',
        heavy: '又大又沉，一路碾压',
        milk: '点一下丢奶泡，从天上砸',
        seek: '点一下屏幕，直着冲过去',
      }[t.key];
      img.src = assetUrl(t.sprite);
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = t.name;
      const tg = document.createElement('div');
      tg.className = 'tg';
      tg.textContent = bare || t.tagline;
      card.append(img, nm, tg);
      el.roster.appendChild(card);
    });
  };
  // 启动：素材读进来再放玩家进来，但**不能傻等**——国内直连 github.io 时这 13 张立绘
  // 实测要 35 秒才下完，那样玩家对着空画面干等。所以最多等 BOOT_WAIT 就先开局，
  // 没到的立绘继续在后台下载、画到就出现（drawBird/drawPig 本来就判了 img.width）。
  const BOOT_WAIT = 2500;
  const bootReady = Promise.race([loadImages(), new Promise((r) => setTimeout(r, BOOT_WAIT))]);
  bootReady.then(() => {
    buildRoster();
    loadAudio();   // boss 笑声预先读进来（35KB，不差这点）
    if (el.buildStamp) el.buildStamp.textContent = `版本 ${BUILD}`;
    state = 'title';
    el.hint.classList.add('hide');
    render();
    requestAnimationFrame(frame);
    // 带分享码打开（#level=…）：直接进这份自制关卡（先在选蛋面板挑一颗）
    openSharedLink();
  });
})();
