/**
 * 奶龙快跑：地铁酷跑式的三车道无尽跑酷（伪 3D 透视）。
 * 跟弹弓玩法完全分开：自己的画布、自己的循环、自己的 DOM，只借用 assets/ 里的立绘和 AudioKit 音效。
 * 入口是标题页的「奶龙快跑」按钮（或 #run 链接）；打开时盖在整个页面上，关掉就回到标题页。
 *
 * 玩法：
 *   换道（← → / A D / 左右滑）   跳（↑ / W / 空格 / 上滑 / 点一下）   翻滚（↓ / S / 下滑；空中按 = 急降）   技能（E / 技能键）
 *   暗黑奶皇一直在身后追，而且越追越快：减速、侧蹭、被弹开都会被它追近；捡「能量奶」才能把它甩开。
 *   开局挑一颗奶蛋，每颗都有自己的跑酷技能；路上捡奶蛋碎片充能。
 *   每种障碍第一次出现时只出现它自己、还会弹一句提示（跑酷的标准教学法）。
 *   赛道用 mulberry32 种子生成：「每日赛道」同一天所有人跑的是同一条路，可以比分。
 *
 * 坐标：x 向右（三条道在 -LANE_W / 0 / +LANE_W），y 向上，z 向前；世界里的东西存绝对 z（wz），
 * 奶蛋永远在 z = dist，镜头在它身后 camZ、高 camY 处往前看。
 */
