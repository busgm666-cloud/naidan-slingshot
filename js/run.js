/**
 * 奶龙快跑：横版无尽跑酷。
 * 跟弹弓玩法完全分开：自己的画布、自己的循环、自己的 DOM，只借用 assets/ 里的立绘和 AudioKit 音效。
 * 入口是标题页的「奶龙快跑」按钮；打开时盖在整个页面上，关掉就回到标题页，弹弓那边的状态一点不动。
 *
 * 玩法：奶蛋自动往右跑，越跑越快。
 *   跳（空格 / ↑ / W / 点屏幕）—— 空中还能再跳一次，按得越久跳得越高
 *   滑铲（↓ / S / 屏幕上的「滑铲」按钮）—— 从横梁底下钻过去；空中按下 = 急降
 *   踩奶蛙脑袋 +100，撞到侧面就倒了；掉坑也算倒
 *   路上的泡泡是奶蛋道具：冲刺（无敌飞行）/ 变胖（撞碎障碍）/ 奶泡磁铁（吸奶滴）/ 分身护盾（免死一次）
 */
(() => {
  const H = 540;
  const VIEW_MIN = 960;
  const VIEW_MAX = 1600;
  const GROUND = 452;        // 地面顶部的 y
  const PX = 210;            // 奶蛋在屏幕上的固定 x
  const STEP = 1000 / 60;
  const GRAVITY = 0.9;
  const JUMP_V = -15.5;
  const DOUBLE_V = -13.5;
  const BAR_GAP = 50;        // 横梁离地高度：站着撞头，滑铲钻得过去
  const CRATE = 58;
  const BEST_KEY = 'naidan-run-best-v1';

  const POWERS = {
    dash: { sprite: 'naidan_dash', name: '冲刺', tip: '冲刺！无敌飞过一切', frames: 180, color: '#ff8a5b' },
    heavy: { sprite: 'naidan_heavy', name: '变胖', tip: '变胖！一路撞碎障碍', frames: 360, color: '#d9902f' },
    milk: { sprite: 'naidan_milk', name: '奶泡磁铁', tip: '奶泡磁铁！奶滴自己飞过来', frames: 480, color: '#5fb8e8' },
    split: { sprite: 'naidan_split', name: '分身护盾', tip: '分身护盾！免死一次', frames: 0, color: '#9b7be0' },
  };

  // ---------------------------------------------------------------- 素材 / 工具
  const ASSET_BASE = window.ASSET_BASE || 'assets/';
  const SPRITES = ['naidan_idle', 'naidan_blink', 'naidan_dash', 'naidan_heavy', 'naidan_milk', 'naidan_split', 'naiwa_angry', 'naiwa_happy'];
  const IMG = {};
  const loadSprites = () =>
    SPRITES.forEach((k) => {
      if (IMG[k]) return;
      const im = new Image();
      im.src = (window.INLINE_ASSETS && window.INLINE_ASSETS[k]) || ASSET_BASE + k + '.png';
      IMG[k] = im;
    });
  const sfx = (name, ...args) => {
    try {
      if (window.AudioKit && typeof window.AudioKit[name] === 'function') window.AudioKit[name](...args);
    } catch (e) { /* 音效出错不影响游戏 */ }
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const loadBest = () => {
    try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { return 0; }
  };
  const saveBest = (v) => {
    try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* 隐私模式存不了就算了 */ }
  };

  // ---------------------------------------------------------------- DOM
  const css = `
  #runScreen { position: fixed; inset: 0; z-index: 60; background: #3a2a1f; display: flex; align-items: center; justify-content: center; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; }
  #runScreen canvas { box-shadow: none; border-radius: 0; touch-action: none; }
  #runHud { position: absolute; top: 12px; right: 12px; display: flex; gap: 8px; }
  #runScreen .iconBtn { width: auto; padding: 0 12px; }
  #runPanelWrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(58,42,31,.28); }
  #runPanel .keys { display: grid; grid-template-columns: auto auto; gap: 4px 14px; justify-content: center; text-align: left; font-size: 14px; color: #6b5444; margin: 10px 0; }
  #runPanel .keys b { color: var(--jam-dark); }
  #runPanel .stats { display: flex; gap: 18px; justify-content: center; font-size: 14px; color: #6b5444; }
  #runPanel .stats b { display: block; font-size: 20px; color: var(--ink); }
  #runPanel .rec { color: #e2632f; font-weight: 800; }
  .runTouch { position: absolute; bottom: 18px; width: 92px; height: 92px; border-radius: 50%; padding: 0; font-size: 18px; opacity: .82; display: none; }
  #runSlideBtn { left: 18px; background: #fff; color: var(--jam-dark); box-shadow: 0 6px 0 rgba(74,53,39,.25); }
  #runJumpBtn { right: 18px; }
  @media (pointer: coarse) { .runTouch { display: block; } }
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
      <button class="runTouch" id="runSlideBtn">滑铲</button>
      <button class="runTouch" id="runJumpBtn">跳</button>
      <div id="runPanelWrap"><div class="panel" id="runPanel"></div></div>`;
    document.body.appendChild(root);
    const $ = (id) => document.getElementById(id);
    el = {
      root, canvas: $('runCanvas'), back: $('runBack'), pause: $('runPause'), sound: $('runSound'),
      slideBtn: $('runSlideBtn'), jumpBtn: $('runJumpBtn'), wrap: $('runPanelWrap'), panel: $('runPanel'),
    };
    ctx = el.canvas.getContext('2d');
  };

  // ---------------------------------------------------------------- 状态
  let ctx = null;
  let viewW = VIEW_MIN;
  let scale = 1;
  let dpr = 1;
  let active = false;
  let phase = 'ready'; // ready | run | pause | dead
  let raf = 0;
  let last = 0;
  let acc = 0;
  let g = null;
  let panelPrimary = null;

  const newGame = () => ({
    t: 0,
    dist: 0,
    speed: 6.2,
    coins: 0,
    stomps: 0,
    smashes: 0,
    p: { y: GROUND, vy: 0, onGround: true, jumps: 0, coyote: 0, buffer: 0, slide: 0, holdDown: false, invuln: 0, spin: 0, land: 0, blink: 0 },
    power: { dash: 0, heavy: 0, milk: 0, shield: false },
    grounds: [{ x0: -600, x1: 900 }],
    solids: [],     // 木箱：顶上能站，撞侧面会倒
    platforms: [],  // 空中木板：只能从上面落上去
    bars: [],       // 吊着的横梁：得滑铲
    frogs: [],
    drops: [],
    items: [],
    fx: [],
    debris: [],
    genX: 900,
    nextItem: 2200,
    shake: 0,
    toast: null,
    deathT: 0,
    deathReason: '',
    milestone: 0,
  });

  const meters = () => Math.floor(g.dist / 40);
  const score = () => meters() + g.coins * 10 + g.stomps * 100 + g.smashes * 50;
  const toast = (text, color = '#e2632f') => { g.toast = { text, color, t: 110 }; };

  // ---------------------------------------------------------------- 关卡生成（一段一段往前拼）
  const addGround = (x0, x1) => {
    const lastSeg = g.grounds[g.grounds.length - 1];
    if (lastSeg && lastSeg.x1 >= x0 - 1) lastSeg.x1 = Math.max(lastSeg.x1, x1);
    else g.grounds.push({ x0, x1 });
  };
  const dropLine = (x, y, n, gap = 46) => { for (let i = 0; i < n; i++) g.drops.push({ x: x + i * gap, y }); };
  const dropArc = (x, w, top, n = 6) => {
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      g.drops.push({ x: x + k * w, y: GROUND - 40 - Math.sin(k * Math.PI) * (GROUND - 40 - top) });
    }
  };
  const frog = (x, range = 60) => g.frogs.push({ x, x0: x - range, x1: x + range, dir: -1, w: 50, h: 50, hop: Math.random() * 6 });
  const crate = (x, stack) => {
    for (let i = 0; i < stack; i++) g.solids.push({ x, y: GROUND - CRATE * (i + 1), w: CRATE, h: CRATE });
  };

  const CHUNKS = [
    { w: 3, min: 0, make: (x) => {
      const L = rand(260, 420);
      addGround(x, x + L);
      dropLine(x + 40, GROUND - 40, Math.floor(L / 46) - 1);
      return x + L;
    } },
    { w: 4, min: 0, make: (x) => {
      addGround(x, x + 400);
      frog(x + 260);
      dropArc(x + 190, 150, GROUND - 170, 5);
      return x + 400;
    } },
    { w: 3, min: 0.12, make: (x) => {
      addGround(x, x + 600);
      frog(x + 230, 40);
      frog(x + 460, 40);
      return x + 600;
    } },
    { w: 4, min: 0, make: (x) => {
      const stack = Math.random() < 0.2 + difficulty() * 0.5 ? 2 : 1;
      addGround(x, x + 440);
      crate(x + 240, stack);
      dropLine(x + 240 + 6, GROUND - CRATE * stack - 34, 2);
      return x + 440;
    } },
    { w: 3, min: 0.04, make: (x) => {
      const w = rand(120, 220);
      addGround(x, x + 300 + w);
      g.bars.push({ x: x + 220, w, bottom: GROUND - BAR_GAP });
      dropLine(x + 228, GROUND - 18, Math.max(2, Math.floor(w / 46)));
      return x + 300 + w;
    } },
    { w: 4, min: 0, make: (x) => {
      const pit = rand(90, Math.min(250, g.speed * 22));
      addGround(x, x + 220);
      dropArc(x + 180, pit + 80, GROUND - 160, 5);
      addGround(x + 220 + pit, x + 220 + pit + 160);
      return x + 380 + pit;
    } },
    { w: 2, min: 0.22, make: (x) => {
      const gap = Math.min(200, g.speed * 18);
      addGround(x, x + 200);
      g.platforms.push({ x: x + 200 + gap, y: GROUND - 90, w: 170, h: 18 });
      dropLine(x + 200 + gap + 20, GROUND - 124, 3);
      addGround(x + 370 + gap * 2, x + 540 + gap * 2);
      return x + 540 + gap * 2;
    } },
    { w: 2, min: 0.38, make: (x) => {
      addGround(x, x + 700);
      crate(x + 200, 1);
      g.bars.push({ x: x + 440, w: 150, bottom: GROUND - BAR_GAP });
      dropLine(x + 450, GROUND - 18, 3);
      return x + 700;
    } },
    { w: 2, min: 0.5, make: (x) => {
      const pit = rand(110, Math.min(220, g.speed * 20));
      addGround(x, x + 200);
      addGround(x + 200 + pit, x + 640 + pit);
      frog(x + 420 + pit, 50);
      return x + 640 + pit;
    } },
    { w: 2, min: 0.3, make: (x) => {
      addGround(x, x + 760);
      crate(x + 180, 1);
      crate(x + 180 + CRATE, 2);
      g.platforms.push({ x: x + 360, y: GROUND - 200, w: 200, h: 18 });
      dropLine(x + 380, GROUND - 234, 4);
      frog(x + 620, 40);
      return x + 760;
    } },
  ];

  const difficulty = () => clamp(g.dist / 40 / 1500, 0, 1);

  const generate = () => {
    while (g.genX < g.dist + viewW + 700) {
      if (g.genX >= g.nextItem) {
        // 道具段：一段平地 + 一个泡泡
        const x = g.genX;
        addGround(x, x + 360);
        const keys = Object.keys(POWERS);
        g.items.push({ x: x + 200, y: GROUND - 120, type: keys[(Math.random() * keys.length) | 0] });
        g.genX = x + 360;
        g.nextItem = g.genX + rand(1900, 3200);
        continue;
      }
      const d = difficulty();
      const pool = CHUNKS.filter((c) => c.min <= d);
      let r = Math.random() * pool.reduce((s, c) => s + c.w, 0);
      let chunk = pool[0];
      for (const c of pool) { r -= c.w; if (r <= 0) { chunk = c; break; } }
      g.genX = chunk.make(g.genX);
    }
  };

  // ---------------------------------------------------------------- 玩家
  const playerSize = () => {
    const k = g.power.heavy > 0 ? 1.45 : 1;
    return g.p.slide > 0 && g.p.onGround ? { w: 54 * k, h: 30 * k } : { w: 42 * k, h: 60 * k };
  };
  const playerBox = (y = g.p.y) => {
    const s = playerSize();
    const cx = g.dist + PX;
    return { l: cx - s.w / 2, r: cx + s.w / 2, top: y - s.h, bottom: y };
  };
  const overlaps = (b, x, y, w, h) => b.r > x && b.l < x + w && b.bottom > y && b.top < y + h;
  const supported = (l, r) => g.grounds.some((s) => s.x1 > l && s.x0 < r);

  const tryJump = () => {
    const P = g.p;
    if (g.power.dash > 0) return false;
    if (P.onGround || P.coyote > 0) {
      P.vy = JUMP_V;
      P.jumps = 1;
      sfx('launch');
    } else if (P.jumps < 2) {
      P.vy = DOUBLE_V;
      P.jumps = 2;
      P.spin = 1;
      sfx('dash');
      puff(g.dist + PX, P.y, 6, '#fff6e4');
    } else {
      return false;
    }
    P.onGround = false;
    P.coyote = 0;
    P.slide = 0;
    return true;
  };

  const startSlide = () => {
    const P = g.p;
    P.holdDown = true;
    if (P.onGround) {
      if (P.slide <= 0) sfx('plop');
      P.slide = 40;
    } else if (g.power.dash <= 0) {
      P.vy = Math.max(P.vy, 14); // 空中按下 = 急降
    }
  };

  // ---------------------------------------------------------------- 特效
  const puff = (x, y, n, color) => {
    for (let i = 0; i < n; i++) {
      g.fx.push({ x, y, vx: rand(-2.5, 1), vy: rand(-3, -0.5), r: rand(4, 9), life: 1, decay: rand(0.03, 0.05), color });
    }
  };
  const sparkle = (x, y, color = '#fff') => {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      g.fx.push({ x, y, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, r: 3, life: 1, decay: 0.06, color });
    }
  };
  const smash = (obj, kind) => {
    obj.dead = true;
    g.smashes++;
    g.shake = 10;
    if (kind === 'frog') {
      g.debris.push({ kind: 'frog', x: obj.x, y: GROUND - obj.h, w: obj.w, h: obj.h, vx: rand(8, 12), vy: rand(-14, -10), rot: 0, vr: rand(0.15, 0.3) });
      sfx('pop');
    } else {
      const x = obj.x, y = kind === 'bar' ? obj.bottom - 30 : obj.y;
      const w = obj.w, h = kind === 'bar' ? 30 : obj.h;
      for (let i = 0; i < 4; i++) {
        g.debris.push({ kind, x: x + (i % 2) * w * 0.5, y: y + Math.floor(i / 2) * h * 0.5, w: w * 0.5, h: h * 0.5, vx: rand(6, 13), vy: rand(-12, -4), rot: 0, vr: rand(-0.3, 0.3) });
      }
      sfx(kind === 'bar' ? 'stone' : 'crack');
    }
  };

  const hurt = (obj, kind, reason) => {
    const P = g.p;
    if (g.power.dash > 0 || g.power.heavy > 0) return smash(obj, kind);
    if (P.invuln > 0) return;
    if (g.power.shield) {
      g.power.shield = false;
      P.invuln = 90;
      smash(obj, kind);
      sfx('glass');
      toast('护盾碎了！', '#9b7be0');
      return;
    }
    die(reason);
  };

  const die = (reason) => {
    if (phase !== 'run') return;
    phase = 'dead';
    g.deathReason = reason;
    g.deathT = 0;
    g.shake = 18;
    g.p.vy = -12;
    sfx('lose');
    sfx('laugh');
  };

  const activate = (type) => {
    const def = POWERS[type];
    const pw = g.power;
    if (type === 'split') pw.shield = true;
    else pw[type] = def.frames;
    if (type === 'dash') { g.p.slide = 0; sfx('dash'); } else sfx('levelUp');
    toast(def.tip, def.color);
  };

  // ---------------------------------------------------------------- 每帧逻辑
  const step = () => {
    g.t++;
    const P = g.p;
    const pw = g.power;

    if (phase === 'dead') {
      // 倒下的奶蛋往后飞出画面，世界停住
      g.deathT++;
      P.vy += GRAVITY;
      P.y += P.vy;
      P.spin = (P.spin + 0.05) % 1;
      stepFx();
      if (g.deathT === 70) showDead();
      return;
    }

    const m = g.dist / 40;
    g.speed = (6.2 + 6.8 * (1 - Math.exp(-m / 1100))) * (pw.dash > 0 ? 2 : 1);
    g.dist += g.speed;

    if (Math.floor(m / 500) > g.milestone) {
      g.milestone = Math.floor(m / 500);
      toast(`${g.milestone * 500} 米！越跑越快了`);
      sfx('levelUp');
    }

    // 道具计时
    if (pw.dash > 0 && --pw.dash === 0) { P.vy = -9; P.jumps = 1; P.invuln = 70; }
    if (pw.heavy > 0) pw.heavy--;
    if (pw.milk > 0) pw.milk--;
    if (P.invuln > 0) P.invuln--;
    if (P.spin > 0) P.spin = Math.max(0, P.spin - 1 / 24);
    if (P.land > 0) P.land--;
    if (P.coyote > 0) P.coyote--;
    if (P.slide > 0 && !(P.holdDown && P.onGround)) P.slide--;
    if (P.buffer > 0) { if (tryJump()) P.buffer = 0; else P.buffer--; }

    // 竖直方向
    const prevY = P.y;
    if (pw.dash > 0) {
      P.vy = (GROUND - 120 - P.y) * 0.12;
      P.onGround = false;
    } else {
      P.vy = Math.min(20, P.vy + GRAVITY * (P.holdDown && !P.onGround ? 1.8 : 1));
    }
    P.y += P.vy;

    let box = playerBox();
    let landY = null;
    if (P.vy >= 0 && pw.dash <= 0) {
      if (prevY <= GROUND + 1 && P.y >= GROUND && supported(box.l + 6, box.r - 6)) landY = GROUND;
      for (const s of g.solids.concat(g.platforms)) {
        if (s.dead || box.r <= s.x + 2 || box.l >= s.x + s.w - 2) continue;
        if (prevY <= s.y + 1 && P.y >= s.y) landY = landY === null ? s.y : Math.min(landY, s.y);
      }
    }
    if (landY !== null) {
      if (!P.onGround && P.vy > 6) { P.land = 8; puff(g.dist + PX, landY, 5, '#e8d2b4'); sfx('thud', 0.3); }
      P.y = landY;
      P.vy = 0;
      P.onGround = true;
      P.jumps = 0;
      if (P.holdDown && P.slide <= 0) P.slide = 40;
    } else {
      if (P.onGround) P.coyote = 6;
      P.onGround = false;
    }
    if (P.y > H + 140) return die('掉进坑里了');

    box = playerBox();
    const px = g.dist + PX;

    for (const s of g.solids) {
      if (!s.dead && overlaps(box, s.x, s.y, s.w, s.h) && box.bottom > s.y + 6) hurt(s, 'crate', '一头撞上了木箱');
    }
    for (const b of g.bars) {
      if (!b.dead && overlaps(box, b.x, -100, b.w, b.bottom + 100)) hurt(b, 'bar', '撞到横梁了，该滑铲的');
    }
    for (const f of g.frogs) {
      if (f.dead) continue;
      f.x += f.dir * 0.7;
      if (f.x < f.x0) f.dir = 1;
      if (f.x > f.x1) f.dir = -1;
      const top = GROUND - f.h;
      if (!overlaps(box, f.x, top, f.w, f.h)) continue;
      if (P.vy > 0 && prevY <= top + 16 && pw.dash <= 0) {
        f.dead = true;
        g.stomps++;
        P.vy = P.holdDown ? -8 : -12;
        P.jumps = 1;
        g.debris.push({ kind: 'squash', x: f.x, y: GROUND - f.h, w: f.w, h: f.h, life: 30 });
        sfx('pop');
        puff(f.x + f.w / 2, GROUND - 10, 6, '#ffe58a');
        toast('踩扁 +100', '#d9902f');
      } else {
        hurt(f, 'frog', '被奶蛙绊倒了');
      }
      if (phase !== 'run') return;
    }

    // 奶滴
    const cy = box.top + (box.bottom - box.top) / 2;
    for (const d of g.drops) {
      if (d.taken) continue;
      const dx = px - d.x, dy = cy - d.y;
      const dist = Math.hypot(dx, dy);
      if (pw.milk > 0 && dist < 280) { d.x += (dx / dist) * 14; d.y += (dy / dist) * 14; }
      if (dist < 32 + (pw.heavy > 0 ? 12 : 0)) {
        d.taken = true;
        g.coins++;
        sparkle(d.x, d.y);
        if (g.coins % 3 === 0) sfx('pop');
      }
    }
    for (const it of g.items) {
      if (it.taken) continue;
      if (Math.hypot(px - it.x, cy - it.y) < 46) {
        it.taken = true;
        sparkle(it.x, it.y, POWERS[it.type].color);
        activate(it.type);
      }
    }

    stepFx();

    // 清掉身后的东西
    const behind = g.dist - 300;
    const keep = (o) => o.x + o.w > behind;
    g.grounds = g.grounds.filter((s) => s.x1 > behind);
    g.solids = g.solids.filter(keep);
    g.platforms = g.platforms.filter(keep);
    g.bars = g.bars.filter(keep);
    g.frogs = g.frogs.filter((f) => f.x1 + f.w > behind);
    g.drops = g.drops.filter((d) => !d.taken && d.x > behind);
    g.items = g.items.filter((i) => !i.taken && i.x > behind);
    generate();
  };

  const stepFx = () => {
    if (g.shake > 0) g.shake *= 0.85;
    if (g.shake < 0.3) g.shake = 0;
    if (g.toast && --g.toast.t <= 0) g.toast = null;
    for (const f of g.fx) { f.x += f.vx; f.y += f.vy; f.vy += 0.12; f.life -= f.decay; }
    g.fx = g.fx.filter((f) => f.life > 0);
    for (const d of g.debris) {
      if (d.kind === 'squash') { d.life--; continue; }
      d.x += d.vx; d.y += d.vy; d.vy += 0.8; d.rot += d.vr;
    }
    g.debris = g.debris.filter((d) => (d.kind === 'squash' ? d.life > 0 : d.y < H + 200));
  };

  // ---------------------------------------------------------------- 绘制
  const sx = (wx) => wx - g.dist;

  const drawSprite = (key, cx, bottom, height, opts = {}) => {
    const im = IMG[key];
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
      c.fillStyle = key.startsWith('naiwa') ? '#f6d44a' : '#ffe9a8';
      c.beginPath();
      c.ellipse(0, 0, height * 0.38, height * 0.5, 0, 0, Math.PI * 2);
      c.fill();
    }
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

  const drawCrate = (x, y, w, h) => {
    const c = ctx;
    roundRect(x, y, w, h, 6);
    c.fillStyle = '#c98a4f';
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = '#8a5530';
    c.stroke();
    c.strokeStyle = 'rgba(138,85,48,.55)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x + w * 0.33, y + 6); c.lineTo(x + w * 0.33, y + h - 6);
    c.moveTo(x + w * 0.66, y + 6); c.lineTo(x + w * 0.66, y + h - 6);
    c.stroke();
  };

  const drawBar = (x, w, bottom) => {
    const c = ctx;
    c.strokeStyle = '#7d6a5c';
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(x + 18, 0); c.lineTo(x + 18, bottom - 30);
    c.moveTo(x + w - 18, 0); c.lineTo(x + w - 18, bottom - 30);
    c.stroke();
    roundRect(x, bottom - 30, w, 30, 8);
    c.fillStyle = '#9aa0a6';
    c.fill();
    c.save();
    c.clip();
    c.fillStyle = '#ffcf4d';
    for (let i = -1; i < w / 26 + 1; i++) {
      c.beginPath();
      c.moveTo(x + i * 26, bottom);
      c.lineTo(x + i * 26 + 13, bottom);
      c.lineTo(x + i * 26 + 26, bottom - 30);
      c.lineTo(x + i * 26 + 13, bottom - 30);
      c.fill();
    }
    c.restore();
    c.lineWidth = 3;
    c.strokeStyle = '#5f646a';
    roundRect(x, bottom - 30, w, 30, 8);
    c.stroke();
  };

  const drawDrop = (x, y, t) => {
    const c = ctx;
    const bob = Math.sin(t * 0.1 + x * 0.05) * 3;
    c.save();
    c.translate(x, y + bob);
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

  const drawBackground = () => {
    const c = ctx;
    const sky = c.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#ffe7c2');
    sky.addColorStop(1, '#ffcfa0');
    c.fillStyle = sky;
    c.fillRect(0, 0, viewW, H);
    c.fillStyle = 'rgba(255,248,230,.85)';
    c.beginPath();
    c.arc(viewW - 170, 110, 46, 0, Math.PI * 2);
    c.fill();
    // 云
    c.fillStyle = 'rgba(255,253,247,.92)';
    for (let i = 0; i < 6; i++) {
      const span = viewW + 360;
      const x = ((((i * 433) - g.dist * 0.12) % span) + span) % span - 180;
      const y = 60 + ((i * 71) % 140);
      const s = 0.7 + ((i * 37) % 10) / 20;
      c.beginPath();
      c.ellipse(x, y, 70 * s, 26 * s, 0, 0, Math.PI * 2);
      c.ellipse(x + 46 * s, y - 14 * s, 50 * s, 30 * s, 0, 0, Math.PI * 2);
      c.ellipse(x - 50 * s, y + 2 * s, 40 * s, 20 * s, 0, 0, Math.PI * 2);
      c.fill();
    }
    // 两层远山
    const hills = (k, base, amp, color) => {
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(0, H);
      for (let x = 0; x <= viewW + 20; x += 20) {
        const wx = x + g.dist * k;
        c.lineTo(x, base - Math.sin(wx * 0.004) * amp - Math.sin(wx * 0.011 + 1.3) * amp * 0.4);
      }
      c.lineTo(viewW, H);
      c.fill();
    };
    hills(0.15, 340, 34, '#ffe2bd');
    hills(0.4, 392, 26, '#fbd6a6');
  };

  const drawGround = () => {
    const c = ctx;
    // 先铺一层深色坑底，地面段画在上面，没有地面的地方就露出坑
    const pit = c.createLinearGradient(0, GROUND, 0, H);
    pit.addColorStop(0, '#8a5a3a');
    pit.addColorStop(1, '#3a2a1f');
    c.fillStyle = pit;
    c.fillRect(0, GROUND + 6, viewW, H - GROUND);
    for (const s of g.grounds) {
      const x0 = sx(s.x0), x1 = sx(s.x1);
      if (x1 < -20 || x0 > viewW + 20) continue;
      c.fillStyle = '#d9a874';
      c.fillRect(x0, GROUND + 10, x1 - x0, H - GROUND);
      c.fillStyle = 'rgba(160,110,70,.18)';
      for (let x = Math.ceil(s.x0 / 90) * 90; x < s.x1 - 20; x += 90) {
        c.beginPath();
        c.ellipse(sx(x) + 30, GROUND + 50 + ((x / 90) % 3) * 22, 14, 6, 0, 0, Math.PI * 2);
        c.fill();
      }
      roundRect(x0, GROUND - 2, x1 - x0, 16, 7);
      c.fillStyle = '#8fcf6a';
      c.fill();
      c.strokeStyle = '#6fae4c';
      c.lineWidth = 2;
      c.beginPath();
      for (let x = Math.ceil(s.x0 / 14) * 14; x < s.x1 - 4; x += 14) {
        c.moveTo(sx(x), GROUND);
        c.lineTo(sx(x) + 2, GROUND - 8 - ((x / 14) % 3) * 2);
      }
      c.stroke();
    }
  };

  const drawPlayer = () => {
    const P = g.p;
    const pw = g.power;
    const c = ctx;
    const heavy = pw.heavy > 0;
    let key = 'naidan_idle';
    if (pw.dash > 0) key = 'naidan_dash';
    else if (heavy) key = 'naidan_heavy';
    else if (pw.milk > 0) key = 'naidan_milk';
    else if (pw.shield) key = 'naidan_split';
    else if (g.t % 200 < 8) key = 'naidan_blink';
    const h = 78 * (heavy ? 1.45 : 1);
    const sliding = P.slide > 0 && P.onGround;
    let sxk = 1, syk = 1, rot = 0, bob = 0;
    if (phase === 'dead') {
      rot = P.spin * Math.PI * 2;
    } else if (sliding) {
      sxk = 1.25; syk = 0.52; rot = -0.18;
    } else if (P.onGround) {
      bob = -Math.abs(Math.sin(g.t * 0.3)) * 5;
      if (P.land > 0) { syk = 1 - P.land * 0.025; sxk = 1 + P.land * 0.02; }
    } else {
      rot = clamp(P.vy * 0.02, -0.25, 0.3) + (1 - P.spin) * Math.PI * 2 * (P.spin > 0 ? 1 : 0);
    }
    if (pw.dash > 0) {
      rot = 0.25;
      for (let i = 1; i <= 4; i++) drawSprite(key, PX - i * 26, P.y, h, { alpha: 0.22 - i * 0.04, rot });
      c.strokeStyle = 'rgba(255,255,255,.7)';
      c.lineWidth = 3;
      c.beginPath();
      for (let i = 0; i < 5; i++) {
        const y = P.y - 70 + ((g.t * 7 + i * 37) % 90);
        const x = PX - 60 - ((g.t * 23 + i * 53) % 160);
        c.moveTo(x, y); c.lineTo(x - 60, y);
      }
      c.stroke();
    }
    if (pw.milk > 0) {
      c.strokeStyle = `rgba(95,184,232,${0.25 + Math.sin(g.t * 0.2) * 0.1})`;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(PX, P.y - h * 0.5, 70 + Math.sin(g.t * 0.2) * 6, 0, Math.PI * 2);
      c.stroke();
    }
    const alpha = P.invuln > 0 && Math.floor(P.invuln / 4) % 2 ? 0.45 : 1;
    // 影子
    if (phase !== 'dead' && P.y <= GROUND + 2 && supported(g.dist + PX - 10, g.dist + PX + 10)) {
      const air = clamp((GROUND - P.y) / 200, 0, 1);
      c.fillStyle = `rgba(90,60,30,${0.22 * (1 - air)})`;
      c.beginPath();
      c.ellipse(PX, GROUND + 2, 26 * (1 - air * 0.5) * (heavy ? 1.4 : 1), 6, 0, 0, Math.PI * 2);
      c.fill();
    }
    drawSprite(key, PX, P.y + bob, h, { sx: sxk, sy: syk, rot, alpha });
    if (pw.shield) {
      c.strokeStyle = 'rgba(155,123,224,.65)';
      c.fillStyle = 'rgba(155,123,224,.12)';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(PX, P.y - h * 0.5, h * 0.62, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  };

  const drawHud = () => {
    const c = ctx;
    c.save();
    c.font = '800 30px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
    c.textBaseline = 'top';
    c.fillStyle = 'rgba(255,246,228,.88)';
    roundRect(16, 14, 220, 76, 18);
    c.fill();
    c.fillStyle = '#e2632f';
    c.fillText(`${meters()} 米`, 32, 22);
    c.font = '700 16px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
    c.fillStyle = '#6b5444';
    c.fillText(`奶滴 ${g.coins}   得分 ${score()}`, 32, 62);
    // 道具剩余时间
    let y = 102;
    for (const k of ['dash', 'heavy', 'milk']) {
      const left = g.power[k];
      if (left <= 0) continue;
      const def = POWERS[k];
      c.fillStyle = 'rgba(255,246,228,.88)';
      roundRect(16, y, 220, 26, 13);
      c.fill();
      c.fillStyle = def.color;
      roundRect(18, y + 2, 216 * (left / def.frames), 22, 11);
      c.fill();
      c.fillStyle = '#4a3527';
      c.font = '700 13px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
      c.fillText(def.name, 28, y + 6);
      y += 32;
    }
    if (g.power.shield) {
      c.fillStyle = 'rgba(255,246,228,.88)';
      roundRect(16, y, 120, 26, 13);
      c.fill();
      c.fillStyle = '#9b7be0';
      c.font = '700 13px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
      c.fillText('🛡 分身护盾', 28, y + 6);
    }
    if (g.toast) {
      const a = Math.min(1, g.toast.t / 20);
      c.globalAlpha = a;
      c.font = '800 26px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
      c.textAlign = 'center';
      c.lineWidth = 6;
      c.strokeStyle = '#fff6e4';
      const ty = 120 - (1 - a) * 10;
      c.strokeText(g.toast.text, viewW / 2, ty);
      c.fillStyle = g.toast.color;
      c.fillText(g.toast.text, viewW / 2, ty);
    }
    c.restore();
  };

  const render = () => {
    const c = ctx;
    c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    c.save();
    if (g.shake) c.translate(rand(-g.shake, g.shake) * 0.5, rand(-g.shake, g.shake) * 0.5);
    drawBackground();
    drawGround();
    const vis = (x, w = 0) => sx(x) + w > -60 && sx(x) < viewW + 60;
    for (const p of g.platforms) {
      if (!vis(p.x, p.w)) continue;
      roundRect(sx(p.x), p.y, p.w, p.h, 7);
      c.fillStyle = '#b97a45';
      c.fill();
      c.strokeStyle = '#8a5530';
      c.lineWidth = 3;
      c.stroke();
    }
    for (const s of g.solids) if (!s.dead && vis(s.x, s.w)) drawCrate(sx(s.x), s.y, s.w, s.h);
    for (const b of g.bars) if (!b.dead && vis(b.x, b.w)) drawBar(sx(b.x), b.w, b.bottom);
    for (const d of g.drops) if (vis(d.x)) drawDrop(sx(d.x), d.y, g.t);
    for (const it of g.items) {
      if (!vis(it.x)) continue;
      const def = POWERS[it.type];
      const y = it.y + Math.sin(g.t * 0.08 + it.x) * 6;
      c.fillStyle = 'rgba(255,255,255,.55)';
      c.strokeStyle = def.color;
      c.lineWidth = 4;
      c.beginPath();
      c.arc(sx(it.x), y, 34, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      drawSprite(def.sprite, sx(it.x), y + 26, 52);
      c.fillStyle = 'rgba(255,255,255,.8)';
      c.beginPath();
      c.arc(sx(it.x) - 13, y - 14, 6, 0, Math.PI * 2);
      c.fill();
    }
    for (const f of g.frogs) {
      if (f.dead || !vis(f.x, f.w)) continue;
      const hop = Math.abs(Math.sin(g.t * 0.12 + f.hop)) * 6;
      drawSprite('naiwa_angry', sx(f.x + f.w / 2), GROUND - hop, 62, { flip: f.dir > 0 });
    }
    for (const d of g.debris) {
      if (d.kind === 'squash') {
        drawSprite('naiwa_happy', sx(d.x + d.w / 2), GROUND, 62, { sx: 1.3, sy: 0.35, alpha: Math.min(1, d.life / 10) });
      } else if (d.kind === 'frog') {
        drawSprite('naiwa_happy', sx(d.x + d.w / 2), d.y + d.h, 62, { rot: d.rot });
      } else {
        c.save();
        c.translate(sx(d.x + d.w / 2), d.y + d.h / 2);
        c.rotate(d.rot);
        if (d.kind === 'bar') { c.fillStyle = '#9aa0a6'; c.fillRect(-d.w / 2, -d.h / 2, d.w, d.h); }
        else drawCrate(-d.w / 2, -d.h / 2, d.w, d.h);
        c.restore();
      }
    }
    drawPlayer();
    for (const f of g.fx) {
      c.globalAlpha = Math.max(0, f.life);
      c.fillStyle = f.color;
      c.beginPath();
      c.arc(sx(f.x), f.y, f.r * (0.5 + f.life * 0.5), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    if (phase === 'dead') {
      drawSprite('naiwa_happy', viewW - 150, GROUND, 120 * clamp(g.deathT / 15, 0, 1), { rot: Math.sin(g.t * 0.3) * 0.08 });
    }
    c.restore();
    drawHud();
  };

  // ---------------------------------------------------------------- 循环 / 尺寸
  const fit = () => {
    const aspect = window.innerWidth / window.innerHeight;
    viewW = clamp(Math.round(aspect * H), VIEW_MIN, VIEW_MAX);
    scale = Math.min(window.innerWidth / viewW, window.innerHeight / H);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    el.canvas.width = Math.round(viewW * scale * dpr);
    el.canvas.height = Math.round(H * scale * dpr);
    el.canvas.style.width = `${Math.round(viewW * scale)}px`;
    el.canvas.style.height = `${Math.round(H * scale)}px`;
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
        step();
        acc -= STEP;
      }
    } else {
      acc = 0;
    }
    render();
    raf = requestAnimationFrame(frame);
  };

  // ---------------------------------------------------------------- 面板
  const showPanel = (html, primary) => {
    el.panel.innerHTML = html;
    el.wrap.classList.remove('hide');
    panelPrimary = primary;
    el.panel.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => ACTIONS[b.dataset.act]());
    });
  };
  const hidePanel = () => {
    el.wrap.classList.add('hide');
    panelPrimary = null;
  };

  const KEYS_HTML = `
    <div class="keys">
      <b>跳</b><span>空格 / ↑ / 点屏幕（空中还能再跳一次）</span>
      <b>滑铲</b><span>↓ / S（钻横梁；空中按 = 急降）</span>
      <b>踩奶蛙</b><span>从上面落下去 +100，撞侧面就倒</span>
      <b>道具泡泡</b><span>冲刺 · 变胖 · 奶泡磁铁 · 分身护盾</span>
    </div>`;

  const showReady = () => {
    phase = 'ready';
    const best = loadBest();
    const portrait = window.innerHeight > window.innerWidth;
    showPanel(`
      <h2>奶龙快跑</h2>
      <p class="big">奶蛙追来了，快跑！</p>
      ${KEYS_HTML}
      ${best ? `<p>最高分 <b>${best}</b></p>` : ''}
      ${portrait ? '<p style="font-size:13px">手机横过来玩视野更大</p>' : ''}
      <div class="row"><button data-act="start">开跑！</button><button class="ghost" data-act="menu">回主菜单</button></div>`, 'start');
  };

  const showPause = () => {
    if (phase !== 'run') return;
    phase = 'pause';
    showPanel(`
      <h2>暂停中</h2>
      <p>已经跑了 ${meters()} 米</p>
      <div class="row"><button data-act="resume">继续</button><button class="ghost" data-act="start">重新开始</button><button class="ghost" data-act="menu">回主菜单</button></div>`, 'resume');
  };

  const showDead = () => {
    const s = score();
    const best = loadBest();
    const record = s > best;
    if (record) saveBest(s);
    showPanel(`
      <h2>${g.deathReason}</h2>
      <p class="big">${s} 分</p>
      ${record ? '<p class="rec">新纪录！</p>' : `<p>最高分 ${best}</p>`}
      <div class="stats">
        <div><b>${meters()}</b>米</div><div><b>${g.coins}</b>奶滴</div><div><b>${g.stomps}</b>踩扁</div><div><b>${g.smashes}</b>撞碎</div>
      </div>
      <div class="row"><button data-act="start">再跑一次</button><button class="ghost" data-act="menu">回主菜单</button></div>`, 'start');
    if (record) sfx('win');
  };

  const ACTIONS = {
    start: () => {
      g = newGame();
      generate();
      hidePanel();
      phase = 'run';
      last = performance.now();
      acc = 0;
      sfx('ready');
    },
    resume: () => {
      hidePanel();
      phase = 'run';
      last = performance.now();
    },
    menu: () => close(),
  };

  // ---------------------------------------------------------------- 输入
  const press = (action) => {
    if (!active) return;
    sfx('unlock');
    if (phase !== 'run') return;
    if (action === 'jump') {
      g.p.buffer = 7;
      if (tryJump()) g.p.buffer = 0;
    } else if (action === 'slide') {
      startSlide();
    }
  };
  const release = (action) => {
    if (!active || !g) return;
    if (action === 'jump' && g.p.vy < -7 && g.power.dash <= 0) g.p.vy = -7;
    if (action === 'slide') g.p.holdDown = false;
  };

  const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);
  const SLIDE_KEYS = new Set(['ArrowDown', 'KeyS']);
  const onKeyDown = (e) => {
    if (!active) return;
    // 跑酷开着的时候，弹弓那边的快捷键（空格放技能、Enter 开局、R 重开……）全部截住
    e.stopImmediatePropagation();
    if (phase !== 'run') {
      if ((e.code === 'Space' || e.code === 'Enter') && panelPrimary) { e.preventDefault(); if (!e.repeat) ACTIONS[panelPrimary](); }
      else if (e.code === 'Escape' && phase === 'pause') ACTIONS.resume();
      return;
    }
    if (JUMP_KEYS.has(e.code)) { e.preventDefault(); if (!e.repeat) press('jump'); }
    else if (SLIDE_KEYS.has(e.code)) { e.preventDefault(); if (!e.repeat) press('slide'); }
    else if (e.code === 'KeyP' || e.code === 'Escape') showPause();
  };
  const onKeyUp = (e) => {
    if (!active) return;
    e.stopImmediatePropagation();
    if (JUMP_KEYS.has(e.code)) release('jump');
    else if (SLIDE_KEYS.has(e.code)) release('slide');
  };

  const bindInput = () => {
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    el.canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); press('jump'); });
    el.canvas.addEventListener('pointerup', () => release('jump'));
    el.canvas.addEventListener('pointercancel', () => release('jump'));
    const hold = (btn, action) => {
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); press(action); });
      btn.addEventListener('pointerup', () => release(action));
      btn.addEventListener('pointercancel', () => release(action));
      btn.addEventListener('pointerleave', () => release(action));
    };
    hold(el.jumpBtn, 'jump');
    hold(el.slideBtn, 'slide');
    el.back.addEventListener('click', () => close());
    el.pause.addEventListener('click', () => (phase === 'pause' ? ACTIONS.resume() : showPause()));
    el.sound.addEventListener('click', () => {
      if (!window.AudioKit) return;
      const muted = window.AudioKit.toggle();
      syncSoundLabel(muted);
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
    g = newGame();
    generate();
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

  window.NailongRun = { open, close, state: () => g, phase: () => phase };
})();