(() => {
  const H = 540;
  const VIEW_MIN = 960;
  const VIEW_MAX = 1600;
  const FAR = 110;
  const LANE_W = 2;
  const STEP = 1000 / 60;
  const GRAVITY = 0.022;
  const JUMP_V = 0.27;
  const PLAYER_H = 1.5;
  const ROLL_H = 0.7;
  const ROLL_FRAMES = 38;
  const TRAIN_H = 2.4;
  const SKILL_FULL = 100;
  const SHARD_VALUE = 25;
  const BEST_KEY = 'naidan-run-best-v2';
  const EGG_KEY = 'naidan-run-egg-v1';
  const MODE_KEY = 'naidan-run-mode-v1';

  /** 八颗奶蛋 = 八个跑酷技能（路上捡奶蛋碎片充能，满了按 E / 技能键放） */
  const EGGS = [
    { key: 'naidan', sprite: 'naidan_idle', name: '奶蛋', skill: '双倍积分', tip: '8 秒内奶滴、踩扁的分数翻倍', color: '#f2b84b' },
    { key: 'dash', sprite: 'naidan_dash', name: '冲刺奶蛋', skill: '猛冲', tip: '2.5 秒无敌猛冲，撞穿一切，顺便甩开追兵', color: '#ff8a5b' },
    { key: 'split', sprite: 'naidan_split', name: '分身奶蛋', skill: '分身', tip: '分身护盾 + 7 秒内三条道的奶滴一起收', color: '#9b7be0' },
    { key: 'bomb', sprite: 'naidan_bomb', name: '爆奶蛋', skill: '爆破', tip: '炸掉前方一大片障碍和导弹', color: '#e2632f' },
    { key: 'heavy', sprite: 'naidan_heavy', name: '胖奶蛋', skill: '大奶蛙', tip: '变身大奶蛙 5 秒，一路撞碎障碍', color: '#d9902f' },
    { key: 'milk', sprite: 'naidan_milk', name: '奶泡蛋', skill: '奶泡浮台', tip: '踩着奶泡飘 3.5 秒，地上的东西都碰不到', color: '#5fb8e8' },
    { key: 'back', sprite: 'naidan_back', name: '回旋奶蛋', skill: '回旋镖', tip: '回头砸暗黑奶皇：把它甩远，还让它晕 4 秒', color: '#4fb38a' },
    { key: 'seek', sprite: 'naidan_seek', name: '制导奶蛋', skill: '自动导航', tip: '5 秒自动躲障碍', color: '#e86aa6' },
  ];
  const EGG = Object.fromEntries(EGGS.map((e) => [e.key, e]));

  /** 路上的道具泡泡 */
  const POWERS = {
    dash: { icon: 'naidan_dash', name: '喷气冲刺', tip: '冲刺！飞上天收奶滴', frames: 300, color: '#ff8a5b' },
    heavy: { icon: 'naiwa_happy', name: '大奶蛙', tip: '变身大奶蛙！一路撞碎障碍', frames: 420, color: '#d9902f' },
    milk: { icon: 'naidan_milk', name: '磁铁', tip: '奶泡磁铁！奶滴、能量奶、碎片都吸过来', frames: 540, color: '#5fb8e8' },
    split: { icon: 'naidan_split', name: '分身护盾', tip: '分身护盾！免死一次', frames: 0, color: '#9b7be0' },
    spring: { emoji: '👟', name: '弹簧鞋', tip: '弹簧鞋！跳得老高，能直接跳上车顶', frames: 600, color: '#4fb38a' },
    x2: { emoji: '×2', name: '双倍积分', tip: '双倍积分！', frames: 600, color: '#f2b84b' },
  };
  /** 会倒计时的状态（道具 + 技能），HUD 上画进度条 */
  const TIMED = {
    dash: { name: '喷气冲刺', frames: 300, color: '#ff8a5b' },
    rush: { name: '猛冲', frames: 150, color: '#ff8a5b' },
    heavy: { name: '大奶蛙', frames: 420, color: '#d9902f' },
    milk: { name: '磁铁', frames: 540, color: '#5fb8e8' },
    spring: { name: '弹簧鞋', frames: 600, color: '#4fb38a' },
    x2: { name: '双倍积分', frames: 600, color: '#f2b84b' },
    tri: { name: '分身收集', frames: 420, color: '#9b7be0' },
    float: { name: '奶泡浮台', frames: 210, color: '#5fb8e8' },
    auto: { name: '自动导航', frames: 300, color: '#e86aa6' },
    stun: { name: '奶皇晕了', frames: 240, color: '#4fb38a' },
    boost: { name: '能量奶加速', frames: 90, color: '#7bc96f' },
  };

  /**
   * 新障碍的「教学关」：到了这个距离，先单独摆一段只有它的赛道、再弹一句提示，之后才混进随机赛道。
   * type 同时是随机赛道的解锁开关（g.known）。
   */
  const INTRO = [
    { at: 40, type: 'low', tip: '矮栏：跳过去（↑ / 上滑）', make: (z) => { [-1, 0, 1].forEach((l) => obstacle('low', l, z)); return 16; } },
    { at: 90, type: 'high', tip: '高栏：翻滚钻过去（↓ / 下滑）', make: (z) => { [-1, 0, 1].forEach((l) => obstacle('high', l, z)); return 16; } },
    { at: 140, type: 'train', tip: '车厢：换道躲开（← → / 左右滑）', make: (z) => { obstacle('train', 0, z, { len: 14 }); coinLine(-1, z, 6); coinLine(1, z, 6); return 14 + gapAfterTrain(); } },
    { at: 210, type: 'boost', tip: '能量奶：捡到就加速，甩开暗黑奶皇！', make: (z) => { [-1, 0, 1].forEach((l) => g.pickups.push({ kind: 'boost', lane: l, wz: z + 4, y: 0.8 })); return 18; } },
    { at: 260, type: 'puddle', tip: '奶油泥坑：跳过去，踩进去会减速', make: (z) => { [-1, 0, 1].forEach((l) => obstacle('puddle', l, z)); return 4 + gapShort(); } },
    { at: 320, type: 'shard', tip: '奶蛋碎片：集满了按 E / 技能键放技能', make: (z) => { [-1, 0, 1].forEach((l) => g.pickups.push({ kind: 'shard', lane: l, wz: z + 4, y: 0.8 })); return 18; } },
    { at: 380, type: 'ramp', tip: '斜坡：顺着跑上车顶', make: (z) => { obstacle('ramp', 0, z); obstacle('train', 0, z + 6, { len: 16 }); obstacle('train', -1, z + 2, { len: 20 }); obstacle('train', 1, z + 2, { len: 20 }); coinLine(0, z + 7, 6, TRAIN_H + 0.6); return 22 + gapAfterTrain(); } },
    { at: 450, type: 'cone', tip: '路障锥：撞翻了会减速，躲开它', make: (z) => { obstacle('cone', -1, z); obstacle('cone', 0, z); obstacle('cone', 1, z + 6); obstacle('cone', 0, z + 6); return 10 + gapShort(); } },
    { at: 520, type: 'frog', tip: '奶蛙：从上面踩扁 +100，正面撞上会倒', make: (z) => { [-1, 0, 1].forEach((l) => obstacle('frog', l, z)); return 4 + gapShort(); } },
    { at: 600, type: 'candy', tip: '奶糖池：粘脚超慢，跳过去', make: (z) => { [-1, 0, 1].forEach((l) => obstacle('candy', l, z)); return 4 + gapShort(); } },
    { at: 680, type: 'missile', tip: '奶蛙导弹！看红色警告：低的跳、高的滚，或者换道', make: (z) => { g.nextMissile = z - 30; return 20; } },
    { at: 780, type: 'plank', tip: '塌陷木地板：踩上去一下就塌，跳过去', make: (z) => { [-1, 0, 1].forEach((l) => obstacle('plank', l, z)); return 8 + gapShort(); } },
    { at: 880, type: 'sentinel', tip: '奶蛙哨兵：撞上会被弹开、减速，绕开它', make: (z) => { obstacle('sentinel', -1, z); obstacle('sentinel', 1, z); coinLine(0, z - 3, 4); return 4 + gapShort(); } },
    { at: 960, type: 'crates', tip: '木箱塔：撞得碎但会减速，大奶蛙能直接撞穿', make: (z) => { obstacle('crates', 0, z); obstacle('crates', 1, z); coinLine(-1, z - 3, 4); return 4 + gapShort(); } },
    { at: 1050, type: 'ice', tip: '冰面：换道会打滑、慢半拍，提前操作', make: (z) => { [-1, 0, 1].forEach((l) => obstacle('ice', l, z)); obstacle('train', 0, z + 12, { len: 12 }); obstacle('train', 1, z + 12, { len: 12 }); return 26 + gapAfterTrain(); } },
    { at: 1150, type: 'paw', tip: '', make: (z) => { g.nextPaw = z - 20; return 10; } },
    { at: 1250, type: 'windmill', tip: '风车：叶片转到下面会撞人，看准空档再过', make: (z) => { [-1, 0, 1].forEach((l, i) => obstacle('windmill', l, z, { phase: i * 2.1 })); return 4 + gapShort(); } },
    { at: 1380, type: 'river', tip: '牛奶河：跳过去！掉进去就狂按跳往前划', make: (z) => { obstacle('river', 0, z); coinArc(0, z + 3, 2.4); return 7 + gapShort(); } },
    { at: 1500, type: 'fan', tip: '鼓风机：会把你吹到旁边那条道上', make: (z) => { obstacle('fan', 0, z, { dir: 1 }); coinLine(1, z + 4, 5); return 16 + gapShort(); } },
    { at: 1620, type: 'portal', tip: '奶洞：钻进去会传送到另一条道', make: (z) => makePortal(z, 0, 1) },
    { at: 1750, type: 'moving', tip: '红色车厢会迎面开过来，早点换道', make: (z) => { obstacle('train', 0, z + 30, { len: 12, vz: -0.12, moving: true }); coinLine(1, z, 8); return 42 + gapAfterTrain(); } },
  ];

  // ---------------------------------------------------------------- 素材 / 工具
  const ASSET_BASE = window.ASSET_BASE || 'assets/';
  const SPRITES = [
    'naidan_idle', 'naidan_blink', 'naidan_dash', 'naidan_split', 'naidan_bomb', 'naidan_heavy', 'naidan_milk', 'naidan_back', 'naidan_seek',
    'naiwa_angry', 'naiwa_happy', 'naiwa_roll', 'boss_idle', 'boss_laugh',
  ];
  const assetUrl = (k) => (window.INLINE_ASSETS && window.INLINE_ASSETS[k]) || ASSET_BASE + k + '.png';
  const IMG = {};
  const loadSprites = () =>
    SPRITES.forEach((k) => {
      if (IMG[k]) return;
      const im = new Image();
      im.src = assetUrl(k);
      IMG[k] = im;
    });
  const sfx = (name, ...args) => {
    try {
      if (window.AudioKit && typeof window.AudioKit[name] === 'function') window.AudioKit[name](...args);
    } catch (e) { /* 音效出错不影响游戏 */ }
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const store = {
    get: (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* 隐私模式存不了就算了 */ } },
  };
  const loadBest = () => Number(store.get(BEST_KEY, 0)) || 0;

  /** 可复现的随机数：赛道生成只用它，「每日赛道」同一天所有人一样 */
  const mulberry32 = (a) => () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** 北京时间的今天，例如 20261018 */
  const todayKey = () => {
    const bj = new Date(Date.now() + 8 * 3600e3);
    return bj.getUTCFullYear() * 10000 + (bj.getUTCMonth() + 1) * 100 + bj.getUTCDate();
  };
  const R = () => g.rng();
  const rr = (a, b) => a + R() * (b - a);
  const ri = (a, b) => Math.floor(rr(a, b + 1));
  const pk = (arr) => arr[Math.floor(R() * arr.length)];
  const shuffled = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  // ---------------------------------------------------------------- DOM
  const css = `
  #runScreen { position: fixed; inset: 0; z-index: 60; background: #3a2a1f; display: flex; align-items: center; justify-content: center; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; }
  #runScreen canvas { box-shadow: none; border-radius: 0; touch-action: none; }
  #runHud { position: absolute; top: 12px; right: 12px; display: flex; gap: 8px; }
  #runScreen .iconBtn { width: auto; padding: 0 12px; }
  #runSkill { position: absolute; right: 18px; bottom: 26px; width: 86px; height: 86px; border-radius: 50%; padding: 0; border: 0;
    background: conic-gradient(var(--c, #ff8a5b) calc(var(--p, 0) * 1%), rgba(255,246,228,.55) 0); box-shadow: 0 5px 0 rgba(74,53,39,.3);
    display: flex; align-items: center; justify-content: center; }
  #runSkill img { width: 62px; height: 62px; object-fit: contain; border-radius: 50%; background: #fff6e4; padding: 4px; box-sizing: border-box; }
  #runSkill span { position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%); white-space: nowrap; font-size: 12px; font-weight: 800; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.6); }
  #runSkill.ready { animation: runPulse .7s infinite alternate; }
  @keyframes runPulse { to { transform: scale(1.1); } }
  #runPanelWrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(58,42,31,.28); }
  #runPanel { max-height: 94vh; overflow-y: auto; padding: 20px 22px; }
  #runPanel h2 { margin-bottom: 4px; }
  #runPanel .keys { display: grid; grid-template-columns: auto auto; gap: 4px 14px; justify-content: center; text-align: left; font-size: 13px; color: #6b5444; margin: 8px 0; }
  #runPanel .keys b { color: var(--jam-dark); }
  #runPanel details { font-size: 13px; color: #6b5444; margin: 6px 0; }
  #runPanel summary { cursor: pointer; font-weight: 700; }
  #runPanel .eggs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0 4px; }
  #runPanel .egg { background: #fff; border: 2px solid rgba(74,53,39,.08); border-radius: 12px; padding: 4px 2px 6px; box-shadow: none; color: var(--ink); font-size: 11px; line-height: 1.25; letter-spacing: 0; }
  #runPanel .egg img { width: 40px; height: 44px; object-fit: contain; display: block; margin: 0 auto 2px; }
  #runPanel .egg b { display: block; font-size: 12px; }
  #runPanel .egg.on { border-color: var(--jam); background: #fff1e6; }
  #runPanel .eggTip { font-size: 13px; min-height: 1.5em; margin: 4px 0; }
  #runPanel .stats { display: flex; gap: 16px; justify-content: center; font-size: 13px; color: #6b5444; flex-wrap: wrap; }
  #runPanel .stats b { display: block; font-size: 20px; color: var(--ink); }
  #runPanel .rec { color: #e2632f; font-weight: 800; }
  #runPanel .submit { display: flex; gap: 8px; justify-content: center; margin-top: 12px; }
  #runPanel .submit input { width: 150px; padding: 8px 12px; border-radius: 12px; border: 2px solid rgba(74,53,39,.2); font-size: 15px; font-family: inherit; color: var(--ink); background: #fff; }
  #runPanel .submit button { padding: 8px 14px; font-size: 14px; }
  #runPanel .msg { min-height: 1.4em; font-size: 13px; margin: 6px 0 0; }
  #runPanel .tabs { display: flex; gap: 8px; justify-content: center; margin: 4px 0 8px; flex-wrap: wrap; }
  #runPanel .tabs button { padding: 6px 14px; font-size: 13px; }
  #runPanel .board { list-style: none; margin: 0; padding: 0; max-height: min(46vh, 420px); overflow-y: auto; min-width: min(78vw, 360px); text-align: left; }
  #runPanel .board li { display: grid; grid-template-columns: 2.2em 1fr auto 4.8em; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 10px; font-size: 14px; color: #6b5444; }
  #runPanel .board li:nth-child(odd) { background: rgba(74,53,39,.05); }
  #runPanel .board li.me { background: rgba(255,138,91,.18); }
  #runPanel .board .rk { font-weight: 800; color: var(--jam-dark); text-align: center; }
  #runPanel .board .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
  #runPanel .board .sc { font-weight: 800; color: var(--ink); }
  #runPanel .board .mt { font-size: 12px; text-align: right; }
  `;

  let el = null;
  const buildDom = () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.id = 'runScreen';
    root.className = 'hide';
    root.innerHTML = `
      <canvas id="runCanvas"></canvas>
      <div id="runHud">
        <button class="iconBtn small" id="runBack" title="回主菜单">← 主菜单</button>
        <button class="iconBtn small" id="runPause" title="暂停（P）">⏸</button>
        <button class="iconBtn small" id="runSound" title="音效开关">🔊</button>
      </div>
      <button id="runSkill" class="hide" title="放技能（E）"><img alt="" /><span></span></button>
      <div id="runPanelWrap"><div class="panel" id="runPanel"></div></div>`;
    document.body.appendChild(root);
    const $ = (id) => document.getElementById(id);
    el = {
      root, canvas: $('runCanvas'), back: $('runBack'), pause: $('runPause'), sound: $('runSound'),
      skill: $('runSkill'), wrap: $('runPanelWrap'), panel: $('runPanel'),
    };
    ctx = el.canvas.getContext('2d');
  };

  // ---------------------------------------------------------------- 状态
  let ctx = null;
  let viewW = VIEW_MIN;
  let viewH = H;
  let horizon = 150;
  let focal = 520;
  let camY = 3.2;
  let camZ = -5.5;
  let nearZ = camZ + 0.9;
  let scale = 1;
  let dpr = 1;
  let active = false;
  let phase = 'ready'; // ready | run | pause | dead | board
  let raf = 0;
  let last = 0;
  let acc = 0;
  let g = null;
  let panelPrimary = null;
  let eggKey = EGG[store.get(EGG_KEY, 'naidan')] ? store.get(EGG_KEY, 'naidan') : 'naidan';
  let mode = store.get(MODE_KEY, 'free') === 'daily' ? 'daily' : 'free';

  const newGame = () => {
    const daily = mode === 'daily';
    const seed = daily ? todayKey() : (Math.random() * 2 ** 31) | 0;
    return {
      rng: mulberry32(seed),
      track: daily ? `daily-${todayKey()}` : 'free',
      egg: eggKey,
      t: 0,
      dist: 0,
      speed: 0.3,
      points: 0,      // 奶滴 / 踩扁 / 撞碎 的分（双倍积分算在这里）
      coinCount: 0,
      stomps: 0,
      smashes: 0,
      boosts: 0,
      meter: 0,       // 技能充能 0~100
      p: {
        lane: 0, x: 0, prevX: 0, fromLane: 0, y: 0, vy: 0, onGround: true, roll: 0, invuln: 0, land: 0, morph: 0,
        jumpStyle: 'flip', airT: 0, airTotal: 1, pending: null, wade: false, fall: 0,
      },
      power: { dash: 0, rush: 0, heavy: 0, milk: 0, spring: 0, x2: 0, tri: 0, float: 0, auto: 0, stun: 0, boost: 0, shield: false },
      chaseDist: 20,  // 暗黑奶皇离你多少米（真实距离：谁跑得快谁占便宜），0 = 被抓
      chaseRate: 0,   // 距离变化速度（米/秒，正 = 在拉开），HUD 上显示
      gap: 0.5,       // chaseDist / CHASE_MAX，画追兵用
      deltas: [],     // 追逐条旁边飘的 +3 米 / -8 米
      chaseX: 0,      // 奶皇跟着你换道（慢半拍）
      chaseSide: -1.1,
      slow: 0,        // 减速剩余帧数
      known: new Set(),
      introIdx: 0,
      obstacles: [],  // { type, lane, wz, len, h, vz, ... }
      coins: [],
      pickups: [],    // 能量奶 / 奶蛋碎片
      items: [],      // 道具泡泡
      warnings: [],   // 导弹预警
      paw: null,      // 奶皇拍掌
      fx: [],
      debris: [],
      genZ: 30,
      nextItem: 420,
      nextBoost: 230,
      nextShard: 340,
      nextMissile: Infinity,
      nextPaw: Infinity,
      shake: 0,
      flash: 0,
      toast: null,
      deathT: 0,
      deathReason: '',
      milestone: 0,
      introSlow: 0,
    };
  };

  const meters = () => Math.floor(g.dist);
  const score = () => meters() + g.points;
  const mult = () => (g.power.x2 > 0 ? 2 : 1);
  const toast = (text, color = '#e2632f', t = 110) => { if (text) g.toast = { text, color, t }; };
  const laneX = (lane) => lane * LANE_W;
  const difficulty = () => clamp(g.dist / 3000, 0, 1);
  /** 奶皇越跑越快：开头还能慢慢甩开它，两千多米之后不捡能量奶就会被追上 */
  const CHASE_MAX = 40;
  /** 奶皇的速度 = 你的正常速度 × 这个系数：开头比你慢一点，2000 米后比你快，不捡能量奶就会被追上 */
  const chaserFactor = () => 0.965 + 0.085 * clamp(g.dist / 2400, 0, 1);
  /** 追逐距离变化 + 在追逐条旁边飘个字 */
  const chaseDelta = (m) => {
    g.chaseDist = Math.min(CHASE_MAX, g.chaseDist + m);
    g.deltas.push({ text: `${m > 0 ? '+' : ''}${Math.round(m)} 米`, good: m > 0, t: 60 });
  };

  // ---------------------------------------------------------------- 关卡生成（一排一排往前摆）
  const coinLine = (lane, wz, n, y = 0.6, gap = 2.4) => {
    for (let i = 0; i < n; i++) g.coins.push({ lane, wz: wz + i * gap, y });
  };
  const coinArc = (lane, wz, top = 2.1) => {
    for (let i = 0; i < 5; i++) g.coins.push({ lane, wz: wz - 3 + i * 1.5, y: 0.6 + Math.sin((i / 4) * Math.PI) * (top - 0.6) });
  };
  const OB = {
    low: { len: 0.5, h: 1.0 },
    high: { len: 0.5, h: 2.3, bottom: 1.05 },
    frog: { len: 0.7, h: 0.95 },
    puddle: { len: 3.4, h: 0.05 },
    candy: { len: 3.2, h: 0.05 },
    cone: { len: 0.5, h: 0.8 },
    train: { len: 14, h: TRAIN_H },
    ramp: { len: 6, h: TRAIN_H },
    river: { len: 6, h: 0.05, wide: true },
    ice: { len: 16, h: 0.02 },
    plank: { len: 7, h: 0.05 },
    sentinel: { len: 0.8, h: 1.75 },
    crates: { len: 1.2, h: 1.9 },
    windmill: { len: 0.4, h: 2.7 },
    fan: { len: 12, h: 0, wide: true },
    portal: { len: 0.6, h: 2.0 },
    missile: { len: 1.2, h: 0.8 },
  };
  const obstacle = (type, lane, wz, extra = {}) => {
    const o = { type, lane, wz, vz: 0, ...OB[type], ...extra };
    g.obstacles.push(o);
    return o;
  };
  // 越往后间距越短（障碍越密），但留足最低反应距离
  const density = () => 1 - 0.6 * difficulty();
  const gapAfterTrain = () => Math.max(8 + g.speed * 30, (10 + g.speed * 50) * density());
  const gapShort = () => Math.max(6 + g.speed * 14, (9 + g.speed * 28) * density());
  const otherLanes = (lane) => [-1, 0, 1].filter((l) => l !== lane);
  const knows = (...types) => types.every((t) => g.known.has(t));

  /** 奶洞：入口在 a 道，出口在 b 道；a 道洞后面堵一节车厢，钻洞 = 换到奖励路线 */
  const makePortal = (z, a, b) => {
    obstacle('portal', a, z, { to: b, hue: (z * 7) % 360 });
    obstacle('train', a, z + 4, { len: 14 });
    coinLine(b, z + 2, 7, 0.6, 2);
    g.pickups.push({ kind: 'shard', lane: b, wz: z + 16, y: 0.8 });
    return 20 + gapAfterTrain();
  };

  const PATTERNS = [
    { w: () => 0.4 + 1.8 * (1 - difficulty()), needs: [], make: (z) => { coinLine(ri(-1, 1), z, 8); return 8 * 2.4 + gapShort(); } },
    { w: 4, needs: ['train'], make: (z) => {
      const lane = ri(-1, 1);
      const len = rr(12, 20) * (1 - 0.3 * difficulty());
      const ramp = knows('ramp') && R() < 0.4;
      if (ramp) {
        obstacle('ramp', lane, z);
        obstacle('train', lane, z + 6, { len });
        coinLine(lane, z + 7, Math.floor(len / 2.4), TRAIN_H + 0.6);
      } else {
        obstacle('train', lane, z, { len });
        const others = shuffled(otherLanes(lane));
        coinLine(others[0], z, 6);
        // 后面车厢旁边那条道也不安全了
        const extras = ['low', 'high', 'cone', 'frog', 'sentinel', 'windmill'].filter((t) => knows(t));
        if (extras.length && R() < difficulty() * 0.8) obstacle(pk(extras), others[1], z + len * 0.4, { phase: rr(0, 6) });
      }
      return (ramp ? 6 : 0) + len + gapAfterTrain();
    } },
    { w: 3, needs: ['train'], make: (z) => {
      const free = ri(-1, 1);
      const len = rr(12, 18) * (1 - 0.3 * difficulty());
      otherLanes(free).forEach((l, i) => {
        if (i === 0 && knows('ramp') && R() < 0.35) {
          obstacle('ramp', l, z);
          obstacle('train', l, z + 6, { len });
        } else {
          obstacle('train', l, z + rr(0, 4), { len });
        }
      });
      const extras = ['low', 'high', 'puddle', 'candy', 'cone'].filter((t) => knows(t));
      if (difficulty() > 0.12 && R() < 0.3 + 0.6 * difficulty()) obstacle(pk(extras), free, z + len * 0.5);
      else coinLine(free, z, Math.floor(len / 2.4));
      return 10 + len + gapAfterTrain();
    } },
    { w: 3, needs: ['low', 'high'], make: (z) => {
      const kinds = ['low', 'high', 'frog'].filter((t) => knows(t));
      const lanes = difficulty() > 0.15 ? [-1, 0, 1] : [ri(-1, 1)];
      lanes.forEach((l) => {
        const k = pk(kinds);
        obstacle(k, l, z);
        if (k === 'low' || k === 'frog') coinArc(l, z);
      });
      return gapShort();
    } },
    { w: 2, needs: ['moving'], make: (z) => {
      const lane = ri(-1, 1);
      obstacle('train', lane, z + 30, { len: 12, vz: -(0.1 + difficulty() * 0.08), moving: true });
      coinLine(pk(otherLanes(lane)), z, 10);
      return 30 + 12 + gapAfterTrain();
    } },
    { w: 2, needs: ['frog'], make: (z) => {
      const lanes = shuffled([-1, 0, 1]).slice(0, ri(1, 2));
      lanes.forEach((l, i) => obstacle('frog', l, z + i * 4));
      coinLine(lanes[0], z + 1.5, 3, 1.9, 1.5);
      return 8 + gapShort();
    } },
    { w: 2, needs: ['puddle'], make: (z) => {
      shuffled([-1, 0, 1]).slice(0, ri(1, 2)).forEach((l) => { obstacle('puddle', l, z); coinArc(l, z + 1.7); });
      return 4 + gapShort();
    } },
    { w: 2, needs: ['cone'], make: (z) => {
      const free = ri(-1, 1);
      otherLanes(free).forEach((l) => { obstacle('cone', l, z); obstacle('cone', l, z + 3); });
      coinLine(free, z - 2, 4);
      return 4 + gapShort();
    } },
    { w: 2, needs: ['candy'], make: (z) => {
      shuffled([-1, 0, 1]).slice(0, ri(1, 2)).forEach((l) => { obstacle('candy', l, z); coinArc(l, z + 1.6); });
      return 4 + gapShort();
    } },
    { w: 1, needs: ['river'], make: (z) => { obstacle('river', 0, z, { len: rr(5, 7) }); coinArc(ri(-1, 1), z + 3, 2.4); return 8 + gapShort(); } },
    { w: 2, needs: ['ice', 'train'], make: (z) => {
      [-1, 0, 1].forEach((l) => obstacle('ice', l, z));
      const free = ri(-1, 1);
      otherLanes(free).forEach((l) => obstacle('train', l, z + 12, { len: 12 }));
      coinLine(free, z + 12, 5);
      return 26 + gapAfterTrain();
    } },
    { w: 2, needs: ['plank'], make: (z) => {
      shuffled([-1, 0, 1]).slice(0, ri(1, 2)).forEach((l) => { obstacle('plank', l, z); coinArc(l, z + 3.5, 2.3); });
      return 8 + gapShort();
    } },
    { w: 2, needs: ['sentinel'], make: (z) => {
      const free = ri(-1, 1);
      shuffled(otherLanes(free)).slice(0, ri(1, 2)).forEach((l) => obstacle('sentinel', l, z));
      coinLine(free, z - 3, 4);
      return 4 + gapShort();
    } },
    { w: 2, needs: ['crates'], make: (z) => {
      const free = ri(-1, 1);
      otherLanes(free).forEach((l) => obstacle('crates', l, z));
      coinLine(free, z - 3, 4);
      return 4 + gapShort();
    } },
    { w: 2, needs: ['windmill'], make: (z) => {
      shuffled([-1, 0, 1]).slice(0, ri(1, 3)).forEach((l) => obstacle('windmill', l, z, { phase: rr(0, 6) }));
      return 4 + gapShort();
    } },
    { w: 1, needs: ['fan'], make: (z) => {
      const dir = R() < 0.5 ? -1 : 1;
      obstacle('fan', 0, z, { dir });
      coinLine(dir, z + 4, 5);
      return 16 + gapShort();
    } },
    { w: 1, needs: ['portal', 'train'], make: (z) => { const a = ri(-1, 1); return makePortal(z, a, pk(otherLanes(a))); } },
  ];

  /** 某个 z 处哪条道被车厢占着（放能量奶时绕开 / 放到车顶上） */
  const trainAt = (lane, wz) => g.obstacles.find((o) => o.type === 'train' && o.lane === lane && o.wz - 1 < wz && o.wz + o.len + 1 > wz);

  const generate = () => {
    while (g.genZ < g.dist + FAR) {
      const intro = INTRO[g.introIdx];
      if (intro && g.genZ >= intro.at) {
        g.introIdx++;
        const start = g.obstacles.length;
        const z = g.genZ;
        g.genZ += intro.make(z);
        g.known.add(intro.type);
        // 教学提示挂在这段的第一个障碍上（没有障碍的就挂个隐形标记）
        const first = g.obstacles[start];
        if (intro.tip) {
          if (first && first.wz >= z) first.tip = intro.tip;
          else g.obstacles.push({ type: 'marker', lane: 0, wz: z, len: 0.1, h: 0, tip: intro.tip, dead: false, vz: 0 });
        }
        continue;
      }
      if (g.genZ >= g.nextItem) {
        const keys = Object.keys(POWERS);
        g.items.push({ lane: ri(-1, 1), wz: g.genZ + 4, type: pk(keys) });
        g.genZ += 14;
        g.nextItem = g.genZ + rr(320, 520);
        continue;
      }
      const weight = (p) => (typeof p.w === 'function' ? p.w() : p.w);
      const pool = PATTERNS.filter((p) => knows(...p.needs));
      let r = R() * pool.reduce((s, p) => s + weight(p), 0);
      let pat = pool[0];
      for (const p of pool) { r -= weight(p); if (r <= 0) { pat = p; break; } }
      g.genZ += pat.make(g.genZ);
      // 越往后越常在两段之间再加塞一排小障碍（永远留一条道能过）
      const d = difficulty();
      const extraRows = R() < 0.15 + 0.75 * d ? (d > 0.6 && R() < 0.5 ? 2 : 1) : 0;
      for (let row = 0; row < extraRows; row++) {
        const smalls = ['low', 'high', 'cone', 'puddle', 'candy', 'frog', 'sentinel', 'crates', 'windmill', 'plank'].filter((t) => knows(t));
        if (smalls.length) {
          const lanes = shuffled([-1, 0, 1]).slice(0, d > 0.35 && R() < 0.3 + 0.5 * d ? 2 : 1);
          lanes.forEach((l) => obstacle(pk(smalls), l, g.genZ, { phase: rr(0, 6) }));
          g.genZ += 3 + gapShort();
        }
      }
    }
    // 能量奶、奶蛋碎片独立撒，跟赛道段落错开；落在车厢上就放到车顶
    const scatter = (kind, nextKey, gapMin, gapMax) => {
      while (g[nextKey] < g.dist + FAR && g.known.has(kind)) {
        const lane = ri(-1, 1);
        const wz = g[nextKey];
        const tr = trainAt(lane, wz);
        g.pickups.push({ kind, lane, wz, y: tr ? tr.h + 0.8 : 0.8 });
        g[nextKey] += rr(gapMin, gapMax);
      }
    };
    scatter('boost', 'nextBoost', 60, 110);
    scatter('shard', 'nextShard', 80, 150);
  };

  // ---------------------------------------------------------------- 玩家动作
  const onIce = () => g.obstacles.some((o) => o.type === 'ice' && o.wz < g.dist && o.wz + o.len > g.dist && Math.abs(g.p.x - laneX(o.lane)) < 1);
  const changeLane = (dir, forced = false) => {
    const P = g.p;
    if (!forced && onIce() && P.onGround) {
      // 冰面：输入慢半拍（0.15 秒），落地也会滑一下
      if (!P.pending) P.pending = { dir, t: 9 };
      return;
    }
    const next = clamp(P.lane + dir, -1, 1);
    if (next === P.lane) {
      if (!forced) { g.shake = 4; sfx('thud', 0.2); }
      return;
    }
    P.fromLane = P.lane;
    P.lane = next;
    sfx('stretch', 0.3);
  };
  const JUMP_STYLES = ['flip', 'spin', 'twist', 'star', 'tuck'];
  const jump = () => {
    const P = g.p;
    if (P.wade) {
      // 牛奶河里：每按一下往前划一下（连点挣脱）
      P.vy = 0.13;
      g.dist += 0.5;
      puff(P.x, 0.2, g.dist + 0.3, 3, '#fffaf0');
      sfx('plop');
      return;
    }
    if (!P.onGround || g.power.dash > 0 || g.power.float > 0 || P.fall > 0) return;
    const k = (g.power.spring > 0 ? 1.45 : 1) * (g.power.heavy > 0 ? 1.08 : 1);
    P.vy = JUMP_V * k;
    P.onGround = false;
    P.roll = 0;
    P.airT = 0;
    P.airTotal = (2 * P.vy) / GRAVITY;
    P.jumpStyle = JUMP_STYLES[(Math.random() * JUMP_STYLES.length) | 0];
    P.spinDir = Math.random() < 0.5 ? -1 : 1;
    sfx(g.power.spring > 0 ? 'boomer' : 'launch');
  };
  const roll = () => {
    const P = g.p;
    if (g.power.dash > 0 || g.power.float > 0 || P.wade) return;
    if (!P.onGround) P.vy = Math.min(P.vy, -0.42); // 空中按下 = 急降，落地接着滚
    P.roll = ROLL_FRAMES;
    sfx('plop');
  };

  // ---------------------------------------------------------------- 特效
  const puff = (x, y, wz, n, color) => {
    for (let i = 0; i < n; i++) {
      g.fx.push({ x: x + rand(-0.4, 0.4), y, wz, vx: rand(-0.03, 0.03), vy: rand(0.02, 0.06), vz: rand(-0.05, 0.05), r: rand(0.12, 0.25), life: 1, decay: rand(0.03, 0.05), color });
    }
  };
  const sparkle = (x, y, wz, color = '#fff') => {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      g.fx.push({ x, y, wz, vx: Math.cos(a) * 0.05, vy: Math.sin(a) * 0.05 + 0.02, vz: g.speed * 0.6, r: 0.1, life: 1, decay: 0.06, color });
    }
  };
  const boom = (x, y, wz, n = 16) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.06, 0.16);
      g.fx.push({ x, y, wz, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 0.05, vz: rand(-0.1, 0.3), r: rand(0.2, 0.45), life: 1, decay: rand(0.025, 0.04), color: pickColor() });
    }
  };
  const pickColor = () => ['#ffcf4d', '#ff8a5b', '#fff6e4', '#e2632f'][(Math.random() * 4) | 0];

  const smash = (o) => {
    if (o.dead) return;
    o.dead = true;
    if (o.type !== 'cone') { g.smashes++; g.points += 50; }
    g.shake = 10;
    const x = laneX(o.lane);
    if (o.type === 'frog' || o.type === 'sentinel') {
      g.debris.push({ kind: 'frog', x, y: 0, wz: g.dist + 1, vx: rand(-0.1, 0.1), vy: 0.32, vz: 0.6, rot: 0, vr: rand(0.15, 0.3) });
      sfx('pop');
    } else if (o.type === 'missile') {
      boom(x, o.y, o.wz, 12);
      sfx('boom');
    } else {
      const n = o.type === 'train' ? 6 : 3;
      for (let i = 0; i < n; i++) {
        g.debris.push({ kind: o.type, x: x + rand(-0.6, 0.6), y: rand(0.3, Math.max(0.5, o.h)), wz: g.dist + 1, vx: rand(-0.12, 0.12), vy: rand(0.15, 0.35), vz: rand(0.5, 0.9), rot: 0, vr: rand(-0.3, 0.3) });
      }
      sfx(o.type === 'train' || o.type === 'ramp' ? 'stone' : 'crack');
    }
  };

  const die = (reason) => {
    if (phase !== 'run') return;
    phase = 'dead';
    g.deathReason = reason;
    g.deathT = 0;
    g.shake = 18;
    g.chaseDist = 0;
    g.gap = 0;
    sfx('lose');
    sfx('laugh');
  };

  /** 无敌状态：猛冲、喷气、大奶蛙、自动导航（导航是兜底，免得 AI 判断失误） */
  const unstoppable = () => g.power.rush > 0 || g.power.dash > 0 || g.power.heavy > 0;

  /** 正面撞上：道具能扛就扛，扛不住就倒 */
  const crash = (o, reason) => {
    const P = g.p;
    if (unstoppable()) return smash(o);
    if (P.invuln > 0) return;
    if (g.power.shield) {
      g.power.shield = false;
      P.invuln = 90;
      smash(o);
      sfx('glass');
      toast('护盾碎了！', '#9b7be0');
      return;
    }
    die(reason);
  };

  /** 被追兵拉近：追上了就抓住 */
  const loseGround = (m) => {
    chaseDelta(-m);
    if (g.chaseDist <= 0) die('被暗黑奶皇抓住了');
  };

  /** 侧面蹭到：弹回原来那条道，追兵猛地追近 */
  const stumble = () => {
    const P = g.p;
    if (unstoppable() || P.invuln > 0) return;
    P.lane = P.fromLane;
    P.x = P.prevX;
    g.shake = 8;
    P.invuln = 30;
    sfx('thud', 0.6);
    sfx('roar');
    toast('小心！暗黑奶皇追上来了', '#7b2d8e');
    loseGround(8);
  };

  /** 被弹开（哨兵 / 风车 / 木箱塔）：不致命，但减速、追兵追近 */
  const knock = (o, sideways, text) => {
    const P = g.p;
    if (unstoppable()) return smash(o);
    if (P.invuln > 0) return;
    if (sideways) { P.lane = P.fromLane; P.x = P.prevX; }
    if (o.type === 'crates') smash(o);
    P.invuln = 45;
    P.vy = Math.max(P.vy, 0.12);
    P.onGround = false;
    g.slow = Math.max(g.slow, 60);
    g.shake = 9;
    sfx('thud', 0.7);
    toast(text, '#b04ad0');
    loseGround(5);
  };

  const activate = (type) => {
    const def = POWERS[type];
    if (type === 'split') g.power.shield = true;
    else g.power[type] = def.frames;
    if (type === 'heavy') { g.p.morph = 20; puff(g.p.x, 0.8, g.dist + 0.3, 12, '#ffe58a'); sfx('roar'); }
    if (type === 'dash') {
      g.p.roll = 0;
      for (let i = 0; i < 28; i++) g.coins.push({ lane: [-1, 0, 1][Math.floor(i / 7) % 3], wz: g.dist + 10 + i * 2.8, y: 3.8, sky: true });
      sfx('dash');
    } else {
      sfx('levelUp');
    }
    toast(def.tip, def.color);
  };

  /** 放技能（充满才能放） */
  const useSkill = () => {
    if (phase !== 'run' || g.meter < SKILL_FULL) return;
    g.meter = 0;
    const P = g.p;
    const pw = g.power;
    const egg = EGG[g.egg];
    switch (g.egg) {
      case 'naidan': pw.x2 = Math.max(pw.x2, 480); break;
      case 'dash': pw.rush = TIMED.rush.frames; P.roll = 0; sfx('dash'); break;
      case 'split': pw.shield = true; pw.tri = TIMED.tri.frames; sfx('split'); break;
      case 'bomb': {
        for (const o of g.obstacles) {
          if (o.dead || o.wz > g.dist + 40 || o.wz + o.len < g.dist - 1) continue;
          if (['marker', 'ice', 'fan', 'portal', 'ramp'].includes(o.type)) continue;
          smash(o);
        }
        g.warnings = [];
        g.flash = 12;
        boom(P.x, 1, g.dist + 8, 30);
        sfx('boom');
        break;
      }
      case 'heavy': pw.heavy = 300; P.morph = 20; puff(P.x, 0.8, g.dist + 0.3, 12, '#ffe58a'); sfx('roar'); break;
      case 'milk': pw.float = TIMED.float.frames; P.roll = 0; sfx('plop'); break;
      case 'back': pw.stun = TIMED.stun.frames; chaseDelta(12); g.boomerang = 40; sfx('boomer'); break;
      case 'seek': pw.auto = TIMED.auto.frames; sfx('levelUp'); break;
      default: break;
    }
    toast(`${egg.skill}！`, egg.color);
  };

  // ---------------------------------------------------------------- 自动导航（制导奶蛋的技能；也拿来做自测）
  const autopilot = () => {
    const P = g.p;
    if (Math.abs(P.x - laneX(P.lane)) > 0.15) return;
    const ahead = (lane, a, b) => g.obstacles.filter((o) => !o.dead && (o.lane === lane || o.wide) && o.wz + o.len > g.dist + a && o.wz < g.dist + b);
    const deadly = (o) => o.type === 'train' && P.y < o.h - 0.5 && !g.obstacles.some((r) => r.type === 'ramp' && r.lane === o.lane && Math.abs(r.wz + r.len - o.wz) < 0.5);
    const bad = (lane) => ahead(lane, -1, 20 + g.speed * 20).some((o) => deadly(o) || ['sentinel', 'crates', 'cone', 'windmill'].includes(o.type))
      || g.warnings.some((w) => w.lane === lane) || (g.paw && g.paw.lane === lane && g.paw.state === 'warn');
    if (bad(P.lane)) {
      const opts = [P.lane - 1, P.lane + 1].filter((l) => l >= -1 && l <= 1 && !ahead(l, -1.5, 3).some((o) => o.type === 'train')).sort((a, b) => bad(a) - bad(b));
      if (opts.length && !bad(opts[0])) { changeLane(opts[0] < P.lane ? -1 : 1); return; }
    }
    for (const o of ahead(P.lane, 0, 3.5 + g.speed * 6)) {
      if (['low', 'frog', 'puddle', 'candy', 'plank', 'river'].includes(o.type) && P.onGround) jump();
      if (o.type === 'missile' && o.y < 1) { if (P.onGround) jump(); }
      else if ((o.type === 'high' || o.type === 'missile') && P.roll <= 0) roll();
    }
  };

  // ---------------------------------------------------------------- 每帧逻辑
  const step = () => {
    g.t++;
    const P = g.p;
    const pw = g.power;

    if (phase === 'dead') {
      g.deathT++;
      stepFx();
      if (g.deathT === 70) showDead();
      return;
    }

    // 速度：底速 × 各种加成 / 减速
    const latX = (o) => o.wide || Math.abs(P.x - laneX(o.lane)) < 0.95;
    const inside = (type) => g.obstacles.find((o) => o.type === type && !o.dead && o.wz < g.dist && o.wz + o.len > g.dist && latX(o));
    const base = 0.3 + 0.32 * (1 - Math.exp(-g.dist / 2500));
    let k = 1;
    if (pw.rush > 0) k *= 1.8;
    else if (pw.dash > 0) k *= 1.6;
    if (pw.boost > 0) k *= 1.25;
    const immune = pw.dash > 0 || pw.rush > 0 || pw.heavy > 0 || pw.float > 0;
    if (!immune) {
      if (g.slow > 0) k *= 0.7;
      if (P.y < 0.2 && inside('candy')) k *= 0.45;
      if (P.wade) k *= 0.4;
      if (P.fall > 0) k *= 0.4;
    }
    const introK = g.introSlow > 0 ? 0.85 : 1;
    if (g.introSlow > 0) g.introSlow--;
    g.speed = base * k * introK;
    g.dist += g.speed;
    // 追兵：按自己的速度跑（被回旋镖砸晕就原地停），跟你的真实速度比
    const chaserSpeed = pw.stun > 0 ? 0 : base * chaserFactor() * introK;
    g.chaseDist = Math.min(CHASE_MAX, g.chaseDist + g.speed - chaserSpeed);
    g.chaseRate += ((g.speed - chaserSpeed) * 60 - g.chaseRate) * 0.08;
    g.gap = clamp(g.chaseDist / CHASE_MAX, 0, 1);

    if (Math.floor(g.dist / 500) > g.milestone) {
      g.milestone = Math.floor(g.dist / 500);
      toast(`${g.milestone * 500} 米！暗黑奶皇也越追越快了`);
      sfx('levelUp');
    }

    // 计时
    for (const key of Object.keys(TIMED)) if (pw[key] > 0) pw[key]--;
    if (pw.dash === 1) { P.invuln = 90; P.onGround = false; P.vy = 0; }
    if (pw.heavy === 1) { P.invuln = 60; P.morph = 20; puff(P.x, 0.8, g.dist + 0.3, 10, '#ffe58a'); toast('变回奶蛋了', '#d9902f'); }
    if (pw.float === 1) { P.vy = 0; P.onGround = false; P.invuln = 30; }
    if (pw.rush === 1) P.invuln = 40;
    if (pw.auto > 0) { P.invuln = Math.max(P.invuln, 2); autopilot(); }
    if (P.invuln > 0) P.invuln--;
    if (P.morph > 0) P.morph--;
    if (P.land > 0) P.land--;
    if (P.fall > 0) P.fall--;
    if (g.flash > 0) g.flash--;
    if (g.boomerang > 0) g.boomerang--;
    if (P.roll > 0 && P.onGround) P.roll--;
    if (!P.onGround) P.airT++;

    // 追兵：越追越快；减速时猛追；能量奶 / 冲刺能拉开；被回旋镖砸晕就停一下
    if (g.slow > 0) g.slow--;
    for (const d of g.deltas) d.t--;
    g.deltas = g.deltas.filter((d) => d.t > 0);
    if (g.chaseDist <= 0) return die('被暗黑奶皇抓住了');
    g.chaseX += (P.x - g.chaseX) * 0.06;
    const side = g.chaseX > 1 ? -1.1 : g.chaseX < -1 ? 1.1 : -1.1;
    g.chaseSide += (side - g.chaseSide) * 0.08;

    // 冰面上排队的换道
    if (P.pending && --P.pending.t <= 0) { changeLane(P.pending.dir, true); P.pending = null; }

    // 横向：滑向目标车道（冰面上慢、会打滑）
    P.prevX = P.x;
    const tx = laneX(P.lane);
    const slip = onIce() && P.onGround;
    P.x += clamp((tx - P.x) * (slip ? 0.1 : 0.32), -0.42, 0.42);
    if (Math.abs(tx - P.x) < 0.02) P.x = tx;

    // 竖直
    const prevY = P.y;
    if (pw.dash > 0) {
      P.y += (3.2 - P.y) * 0.08;
      P.vy = 0;
      P.onGround = false;
    } else if (pw.float > 0) {
      P.y += (2.9 + Math.sin(g.t * 0.1) * 0.1 - P.y) * 0.1;
      P.vy = 0;
      P.onGround = true; // 踩在奶泡上
    } else {
      P.vy -= GRAVITY * (P.roll > 0 && !P.onGround ? 1.6 : 1);
      P.y += P.vy;
    }

    for (const o of g.obstacles) {
      if (o.vz) o.wz += o.vz;
      if (o.type === 'windmill') o.phase = (o.phase || 0) + 0.04;
    }

    // 落脚点：地面 / 斜坡 / 车顶；牛奶河里会往下陷
    const zHit = (o) => o.wz < g.dist + 0.35 && o.wz + o.len > g.dist - 0.35;
    let floor = 0;
    const river = inside('river');
    if (river && !immune) floor = -0.45;
    for (const o of g.obstacles) {
      if (o.dead || !latX(o) || !zHit(o)) continue;
      if (o.type === 'ramp') {
        const h = o.h * clamp((g.dist - o.wz) / o.len, 0, 1);
        if (P.y >= h - 0.45) floor = Math.max(floor, h);
      } else if (o.type === 'train') {
        if (prevY >= o.h - 0.4) floor = Math.max(floor, o.h);
      }
    }
    if (pw.dash <= 0 && pw.float <= 0) {
      if (P.y <= floor && P.vy <= 0) {
        if (!P.onGround && P.vy < -0.15) {
          P.land = 8;
          puff(P.x, floor, g.dist + 0.3, 5, river ? '#fffaf0' : '#e8d2b4');
          sfx(river ? 'plop' : 'thud', 0.3);
        }
        P.y = floor;
        P.vy = 0;
        P.onGround = true;
      } else if (P.y > floor + 0.05) {
        P.onGround = false;
      }
    }
    const wasWading = P.wade;
    P.wade = !!river && !immune && P.y < 0.05;
    if (P.wade && !wasWading) { toast('掉进牛奶河了！狂按跳往前划', '#5fb8e8'); g.slow = Math.max(g.slow, 30); }

    // 教学提示：快到的时候弹出来，顺便把这一段放慢一点
    for (const o of g.obstacles) {
      if (o.tip && !o.tipShown && o.wz - g.dist < 32) {
        o.tipShown = true;
        toast(o.tip, '#4a3527', 170);
        g.introSlow = 120;
      }
    }

    // 障碍
    const top = P.y + (P.roll > 0 ? ROLL_H : PLAYER_H) * (pw.heavy > 0 ? 1.2 : 1);
    for (const o of g.obstacles) {
      if (phase !== 'run') return;
      if (o.dead || !zHit(o) || !latX(o)) continue;
      const sideways = !o.wide && Math.abs(P.prevX - laneX(o.lane)) >= 0.95;
      switch (o.type) {
        case 'marker': case 'ramp': case 'river': continue;
        case 'puddle':
          if (P.y < 0.2 && !immune) {
            if (g.slow <= 0) { toast('踩进奶油泥坑，减速！', '#b07a3c'); sfx('plop'); }
            g.slow = Math.max(g.slow, 70);
            if (g.t % 4 === 0) puff(P.x, 0.1, g.dist + 0.2, 1, '#fff3d6');
          }
          continue;
        case 'candy':
          if (P.y < 0.2 && !immune && !o.hit) { o.hit = true; toast('粘在奶糖里了！', '#c0703a'); sfx('plop'); g.slow = Math.max(g.slow, 40); }
          continue;
        case 'cone':
          if (P.y < o.h) {
            smash(o);
            if (!immune) { g.slow = Math.max(g.slow, 75); toast('撞翻路障，减速！', '#e2632f'); }
          }
          continue;
        case 'ice':
          continue;
        case 'plank':
          // 踩上去 0.3 秒就塌；那时还站在上面就掉下去
          if (P.y < 0.1 && !immune && !o.timer && !o.fallen) o.timer = 18;
          continue;
        case 'fan':
          if (!o.pushed && (o.inT = (o.inT || 0) + 1) > 24 && !immune) {
            o.pushed = true;
            const before = P.lane;
            changeLane(o.dir, true);
            if (P.lane !== before) toast('被鼓风机吹偏了！', '#5fb8e8');
          }
          continue;
        case 'portal':
          if (P.y < 1.6 && !o.used) {
            o.used = true;
            sparkle(P.x, 1, g.dist, '#c58af0');
            P.lane = o.to;
            P.fromLane = o.to;
            P.x = laneX(o.to);
            P.prevX = P.x;
            g.flash = 6;
            sfx('dash');
            toast('钻进奶洞！', '#9b7be0');
          }
          continue;
        case 'windmill': {
          // 三片叶子，转到朝下（±0.45 弧度）的那片会扫过地面
          const down = [0, 1, 2].some((i) => {
            const a = (((o.phase + (i * Math.PI * 2) / 3) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            return Math.abs(a - Math.PI * 1.5) < 0.45;
          });
          if (down && P.y < 1.0) knock(o, sideways, '被风车扫到了，减速！');
          continue;
        }
        case 'sentinel':
          if (P.y < o.h) knock(o, sideways, '被奶蛙哨兵弹开了！');
          continue;
        case 'crates':
          if (P.y < o.h) knock(o, sideways, '撞碎了木箱，减速！');
          continue;
        default: break;
      }
      let blocked = false;
      if (o.type === 'train') blocked = P.y < o.h - 0.4;
      else if (o.type === 'low') blocked = P.y < o.h;
      else if (o.type === 'high') blocked = top > o.bottom && P.y < o.h;
      else if (o.type === 'missile') blocked = top > o.y - 0.45 && P.y < o.y + 0.45;
      else if (o.type === 'frog') {
        if (P.y >= o.h * 0.6 && P.vy < 0 && pw.dash <= 0) {
          o.dead = true;
          g.stomps++;
          g.points += 100 * mult();
          P.vy = 0.22;
          P.onGround = false;
          P.airT = 0;
          P.airTotal = 20;
          puff(laneX(o.lane), 0.2, g.dist + 0.5, 6, '#ffe58a');
          g.debris.push({ kind: 'squash', x: laneX(o.lane), y: 0, wz: o.wz, life: 30 });
          sfx('pop');
          toast(`踩扁 +${100 * mult()}`, '#d9902f');
          continue;
        }
        blocked = P.y < o.h;
      }
      if (!blocked) continue;
      if (sideways && o.type !== 'missile') stumble();
      else crash(o, {
        train: '一头撞上了车厢',
        low: '被矮栏绊倒了，该跳的',
        high: '撞到高栏了，该翻滚的',
        frog: '被奶蛙绊倒了',
        missile: '被奶蛙导弹砸中了',
      }[o.type]);
      if (phase !== 'run') return;
    }

    // 塌陷木地板计时
    for (const o of g.obstacles) {
      if (o.type !== 'plank' || !o.timer || o.fallen) continue;
      if (--o.timer <= 0) {
        o.fallen = true;
        sfx('crack');
        const over = Math.abs(P.x - laneX(o.lane)) < 0.95 && o.wz < g.dist && o.wz + o.len > g.dist;
        if (over && P.y < 0.15 && !immune && P.invuln <= 0) {
          P.fall = 45;
          g.shake = 10;
          toast('地板塌了！', '#8a5530');
          loseGround(6);
          if (phase !== 'run') return;
        }
      }
    }

    // 奶蛙导弹：先预警，再从前方飞过来
    if (g.known.has('missile') && g.dist >= g.nextMissile) {
      const d = difficulty();
      const n = d < 0.35 ? 1 : d < 0.7 ? 2 : 3;
      const lanes = shuffled([-1, 0, 1]).slice(0, n);
      lanes.forEach((l, i) => g.warnings.push({ lane: l, t: 80 + i * (n === 3 ? 45 : 18), low: R() < 0.4 }));
      g.nextMissile = g.dist + rr(220, 380) * (1.2 - d * 0.4);
      sfx('bossSummon');
    }
    for (const w of g.warnings) {
      if (--w.t <= 0) {
        obstacle('missile', w.lane, g.dist + 55, { vz: -0.75, y: w.low ? 0.55 : 1.3, spin: Math.random() * 6 });
        sfx('flyStart');
      }
    }
    g.warnings = g.warnings.filter((w) => w.t > 0);

    // 暗黑奶皇拍掌：从 1150 米起每 500 米一次；锁定你当时那条道
    if (g.known.has('paw') && !g.paw && g.dist >= g.nextPaw) {
      g.paw = { lane: P.lane, t: 75, state: 'warn', y: 7 };
      g.nextPaw = g.dist + 500;
      toast('暗黑奶皇要拍你了！看影子，换道！', '#7b2d8e', 90);
      sfx('roar');
    }
    if (g.paw) {
      const pw2 = g.paw;
      pw2.t--;
      if (pw2.state === 'warn') {
        pw2.y = 6 + Math.sin(g.t * 0.2) * 0.3;
        if (pw2.t <= 0) { pw2.state = 'slam'; pw2.t = 8; }
      } else if (pw2.state === 'slam') {
        pw2.y = Math.max(0.3, pw2.y - 0.8);
        if (pw2.t <= 0) {
          pw2.state = 'lift';
          pw2.t = 30;
          g.shake = 16;
          sfx('slam');
          puff(laneX(pw2.lane), 0.1, g.dist + 2, 14, '#d6b48c');
          if (Math.abs(P.x - laneX(pw2.lane)) < 1.1 && P.y < 2.5 && !unstoppable() && pw.float <= 0 && P.invuln <= 0) {
            if (pw.shield) { pw.shield = false; P.invuln = 90; sfx('glass'); toast('护盾挡住了奶皇一掌！', '#9b7be0'); }
            else return die('被暗黑奶皇一掌拍扁了');
          }
        }
      } else {
        pw2.y += 0.25;
        if (pw2.t <= 0) g.paw = null;
      }
    }

    // 奶滴 / 能量奶 / 碎片 / 道具；磁铁全都吸
    const cy = P.y + 0.7;
    const magnet = pw.milk > 0;
    const pull = (c) => {
      c.x = c.x === undefined ? laneX(c.lane) : c.x;
      c.x += (P.x - c.x) * 0.25;
      c.y += (cy - c.y) * 0.25;
      c.wz += (g.dist - c.wz) * 0.25;
    };
    const near = (c, x) => Math.abs(c.wz - g.dist) < 0.7 && Math.abs(x - P.x) < (pw.tri > 0 ? 9 : 0.9) && Math.abs(c.y - cy) < (pw.tri > 0 ? 3 : 1.1);
    for (const c of g.coins) {
      if (c.taken) continue;
      const dz = c.wz - g.dist;
      if (magnet && dz < 22 && dz > -1 && !c.sky) c.pull = true;
      if (c.pull) pull(c);
      const cx = c.x === undefined ? laneX(c.lane) : c.x;
      if (near(c, cx)) {
        c.taken = true;
        g.coinCount++;
        g.points += 10 * mult();
        sparkle(cx, c.y, c.wz);
        if (g.coinCount % 3 === 0) sfx('pop');
      }
    }
    for (const c of g.pickups) {
      if (c.taken) continue;
      const dz = c.wz - g.dist;
      if (magnet && dz < 22 && dz > -1) c.pull = true;
      if (c.pull) pull(c);
      const cx = c.x === undefined ? laneX(c.lane) : c.x;
      if (Math.abs(c.wz - g.dist) < 0.8 && Math.abs(cx - P.x) < 0.95 && Math.abs(c.y - cy) < 1.3) {
        c.taken = true;
        if (c.kind === 'boost') {
          g.boosts++;
          pw.boost = TIMED.boost.frames;
          chaseDelta(3);
          sparkle(cx, c.y, c.wz, '#7bc96f');
          sfx('dash');
        } else {
          const was = g.meter;
          g.meter = Math.min(SKILL_FULL, g.meter + SHARD_VALUE);
          sparkle(cx, c.y, c.wz, EGG[g.egg].color);
          sfx('pop');
          if (was < SKILL_FULL && g.meter >= SKILL_FULL) toast(`${EGG[g.egg].skill}充满了！按 E / 技能键`, EGG[g.egg].color);
        }
      }
    }
    for (const it of g.items) {
      if (it.taken) continue;
      if (magnet && it.wz - g.dist < 22) it.pull = true;
      if (it.pull) { it.lane = Math.round(P.x / LANE_W); it.wz += (g.dist - it.wz) * 0.25; }
      if (Math.abs(it.wz - g.dist) < 0.8 && Math.abs(laneX(it.lane) - P.x) < 1 && P.y < 3.2) {
        it.taken = true;
        sparkle(laneX(it.lane), 1.2, it.wz, POWERS[it.type].color);
        activate(it.type);
      }
    }

    stepFx();

    const behind = g.dist - 8;
    g.obstacles = g.obstacles.filter((o) => o.wz + o.len > behind && !(o.dead && o.type !== 'train') && !(o.type === 'missile' && o.wz < behind));
    g.coins = g.coins.filter((c) => !c.taken && c.wz > behind);
    g.pickups = g.pickups.filter((c) => !c.taken && c.wz > behind);
    g.items = g.items.filter((i) => !i.taken && i.wz > behind);
    generate();
  };

  const stepFx = () => {
    if (g.shake > 0) g.shake *= 0.85;
    if (g.shake < 0.3) g.shake = 0;
    if (g.toast && --g.toast.t <= 0) g.toast = null;
    for (const f of g.fx) { f.x += f.vx; f.y += f.vy; f.wz += f.vz; f.vy -= 0.004; f.life -= f.decay; }
    g.fx = g.fx.filter((f) => f.life > 0);
    for (const d of g.debris) {
      if (d.kind === 'squash') { d.life--; continue; }
      d.x += d.vx; d.y += d.vy; d.wz += d.vz; d.vy -= 0.02; d.rot += d.vr;
    }
    g.debris = g.debris.filter((d) => (d.kind === 'squash' ? d.life > 0 : d.y > -3));
  };

  // ---------------------------------------------------------------- 透视投影
  let camX = 0;
  const proj = (x, y, wz) => {
    const d = Math.max(0.05, wz - g.dist - camZ);
    const s = focal / d;
    return { x: viewW / 2 + (x - camX) * s, y: horizon + (camY - y) * s, s };
  };
  const quad = (a, b, c, d) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
  };
  const clipNear = (wz) => Math.max(wz, g.dist + nearZ);
  /** 贴地的一块（泥坑、冰面、木板……）：在 x0~x1、za~zb 范围画个四边形 */
  const groundQuad = (x0, x1, za, zb, y = 0.02) => {
    const a = clipNear(za);
    if (zb <= a) return false;
    quad(proj(x0, y, a), proj(x1, y, a), proj(x1, y, zb), proj(x0, y, zb));
    return true;
  };

  // ---------------------------------------------------------------- 绘制
  const drawSprite = (key, cx, bottom, height, opts = {}) => {
    const im = typeof key === 'string' ? IMG[key] : key;
    if (typeof key !== 'string') key = 'naidan';
    const c = ctx;
    c.save();
    c.translate(cx, bottom - height / 2);
    if (opts.rot) c.rotate(opts.rot);
    c.scale((opts.flip ? -1 : 1) * (opts.sx || 1), opts.sy || 1);
    if (opts.alpha !== undefined) c.globalAlpha = opts.alpha;
    if (im && im.complete && im.naturalWidth) {
      const w = (height * im.naturalWidth) / im.naturalHeight;
      c.drawImage(im, -w / 2, -height / 2, w, height);
    } else {
      c.fillStyle = key.startsWith('naiwa') || key.startsWith('boss') ? '#f6d44a' : '#ffe9a8';
      c.beginPath();
      c.ellipse(0, 0, height * 0.38, height * 0.5, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  };

  /**
   * 立绘最底下那一条是两只脚。量出它们的位置和颜色（每张图只量一次），
   * 跑的时候把原图的脚裁掉、换成两只会交替抬起的脚。画布被污染（file:// 外链图）就照原图画。
   */
  const FEET = {};
  const feetOf = (key) => {
    if (FEET[key] !== undefined) return FEET[key];
    const im = IMG[key];
    if (!im || !im.complete || !im.naturalWidth) return null;
    let info = null;
    try {
      const w = im.naturalWidth, h = im.naturalHeight;
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const c = cv.getContext('2d');
      c.drawImage(im, 0, 0);
      const px = c.getImageData(0, 0, w, h).data;
      let minY = h, maxY = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x += 2) {
          if (px[(y * w + x) * 4 + 3] > 60) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
        }
      }
      const cut = Math.round(minY + (maxY - minY) * 0.91);
      const sides = [0, 1].map(() => ({ n: 0, x: 0, r: 0, g: 0, b: 0, x0: w, x1: 0 }));
      for (let y = cut; y <= maxY; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (px[i + 3] < 160) continue;
          const sd = sides[x < w / 2 ? 0 : 1];
          sd.n++; sd.x += x; sd.r += px[i]; sd.g += px[i + 1]; sd.b += px[i + 2];
          if (x < sd.x0) sd.x0 = x;
          if (x > sd.x1) sd.x1 = x;
        }
      }
      if (sides[0].n > 20 && sides[1].n > 20) {
        info = {
          cut: cut / h,
          mid: (cut + maxY) / 2 / h,
          ry: ((maxY - cut) / h) * 0.75,
          feet: sides.map((sd) => ({
            x: sd.x / sd.n / w - 0.5,
            rx: Math.max(0.05, Math.min(0.16, (sd.x1 - sd.x0) / 2 / w)),
            color: `rgb(${(sd.r / sd.n) | 0},${(sd.g / sd.n) | 0},${(sd.b / sd.n) | 0})`,
          })),
        };
      }
    } catch (e) { info = null; }
    FEET[key] = info;
    return info;
  };

  /** 暗黑奶皇：把奶皇立绘压一层暗紫色（只做一次） */
  const darkOf = (key) => {
    const dk = 'dark_' + key;
    if (IMG[dk]) return dk;
    const im = IMG[key];
    if (!im || !im.complete || !im.naturalWidth) return key;
    const cv = document.createElement('canvas');
    cv.width = im.naturalWidth;
    cv.height = im.naturalHeight;
    const c = cv.getContext('2d');
    c.drawImage(im, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = 'rgba(52,14,78,.62)';
    c.fillRect(0, 0, cv.width, cv.height);
    cv.naturalWidth = cv.width;
    cv.naturalHeight = cv.height;
    cv.complete = true;
    IMG[dk] = cv;
    return dk;
  };

  /**
   * 带两只脚的立绘。step = 步伐相位（null = 脚不动）；
   * pose：'run' 跑 / 'tuck' 空中缩脚 / 'star' 大字跳（脚分开） / null 照原图
   */
  const drawRunner = (key, cx, bottom, height, opts = {}, step = null, pose = null) => {
    const info = feetOf(key);
    const im = IMG[key];
    if (!info || (step === null && !pose)) return drawSprite(key, cx, bottom, height, opts);
    const c = ctx;
    const w = (height * im.naturalWidth) / im.naturalHeight;
    c.save();
    c.translate(cx, bottom - height / 2);
    if (opts.rot) c.rotate(opts.rot);
    c.scale(opts.sx || 1, opts.sy || 1);
    if (opts.alpha !== undefined) c.globalAlpha = opts.alpha;
    c.drawImage(im, 0, 0, im.naturalWidth, im.naturalHeight * info.cut, -w / 2, -height / 2, w, height * info.cut);
    info.feet.forEach((f, i) => {
      // 一只脚抬起来（离镜头近一点、显大一点），另一只踩地，交替着来
      let lift = Math.max(0, Math.sin((step || 0) + i * Math.PI));
      let spread = 1;
      if (pose === 'tuck') lift = i ? 0.35 : 0.8;
      if (pose === 'star') { lift = 0.25; spread = 1.7; }
      const k = 1 + lift * 0.22;
      const fx = f.x * w * (1 - lift * 0.1) * spread;
      const fy = (info.mid - 0.5) * height - lift * height * 0.11;
      c.fillStyle = f.color;
      c.beginPath();
      c.ellipse(fx, fy, f.rx * w * k, info.ry * height * k, pose === 'star' ? (i ? 0.5 : -0.5) : 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,.25)';
      c.beginPath();
      c.ellipse(fx - f.rx * w * 0.25, fy - info.ry * height * 0.3, f.rx * w * 0.45 * k, info.ry * height * 0.35 * k, 0, 0, Math.PI * 2);
      c.fill();
    });
    c.restore();
  };

  const roundRect = (x, y, w, h, r) => {
    const c = ctx;
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  };

  const drawBackground = () => {
    const c = ctx;
    const sky = c.createLinearGradient(0, 0, 0, horizon + 40);
    sky.addColorStop(0, '#ffe7c2');
    sky.addColorStop(1, '#ffcfa0');
    c.fillStyle = sky;
    c.fillRect(0, 0, viewW, viewH);
    c.fillStyle = 'rgba(255,248,230,.85)';
    c.beginPath();
    c.arc(viewW * 0.78 - camX * 6, 70, 36, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,253,247,.92)';
    for (let i = 0; i < 5; i++) {
      const span = viewW + 300;
      const x = ((((i * 389) - g.t * 0.15 - camX * 10) % span) + span) % span - 150;
      const y = 30 + ((i * 53) % 80);
      const s = 0.55 + ((i * 37) % 10) / 25;
      c.beginPath();
      c.ellipse(x, y, 60 * s, 20 * s, 0, 0, Math.PI * 2);
      c.ellipse(x + 38 * s, y - 11 * s, 40 * s, 24 * s, 0, 0, Math.PI * 2);
      c.fill();
    }
    const hills = (k, base, amp, color) => {
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(0, viewH);
      for (let x = 0; x <= viewW + 20; x += 20) {
        const wx = x + camX * k * 40;
        c.lineTo(x, base - Math.sin(wx * 0.006) * amp - Math.sin(wx * 0.017 + 1.3) * amp * 0.4);
      }
      c.lineTo(viewW, viewH);
      c.fill();
    };
    hills(0.3, horizon + 4, 18, '#ffe2bd');
    hills(0.6, horizon + 14, 10, '#fbd6a6');
    c.fillStyle = '#a9d67f';
    c.fillRect(0, horizon + 14, viewW, viewH);
  };

  const drawTrack = () => {
    const c = ctx;
    const z0 = g.dist + nearZ;
    const z1 = g.dist + FAR;
    c.fillStyle = '#d6b48c';
    quad(proj(-3.4, 0, z0), proj(3.4, 0, z0), proj(3.4, 0, z1), proj(-3.4, 0, z1));
    c.fill();
    c.fillStyle = '#9b6b45';
    const tieGap = 1.6;
    for (let wz = Math.ceil(z0 / tieGap) * tieGap; wz < z1; wz += tieGap) {
      for (const l of [-1, 0, 1]) {
        const x = laneX(l);
        const a = proj(x - 0.85, 0, wz), b = proj(x + 0.85, 0, wz), d = proj(x - 0.85, 0, wz + 0.35), e = proj(x + 0.85, 0, wz + 0.35);
        if (a.s < 6) continue;
        quad(a, b, e, d);
        c.fill();
      }
    }
    c.fillStyle = '#8c8f96';
    for (const l of [-1, 0, 1]) {
      for (const off of [-0.55, 0.55]) {
        const x = laneX(l) + off;
        quad(proj(x - 0.05, 0.05, z0), proj(x + 0.05, 0.05, z0), proj(x + 0.05, 0.05, z1), proj(x - 0.05, 0.05, z1));
        c.fill();
      }
    }
    c.fillStyle = '#c98a4f';
    const postGap = 6;
    for (let wz = Math.ceil(z0 / postGap) * postGap; wz < z1; wz += postGap) {
      for (const x of [-3.9, 3.9]) {
        const b = proj(x, 0, wz), t = proj(x, 1.1, wz);
        if (b.s < 5) continue;
        const w = Math.max(2, b.s * 0.14);
        c.fillRect(b.x - w / 2, t.y, w, b.y - t.y);
      }
    }
    const fog = c.createLinearGradient(0, horizon, 0, horizon + 40);
    fog.addColorStop(0, 'rgba(255,214,170,.9)');
    fog.addColorStop(1, 'rgba(255,214,170,0)');
    c.fillStyle = fog;
    c.fillRect(0, horizon, viewW, 40);
  };

  const shade = (hex, k) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => clamp(Math.round(v * k), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  };

  const drawBox = (x0, x1, y0, y1, za, zb, color) => {
    const c = ctx;
    const zA = clipNear(za);
    if (zb <= zA) return null;
    const p = (x, y, z) => proj(x, y, z);
    if (x1 < camX) {
      c.fillStyle = shade(color, 0.78);
      quad(p(x1, y0, zA), p(x1, y1, zA), p(x1, y1, zb), p(x1, y0, zb));
      c.fill();
    } else if (x0 > camX) {
      c.fillStyle = shade(color, 0.78);
      quad(p(x0, y0, zA), p(x0, y1, zA), p(x0, y1, zb), p(x0, y0, zb));
      c.fill();
    }
    if (y1 < camY) {
      c.fillStyle = shade(color, 1.1);
      quad(p(x0, y1, zA), p(x1, y1, zA), p(x1, y1, zb), p(x0, y1, zb));
      c.fill();
    }
    const fa = p(x0, y1, zA), fb = p(x1, y0, zA);
    c.fillStyle = color;
    c.fillRect(fa.x, fa.y, fb.x - fa.x, fb.y - fa.y);
    return { x: fa.x, y: fa.y, w: fb.x - fa.x, h: fb.y - fa.y, front: za >= zA };
  };

  const drawTrain = (o) => {
    const x = laneX(o.lane);
    const f = drawBox(x - 0.9, x + 0.9, 0, o.h, o.wz, o.wz + o.len, o.moving ? '#e8735a' : '#f2a65a');
    if (!f || !f.front) return;
    const c = ctx;
    c.fillStyle = '#fff3dc';
    roundRect(f.x + f.w * 0.12, f.y + f.h * 0.14, f.w * 0.76, f.h * 0.3, Math.max(2, f.w * 0.06));
    c.fill();
    c.fillStyle = '#7bb6d9';
    roundRect(f.x + f.w * 0.17, f.y + f.h * 0.18, f.w * 0.66, f.h * 0.22, Math.max(2, f.w * 0.05));
    c.fill();
    c.fillStyle = '#fff6e4';
    c.fillRect(f.x, f.y + f.h * 0.58, f.w, f.h * 0.07);
    c.fillStyle = o.moving && g.t % 20 < 10 ? '#fff27a' : '#ffe7a8';
    for (const k of [0.2, 0.8]) {
      c.beginPath();
      c.arc(f.x + f.w * k, f.y + f.h * 0.78, Math.max(2, f.w * 0.07), 0, Math.PI * 2);
      c.fill();
    }
  };

  const drawRamp = (o) => {
    const c = ctx;
    const x = laneX(o.lane);
    const za = clipNear(o.wz);
    const zb = o.wz + o.len;
    if (zb <= za) return;
    const hA = o.h * ((za - o.wz) / o.len);
    const l0 = proj(x - 0.9, 0, za), r0 = proj(x + 0.9, 0, za);
    const l1 = proj(x - 0.9, hA, za), r1 = proj(x + 0.9, hA, za);
    const l2 = proj(x - 0.9, o.h, zb), r2 = proj(x + 0.9, o.h, zb);
    const lb = proj(x - 0.9, 0, zb), rb = proj(x + 0.9, 0, zb);
    c.fillStyle = '#b97a45';
    if (x + 0.9 < camX) { c.beginPath(); c.moveTo(r0.x, r0.y); c.lineTo(r1.x, r1.y); c.lineTo(r2.x, r2.y); c.lineTo(rb.x, rb.y); c.fill(); }
    if (x - 0.9 > camX) { c.beginPath(); c.moveTo(l0.x, l0.y); c.lineTo(l1.x, l1.y); c.lineTo(l2.x, l2.y); c.lineTo(lb.x, lb.y); c.fill(); }
    c.fillStyle = '#d9a066';
    quad(l1, r1, r2, l2);
    c.fill();
    c.strokeStyle = 'rgba(138,85,48,.6)';
    c.lineWidth = Math.max(1, l1.s * 0.03);
    for (let k = 0.15; k < 1; k += 0.2) {
      const zz = o.wz + o.len * k;
      if (zz < za) continue;
      const a = proj(x - 0.9, o.h * k, zz), b = proj(x + 0.9, o.h * k, zz);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
  };

  const drawBarrier = (o) => {
    const c = ctx;
    const x = laneX(o.lane);
    const zz = clipNear(o.wz);
    const bottom = o.type === 'high' ? o.bottom : 0.35;
    const topY = o.h;
    for (const px of [x - 0.8, x + 0.8]) {
      const b = proj(px, 0, zz), t = proj(px, topY, zz);
      c.fillStyle = '#7d6a5c';
      const w = Math.max(2, b.s * 0.1);
      c.fillRect(b.x - w / 2, t.y, w, b.y - t.y);
    }
    const a = proj(x - 0.9, topY, zz), b = proj(x + 0.9, bottom, zz);
    const boardTop = a.y;
    const boardH = o.type === 'high' ? b.y - a.y : (b.y - a.y) * 0.55;
    const w = b.x - a.x;
    c.save();
    roundRect(a.x, boardTop, w, boardH, Math.max(2, a.s * 0.06));
    c.clip();
    c.fillStyle = '#fff6e4';
    c.fillRect(a.x, boardTop, w, boardH);
    c.fillStyle = '#e2632f';
    const stripe = Math.max(6, a.s * 0.35);
    for (let i = -2; i < w / stripe + 2; i += 2) {
      c.beginPath();
      c.moveTo(a.x + i * stripe, boardTop + boardH);
      c.lineTo(a.x + (i + 1) * stripe, boardTop + boardH);
      c.lineTo(a.x + (i + 2) * stripe, boardTop);
      c.lineTo(a.x + (i + 1) * stripe, boardTop);
      c.fill();
    }
    c.restore();
  };

  const drawPool = (o, outer, inner, bubbles) => {
    const c = ctx;
    const x = o.wide ? 0 : laneX(o.lane);
    const half = o.wide ? 3.3 : 0.9;
    c.fillStyle = outer;
    if (!groundQuad(x - half, x + half, o.wz, o.wz + o.len)) return;
    c.fill();
    c.fillStyle = inner;
    if (groundQuad(x - half * 0.8, x + half * 0.8, o.wz + 0.3, o.wz + o.len - 0.3, 0.03)) c.fill();
    c.fillStyle = bubbles;
    for (let i = 0; i < (o.wide ? 7 : 3); i++) {
      const k = ((i * 0.37 + g.t * 0.004) % 1);
      const wz = o.wz + 0.3 + (o.len - 0.6) * k;
      if (wz < g.dist + nearZ) continue;
      const p = proj(x + (((i * 1.7) % 2) - 1) * half * 0.6, 0.05, wz);
      c.beginPath();
      c.arc(p.x, p.y - Math.abs(Math.sin(g.t * 0.1 + i)) * 0.08 * p.s, Math.max(1, 0.1 * p.s), 0, Math.PI * 2);
      c.fill();
    }
  };

  const drawIce = (o) => {
    const c = ctx;
    const x = laneX(o.lane);
    c.fillStyle = 'rgba(190,230,255,.75)';
    if (!groundQuad(x - 0.95, x + 0.95, o.wz, o.wz + o.len)) return;
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,.85)';
    c.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const wz = o.wz + 2 + i * 3.5;
      if (wz < g.dist + nearZ) continue;
      const a = proj(x - 0.5 + (i % 2) * 0.4, 0.03, wz), b = proj(x + (i % 2) * 0.4, 0.03, wz + 1.2);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
  };

  const drawPlank = (o) => {
    const c = ctx;
    const x = laneX(o.lane);
    if (o.fallen) {
      c.fillStyle = '#3a2a1f';
      if (groundQuad(x - 0.9, x + 0.9, o.wz, o.wz + o.len)) c.fill();
      return;
    }
    const shakeX = o.timer ? Math.sin(g.t * 2) * 0.04 : 0;
    for (let i = 0; i < 4; i++) {
      c.fillStyle = i % 2 ? '#b97a45' : '#c98a4f';
      const za = o.wz + (o.len / 4) * i, zb = za + o.len / 4 - 0.12;
      if (groundQuad(x - 0.92 + shakeX, x + 0.92 + shakeX, za, zb, 0.06)) c.fill();
    }
    if (o.timer) {
      c.strokeStyle = '#5a3418';
      c.lineWidth = 2;
      const a = proj(x - 0.4, 0.07, Math.max(o.wz + 1, g.dist + nearZ + 0.1)), b = proj(x + 0.3, 0.07, o.wz + o.len - 1);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
  };

  const drawCone = (o) => {
    const c = ctx;
    const b = proj(laneX(o.lane), 0, clipNear(o.wz));
    const hh = o.h * b.s, ww = 0.32 * b.s;
    c.fillStyle = '#ff7a3d';
    c.beginPath();
    c.moveTo(b.x - ww, b.y);
    c.lineTo(b.x + ww, b.y);
    c.lineTo(b.x + ww * 0.18, b.y - hh);
    c.lineTo(b.x - ww * 0.18, b.y - hh);
    c.closePath();
    c.fill();
    c.fillStyle = '#fff6e4';
    c.fillRect(b.x - ww * 0.62, b.y - hh * 0.55, ww * 1.24, hh * 0.14);
    c.fillStyle = '#c95a2a';
    c.fillRect(b.x - ww * 1.25, b.y - hh * 0.07, ww * 2.5, hh * 0.07);
  };

  const drawCrates = (o) => {
    const x = laneX(o.lane);
    drawBox(x - 0.8, x + 0.8, 0, 0.95, o.wz, o.wz + o.len, '#c98a4f');
    const f = drawBox(x - 0.7, x + 0.7, 0.95, o.h, o.wz + 0.1, o.wz + o.len - 0.1, '#d39a5c');
    if (!f || !f.front) return;
    ctx.strokeStyle = 'rgba(138,85,48,.7)';
    ctx.lineWidth = Math.max(1, f.w * 0.04);
    ctx.strokeRect(f.x + f.w * 0.08, f.y + f.h * 0.08, f.w * 0.84, f.h * 0.84);
    ctx.beginPath();
    ctx.moveTo(f.x + f.w * 0.08, f.y + f.h * 0.08);
    ctx.lineTo(f.x + f.w * 0.92, f.y + f.h * 0.92);
    ctx.stroke();
  };

  const drawSentinel = (o) => {
    const x = laneX(o.lane);
    const p = proj(x, 0, clipNear(o.wz));
    drawShadow(x, 0, o.wz, 0.6);
    drawSprite('naiwa_angry', p.x, p.y, o.h * 1.05 * p.s);
    // 头顶一块「禁止通行」小牌子
    const s = proj(x, o.h + 0.35, clipNear(o.wz));
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(3, 0.24 * s.s), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(s.x - 0.15 * s.s, s.y - 0.04 * s.s, 0.3 * s.s, 0.08 * s.s);
  };

  const drawWindmill = (o) => {
    const c = ctx;
    const x = laneX(o.lane);
    const zz = clipNear(o.wz);
    const base = proj(x + 0.95, 0, zz), hub = proj(x, 1.4, zz);
    c.strokeStyle = '#7d6a5c';
    c.lineWidth = Math.max(2, base.s * 0.12);
    c.beginPath(); c.moveTo(base.x, base.y); c.lineTo(hub.x + (base.x - hub.x) * 0.02, hub.y); c.lineTo(hub.x, hub.y); c.stroke();
    for (let i = 0; i < 3; i++) {
      const a = o.phase + (i * Math.PI * 2) / 3;
      const tip = proj(x + Math.cos(a) * 1.25, 1.4 + Math.sin(a) * 1.25, zz);
      c.strokeStyle = i ? '#fff6e4' : '#e2632f';
      c.lineWidth = Math.max(3, hub.s * 0.28);
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(hub.x, hub.y); c.lineTo(tip.x, tip.y); c.stroke();
    }
    c.lineCap = 'butt';
    c.fillStyle = '#ffcf4d';
    c.beginPath();
    c.arc(hub.x, hub.y, Math.max(3, 0.2 * hub.s), 0, Math.PI * 2);
    c.fill();
  };

  const drawFan = (o) => {
    const c = ctx;
    const ex = o.dir > 0 ? -3.9 : 3.9; // 风从这一侧吹向另一侧
    const zz = clipNear(o.wz + o.len * 0.3);
    const f = drawBox(ex - 0.35, ex + 0.35, 0, 1.6, zz, zz + 1.4, '#9aa0a6');
    if (!f) return;
    const hub = proj(ex - o.dir * 0.36, 0.8, zz + 0.7);
    c.strokeStyle = '#5f646a';
    c.lineWidth = Math.max(2, hub.s * 0.08);
    for (let i = 0; i < 4; i++) {
      const a = g.t * 0.5 + (i * Math.PI) / 2;
      c.beginPath();
      c.moveTo(hub.x, hub.y);
      c.lineTo(hub.x + Math.cos(a) * hub.s * 0.12, hub.y + Math.sin(a) * hub.s * 0.55);
      c.stroke();
    }
    // 风：几条横着飘的白线
    c.strokeStyle = 'rgba(255,255,255,.75)';
    c.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const wz = o.wz + ((i * 2.1 + g.t * 0.05) % o.len);
      if (wz < g.dist + nearZ) continue;
      const k = ((g.t * 0.04 + i * 0.3) % 1);
      const x0 = ex - o.dir * (0.5 + k * 6);
      const a = proj(x0, 0.6 + (i % 3) * 0.5, wz), b = proj(x0 - o.dir * 0.9, 0.6 + (i % 3) * 0.5, wz);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
  };

  const drawPortal = (o) => {
    const c = ctx;
    const ring = (lane, alpha) => {
      const p = proj(laneX(lane), 1.0, clipNear(o.wz));
      const rx = 0.8 * p.s, ry = 1.0 * p.s;
      const grad = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, ry);
      grad.addColorStop(0, `rgba(255,255,255,${0.9 * alpha})`);
      grad.addColorStop(0.5, `rgba(197,138,240,${0.6 * alpha})`);
      grad.addColorStop(1, `rgba(120,60,180,${0.15 * alpha})`);
      c.fillStyle = grad;
      c.beginPath();
      c.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = `rgba(155,123,224,${alpha})`;
      c.lineWidth = Math.max(2, p.s * 0.1);
      c.beginPath();
      c.ellipse(p.x, p.y, rx, ry, Math.sin(g.t * 0.05) * 0.2, 0, Math.PI * 2);
      c.stroke();
    };
    ring(o.lane, 1);
    ring(o.to, 0.45); // 出口那条道上淡淡的一圈
  };

  const drawMissile = (o) => {
    const c = ctx;
    const x = laneX(o.lane);
    const p = proj(x, o.y, o.wz);
    // 尾焰（朝远处拖）
    for (let i = 4; i >= 1; i--) {
      const q = proj(x, o.y + Math.sin(g.t * 0.5 + i) * 0.05, o.wz + i * 0.6);
      c.fillStyle = i % 2 ? 'rgba(255,138,91,.55)' : 'rgba(255,207,77,.6)';
      c.beginPath();
      c.arc(q.x, q.y, Math.max(2, (0.5 - i * 0.07) * q.s), 0, Math.PI * 2);
      c.fill();
    }
    drawSprite('naiwa_roll', p.x, p.y + 0.4 * p.s, 0.95 * p.s, { rot: (o.spin || 0) + g.t * 0.25 });
  };

  const drawDrop = (x, y, s, t, seed) => {
    const c = ctx;
    const k = (s * 0.5) / 24;
    if (k < 0.08) return;
    const bob = Math.sin(t * 0.1 + seed) * 3 * k;
    c.save();
    c.translate(x, y + bob);
    c.scale(k, k);
    c.beginPath();
    c.moveTo(0, -13);
    c.bezierCurveTo(7, -4, 10, 2, 10, 5);
    c.arc(0, 5, 10, 0, Math.PI);
    c.bezierCurveTo(-10, 2, -7, -4, 0, -13);
    c.fillStyle = '#fffdf7';
    c.fill();
    c.lineWidth = 2.5;
    c.strokeStyle = '#8fc7ec';
    c.stroke();
    c.fillStyle = 'rgba(143,199,236,.55)';
    c.beginPath();
    c.arc(-3.5, 4, 3, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };

  /** 能量奶：绿瓶盖的小奶瓶；奶蛋碎片：半个蛋壳 */
  const drawPickup = (pu) => {
    const c = ctx;
    const p = proj(pu.x === undefined ? laneX(pu.lane) : pu.x, pu.y + Math.sin(g.t * 0.1 + pu.wz) * 0.1, pu.wz);
    const s = p.s;
    if (s < 4) return;
    c.save();
    c.translate(p.x, p.y);
    if (pu.kind === 'boost') {
      c.rotate(Math.sin(g.t * 0.08 + pu.wz) * 0.2);
      c.fillStyle = 'rgba(123,201,111,.25)';
      c.beginPath(); c.arc(0, 0, 0.5 * s, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fffdf7';
      roundRect(-0.2 * s, -0.25 * s, 0.4 * s, 0.55 * s, 0.1 * s);
      c.fill();
      c.strokeStyle = '#7bc96f';
      c.lineWidth = Math.max(1.5, 0.04 * s);
      c.stroke();
      c.fillStyle = '#7bc96f';
      c.fillRect(-0.12 * s, -0.4 * s, 0.24 * s, 0.16 * s);
      c.fillStyle = '#ffcf4d';
      c.beginPath();
      c.moveTo(0.04 * s, -0.12 * s); c.lineTo(-0.08 * s, 0.06 * s); c.lineTo(0.01 * s, 0.06 * s); c.lineTo(-0.04 * s, 0.22 * s); c.lineTo(0.1 * s, 0.0); c.lineTo(0.01 * s, 0.0);
      c.closePath();
      c.fill();
    } else {
      c.rotate(g.t * 0.05 + pu.wz);
      const col = EGG[g.egg].color;
      c.fillStyle = 'rgba(255,255,255,.5)';
      c.beginPath(); c.arc(0, 0, 0.42 * s, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff6e4';
      c.strokeStyle = col;
      c.lineWidth = Math.max(1.5, 0.05 * s);
      c.beginPath();
      c.moveTo(-0.28 * s, 0);
      c.quadraticCurveTo(-0.28 * s, 0.32 * s, 0, 0.32 * s);
      c.quadraticCurveTo(0.28 * s, 0.32 * s, 0.28 * s, 0);
      for (let i = 0; i <= 4; i++) c.lineTo(0.28 * s - i * 0.14 * s, i % 2 ? -0.1 * s : 0);
      c.closePath();
      c.fill();
      c.stroke();
    }
    c.restore();
  };

  const drawShadow = (x, y, wz, r) => {
    const p = proj(x, y, wz);
    ctx.fillStyle = 'rgba(90,60,30,.22)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * p.s, r * p.s * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawPlayer = () => {
    const P = g.p;
    const pw = g.power;
    const c = ctx;
    const frog = pw.heavy > 0 && pw.dash <= 0;
    const egg = EGG[g.egg];
    let key = egg.sprite;
    if (pw.dash > 0) key = 'naidan_dash';
    else if (frog) key = 'naiwa_angry';
    else if (g.egg === 'naidan' && g.t % 200 < 8) key = 'naidan_blink';
    const wz = g.dist;
    const hUnits = PLAYER_H * (frog ? 1.4 : 1) * (P.morph > 0 ? 1 + Math.sin(P.morph * 0.6) * 0.12 : 1);
    const sink = P.wade ? 0.35 : P.fall > 0 ? Math.sin((P.fall / 45) * Math.PI) * 1.1 : 0;
    const foot = proj(P.x, P.y - sink, wz);
    const hPx = hUnits * foot.s;
    let sxk = 1, syk = 1, rot = 0, bob = 0;
    let pose = null;
    let runStep = null;
    const rolling = P.roll > 0;
    if (phase === 'dead') {
      rot = Math.min(1, g.deathT / 20) * 1.4;
    } else if (rolling) {
      sxk = 1.15; syk = 0.55; rot = Math.sin(g.t * 0.6) * 0.2;
    } else if (P.onGround || pw.float > 0) {
      bob = -Math.abs(Math.sin(g.t * 0.21)) * hPx * 0.05;
      rot = Math.sin(g.t * 0.16) * 0.06;
      if (P.land > 0) { syk = 1 - P.land * 0.025; sxk = 1 + P.land * 0.02; }
      runStep = g.t * (P.wade ? 0.7 : 0.42);
      pose = 'run';
    } else if (pw.dash > 0) {
      rot = 0.25;
      pose = 'tuck';
    } else {
      // 跳起来的五种动作：前空翻 / 侧翻 / 转体 / 大字 / 抱膝
      const f = clamp(P.airT / Math.max(1, P.airTotal), 0, 1);
      const turn = f * Math.PI * 2;
      pose = 'tuck';
      switch (P.jumpStyle) {
        case 'flip': syk = Math.cos(turn); if (Math.abs(syk) < 0.15) syk = 0.15 * Math.sign(syk || 1); break;
        case 'spin': rot = turn * (P.spinDir || 1); break;
        case 'twist': sxk = Math.cos(turn); if (Math.abs(sxk) < 0.12) sxk = 0.12 * Math.sign(sxk || 1); break;
        case 'star': sxk = 1.12; syk = 0.94; pose = 'star'; rot = Math.sin(turn) * 0.15; break;
        default: sxk = 0.9; syk = 0.86; rot = Math.sin(turn) * 0.3; break;
      }
    }
    rot += (laneX(P.lane) - P.x) * -0.08;
    let floor = 0;
    for (const o of g.obstacles) {
      if (o.dead || Math.abs(P.x - laneX(o.lane)) > 0.95 || o.wz > wz || o.wz + o.len < wz) continue;
      if (o.type === 'train' && P.y >= o.h - 0.4) floor = Math.max(floor, o.h);
      if (o.type === 'ramp') floor = Math.max(floor, o.h * clamp((wz - o.wz) / o.len, 0, 1));
    }
    if (phase !== 'dead' && !P.wade) drawShadow(P.x, floor, wz, 0.55 * (frog ? 1.3 : 1) * (1 - clamp((P.y - floor) / 5, 0, 0.6)));
    if (pw.dash > 0 || pw.rush > 0) {
      for (let i = 1; i <= 3; i++) {
        const tp = proj(P.x, P.y - i * 0.05, wz - i * 0.8);
        drawSprite(key, tp.x, tp.y, hUnits * tp.s, { alpha: 0.2 - i * 0.05 });
      }
    }
    if (pw.float > 0) {
      // 脚下一团奶泡
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + g.t * 0.05;
        const q = proj(P.x + Math.cos(a) * 0.55, P.y - 0.15 + Math.sin(a * 2) * 0.06, wz + Math.sin(a) * 0.4);
        c.fillStyle = 'rgba(255,255,255,.85)';
        c.strokeStyle = 'rgba(95,184,232,.7)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(q.x, q.y, 0.22 * q.s, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
    }
    if (pw.milk > 0) {
      c.strokeStyle = `rgba(95,184,232,${0.25 + Math.sin(g.t * 0.2) * 0.1})`;
      c.lineWidth = 3;
      c.beginPath();
      c.ellipse(foot.x, foot.y - hPx * 0.45, hPx * 0.75, hPx * 0.62, 0, 0, Math.PI * 2);
      c.stroke();
    }
    const alpha = P.invuln > 0 && pw.auto <= 0 && Math.floor(P.invuln / 4) % 2 ? 0.45 : 1;
    if (P.wade) {
      c.save();
      c.beginPath();
      c.rect(0, 0, viewW, foot.y - 0.05 * foot.s); // 下半截泡在牛奶里
      c.clip();
    }
    drawRunner(key, foot.x, foot.y + bob, hPx, { sx: sxk, sy: syk, rot, alpha }, runStep, pose);
    if (P.wade) {
      c.restore();
      c.fillStyle = 'rgba(255,253,245,.9)';
      c.beginPath();
      c.ellipse(foot.x, foot.y, 0.7 * foot.s, 0.16 * foot.s, 0, 0, Math.PI * 2);
      c.fill();
    }
    if (pw.shield) {
      c.strokeStyle = 'rgba(155,123,224,.65)';
      c.fillStyle = 'rgba(155,123,224,.12)';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(foot.x, foot.y - hPx * 0.5, hPx * 0.62, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    if (pw.auto > 0) {
      c.strokeStyle = 'rgba(232,106,166,.8)';
      c.lineWidth = 2;
      const r = hPx * 0.7;
      c.beginPath();
      c.arc(foot.x, foot.y - hPx * 0.5, r, g.t * 0.1, g.t * 0.1 + Math.PI * 1.5);
      c.stroke();
    }
    if (pw.x2 > 0) {
      c.font = `900 ${Math.round(hPx * 0.22)}px system-ui, sans-serif`;
      c.fillStyle = '#f2b84b';
      c.textAlign = 'center';
      c.fillText('×2', foot.x + hPx * 0.42, foot.y - hPx * 0.95);
      c.textAlign = 'left';
    }
  };

  const drawChaser = () => {
    // 一直看得见、跟着你换道：离得远 = 贴着镜头、只露个脑袋；越追越近就跑到奶蛋身边
    const BOSS_H = 2.3;
    const dNear = -camZ - 1.0;
    const dFar = clamp(((camY - BOSS_H) * focal) / Math.max(40, viewH - 150 - horizon), 1.2, dNear - 0.5);
    // 画面上的远近跟真实米数走：20 米开外只露个头，越近越贴上来
    const near = 1 - Math.pow(clamp(g.chaseDist / 20, 0, 1), 0.8);
    const wz = g.dist + camZ + dFar + (dNear - dFar) * near;
    const x = g.chaseX + g.chaseSide;
    const p = proj(x, 0, wz);
    const key = darkOf(phase === 'dead' ? 'boss_laugh' : 'boss_idle');
    const h = BOSS_H * p.s;
    const aura = ctx.createRadialGradient(p.x, p.y - h * 0.5, h * 0.1, p.x, p.y - h * 0.5, h * 0.75);
    aura.addColorStop(0, 'rgba(160,40,200,.35)');
    aura.addColorStop(1, 'rgba(160,40,200,0)');
    ctx.fillStyle = aura;
    ctx.fillRect(p.x - h, p.y - h * 1.3, h * 2, h * 1.6);
    const stunned = g.power.stun > 0;
    drawRunner(key, p.x, p.y + Math.abs(Math.sin(g.t * 0.2)) * -8, h, { rot: stunned ? Math.sin(g.t * 0.1) * 0.15 : Math.sin(g.t * 0.2) * 0.05 }, phase === 'dead' ? null : g.t * (stunned ? 0.15 : 0.4));
    if (stunned) {
      ctx.fillStyle = '#ffcf4d';
      ctx.font = `${Math.round(h * 0.12)}px system-ui, sans-serif`;
      for (let i = 0; i < 3; i++) {
        const a = g.t * 0.1 + (i * Math.PI * 2) / 3;
        ctx.fillText('★', p.x + Math.cos(a) * h * 0.25 - h * 0.05, p.y - h * 1.02 + Math.sin(a) * h * 0.06);
      }
    }
    if (g.boomerang > 0) {
      // 回旋镖：从奶蛋飞向奶皇
      const k = 1 - g.boomerang / 40;
      const from = proj(g.p.x, 1, g.dist);
      const bx = from.x + (p.x - from.x) * k, by = from.y + (p.y - h * 0.6 - from.y) * k - Math.sin(k * Math.PI) * 60;
      drawSprite('naidan_back', bx, by + 20, 40, { rot: g.t * 0.6 });
    }
  };

  const drawPaw = () => {
    const pw2 = g.paw;
    if (!pw2) return;
    const c = ctx;
    const x = laneX(pw2.lane);
    const wz = g.dist + 2.5;
    // 地上的影子：越接近落下越实
    const warnK = pw2.state === 'warn' ? clamp(1 - pw2.t / 75, 0, 1) : 1;
    const sh = proj(x, 0.02, wz);
    c.fillStyle = `rgba(60,20,80,${0.15 + warnK * 0.35})`;
    c.beginPath();
    c.ellipse(sh.x, sh.y, 1.2 * sh.s * (0.6 + warnK * 0.4), 0.35 * sh.s, 0, 0, Math.PI * 2);
    c.fill();
    if (pw2.state === 'warn' && g.t % 16 < 8) {
      c.strokeStyle = '#ff4d6d';
      c.lineWidth = 3;
      c.stroke();
    }
    // 巨掌（画出来的：掌心 + 四根手指 + 灰爪）
    const p = proj(x, pw2.y, wz);
    const u = p.s;
    c.save();
    c.translate(p.x, p.y);
    c.fillStyle = '#4a2a5e';
    c.beginPath();
    c.ellipse(0, -0.3 * u, 0.85 * u, 0.6 * u, 0, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < 4; i++) {
      const fx = (-0.6 + i * 0.4) * u;
      c.fillStyle = '#4a2a5e';
      c.beginPath();
      c.ellipse(fx, 0.15 * u, 0.17 * u, 0.32 * u, (i - 1.5) * 0.15, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#8c8f96';
      c.beginPath();
      c.ellipse(fx, 0.42 * u, 0.09 * u, 0.12 * u, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  };

  /** 导弹预警：那条道上闪红、远处一个「！」 */
  const drawWarnings = () => {
    const c = ctx;
    for (const w of g.warnings) {
      if (g.t % 14 > 8) continue;
      const x = laneX(w.lane);
      c.fillStyle = 'rgba(255,77,109,.22)';
      if (groundQuad(x - 0.95, x + 0.95, g.dist + 2, g.dist + 60, 0.04)) c.fill();
      const p = proj(x, w.low ? 1.2 : 2.2, g.dist + 30);
      const r = Math.max(10, 0.45 * p.s);
      c.fillStyle = '#ff4d6d';
      c.beginPath();
      c.moveTo(p.x, p.y - r);
      c.lineTo(p.x + r * 0.95, p.y + r * 0.7);
      c.lineTo(p.x - r * 0.95, p.y + r * 0.7);
      c.closePath();
      c.fill();
      c.fillStyle = '#fff';
      c.font = `900 ${Math.round(r)}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.fillText('!', p.x, p.y + r * 0.5);
      c.textAlign = 'left';
    }
  };

  /**
   * 追逐条：右边是你、左边是暗黑奶皇，奶皇的位置 = 真实距离（0~40 米）。
   * 下面一行写「拉开 / 逼近 多少米每秒」，减速、能量奶的效果一眼就看得出来。
   */
  const drawChaseBar = (c, font) => {
    const small = viewW < 700; // 竖屏：画布会被缩小，字放大一点
    const bw = Math.min(small ? 500 : 340, viewW - 30), bh = small ? 60 : 50;
    const bx = viewW / 2 - bw / 2, by = 98;
    const d = Math.max(0, g.chaseDist);
    const danger = 1 - clamp(d / 15, 0, 1);
    c.fillStyle = 'rgba(40,20,50,.78)';
    roundRect(bx, by, bw, bh, 16);
    c.fill();
    if (danger > 0.5 && g.t % 20 < 10) {
      c.strokeStyle = '#ff4d6d';
      c.lineWidth = 3;
      c.stroke();
    }
    // 轨道：左端 = 40 米，右端 = 你
    const tx0 = bx + 26, tx1 = bx + bw - 26, ty = by + 17;
    c.strokeStyle = 'rgba(255,255,255,.25)';
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(tx0, ty); c.lineTo(tx1, ty); c.stroke();
    c.lineWidth = 1;
    for (let m = 10; m < CHASE_MAX; m += 10) {
      const x = tx1 - (m / CHASE_MAX) * (tx1 - tx0);
      c.beginPath(); c.moveTo(x, ty - 5); c.lineTo(x, ty + 5); c.stroke();
    }
    const cx = tx1 - (Math.min(d, CHASE_MAX) / CHASE_MAX) * (tx1 - tx0);
    // 奶皇和你之间那一段：越近越红
    c.strokeStyle = danger > 0.5 ? '#ff4d6d' : danger > 0 ? '#ff9a5b' : '#b04ad0';
    c.lineWidth = 4;
    c.beginPath(); c.moveTo(cx, ty); c.lineTo(tx1, ty); c.stroke();
    c.lineCap = 'butt';
    drawSprite(darkOf('boss_idle'), cx, ty + 14, 30);
    drawSprite(EGG[g.egg].sprite, tx1, ty + 13, 26);
    // 文字：距离 + 趋势
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.font = font(800, small ? 18 : 13);
    c.fillStyle = danger > 0.5 ? '#ff8fa3' : '#fff';
    const r = g.chaseRate;
    const trend = g.power.stun > 0 ? '奶皇晕了' : Math.abs(r) < 0.15 ? '僵持' : r > 0 ? `▲ 拉开 ${r.toFixed(1)} 米/秒` : `▼ 逼近 ${(-r).toFixed(1)} 米/秒`;
    c.fillText(`奶皇距离 ${d.toFixed(1)} 米`, bx + bw * 0.32, by + (small ? 35 : 31));
    c.fillStyle = g.power.stun > 0 ? '#ffcf4d' : r >= 0.15 ? '#8fe08a' : r <= -0.15 ? '#ff8fa3' : '#ddd';
    c.fillText(trend, bx + bw * 0.74, by + (small ? 35 : 31));
    // 飘字
    c.font = font(900, small ? 24 : 18);
    for (const dl of g.deltas) {
      const k = 1 - dl.t / 60;
      c.globalAlpha = Math.min(1, dl.t / 15);
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(40,20,50,.8)';
      c.strokeText(dl.text, cx, by + bh + 4 + k * 18);
      c.fillStyle = dl.good ? '#7bd36f' : '#ff4d6d';
      c.fillText(dl.text, cx, by + bh + 4 + k * 18);
    }
    c.globalAlpha = 1;
    c.textAlign = 'left';
  };

  const drawHud = () => {
    const c = ctx;
    const font = (w, px) => `${w} ${px}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
    c.save();
    c.textBaseline = 'top';
    c.fillStyle = 'rgba(255,246,228,.88)';
    roundRect(16, 14, 230, 76, 18);
    c.fill();
    c.font = font(800, 30);
    c.fillStyle = '#e2632f';
    c.fillText(`${meters()} 米`, 32, 22);
    c.font = font(700, 16);
    c.fillStyle = '#6b5444';
    c.fillText(`奶滴 ${g.coinCount}   得分 ${score()}`, 32, 62);
    let y = viewW < 700 ? 170 : 160;
    for (const [k, def] of Object.entries(TIMED)) {
      const left = g.power[k];
      if (left <= 0) continue;
      c.fillStyle = 'rgba(255,246,228,.88)';
      roundRect(16, y, 230, 24, 12);
      c.fill();
      c.fillStyle = def.color;
      roundRect(18, y + 2, 226 * clamp(left / def.frames, 0, 1), 20, 10);
      c.fill();
      c.fillStyle = '#4a3527';
      c.font = font(700, 12);
      c.fillText(def.name, 28, y + 6);
      y += 28;
    }
    if (g.power.shield) {
      c.fillStyle = 'rgba(255,246,228,.88)';
      roundRect(16, y, 120, 24, 12);
      c.fill();
      c.fillStyle = '#9b7be0';
      c.font = font(700, 12);
      c.fillText('🛡 分身护盾', 28, y + 6);
    }
    if (phase === 'run' || phase === 'dead') drawChaseBar(c, font);
    if (g.toast) {
      const a = Math.min(1, g.toast.t / 20);
      c.globalAlpha = a;
      c.font = font(800, viewW < 700 ? 22 : 26);
      c.textAlign = 'center';
      c.lineWidth = 6;
      c.strokeStyle = '#fff6e4';
      const ty = (viewW < 700 ? 230 : 172) - (1 - a) * 10;
      c.strokeText(g.toast.text, viewW / 2, ty);
      c.fillStyle = g.toast.color;
      c.fillText(g.toast.text, viewW / 2, ty);
    }
    c.restore();
    if (g.flash > 0) {
      c.fillStyle = `rgba(255,250,235,${g.flash / 14})`;
      c.fillRect(0, 0, viewW, viewH);
    }
  };

  /** 技能键：图标 + 充能环 */
  let skillShown = '';
  const syncSkillButton = () => {
    if (!el) return;
    const show = phase === 'run';
    const egg = EGG[g.egg];
    const p = Math.round(g.meter);
    const stateKey = `${show}|${g.egg}|${p}`;
    if (stateKey === skillShown) return;
    skillShown = stateKey;
    el.skill.classList.toggle('hide', !show);
    el.skill.classList.toggle('ready', p >= SKILL_FULL);
    el.skill.style.setProperty('--p', p);
    el.skill.style.setProperty('--c', egg.color);
    const img = el.skill.querySelector('img');
    const src = assetUrl(egg.sprite);
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    el.skill.querySelector('span').textContent = p >= SKILL_FULL ? `${egg.skill}（E）` : `${egg.skill} ${p}%`;
  };

  const render = () => {
    const c = ctx;
    camX += (g.p.x * 0.55 - camX) * 0.2;
    c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    c.save();
    if (g.shake) c.translate(rand(-g.shake, g.shake) * 0.5, rand(-g.shake, g.shake) * 0.5);
    drawBackground();
    drawTrack();
    drawWarnings();

    // 远的先画、近的后画；奶蛋自己按 z = dist 插进去
    const list = [];
    // 奶蛋正踩在上面的斜坡/车厢要排在它前面画，不然车头会盖住它的脚（"穿模"）
    const P = g.p;
    const under = (o) => {
      if (o.wz > g.dist + 0.4 || o.wz + o.len < g.dist - 0.4 || Math.abs(P.x - laneX(o.lane)) > 1.3) return false;
      if (o.type === 'ramp') return P.y >= o.h * clamp((g.dist - o.wz) / o.len, 0, 1) - 0.5;
      if (o.type === 'train') return P.y >= o.h - 0.5;
      return false;
    };
    const FLAT = new Set(['puddle', 'candy', 'river', 'ice', 'plank', 'fan', 'marker']);
    for (const o of g.obstacles) {
      if ((o.dead && o.type !== 'plank') || o.wz >= g.dist + FAR || o.wz + o.len <= g.dist + nearZ) continue;
      list.push({ z: FLAT.has(o.type) ? o.wz + o.len + 100 : under(o) ? g.dist + 0.01 : clipNear(o.wz), o });
    }
    for (const cn of g.coins) if (cn.wz > g.dist + nearZ && cn.wz < g.dist + FAR) list.push({ z: cn.wz, coin: cn });
    for (const pu of g.pickups) if (pu.wz > g.dist + nearZ && pu.wz < g.dist + FAR) list.push({ z: pu.wz, pickup: pu });
    for (const it of g.items) if (it.wz > g.dist + nearZ && it.wz < g.dist + FAR) list.push({ z: it.wz, item: it });
    for (const d of g.debris) if (d.wz > g.dist + nearZ) list.push({ z: d.wz, debris: d });
    list.push({ z: g.dist, player: true });
    list.sort((a, b) => b.z - a.z || (a.player ? 1 : -1));

    for (const e of list) {
      if (e.player) { drawPlayer(); continue; }
      if (e.o) {
        const o = e.o;
        switch (o.type) {
          case 'train': drawTrain(o); break;
          case 'ramp': drawRamp(o); break;
          case 'frog': {
            const p = proj(laneX(o.lane), 0, o.wz);
            const hop = Math.abs(Math.sin(g.t * 0.14 + o.lane)) * 0.15;
            drawShadow(laneX(o.lane), 0, o.wz, 0.45);
            drawSprite('naiwa_angry', p.x, p.y - hop * p.s, 1.05 * p.s);
            break;
          }
          case 'puddle': drawPool(o, '#f3d9a6', '#fff3d6', 'rgba(255,255,255,.9)'); break;
          case 'candy': drawPool(o, '#b0703a', '#d9915a', 'rgba(255,220,180,.8)'); break;
          case 'river': drawPool(o, '#e8f2fb', '#fffdf7', 'rgba(143,199,236,.8)'); break;
          case 'ice': drawIce(o); break;
          case 'plank': drawPlank(o); break;
          case 'cone': drawCone(o); break;
          case 'crates': drawCrates(o); break;
          case 'sentinel': drawSentinel(o); break;
          case 'windmill': drawWindmill(o); break;
          case 'fan': drawFan(o); break;
          case 'portal': drawPortal(o); break;
          case 'missile': drawMissile(o); break;
          case 'marker': break;
          default: drawBarrier(o);
        }
      } else if (e.coin) {
        const cn = e.coin;
        const p = proj(cn.x === undefined ? laneX(cn.lane) : cn.x, cn.y, cn.wz);
        drawDrop(p.x, p.y, p.s, g.t, cn.wz);
      } else if (e.pickup) {
        drawPickup(e.pickup);
      } else if (e.item) {
        const it = e.item;
        const def = POWERS[it.type];
        const y = 1.2 + Math.sin(g.t * 0.08 + it.wz) * 0.15;
        const p = proj(laneX(it.lane), y, it.wz);
        const r = 0.7 * p.s;
        c.fillStyle = 'rgba(255,255,255,.55)';
        c.strokeStyle = def.color;
        c.lineWidth = Math.max(2, r * 0.1);
        c.beginPath();
        c.arc(p.x, p.y, r, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        if (def.icon) drawSprite(def.icon, p.x, p.y + r * 0.78, r * 1.55);
        else {
          c.font = `900 ${Math.round(r * 0.95)}px system-ui, sans-serif`;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillStyle = def.color;
          c.fillText(def.emoji, p.x, p.y + r * 0.05);
          c.textAlign = 'left';
          c.textBaseline = 'alphabetic';
        }
      } else if (e.debris) {
        const d = e.debris;
        const p = proj(d.x, d.y, d.wz);
        if (d.kind === 'squash') {
          drawSprite('naiwa_happy', p.x, p.y, 1.05 * p.s, { sx: 1.3, sy: 0.35, alpha: Math.min(1, d.life / 10) });
        } else if (d.kind === 'frog') {
          drawSprite('naiwa_happy', p.x, p.y, 1.05 * p.s, { rot: d.rot });
        } else {
          c.save();
          c.translate(p.x, p.y);
          c.rotate(d.rot);
          c.fillStyle = d.kind === 'train' || d.kind === 'ramp' || d.kind === 'crates' ? '#f2a65a' : '#e2632f';
          const s = 0.5 * p.s;
          c.fillRect(-s / 2, -s / 2, s, s);
          c.restore();
        }
      }
    }
    drawPaw();
    drawChaser();
    for (const f of g.fx) {
      const p = proj(f.x, f.y, f.wz);
      c.globalAlpha = Math.max(0, f.life);
      c.fillStyle = f.color;
      c.beginPath();
      c.arc(p.x, p.y, Math.max(1, f.r * p.s * (0.5 + f.life * 0.5)), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    c.restore();
    drawHud();
    syncSkillButton();
  };

  // ---------------------------------------------------------------- 循环 / 尺寸
  const fit = () => {
    const aspect = window.innerWidth / window.innerHeight;
    if (aspect >= 1.2) {
      // 横屏：固定 540 高，宽度跟着屏幕拉
      viewH = H;
      viewW = clamp(Math.round(aspect * H), VIEW_MIN, VIEW_MAX);
      focal = 520;
      horizon = 150;
      camY = 3.2;
      camZ = -5.5;
    } else {
      // 竖屏（手机）：固定 540 宽，往下长；焦距收一点让三条道刚好铺满宽度
      viewW = H;
      viewH = clamp(Math.round(H / aspect), H, 1200);
      focal = 400;
      camY = 3.6;
      camZ = -4.2;
      horizon = Math.round(viewH * 0.36);
    }
    nearZ = camZ + 0.9;
    scale = Math.min(window.innerWidth / viewW, window.innerHeight / viewH);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    el.canvas.width = Math.round(viewW * scale * dpr);
    el.canvas.height = Math.round(viewH * scale * dpr);
    el.canvas.style.width = `${Math.round(viewW * scale)}px`;
    el.canvas.style.height = `${Math.round(viewH * scale)}px`;
    if (g) render();
  };

  const frame = (t) => {
    if (!active) return;
    const dt = Math.min(64, t - last);
    last = t;
    if (phase === 'run' || phase === 'dead') {
      acc += dt;
      let guard = 0;
      while (acc >= STEP && guard++ < 5) {
        try { step(); } catch (e) { console.error(e); }
        acc -= STEP;
      }
    } else {
      acc = 0;
    }
    // 画面出了错也别把整个循环卡死：这一帧跳过，下一帧接着跑
    try { render(); } catch (e) { console.error(e); }
    raf = requestAnimationFrame(frame);
  };

  // ---------------------------------------------------------------- 面板
  const showPanel = (html, primary) => {
    el.panel.innerHTML = html;
    el.wrap.classList.remove('hide');
    panelPrimary = primary;
    el.panel.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => ACTIONS[b.dataset.act](b));
    });
  };
  const hidePanel = () => {
    el.wrap.classList.add('hide');
    panelPrimary = null;
  };

  const KEYS_HTML = `
    <details>
      <summary>操作和规则</summary>
      <div class="keys">
        <b>换道</b><span>← → / A D（手机左右滑）</span>
        <b>跳</b><span>↑ / W / 空格（手机上滑或点一下）</span>
        <b>翻滚</b><span>↓ / S（手机下滑；空中按 = 急降）</span>
        <b>技能</b><span>E / 右下角技能键（捡奶蛋碎片充能）</span>
        <b>暗黑奶皇</b><span>一直在后面追、越追越快；减速和侧蹭都会被追近，捡能量奶才能甩开</span>
        <b>新障碍</b><span>第一次出现时会单独教你怎么过</span>
      </div>
    </details>`;

  const showReady = () => {
    phase = 'ready';
    const best = loadBest();
    const egg = EGG[eggKey];
    showPanel(`
      <h2>奶龙快跑</h2>
      <div class="tabs"><button class="${mode === 'free' ? '' : 'ghost'}" data-act="modeFree">自由跑</button><button class="${mode === 'daily' ? '' : 'ghost'}" data-act="modeDaily">每日赛道 ${todayKey() % 10000}</button></div>
      <div class="eggs">${EGGS.map((e) => `<button class="egg ${e.key === eggKey ? 'on' : ''}" data-act="egg" data-egg="${e.key}"><img src="${assetUrl(e.sprite)}" alt="" /><b>${e.name}</b>${e.skill}</button>`).join('')}</div>
      <p class="eggTip"><b>${egg.name}·${egg.skill}</b>：${egg.tip}</p>
      ${KEYS_HTML}
      ${best ? `<p style="margin:4px 0">最高分 <b>${best}</b></p>` : ''}
      <div class="row" style="margin-top:10px"><button data-act="start">开跑！</button><button class="ghost" data-act="board">排行榜</button><button class="ghost" data-act="menu">回主菜单</button></div>`, 'start');
  };

  const showPause = () => {
    if (phase !== 'run') return;
    phase = 'pause';
    showPanel(`
      <h2>暂停中</h2>
      <p>已经跑了 ${meters()} 米</p>
      <div class="row"><button data-act="resume">继续</button><button class="ghost" data-act="restart">重新开始</button><button class="ghost" data-act="menu">回主菜单</button></div>`, 'resume');
  };

  const showDead = () => {
    const s = score();
    if (!g.result) {
      const best = loadBest();
      g.result = { record: s > best, best: Math.max(best, s) };
      if (g.result.record) { store.set(BEST_KEY, s); sfx('win'); }
    }
    const canSubmit = s > 0 && !g.submitted;
    showPanel(`
      <h2>${esc(g.deathReason)}</h2>
      <p class="big">${s} 分</p>
      ${g.result.record ? '<p class="rec">新纪录！</p>' : `<p>最高分 ${g.result.best}</p>`}
      ${g.track !== 'free' ? `<p style="margin:2px 0;font-size:13px">每日赛道 ${todayKey()}</p>` : ''}
      <div class="stats">
        <div><b>${meters()}</b>米</div><div><b>${g.coinCount}</b>奶滴</div><div><b>${g.boosts}</b>能量奶</div><div><b>${g.stomps}</b>踩扁</div><div><b>${g.smashes}</b>撞碎</div>
      </div>
      ${canSubmit ? `<div class="submit"><input id="runName" maxlength="12" placeholder="填个昵称上榜" autocomplete="off" value="${esc(store.get(NAME_KEY))}" /><button data-act="submit">上传成绩</button></div>` : ''}
      <p class="msg" id="runMsg">${g.submitted ? esc(g.submitted) : ''}</p>
      <div class="row"><button data-act="restart">再跑一次</button><button class="ghost" data-act="ready">换奶蛋</button><button class="ghost" data-act="board">排行榜</button><button class="ghost" data-act="menu">回主菜单</button></div>`, 'restart');
  };

  // ---------------------------------------------------------------- 排行榜（Supabase，免登录，填昵称就能上榜）
  // 表结构见 supabase/run_scores.sql；表还没建好时只显示"排行榜还没开通"，不影响游戏。
  const SUPABASE_REST = 'https://buueozmrxfjqcaiqyzhq.supabase.co/rest/v1';
  const SUPABASE_KEY = 'sb_publishable_dN25ruwymHdivLup377eLg_9WTi1cOt';
  const NAME_KEY = 'naidan-run-name-v1';
  /** 本周一 0 点（北京时间）对应的 ISO 时间 */
  const weekStart = () => {
    const bj = new Date(Date.now() + 8 * 3600e3);
    const day = (bj.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate() - day) - 8 * 3600e3).toISOString();
  };
  const rest = async (path, opts = {}) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      return await fetch(`${SUPABASE_REST}${path}`, {
        ...opts,
        signal: ctrl.signal,
        cache: 'no-store',
        headers: { apikey: SUPABASE_KEY, Accept: 'application/json', ...(opts.headers || {}) },
      });
    } finally {
      clearTimeout(timer);
    }
  };
  const fetchBoard = async (kind) => {
    let path = '/run_scores?select=name,score,meters&order=score.desc&limit=300';
    if (kind === 'week') path += `&created_at=gte.${encodeURIComponent(weekStart())}`;
    if (kind === 'daily') path += `&track=eq.daily-${todayKey()}`;
    try {
      const res = await rest(path);
      if (res.status === 404) return { missing: true };
      if (!res.ok) return { error: true };
      const rows = await res.json();
      const seen = new Set();
      const list = [];
      for (const r of rows) {
        if (seen.has(r.name)) continue;
        seen.add(r.name);
        list.push(r);
        if (list.length >= 50) break;
      }
      return { list };
    } catch (e) {
      return { error: true };
    }
  };
  const submitScore = async (name) => {
    try {
      const res = await rest('/run_scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ name, score: score(), meters: meters(), coins: g.coinCount, track: g.track }),
      });
      if (res.ok) return { ok: true };
      if (res.status === 404) return { error: '排行榜还没开通（等作者在 Supabase 建表）' };
      const text = await res.text();
      return { error: /违禁|广告/.test(text) ? '昵称包含违禁词或联系方式' : '上传失败，稍后再试' };
    } catch (e) {
      return { error: '连不上排行榜，稍后再试' };
    }
  };

  let boardFrom = 'ready';
  let boardKind = 'all';
  const showBoard = async (kind = boardKind) => {
    if (phase === 'ready' || phase === 'dead') boardFrom = phase;
    boardKind = kind;
    phase = 'board';
    const tab = (k, label, act) => `<button class="${kind === k ? '' : 'ghost'}" data-act="${act}">${label}</button>`;
    const head = `
      <h2>奶龙快跑排行榜</h2>
      <div class="tabs">${tab('all', '总榜', 'boardAll')}${tab('week', '本周', 'boardWeek')}${tab('daily', '今日赛道', 'boardDaily')}</div>`;
    const foot = '<div class="row"><button class="ghost" data-act="boardBack">返回</button></div>';
    showPanel(`${head}<div id="runBoard"><p>加载中…</p></div>${foot}`, 'boardBack');
    const res = await fetchBoard(kind);
    if (phase !== 'board' || boardKind !== kind) return; // 等的时候已经切走了
    const box = document.getElementById('runBoard');
    if (!box) return;
    if (res.missing) { box.innerHTML = '<p>排行榜还没开通，等作者建好表就能用啦</p>'; return; }
    if (res.error) { box.innerHTML = '<p>连不上排行榜，稍后再试</p>'; return; }
    if (!res.list.length) { box.innerHTML = '<p>还没有人上榜，快去跑一把！</p>'; return; }
    const me = store.get(NAME_KEY);
    box.innerHTML = `<ol class="board">${res.list.map((r, i) => `
      <li class="${r.name === me ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="sc">${r.score}</span><span class="mt">${r.meters} 米</span></li>`).join('')}</ol>`;
  };

  const resetGame = () => {
    g = newGame();
    camX = 0;
    generate();
  };

  const ACTIONS = {
    start: () => {
      resetGame();
      hidePanel();
      phase = 'run';
      last = performance.now();
      acc = 0;
      sfx('ready');
    },
    restart: () => ACTIONS.start(),
    ready: () => { resetGame(); showReady(); },
    resume: () => {
      hidePanel();
      phase = 'run';
      last = performance.now();
    },
    menu: () => close(),
    egg: (b) => { eggKey = b.dataset.egg; store.set(EGG_KEY, eggKey); resetGame(); showReady(); },
    modeFree: () => { mode = 'free'; store.set(MODE_KEY, mode); resetGame(); showReady(); },
    modeDaily: () => { mode = 'daily'; store.set(MODE_KEY, mode); resetGame(); showReady(); },
    board: () => showBoard(mode === 'daily' ? 'daily' : 'all'),
    boardAll: () => showBoard('all'),
    boardWeek: () => showBoard('week'),
    boardDaily: () => showBoard('daily'),
    boardBack: () => {
      phase = boardFrom;
      if (boardFrom === 'dead') showDead();
      else showReady();
    },
    submit: async () => {
      const input = document.getElementById('runName');
      const msg = document.getElementById('runMsg');
      const btn = el.panel.querySelector('[data-act="submit"]');
      const name = (input ? input.value : '').trim();
      const say = (t) => { if (msg) msg.textContent = t; };
      if (!name) return say('先填个昵称');
      if (name.length > 12) return say('昵称最多 12 个字');
      const mod = window.WorkshopModeration && window.WorkshopModeration.check(name);
      if (mod && !mod.ok) return say(`昵称${mod.reason}`);
      store.set(NAME_KEY, name);
      if (btn) btn.disabled = true;
      say('上传中…');
      const res = await submitScore(name);
      if (phase !== 'dead') return;
      if (res.ok) {
        g.submitted = `已上传：${name} · ${score()} 分`;
        showDead();
      } else {
        if (btn) btn.disabled = false;
        say(res.error);
      }
    },
  };

  // ---------------------------------------------------------------- 输入
  const act = (action) => {
    if (!active) return;
    sfx('unlock');
    if (phase !== 'run') return;
    if (action === 'left') changeLane(-1);
    else if (action === 'right') changeLane(1);
    else if (action === 'jump') jump();
    else if (action === 'roll') roll();
    else if (action === 'skill') useSkill();
  };

  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
    ArrowDown: 'roll', KeyS: 'roll',
    KeyE: 'skill', ShiftLeft: 'skill', ShiftRight: 'skill',
  };
  const onKeyDown = (e) => {
    if (!active) return;
    // 跑酷开着的时候，弹弓那边的快捷键（空格放技能、Enter 开局、R 重开……）全部截住
    e.stopImmediatePropagation();
    if (e.target && e.target.tagName === 'INPUT') {
      if (e.code === 'Enter') { e.preventDefault(); ACTIONS.submit(); }
      return;
    }
    if (phase !== 'run') {
      if ((e.code === 'Space' || e.code === 'Enter') && panelPrimary) { e.preventDefault(); if (!e.repeat) ACTIONS[panelPrimary](); }
      else if (e.code === 'Escape' && phase === 'pause') ACTIONS.resume();
      return;
    }
    if (KEYMAP[e.code]) { e.preventDefault(); if (!e.repeat) act(KEYMAP[e.code]); }
    else if (e.code === 'KeyP' || e.code === 'Escape') showPause();
  };
  const onKeyUp = (e) => { if (active) e.stopImmediatePropagation(); };

  // 触屏：滑动方向 = 动作，轻点 = 跳
  let swipe = null;
  const bindInput = () => {
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    el.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, done: false };
    });
    el.canvas.addEventListener('pointermove', (e) => {
      if (!swipe || swipe.id !== e.pointerId || swipe.done) return;
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      if (Math.hypot(dx, dy) < 28) return;
      swipe.done = true;
      if (Math.abs(dx) > Math.abs(dy)) act(dx < 0 ? 'left' : 'right');
      else act(dy < 0 ? 'jump' : 'roll');
    });
    const end = (e) => {
      if (swipe && swipe.id === e.pointerId && !swipe.done && e.type === 'pointerup') act('jump');
      swipe = null;
    };
    el.canvas.addEventListener('pointerup', end);
    el.canvas.addEventListener('pointercancel', end);
    el.skill.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); act('skill'); });
    el.back.addEventListener('click', () => close());
    el.pause.addEventListener('click', () => (phase === 'pause' ? ACTIONS.resume() : showPause()));
    el.sound.addEventListener('click', () => {
      if (!window.AudioKit) return;
      syncSoundLabel(window.AudioKit.toggle());
    });
    window.addEventListener('resize', () => active && fit());
    document.addEventListener('visibilitychange', () => { if (document.hidden && active) showPause(); });
  };

  const syncSoundLabel = (muted) => {
    const label = muted ? '🔇' : '🔊';
    el.sound.textContent = label;
    const main = document.getElementById('btnSound');
    if (main) main.textContent = label;
  };

  // ---------------------------------------------------------------- 打开 / 关闭
  const open = () => {
    if (!el) { buildDom(); bindInput(); }
    loadSprites();
    active = true;
    el.root.classList.remove('hide');
    syncSoundLabel(!!(window.AudioKit && window.AudioKit.muted));
    resetGame();
    fit();
    showReady();
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  };
  const close = () => {
    active = false;
    cancelAnimationFrame(raf);
    if (el) el.root.classList.add('hide');
  };

  const hook = () => {
    const btn = document.getElementById('btnRun');
    if (btn) btn.addEventListener('click', open);
    // 直接带 #run 打开：分享出去的链接点开就是跑酷
    if (location.hash === '#run') open();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();

  window.NailongRun = {
    open, close, act,
    state: () => g,
    phase: () => phase,
    /** 自测用：直接塞一个障碍到前方 */
    spawn: (type, lane, ahead = 12, extra = {}) => obstacle(type, lane, g.dist + ahead, extra),
    skill: () => { g.meter = SKILL_FULL; useSkill(); },
    autopilot: (on = true) => { g.power.auto = on ? 1e9 : 0; },
  };
})();
