/* ============================================================================
   ¡VUELA, POLLO! — Piri Piri arcade mini-game
   Vanilla ES6, Canvas 2D, no libraries.  Screen-print / woodcut brand style.
   See sandbox/juego/DESIGN.md for the full design contract.
   ========================================================================== */
(function () {
  'use strict';

  // ── Palette (HARD RULES — only these) ─────────────────────────────────────
  const INK      = '#1d1d1b'; // dark-900
  const ORANGE   = '#ff5224'; // brand-500
  const CREAM    = '#efdece'; // light-400
  const LIGHT200 = '#fbf8f5'; // light-200
  const BRAND100 = '#ffede9'; // brand-100  (distant bg shapes only)
  const GOLD      = '#f29100'; // fuego meter fill only
  const INK_HILL_DARK = '#2b2b27'; // parallax hill while inverted (grifo)

  const FONT = "'Neulis Neue', sans-serif";
  const DFONT = "'Salsita Funk', cursive";   // brand display font

  // ── The brand's 10 SVG flame frames (verbatim from site.js) ───────────────
  const FLAME_FRAMES = [
    { vb:'0 0 54.4 128',   tag:'path',    d:'M31.7,15.1l-20.8,25.9,10.4,54.5-.9,27.6,15.5-26.9,1.7-22.9s-3.6-20.9-3.4-22,7.1-26.9,7.1-26.9l2-19.4-11.8,10.2Z' },
    { vb:'0 0 54.4 103.9', tag:'polygon', d:'42.2 5.5 52.8 36.3 46.8 55.6 37.4 71 26.5 79.7 19.6 102.3 2.7 74 3.9 57 12.3 30.1 15.3 46.6 14.6 65.8 29.6 52.6 35.7 40.2 37.8 18.7 42.2 5.5' },
    { vb:'0 0 54.4 103.9', tag:'path',    d:'M28.4,16.3l-8.9,20.3,7.6,17.8-3.1,10.4-7.6,12.3,3.5,24.7s6.4-18.8,7.2-20,7.7-15.9,7.7-15.9l4.7-13.1s-4-10.2-4.7-12.4,0-8.4,0-14.8.7-12.9.8-13.6-1-9.4-1-9.4l-6.2,13.8Z' },
    { vb:'0 0 54.4 103.9', tag:'path',    d:'M33.7,4.9c0,.6,9,61,9,61,0,0-35.1,32.9-34.7,31.2s14.6-62.7,14.6-62.7l11.1-29.4Z' },
    { vb:'0 0 54.4 103.9', tag:'polygon', d:'18 0 8 28 4 54 14 76 20 103.9 34 80 44 58 40 34 30 46 18 0' },
    { vb:'0 0 54.4 103.9', tag:'polygon', d:'36 0 48 30 50 58 38 80 28 103.9 16 78 6 52 10 28 24 44 36 0' },
    { vb:'0 0 54.4 128',   tag:'polygon', d:'27 0 38 22 42 52 36 80 30 128 22 82 16 54 18 24 27 0' },
    { vb:'0 0 54.4 103.9', tag:'polygon', d:'28 8 42 26 50 50 44 72 32 103.9 20 74 8 52 12 28 28 8' },
    { vb:'0 0 54.4 103.9', tag:'polygon', d:'38 2 50 30 48 60 36 82 26 103.9 14 80 10 56 16 32 26 50 38 2' },
    { vb:'0 0 54.4 128',   tag:'polygon', d:'24 0 14 24 10 56 18 82 26 128 36 84 44 60 40 30 30 48 24 0' },
  ];
  const FLAME = FLAME_FRAMES.map(function (f) {
    var d;
    if (f.tag === 'path') { d = f.d; }
    else {
      var n = f.d.trim().split(/\s+/).map(Number);
      d = 'M' + n[0] + ' ' + n[1];
      for (var i = 2; i < n.length; i += 2) d += 'L' + n[i] + ' ' + n[i + 1];
      d += 'Z';
    }
    var vb = f.vb.split(' ').map(Number);
    return { path: new Path2D(d), w: vb[2], h: vb[3] };
  });
  // Simple feather silhouette (flat ink shape) for the death pop.
  const FEATHER = new Path2D('M0,-16 C7,-11 8,4 0,16 C-8,4 -7,-11 0,-16 Z');

  function randFlame() { return (Math.random() * FLAME.length) | 0; }
  // Draw a flame frame with its base anchored at (x,y), size w×h, rotated `rot`.
  function drawFlame(ctx, idx, x, y, w, h, color, rot) {
    var fp = FLAME[idx];
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.scale(w / fp.w, h / fp.h);
    ctx.translate(-fp.w / 2, -fp.h);
    ctx.fillStyle = color;
    ctx.fill(fp.path);
    ctx.restore();
  }
  // A tiny flicker driver (mirrors startFlicker timing from site.js).
  function Flicker() { this.f = randFlame(); this.t = Math.random() * 0.06; }
  Flicker.prototype.tick = function (dt) {
    this.t -= dt;
    if (this.t <= 0) {
      var n; do { n = randFlame(); } while (n === this.f);
      this.f = n;
      this.t = 0.03 + Math.random() * 0.055;
    }
  };

  // ── World / physics constants ─────────────────────────────────────────────
  const WORLD_H   = 1000;      // virtual units, width derived from aspect
  const STEP      = 1 / 120;   // fixed physics step
  const GRAVITY   = 2050;      // tuned up from doc 1800 → snappier fall
  const FLAP      = -610;      // impulse (doc -520 → -610, feels crisper)
  const TERMINAL  = 1000;      // max fall speed
  const GROUND_H  = 76;        // brasas strip height
  const ROOSTER_H = 112;       // gameplay/collision body reference (NOT draw size)
  const ROOSTER_W = ROOSTER_H * (512 / 376); // pollo-down as the reference body
  const GRIFO_H   = 158;
  const GRIFO_W   = GRIFO_H * (768 / 571);
  const HIT_R     = ROOSTER_H * 0.33;

  // ── Rooster pose sprites + body-scale normalization ───────────────────────
  // Each pose is drawn so the TORSO reads the same on-screen size (not fit-to-
  // height — the wide/tall poses would otherwise shrink the bird). `k` scales the
  // sprite's native pixels to world units; tuned against pollo-down as reference.
  // ref draw height for pollo-down ≈ ROOSTER_H, its native h = 376 → k ≈ 0.298.
  // pollo-up and pollo-down are now the SAME native size (560×534) and HEAD-
  // REGISTERED → they MUST share identical w/h/k/bx/by so the body/head stay put
  // across a flap and only the wings/legs move (no size pulse, no jump).
  // pollo-up & pollo-down share ONE pose box (identical 560×535, head+body+feet
  // registered → only the wings differ), so a flap moves wings only: no size/anchor
  // jump. bx/by place the beak ember: right edge (~0.46) ~40% down (by≈-0.10).
  const FLAP_POSE = { w: 560, h: 535, k: 0.285, bx: 0.44, by: -0.10 };
  const POSE = {
    'pollo-down':  FLAP_POSE,
    'pollo-up':    FLAP_POSE,
    'pollo-fall':  { w: 496, h: 512, k: 0.300, bx: 0.30, by:  0.10 },
    'pollo-fire':  { w: 512, h: 272, k: 0.360, bx: 0.49, by: -0.10 },
    'pollo-crash': { w: 512, h: 360, k: 0.300, bx: 0.42, by:  0.00 },
    'morph-1':     { w: 613, h: 640, k: 0.235, bx: 0.44, by:  0.00 },
    'morph-2':     { w: 768, h: 578, k: 0.235, bx: 0.46, by:  0.00 },
    'grifo':       { w: 768, h: 571, k: 0.276, bx: 0.50, by: -0.04 },
    // eagle-flight poses — matched body scale to the level grifo (bigger canvas)
    'grifo-up':    { w: 820, h: 625, k: 0.262, bx: 0.50, by: -0.02 },
    'grifo-down':  { w: 820, h: 613, k: 0.262, bx: 0.50, by:  0.02 }
  };
  function poseBox(name) {
    var p = POSE[name] || POSE['pollo-down'];
    return { w: p.w * p.k, h: p.h * p.k, bx: p.bx, by: p.by };
  }
  const BOTTLE_W  = 172;
  const BOTTLE_RATIO = 640 / 190;
  const BODY_F    = 0.66;      // collidable body width as fraction of sprite w
  const CHILI_W   = 66;
  const CHILI_H   = CHILI_W * (178 / 256);
  const PLATE_R   = 82;
  const MAX_CHILI = 3;
  const OBST_EVERY = 1.9;      // seconds between bottle pairs
  const GRILL_SLOT = 4;        // every Nth obstacle carries a dish grill
  const FIRE_SPEED = 940;
  const GRIFO_TIME = 7;        // seconds

  const DISHES = ['alitas-clasicas','alitas-picantes','piri-piri-original-burger',
    'piripiri-bowl','crispy-piri','boniato-rostizado','bites-de-mazorca','arroz-especial'];
  const DISH_LABEL = {
    'alitas-clasicas':'ALITAS CLÁSICAS','alitas-picantes':'ALITAS PICANTES',
    'piri-piri-original-burger':'ORIGINAL BURGER','piripiri-bowl':'PIRIPIRI BOWL',
    'crispy-piri':'CRISPY PIRI','boniato-rostizado':'BONIATO ROSTIZADO',
    'bites-de-mazorca':'BITES DE MAZORCA','arroz-especial':'ARROZ ESPECIAL'
  };

  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── DOM ───────────────────────────────────────────────────────────────────
  const canvas = document.getElementById('ppCanvas');
  const ctx    = canvas.getContext('2d');
  const stage  = document.getElementById('ppStage');
  const fireBtn = document.getElementById('ppFireBtn');
  const muteBtn = document.getElementById('ppMuteBtn');
  const over    = document.getElementById('ppOver');
  const elScore = document.getElementById('ppOverScore');
  const elBest  = document.getElementById('ppOverBest');
  const elRecord= document.getElementById('ppRecord');
  const elPlates= document.getElementById('ppPlates');
  const btnAgain= document.getElementById('ppAgain');

  // ── Assets ─────────────────────────────────────────────────────────────────
  const SPR = {};       // name -> Image
  const VAR = {};       // name -> cream-variant canvas (for inverted grifo mode)
  const DUO = {};       // slug -> duotone canvas
  const PHOTO = {};     // slug -> Image (full colour)
  let assetsReady = false;

  function loadImg(src) {
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = src;
    });
  }
  // Cream silhouette variant: dark ink pixels → cream, orange stays orange.
  function makeVariant(img) {
    var c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    var x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    try {
      var d = x.getImageData(0, 0, c.width, c.height), a = d.data;
      for (var i = 0; i < a.length; i += 4) {
        if (a[i + 3] < 8) continue;
        var r = a[i], g = a[i + 1], b = a[i + 2];
        var isOrange = r > 150 && g > 45 && g < 175 && b < 105 && (r - b) > 70;
        if (!isOrange) { a[i] = 239; a[i + 1] = 222; a[i + 2] = 206; }
      }
      x.putImageData(d, 0, 0);
    } catch (e) { /* tainted canvas — ignore, fall back to original */ }
    return c;
  }
  // Ink/cream duotone plate art from a real photo (offscreen, one-time).
  function makeDuotone(img, size) {
    var c = document.createElement('canvas');
    c.width = size; c.height = size;
    var x = c.getContext('2d');
    var s = Math.max(size / img.width, size / img.height);
    var w = img.width * s, h = img.height * s;
    x.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    try {
      // WARM ink/cream duotone (silk-screen look): map luminance onto a ramp
      // from ink #1d1d1b (shadows) to cream #efdece (highlights). Not desaturated grey.
      var d = x.getImageData(0, 0, size, size), a = d.data;
      var lo = [29, 29, 27], hi = [239, 222, 206];
      for (var i = 0; i < a.length; i += 4) {
        var L = (0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]) / 255;
        L = L * L * (3 - 2 * L); // gentle S-curve keeps mids warm, not muddy
        a[i]     = lo[0] + (hi[0] - lo[0]) * L;
        a[i + 1] = lo[1] + (hi[1] - lo[1]) * L;
        a[i + 2] = lo[2] + (hi[2] - lo[2]) * L;
      }
      x.putImageData(d, 0, 0);
    } catch (e) { /* tainted canvas — leave as drawn */ }
    return c;
  }

  function loadAssets() {
    var base = 'assets/resources/game/sprites/';
    // Sprites that appear in the inverted (grifo/dark) world need a cream variant:
    // the rooster/morph/grifo poses (transform frames flash while inverted) + bottle
    // + chili. The fuego brand icons are colour-specific already → no variant needed.
    var names = ['pollo-up','pollo-down','pollo-fall','pollo-fire','pollo-crash',
      'morph-1','morph-2','grifo','grifo-up','grifo-down','botella','chili'];
    var jobs = names.map(function (n) {
      return loadImg(base + n + '.png').then(function (im) {
        if (im) { SPR[n] = im; VAR[n] = makeVariant(im); }
      });
    });
    // Brand FUEGO icon sprites (HUD/UI chrome — NOT the animated world flames).
    ['fuego-ink','fuego-cream','fuego-orange'].forEach(function (n) {
      jobs.push(loadImg(base + n + '.png').then(function (im) { if (im) SPR[n] = im; }));
    });
    DISHES.forEach(function (slug) {
      jobs.push(loadImg('assets/resources/images/Carta/480w/' + slug + '_480w.webp').then(function (im) {
        if (im) { PHOTO[slug] = im; DUO[slug] = makeDuotone(im, 260); }
      }));
    });
    return Promise.all(jobs).then(function () { assetsReady = true; });
  }

  // ── Audio (tiny WebAudio synth) ────────────────────────────────────────────
  var actx = null, noiseBuf = null;
  var muted = localStorage.getItem('pp_juego_mute') === '1';
  function initAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var len = actx.sampleRate * 0.4;
      noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
      var ch = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    } catch (e) { actx = null; }
  }
  function tone(freq, dur, type, gain, slideTo, when) {
    if (!actx || muted) return;
    var t = when || actx.currentTime;
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.14, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, gain, hp, lp) {
    if (!actx || muted || !noiseBuf) return;
    var t = actx.currentTime;
    var s = actx.createBufferSource(); s.buffer = noiseBuf;
    var g = actx.createGain();
    g.gain.setValueAtTime(gain || 0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var node = s;
    if (hp) { var f = actx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
    if (lp) { var f2 = actx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = lp; node.connect(f2); node = f2; }
    node.connect(g); g.connect(actx.destination);
    s.start(t); s.stop(t + dur + 0.02);
  }
  const SFX = {
    flap:  function () { tone(520, 0.13, 'triangle', 0.12, 240); noise(0.09, 0.05, 900); },
    point: function () { tone(880, 0.09, 'square', 0.11, 1180); },
    cook:  function () { noise(0.34, 0.13, 1200, 5200); tone(300, 0.3, 'sawtooth', 0.05, 520); },
    smash: function () { noise(0.28, 0.22, 120, 2200); tone(150, 0.24, 'square', 0.10, 60); },
    crack: function () { noise(0.09, 0.14, 2600, 8000); tone(340, 0.06, 'square', 0.05, 190); },
    chili: function () { tone(1050, 0.08, 'square', 0.09, 1500); },
    cluck: function () { tone(680, 0.1, 'square', 0.13, 320); setTimeout(function(){ tone(420, 0.16, 'square', 0.12, 180); }, 90); },
    fanfare: function () {
      if (!actx || muted) return;
      var t0 = actx.currentTime;
      [523, 659, 880].forEach(function (f, i) { tone(f, 0.28, 'square', 0.13, null, t0 + i * 0.11); });
    }
  };
  // `persist` only on a real toggle. The initial render used to write the
  // default straight to localStorage, so simply opening the game left a stored
  // "preference" the player had never expressed. It is exempt storage either
  // way (a UI setting for the service the visitor asked for), but the exemption
  // reads a lot better when every stored value is one the player actually chose.
  function applyMute(persist) {
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.classList.toggle('is-muted', muted);
    muteBtn.innerHTML = muted ? ICON_MUTE : ICON_SOUND;
    if (persist) {
      try { localStorage.setItem('pp_juego_mute', muted ? '1' : '0'); } catch (e) {}
    }
  }
  const ICON_SOUND = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12a4 4 0 0 0-2.2-3.6v7.2A4 4 0 0 0 16.5 12z"/><path d="M14.3 3.2v2.1A6.6 6.6 0 0 1 14.3 18.7v2.1A8.7 8.7 0 0 0 14.3 3.2z"/></svg>';
  const ICON_MUTE  = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M22 9.4 20.6 8l-2.6 2.6L15.4 8 14 9.4l2.6 2.6L14 14.6l1.4 1.4 2.6-2.6 2.6 2.6 1.4-1.4-2.6-2.6z"/></svg>';

  // ── Game state ──────────────────────────────────────────────────────────────
  const S_TITLE = 0, S_PLAY = 1, S_DYING = 2, S_OVER = 3;
  var state = S_TITLE;
  var paused = false, countdown = 0;

  var worldW = 700;            // updated on resize (aspect * WORLD_H = 1000)
  var groundY = WORLD_H - GROUND_H;
  var playerX = 210;

  var best = parseInt(localStorage.getItem('pp_juego_best') || '0', 10) || 0;
  // Difficulty: 'normal' (2-hit bottles, 4 dishes → grifo, sparse chilis) or
  // 'easy' (1-hit bottles, 3 dishes → grifo, lots of chilis). Chosen on the title.
  var mode = localStorage.getItem('pp_juego_mode') === 'easy' ? 'easy' : 'normal';
  var titleModeBtns = [];   // title-screen difficulty toggle hit-boxes (world coords)
  function bottleHp() { return mode === 'easy' ? 1 : 2; }
  function fuegoPerDish() { return mode === 'easy' ? 0.34 : 0.25; }

  // entities
  var obstacles = [];         // {x, gapY, gapH, top:{alive}, bot:{alive}, passed}
  var grills = [];            // {x, y, slug, cooked, burn, coalA, coalB}
  var chilis = [];            // {x, y, base, amp, phase, got}
  var fires = [];             // {x, y, fl, life}
  var particles = [];         // pooled

  // player
  var py = 500, vy = 0, rot = 0, flapFrameT = 0, bobT = 0;
  var flapClock = 0;           // drives the rising up/down alternation (~90ms)
  var fallDiveT = 0;           // how long we've been continuously falling (vy>0)
  var fireT = 0;               // firing-pose timer (~0.22s), also gates the beak flame
  var transformT = 0;          // enterGrifo morph flash sequence timer
  var exitMorphT = 0;          // brief morph-2 flash on grifo exit
  var chili = 0, fuego = 0, score = 0, dishesCooked = [];
  var isGrifo = false, grifoT = 0, invuln = 0;
  // EL GRIFO eagle-flight: smooth tilt + gentle bank + periodic barrel flip.
  var grifoSpin = 0, grifoSpinT = 0, grifoSpinCd = 1.8, grifoBank = 0;
  const GRIFO_SPIN_DUR = 0.5; // full 360° barrel roll length
  // Full-block bottle bookkeeping (item 14)
  var lastFullObst = -99;
  var obstTimer = 0, obstCount = 0, chiliTimer = 0;
  var shake = 0, flash = 0, deathT = 0, timeScale = 1;
  var beakFl = new Flicker(), trailFl = [new Flicker(), new Flicker(), new Flicker()];
  var titleFl = [new Flicker(), new Flicker(), new Flicker(), new Flicker(), new Flicker()];
  // FLOOR FIRE (item 11): sporadic fanned "abanico" clusters of brand flame
  // tongues that spawn/grow/fade at random spots along the ground. Some render
  // BEHIND the floor/obstacles (z:'back' → only their tops peek out), some in
  // front. NOT a uniform constant row.
  var groundFans = [], fanSpawnT = 0;
  var titleFans = [];          // framing abanico fans on the title composition
  var bgHills = [];

  function speedNow() {
    var base = 220 + Math.min(score, 50) / 50 * (340 - 220);
    return isGrifo ? base * 1.3 : base;
  }
  function gapNow() {
    return ROOSTER_H * (2.7 - Math.min(score, 40) / 40 * (2.7 - 2.15));
  }

  // ── Particle pool ────────────────────────────────────────────────────────────
  function getParticle() {
    for (var i = 0; i < particles.length; i++) if (!particles[i].on) return particles[i];
    var p = { on: false };
    particles.push(p);
    return p;
  }
  function spawnShards(x, y, col) {
    var n = REDUCED ? 3 : 5 + (Math.random() * 2 | 0);
    for (var i = 0; i < n; i++) {
      var p = getParticle();
      p.on = true; p.kind = 'shard'; p.x = x; p.y = y;
      var a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 260;
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - 120;
      p.life = p.max = 0.6 + Math.random() * 0.4;
      p.rot = Math.random() * Math.PI; p.vr = (Math.random() - 0.5) * 12;
      p.size = 10 + Math.random() * 16; p.col = col;
    }
  }
  function spawnFeathers(x, y) {
    var n = REDUCED ? 4 : 6 + (Math.random() * 3 | 0);
    for (var i = 0; i < n; i++) {
      var p = getParticle();
      p.on = true; p.kind = 'feather'; p.x = x; p.y = y;
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, sp = 90 + Math.random() * 240;
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
      p.life = p.max = 0.9 + Math.random() * 0.6;
      p.rot = Math.random() * Math.PI; p.vr = (Math.random() - 0.5) * 8;
      p.size = 0.8 + Math.random() * 0.7; p.col = INK;
    }
  }
  function spawnPoof(x, y, scale) {
    var n = REDUCED ? 3 : 5 + (Math.random() * 3 | 0);
    for (var i = 0; i < n; i++) {
      var p = getParticle();
      p.on = true; p.kind = 'poof'; p.x = x + (Math.random() - 0.5) * 30;
      p.y = y + (Math.random() - 0.5) * 30;
      p.vx = (Math.random() - 0.5) * 120; p.vy = -60 - Math.random() * 140;
      p.life = p.max = 0.35 + Math.random() * 0.3;
      p.fl = randFlame(); p.size = (scale || 1) * (40 + Math.random() * 40);
    }
  }
  function updateParticles(dt) {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      if (!p.on) continue;
      p.life -= dt;
      if (p.life <= 0) { p.on = false; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind !== 'poof') { p.vy += 900 * dt; p.rot += p.vr * dt; }
      p.x -= speedNow() * dt; // scroll with world
    }
  }
  function drawParticles(t) {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      if (!p.on) continue;
      var k = p.life / p.max;
      if (p.kind === 'poof') {
        var fl = (p.fl + (i)) % FLAME.length;
        drawFlame(ctx, fl, p.x, p.y, p.size * (0.5 + k * 0.6), p.size * (0.6 + k * 0.7), ORANGE, 0);
      } else if (p.kind === 'shard') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.col;
        ctx.beginPath();
        ctx.moveTo(-p.size * 0.5, -p.size * 0.4);
        ctx.lineTo(p.size * 0.5, -p.size * 0.2);
        ctx.lineTo(p.size * 0.3, p.size * 0.5);
        ctx.lineTo(-p.size * 0.4, p.size * 0.3);
        ctx.closePath(); ctx.fill(); ctx.restore();
      } else { // feather
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(p.size, p.size);
        ctx.fillStyle = t.fg; ctx.fill(FEATHER); ctx.restore();
      }
    }
  }

  // ── Spawning ──────────────────────────────────────────────────────────────
  function spawnObstacle() {
    obstCount++;
    var gapH = gapNow();
    // FULL-BLOCK bottle (item 14): ~1 in 6, never before score 5, ≥4 apart. It
    // slides its gap CLOSED as it nears — the only way through is to break it
    // (2 fireballs = 2 chilis). Reuses the 2-hit crack/shatter halves.
    var full = !isGrifo && score >= 5 && (obstCount - lastFullObst) >= 4 && Math.random() < 1 / 6;
    if (full) lastFullObst = obstCount;
    var minC = gapH / 2 + 70, maxC = groundY - gapH / 2 - 30;
    var gy = full
      ? groundY * 0.5 + (Math.random() - 0.5) * groundY * 0.18   // centred → room after a break
      : minC + Math.random() * (maxC - minC);
    var HP = bottleHp();
    obstacles.push({ x: worldW + BOTTLE_W, gapY: gy, gapH: gapH,
      full: full, fullGapMax: gapH,
      top: { alive: true, hp: HP, crack: null, stump: 0, stumpY: 0 },
      bot: { alive: true, hp: HP, crack: null, stump: 0, stumpY: 0 }, passed: false });
    if (!full && obstCount % GRILL_SLOT === 0) {
      grills.push({
        x: worldW + BOTTLE_W, y: gy, slug: DISHES[(Math.random() * DISHES.length) | 0],
        cooked: false, burn: 0, ca: new Flicker(), cb: new Flicker(), label: 0
      });
    }
  }
  function spawnChiliGroup() {
    var gy = 200 + Math.random() * (groundY - 400);
    var single = mode === 'easy' ? false : Math.random() < 0.5;   // easy → always a cluster
    var n = single ? 1 : (mode === 'easy' ? 4 : 3);
    for (var i = 0; i < n; i++) {
      chilis.push({
        x: worldW + 60 + i * 90, base: gy, amp: 40 + Math.random() * 40,
        phase: Math.random() * Math.PI * 2 + i * 0.6, y: gy, got: false
      });
    }
  }

  // ── Input ────────────────────────────────────────────────────────────────
  function flap() {
    if (paused && state === S_PLAY) return;
    if (state === S_TITLE) { startGame(); return; }   // Space/tap/↑ starts the run
    if (state === S_OVER) { startGame(); return; }     // Space/tap/↑ restarts after losing (no need to click OTRA VEZ)
    if (state !== S_PLAY) return;
    vy = FLAP; flapFrameT = 0.13; flapClock = 0; SFX.flap();
  }
  function fire() {
    if (state !== S_PLAY || paused) return;
    if (chili <= 0) { return; }
    doFire();
  }
  function doFire() {                  // the actual spit
    chili--;
    fireT = 0.34;                     // firing pose window (beak wide, UI flame) — held longer so it reads
    var beak = beakPos();
    fires.push({ x: beak.x, y: beak.y, fl: new Flicker(), life: 1.6 });
    spawnPoof(beak.x, beak.y, 0.6);   // small live-fire burst at the beak
    SFX.flap();
    noise(0.12, 0.06, 700);
  }
  // Beak tip of the FIRING pose: right edge, ~46% down from its top.
  function beakPos() {
    var box = poseBox('pollo-fire');
    var fx = box.w * box.bx, fy = box.h * box.by; // offsets-from-centre (bx≈right edge)
    var c = Math.cos(rot), s = Math.sin(rot);
    return { x: playerX + fx * c - fy * s, y: py + fx * s + fy * c };
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault(); initAudio();
    // On the title, a tap on the FÁCIL/NORMAL toggle switches difficulty (doesn't start).
    if (state === S_TITLE && titleModeBtns.length) {
      var rect = canvas.getBoundingClientRect();
      var wx = (e.clientX - rect.left) / rect.width * worldW;
      var wy = (e.clientY - rect.top) / rect.height * WORLD_H;
      for (var i = 0; i < titleModeBtns.length; i++) {
        var b = titleModeBtns[i];
        if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) {
          if (mode !== b.mode) { mode = b.mode; localStorage.setItem('pp_juego_mode', mode); SFX.point(); }
          return;
        }
      }
    }
    flap();
  }, { passive: false });
  fireBtn.addEventListener('pointerdown', function (e) {
    e.preventDefault(); initAudio(); fire();
  }, { passive: false });
  muteBtn.addEventListener('click', function (e) {
    e.preventDefault(); initAudio(); muted = !muted; applyMute(true);
  });
  // Listen on window (no canvas focus needed) so Shift/F fire reliably WHILE the
  // player flaps with mouse/Space. Space stays its own branch → never swallowed.
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault(); initAudio(); flap();
    } else if (e.code === 'KeyF' || e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.key === 'Shift') {
      // one fire per press (ignore the OS key-repeat while a key is held down)
      if (e.repeat) return;
      e.preventDefault(); initAudio(); fire();
    }
  });
  btnAgain.addEventListener('click', function (e) { e.preventDefault(); startGame(); });
  // "VOLVER" → back to the title / level-select screen (not the home page)
  var btnTitle = document.getElementById('ppTitle');
  if (btnTitle) btnTitle.addEventListener('click', function (e) { e.preventDefault(); showTitle(); });

  // Pause only when the TAB is genuinely hidden, resume with 3-2-1 on next tap.
  // Window 'blur' is intentionally NOT used: it fires on multi-monitor / devtools
  // focus changes and on automated input, which used to swallow every flap.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === S_PLAY) paused = true;
  });
  function resumeFromPause() {
    if (paused && state === S_PLAY) { paused = false; countdown = 3; }
  }
  canvas.addEventListener('pointerdown', function () { if (paused) resumeFromPause(); }, true);
  window.addEventListener('focus', function () { /* wait for gesture (countdown) */ });

  // ── Cursor-flame hide while playing (desktop) ──────────────────────────────
  function hideSiteFlame(h) {
    window._ppFireHidden = h;
    var f = document.getElementById('pp-fire');
    if (f) f.style.opacity = h ? '0' : '';
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  function resetGame() {
    obstacles.length = 0; grills.length = 0; chilis.length = 0; fires.length = 0;
    for (var i = 0; i < particles.length; i++) particles[i].on = false;
    py = WORLD_H * 0.42; vy = 0; rot = 0; flapFrameT = 0;
    flapClock = 0; fallDiveT = 0; fireT = 0; transformT = 0; exitMorphT = 0;
    chili = 1; fuego = 0; score = 0; dishesCooked = [];
    isGrifo = false; grifoT = 0; invuln = 0;
    grifoSpin = 0; grifoSpinT = 0; grifoSpinCd = 1.8; grifoBank = 0;
    obstTimer = OBST_EVERY - 2.5; obstCount = 0; chiliTimer = 1.2; // first obstacle ~2.5s in
    lastFullObst = -99;
    shake = 0; flash = 0; deathT = 0; timeScale = 1;
  }
  function startGame() {
    resetGame();
    state = S_PLAY; paused = false; countdown = 0;
    over.classList.remove('is-show');
    stage.classList.remove('is-grifo');
    hideSiteFlame(true);
  }
  // Static title composition (item 16): NO self-playing demo. Just the branded
  // start screen with a hero rooster + framing fire fans.
  function showTitle() {
    state = S_TITLE; paused = false; countdown = 0;
    py = WORLD_H * 0.5; vy = 0; rot = 0;
    isGrifo = false;
    over.classList.remove('is-show');
    stage.classList.remove('is-grifo');
    hideSiteFlame(false);
  }
  function die() {
    if (state !== S_PLAY) return;
    state = S_DYING; deathT = 0; timeScale = REDUCED ? 1 : 0.32;
    vy = -260; // little launch on the tumble
    spawnFeathers(playerX, py); spawnPoof(playerX, py, 1.1);
    shake = REDUCED ? 0 : 8;
    SFX.cluck();
    isGrifo = false;
    stage.classList.remove('is-grifo');
  }
  function gameOver() {
    state = S_OVER;
    hideSiteFlame(false);
    var isRecord = score > best;
    if (isRecord) { best = score; localStorage.setItem('pp_juego_best', String(best)); }
    elScore.textContent = score;
    elBest.textContent = best;
    elRecord.style.display = isRecord ? '' : 'none';
    // dish plates cooked
    elPlates.innerHTML = '';
    dishesCooked.slice(0, 8).forEach(function (slug) {
      var d = document.createElement('div');
      d.className = 'pp-over-plate';
      if (PHOTO[slug]) d.style.backgroundImage = 'url(assets/resources/images/Carta/480w/' + slug + '_480w.webp)';
      elPlates.appendChild(d);
    });
    over.classList.add('is-show');
  }

  function enterGrifo() {
    isGrifo = true; grifoT = GRIFO_TIME; invuln = 0;
    grifoSpin = 0; grifoSpinT = 0; grifoSpinCd = 1.8; grifoBank = 0;
    flash = 1; shake = REDUCED ? 0 : 6;
    transformT = 0.48;           // pollo → morph-1 → morph-2 → grifo (~0.16s each)
    fireT = 0;
    SFX.fanfare();
    stage.classList.add('is-grifo');
  }
  function exitGrifo() {
    isGrifo = false; flash = 1; invuln = 1.0;
    transformT = 0; exitMorphT = 0.16; // brief morph-2 flash back to pollo
    stage.classList.remove('is-grifo');
  }

  // ── Update ────────────────────────────────────────────────────────────────
  function update(dt) {
    bobT += dt;
    if (state === S_TITLE) { updateScenery(dt); updateTitleFans(dt); return; }
    // GAME OVER: freeze the whole run — no spawning, scoring or world movement.
    // Only the ambient brasas flames keep flickering.
    if (state === S_OVER) { updateScenery(dt); return; }

    if (paused) return;
    if (countdown > 0) { countdown -= dt; if (countdown < 0) countdown = 0; return; }

    var sdt = dt * (state === S_DYING ? timeScale : 1);
    var spd = speedNow();

    if (flash > 0) flash = Math.max(0, flash - dt * 2.4);
    if (shake > 0) shake = Math.max(0, shake - dt * 26);
    updateScenery(sdt);
    beakFl.tick(sdt);
    trailFl.forEach(function (f) { f.tick(sdt); });

    if (state === S_DYING) {
      deathT += dt;
      vy += GRAVITY * sdt; py += vy * sdt;
      rot += 9 * sdt;
      // keep world drifting slowly
      scrollEntities(spd * 0.4, sdt);
      updateParticles(sdt);
      if (deathT > 0.9) gameOver();
      return;
    }

    // ── PLAYING ──
    // physics
    vy += GRAVITY * sdt;
    if (vy > TERMINAL) vy = TERMINAL;
    py += vy * sdt;
    if (flapFrameT > 0) flapFrameT -= dt;
    if (invuln > 0) invuln -= dt;
    flapClock += dt;
    // sustained-dive tracker: only a long real drop (not an inter-flap dip) counts
    if (vy > 0) fallDiveT += dt; else fallDiveT = 0;
    if (fireT > 0) fireT -= dt;
    if (transformT > 0) {
      var before = transformT;
      transformT -= dt;
      // flat cream/orange wash pulse at each morph frame boundary (no glow)
      if ((before > 0.32 && transformT <= 0.32) || (before > 0.16 && transformT <= 0.16)) flash = 0.7;
      if (transformT < 0) transformT = 0;
    }
    if (exitMorphT > 0) exitMorphT -= dt;

    // rotation lerp: map vy → angle. EL GRIFO flies like an eagle — a gentler,
    // symmetric tilt (nose up climbing / down diving, ~±22°) plus a slow bank;
    // the pollo keeps its snappier flap-tilt.
    var targ;
    if (isGrifo) {
      grifoBank = Math.sin(bobT * 2.2) * 0.09;         // subtle side bank/bob
      targ = Math.max(-0.40, Math.min(0.55, vy / 620 * 0.42)) + grifoBank;
    } else {
      targ = vy < 0 ? -0.35 : Math.min(1.13, vy / TERMINAL * 1.13);
    }
    rot += (targ - rot) * Math.min(1, dt * 10);

    // ceiling clamp (no death at top)
    if (py - HIT_R < 4) { py = 4 + HIT_R; if (vy < 0) vy = 0; }

    // grifo timer / meter + periodic barrel flip
    if (isGrifo) {
      grifoT -= dt;
      fuego = Math.max(0, grifoT / GRIFO_TIME);
      if (grifoT <= 0) exitGrifo();
      if (grifoSpinT > 0) {                            // mid barrel-roll (full 360°)
        grifoSpinT -= dt;
        grifoSpin = (1 - Math.max(0, grifoSpinT) / GRIFO_SPIN_DUR) * Math.PI * 2;
        if (grifoSpinT <= 0) { grifoSpin = 0; grifoSpinCd = 2.6 + Math.random() * 1.8; }
      } else if (transformT <= 0) {
        grifoSpinCd -= dt;
        if (grifoSpinCd <= 0) grifoSpinT = GRIFO_SPIN_DUR;
      }
    }

    // spawns
    obstTimer += dt;
    if (obstTimer >= OBST_EVERY) { obstTimer -= OBST_EVERY; spawnObstacle(); }
    chiliTimer -= dt;
    if (chiliTimer <= 0) { spawnChiliGroup(); chiliTimer = mode === 'easy' ? (0.7 + Math.random() * 0.8) : (1.5 + Math.random() * 1.6); }

    scrollEntities(spd, sdt);

    // fires
    for (var i = fires.length - 1; i >= 0; i--) {
      var fr = fires[i];
      fr.x += FIRE_SPEED * sdt; fr.life -= dt; fr.fl.tick(dt);
      if (fr.x > worldW + 80 || fr.life <= 0) { fires.splice(i, 1); continue; }
      // vs bottle halves — 1 damage per fireball, hp=2 (crack → shatter)
      var hit = false;
      for (var o = 0; o < obstacles.length && !hit; o++) {
        var ob = obstacles[o];
        var bw = ob.w = BOTTLE_W * BODY_F;
        var left = ob.x - bw / 2, right = ob.x + bw / 2;
        if (fr.x > left && fr.x < right) {
          // each half is independent: a fireball hits the ONE half in its lane, and
          // that half alone takes the damage (hp per difficulty). Breaking one half
          // opens a passage on that side; the other half stays.
          if (ob.top.alive && fr.y < ob.gapY - ob.gapH / 2) {
            damageHalf(ob, 'top', fr.y); hit = true;
          } else if (ob.bot.alive && fr.y > ob.gapY + ob.gapH / 2) {
            damageHalf(ob, 'bot', fr.y); hit = true;
          }
        }
      }
      // vs grills (cook)
      for (var g = 0; g < grills.length && !hit; g++) {
        var gr = grills[g];
        if (!gr.cooked && Math.abs(fr.x - gr.x) < PLATE_R && Math.abs(fr.y - gr.y) < PLATE_R) {
          cook(gr); hit = true;
        }
      }
      if (hit) fires.splice(i, 1);
    }

    // chili pickups + magnet in grifo
    for (var c = chilis.length - 1; c >= 0; c--) {
      var ch = chilis[c];
      if (ch.x < -80) { chilis.splice(c, 1); continue; }
      ch.y = ch.base + Math.sin(bobT * 2 + ch.phase) * ch.amp;
      if (isGrifo && !ch.got) {
        var ddx = playerX - ch.x, ddy = py - ch.y, dist = Math.hypot(ddx, ddy);
        if (dist < 340) { ch.x += ddx / dist * 520 * dt; ch.y += ddy / dist * 520 * dt; }
      }
      if (!ch.got && Math.hypot(ch.x - playerX, ch.y - py) < HIT_R + CHILI_W * 0.4) {
        ch.got = true; chilis.splice(c, 1);
        if (chili < MAX_CHILI) chili++;
        SFX.chili();
      }
    }

    // grill scoring updates (burn anim)
    for (var g2 = grills.length - 1; g2 >= 0; g2--) {
      var gr2 = grills[g2];
      gr2.ca.tick(dt); gr2.cb.tick(dt);
      if (gr2.burn > 0) gr2.burn = Math.max(0, gr2.burn - dt);
      if (gr2.label > 0) gr2.label -= dt;
      if (gr2.x < -PLATE_R - 40) grills.splice(g2, 1);
    }

    // obstacle scoring + collision
    for (var k = obstacles.length - 1; k >= 0; k--) {
      var obk = obstacles[k];
      if (obk.x < -BOTTLE_W) { obstacles.splice(k, 1); continue; }
      // full-block: telegraph by sliding the gap shut as it approaches (both
      // halves still intact). Once a half is broken it stops closing.
      if (obk.full && obk.top.alive && obk.bot.alive) {
        var closeStart = worldW * 0.72, closeEnd = playerX + 260;
        var fOpen = Math.max(0, Math.min(1, (obk.x - closeEnd) / (closeStart - closeEnd)));
        obk.gapH = obk.fullGapMax * fOpen;   // → 0 at the player: no passable gap
      }
      if (obk.top.stump > 0) obk.top.stump -= dt;
      if (obk.bot.stump > 0) obk.bot.stump -= dt;
      if (!obk.passed && obk.x < playerX) { obk.passed = true; score++; SFX.point(); }
      // collision
      var invin = invuln > 0;
      var bw2 = BOTTLE_W * BODY_F, half = bw2 / 2;
      var withinX = playerX + HIT_R > obk.x - half && playerX - HIT_R < obk.x + half;
      if (withinX) {
        var topEdge = obk.gapY - obk.gapH / 2, botEdge = obk.gapY + obk.gapH / 2;
        var hitTop = obk.top.alive && (py - HIT_R < topEdge);
        var hitBot = obk.bot.alive && (py + HIT_R > botEdge);
        if (hitTop || hitBot) {
          if (isGrifo) {
            // smash through
            if (hitTop && obk.top.alive) { obk.top.alive = false; smashBottle(obk.x, topEdge - 40); }
            if (hitBot && obk.bot.alive) { obk.bot.alive = false; smashBottle(obk.x, botEdge + 40); }
          } else if (!invin) {
            die(); return;
          }
        }
      }
    }

    // ground death
    if (py + HIT_R > groundY) {
      if (isGrifo) { py = groundY - HIT_R; if (vy > 0) vy = 0; }
      else { py = groundY - HIT_R; die(); return; }
    }

    updateParticles(sdt);
  }

  function scrollEntities(spd, sdt) {
    var d = spd * sdt;
    for (var i = 0; i < obstacles.length; i++) obstacles[i].x -= d;
    for (var j = 0; j < grills.length; j++) grills[j].x -= d;
    for (var c = 0; c < chilis.length; c++) chilis[c].x -= d;
  }
  function smashBottle(x, y) {
    spawnShards(x, y, isGrifo ? CREAM : INK); spawnPoof(x, y, 1.0);
    score += 2; SFX.smash(); shake = REDUCED ? 0 : 5;
  }

  // ── 2-hit bottle damage (v2.3) ─────────────────────────────────────────────
  // Impact point = fireball y at collision, clamped into the visible glass band
  // near the gap so the flat-ink crack overlay always lands on the bottle sprite.
  function damageHalf(ob, which, fy) {
    var seg = ob[which];
    if (!seg.alive) return;
    var topEdge = ob.gapY - ob.gapH / 2, botEdge = ob.gapY + ob.gapH / 2;
    var capShow = (BOTTLE_W * BOTTLE_RATIO) * 0.5;
    var iy = which === 'top'
      ? Math.max(topEdge - capShow * 0.82, Math.min(topEdge - 16, fy))
      : Math.min(botEdge + capShow * 0.82, Math.max(botEdge + 16, fy));
    seg.hp -= 1;
    if (seg.hp <= 0) {
      seg.alive = false; seg.stump = 0.12; seg.stumpY = iy;
      shatterHalf(ob.x, iy);
    } else {
      seg.crack = makeCrack(iy);           // seeded once, stored → stable each frame
      SFX.crack(); shake = REDUCED ? 0 : 3;
      spawnShards(ob.x - BOTTLE_W * 0.4, iy, INK); // a couple of ink flecks
    }
  }
  // 2nd hit → shatter: 6–9 flat shards (ink + a few orange), poof, shake, +2.
  function shatterHalf(x, y) {
    var n = REDUCED ? 4 : 6 + (Math.random() * 4 | 0);
    for (var i = 0; i < n; i++) {
      var p = getParticle();
      p.on = true; p.kind = 'shard'; p.x = x; p.y = y;
      var a = Math.random() * Math.PI * 2, sp = 140 + Math.random() * 280;
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - 140;
      p.life = p.max = 0.6 + Math.random() * 0.5;
      p.rot = Math.random() * Math.PI; p.vr = (Math.random() - 0.5) * 12;
      p.size = 10 + Math.random() * 16;
      p.col = (i % 4 === 0) ? ORANGE : INK; // a few orange shards from the label
    }
    spawnPoof(x, y, 1.0);
    score += 2; SFX.smash(); shake = REDUCED ? 0 : 5;
    // Breaking a bottle DRAINS the fuego meter (item 13) — cooking is the only
    // way to charge it. Points still awarded above; fuego is never added by glass.
    fuego = Math.max(0, fuego - 0.25);
  }
  // Seed one random crack variant + all its jitter, in LOCAL coords whose origin
  // is the bottle's near (player-facing) edge at impact y. +x points into the body.
  function makeCrack(iyAbs) {
    var variant = ['simple', 'web', 'chip'][(Math.random() * 3) | 0];
    var bodyW = BOTTLE_W * 0.98;
    var maxLen = bodyW * 0.72;
    var rays = [], arcs = [], bite = null, spikes = [], flecks = [];
    var nRays = variant === 'chip' ? (3 + (Math.random() * 2 | 0)) : (3 + (Math.random() * 3 | 0));
    for (var r = 0; r < nRays; r++) {
      var a = (Math.random() * Math.PI - Math.PI / 2); // -90°..+90° → into the body
      var pts = [{ x: 0, y: 0 }];
      var px = 0, py = 0;
      var steps = 3 + (Math.random() * 3 | 0);
      var segLen = maxLen / (2 + (Math.random() * 2 | 0));
      for (var s2 = 0; s2 < steps; s2++) {
        a += (Math.random() - 0.5) * 0.9;
        var l = segLen * (0.5 + Math.random() * 0.7);
        px += Math.cos(a) * l; py += Math.sin(a) * l;
        if (px < 2) px = 2;                 // never exit back through the near edge
        pts.push({ x: px, y: py });
      }
      rays.push(pts);
    }
    if (variant === 'web') {
      var nArc = 1 + (Math.random() * 2 | 0);
      for (var q = 0; q < nArc; q++) {
        var rad = maxLen * (0.26 + q * 0.22 + Math.random() * 0.1);
        var wob = [], segs = 10;
        for (var w = 0; w <= segs; w++) wob.push((Math.random() - 0.5) * rad * 0.14);
        arcs.push({ r: rad, wob: wob });
      }
    }
    if (variant === 'chip') {
      var bh = 26 + Math.random() * 22, bw2 = 18 + Math.random() * 16;
      bite = [{ x: -8, y: -bh * 0.6 }, { x: bw2 * 0.5, y: -bh * 0.3 },
              { x: bw2, y: 0 }, { x: bw2 * 0.5, y: bh * 0.35 }, { x: -8, y: bh * 0.6 }];
      var ns = 4 + (Math.random() * 3 | 0);
      for (var k = 0; k < ns; k++) {
        var yy = -bh * 0.6 + (ns > 1 ? (k / (ns - 1)) : 0.5) * bh * 1.2;
        var sx = bw2 * (0.5 + Math.random() * 0.6);
        spikes.push([{ x: 0, y: yy - 6 }, { x: sx, y: yy }, { x: 0, y: yy + 6 }]);
      }
      for (var f = 0; f < 3; f++) flecks.push({ x: bw2 + 8 + Math.random() * 20, y: (Math.random() - 0.5) * bh * 1.4, s: 4 + Math.random() * 5 });
    }
    return { variant: variant, yAbs: iyAbs, rays: rays, arcs: arcs, bite: bite, spikes: spikes, flecks: flecks };
  }
  function cook(gr) {
    gr.cooked = true; gr.burn = 0.4; gr.label = 1.6;
    spawnPoof(gr.x, gr.y, 1.2);
    score += 5;
    dishesCooked.push(gr.slug);
    SFX.cook();
    if (!isGrifo) {
      fuego = Math.min(1, fuego + fuegoPerDish());
      if (fuego >= 1) enterGrifo();
    }
  }

  // ── Ground brasas + abanico fire fans + parallax hills ──────────────────────
  // A ground fan = a tight fanned cluster of brand flame tongues (menu "abanico"
  // style). Each spawns, grows, holds, fades → sporadic, never a uniform row.
  function makeFan(cfg) {
    var n = cfg.n || (5 + (Math.random() * 4 | 0));
    var fls = [];
    for (var i = 0; i < n; i++) fls.push(new Flicker());
    return {
      x: cfg.x, baseY: cfg.baseY, n: n,
      span: cfg.span, h: cfg.h, spread: cfg.spread,
      back: !!cfg.back, drift: cfg.drift || 0, fls: fls,
      t: 0, tIn: cfg.tIn || (0.5 + Math.random() * 0.4),
      tHold: cfg.tHold || (1.4 + Math.random() * 2.4),
      tOut: cfg.tOut || (0.7 + Math.random() * 0.7),
      persist: !!cfg.persist        // title fans never die
    };
  }
  function spawnGroundFan() {
    var back = Math.random() < 0.5;
    groundFans.push(makeFan({
      x: Math.random() * worldW,
      baseY: groundY + (back ? 8 : 12),
      span: 110 + Math.random() * 180,          // cluster width (bigger, denser)
      h: 120 + Math.random() * 140,             // tongue height (was 44–100)
      spread: 0.42 + Math.random() * 0.34,      // ± fan angle
      n: 5 + (Math.random() * 4 | 0),
      back: back,
      drift: 8 + Math.random() * 16
    }));
  }
  function fanAmp(f) {
    if (f.persist) return 1;
    if (f.t < f.tIn) return f.t / f.tIn;                        // grow
    if (f.t < f.tIn + f.tHold) return 1;                        // hold
    return Math.max(0, 1 - (f.t - f.tIn - f.tHold) / f.tOut);   // fade
  }
  function tickFans(list, dt, drift) {
    for (var i = list.length - 1; i >= 0; i--) {
      var f = list[i];
      for (var j = 0; j < f.fls.length; j++) f.fls[j].tick(dt);
      if (f.persist) continue;
      f.t += dt;
      if (drift) { f.x -= f.drift * dt; if (f.x < -f.span) f.x = worldW + f.span; }
      if (f.t > f.tIn + f.tHold + f.tOut) list.splice(i, 1);
    }
  }
  function rebuildScenery() {
    groundFans = []; fanSpawnT = 0;
    // seed a couple so the ground isn't bare on the very first frames
    spawnGroundFan(); spawnGroundFan();
    bgHills = [];
    var n = 4;
    for (var i = 0; i < n; i++) {
      bgHills.push({
        x: (i / n) * worldW + Math.random() * 120,
        r: 180 + Math.random() * 220,
        y: groundY + 40 + Math.random() * 30,
        sp: 18 + Math.random() * 14
      });
    }
    rebuildTitleFans();
  }
  // Framing abanico fans anchored to the title composition's bottom corners
  // (persistent). Kept low + to the outer edges so the central text column stays
  // clean — critical in narrow PORTRAIT where the corners crowd the centre.
  function rebuildTitleFans() {
    titleFans = [];
    var by = groundY;                 // sit on the ground line, tops ≈ groundY − h
    var h = WORLD_H * 0.135;
    titleFans.push(makeFan({ x: worldW * 0.14, baseY: by, span: worldW * 0.32, h: h, spread: 0.5, n: 9, persist: true }));
    titleFans.push(makeFan({ x: worldW * 0.86, baseY: by, span: worldW * 0.32, h: h, spread: 0.5, n: 9, persist: true }));
  }
  function updateScenery(dt) {
    tickFans(groundFans, dt, state === S_PLAY);
    // sporadic spawner: keep a few live at random spots, never a constant row
    fanSpawnT -= dt;
    if (fanSpawnT <= 0 && groundFans.length < 6) {
      spawnGroundFan();
      fanSpawnT = 0.5 + Math.random() * 1.3;
    }
    for (var h = 0; h < bgHills.length; h++) {
      bgHills[h].x -= bgHills[h].sp * dt * (state === S_PLAY ? 1 : 0.3);
      if (bgHills[h].x < -bgHills[h].r) bgHills[h].x += worldW + bgHills[h].r * 2;
    }
  }
  function updateTitleFans(dt) { tickFans(titleFans, dt, false); }

  // Draw one fanned abanico cluster rooted at (f.x, f.baseY). Two passes: a
  // slightly-larger ink silhouette (flat woodcut separation) then brand orange.
  function drawFan(f, amp) {
    if (amp <= 0.01) return;
    for (var pass = 0; pass < 2; pass++) {
      var col = pass === 0 ? INK : ORANGE, pad = pass === 0 ? 7 : 0;
      for (var i = 0; i < f.n; i++) {
        var frac = f.n > 1 ? (i / (f.n - 1)) - 0.5 : 0; // -0.5 … 0.5
        var ang = frac * f.spread * 2;
        var fx = f.x + frac * f.span;
        var taper = 0.72 + 0.28 * Math.cos(ang * 1.05);  // centre tongues tallest
        var fw = f.h * 0.30 * amp;
        var fh = f.h * amp * taper;
        drawFlame(ctx, f.fls[i % f.fls.length].f, fx, f.baseY, fw + pad, fh + pad, col, ang);
      }
    }
  }
  function drawGroundFans(back) {
    // Floor flames removed — clean charcoal ground strip only.
    return;
  }

  // ── Rendering ────────────────────────────────────────────────────────────────
  function theme() {
    return isGrifo
      ? { bg: INK, fg: CREAM, hill: INK_HILL_DARK, dark: true }
      : { bg: CREAM, fg: INK, hill: BRAND100, dark: false };
  }
  function spriteFor(name) { return (isGrifo && VAR[name]) ? VAR[name] : SPR[name]; }

  function draw() {
    window.__ppDbg = { state: state, chili: chili, fuego: fuego, isGrifo: isGrifo, obst: obstacles.length };
    var t = theme();
    var s = (canvas.height) / WORLD_H;   // device px per world unit (uniform)
    ctx.setTransform(s, 0, 0, s, 0, 0);

    var sx = 0, sy = 0;
    if (shake > 0) { sx = (Math.random() - 0.5) * shake; sy = (Math.random() - 0.5) * shake; }
    ctx.save();
    ctx.translate(sx, sy);

    // background
    ctx.fillStyle = t.bg;
    ctx.fillRect(-20, -20, worldW + 40, WORLD_H + 40);

    // parallax hills (flat, distant)
    ctx.fillStyle = t.hill;
    for (var h = 0; h < bgHills.length; h++) {
      var hl = bgHills[h];
      ctx.beginPath(); ctx.arc(hl.x, hl.y, hl.r, Math.PI, 0); ctx.fill();
    }

    if (state === S_TITLE) { drawTitle(t); ctx.restore(); return; }

    // FLOOR FIRE (item 11): BACK abanico fans first, so they peek out from behind
    // the ground strip and the obstacle bases.
    drawGroundFans(true);

    // obstacles
    for (var i = 0; i < obstacles.length; i++) drawObstacle(obstacles[i], t);
    // grills + dishes
    for (var g = 0; g < grills.length; g++) drawGrill(grills[g], t);
    // chilis
    for (var c = 0; c < chilis.length; c++) drawChili(chilis[c]);
    // fires
    for (var f = 0; f < fires.length; f++) {
      var fr = fires[f];
      drawFlame(ctx, fr.fl.f, fr.x, fr.y, 70, 118, ORANGE, Math.PI / 2);
      drawFlame(ctx, (fr.fl.f + 3) % FLAME.length, fr.x - 26, fr.y, 46, 84, isGrifo ? CREAM : ORANGE, Math.PI / 2);
    }

    drawParticles(t);
    drawGround(t);
    // FRONT abanico fans — over the floor strip, under the bird.
    drawGroundFans(false);
    drawPlayer(t);
    drawHUD(t);
    if (paused) drawPauseOverlay(t);
    else if (countdown > 0) drawCountdown(t);

    ctx.restore();

    // white/flash wash (flat, low alpha — palette swap moment)
    if (flash > 0) {
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.globalAlpha = flash * 0.5;
      ctx.fillStyle = isGrifo ? ORANGE : CREAM;
      ctx.fillRect(0, 0, worldW, WORLD_H);
      ctx.globalAlpha = 1;
    }
  }

  function drawObstacle(ob, t) {
    var img = spriteFor('botella');
    var half = BOTTLE_W / 2;
    var spriteH = BOTTLE_W * BOTTLE_RATIO;
    // The bottle body spans nearly the full sprite width, so match it: the flat
    // ink wall then reads as one continuous body with the drawn glass (no seam).
    var bodyW = BOTTLE_W * 0.98;
    // How much cap+neck+shoulder to keep visible at the gap opening. Cutting at
    // 0.5·spriteH lands the seam on the full-width body, so it is invisible.
    var capShow = spriteH * 0.5;
    var topEdge = ob.gapY - ob.gapH / 2, botEdge = ob.gapY + ob.gapH / 2;

    ctx.fillStyle = t.fg;
    // TOP obstacle: bottle flipped vertically, cap (opening) points down into gap.
    if (ob.top.alive) {
      var tWallBot = topEdge - capShow;               // wall runs from top edge to here
      if (tWallBot > -40) ctx.fillRect(ob.x - bodyW / 2, -40, bodyW, tWallBot + 40);
      ctx.save();
      ctx.translate(ob.x, topEdge);
      ctx.scale(1, -1); // flip so cap points down into the gap
      if (img) ctx.drawImage(img, -half, 0, BOTTLE_W, spriteH);
      ctx.restore();
      if (ob.top.crack) drawCrack(ob.top, ob.x, bodyW, t,
        { x: ob.x - bodyW / 2, y: -40, w: bodyW, h: topEdge + 40 });
    } else if (ob.top.stump > 0) {
      drawStump(ob.top, ob.x, bodyW, 'top', t);
    }
    // BOTTOM obstacle: upright, cap at the gap opening, body down to the brasas.
    if (ob.bot.alive) {
      var bWallTop = botEdge + capShow;               // wall runs from here to the ground
      if (bWallTop < WORLD_H + 40) ctx.fillRect(ob.x - bodyW / 2, bWallTop, bodyW, (WORLD_H + 40) - bWallTop);
      if (img) ctx.drawImage(img, ob.x - half, botEdge, BOTTLE_W, spriteH);
      if (ob.bot.crack) drawCrack(ob.bot, ob.x, bodyW, t,
        { x: ob.x - bodyW / 2, y: botEdge, w: bodyW, h: (WORLD_H + 40) - botEdge });
    } else if (ob.bot.stump > 0) {
      drawStump(ob.bot, ob.x, bodyW, 'bot', t);
    }

    // FULL-BLOCK telegraph: orange "closing jaws" chevrons pointing into the gap
    // while both halves live — reads as "this seals the path, break it".
    if (ob.full && ob.top.alive && ob.bot.alive) {
      var aw = bodyW * 0.32, chv = 26;
      ctx.save();
      ctx.globalAlpha = 0.78 + Math.sin(bobT * 6) * 0.2;
      ctx.fillStyle = ORANGE;
      ctx.beginPath();
      ctx.moveTo(ob.x - aw, topEdge - chv); ctx.lineTo(ob.x + aw, topEdge - chv); ctx.lineTo(ob.x, topEdge); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(ob.x - aw, botEdge + chv); ctx.lineTo(ob.x + aw, botEdge + chv); ctx.lineTo(ob.x, botEdge); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // Flat hard-edged ink crack overlay (procedural, seeded → stable). Origin at the
  // bottle's near (player-facing) edge, impact y; +x runs into the body. Clipped
  // to the half so nothing draws off-glass.
  function drawCrack(seg, ox, bodyW, t, clip) {
    var cr = seg.crack;
    ctx.save();
    ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.w, clip.h); ctx.clip();
    ctx.translate(ox - bodyW / 2, cr.yAbs);
    if (cr.variant === 'chip' && cr.bite) {   // carve a bitten chunk out of the glass
      ctx.fillStyle = t.bg;
      ctx.beginPath(); ctx.moveTo(cr.bite[0].x, cr.bite[0].y);
      for (var i = 1; i < cr.bite.length; i++) ctx.lineTo(cr.bite[i].x, cr.bite[i].y);
      ctx.closePath(); ctx.fill();
    }
    // Two-pass hard-edged linework (brand woodcut: cream backing stroke + ink core,
    // like the site cursor) so cracks read on the dark glass AND the light label.
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    function strokeRays(color, lw) {
      ctx.strokeStyle = color; ctx.lineWidth = lw;
      for (var r = 0; r < cr.rays.length; r++) {
        var pts = cr.rays[r];
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (var p = 1; p < pts.length; p++) ctx.lineTo(pts[p].x, pts[p].y);
        ctx.stroke();
      }
      for (var a = 0; a < cr.arcs.length; a++) {   // web: jagged concentric arcs
        var arc = cr.arcs[a], sg = arc.wob.length - 1;
        ctx.beginPath();
        for (var w = 0; w <= sg; w++) {
          var ang = -1.1 + 2.2 * (w / sg), rr = arc.r + arc.wob[w];
          var xx = Math.cos(ang) * rr, yy = Math.sin(ang) * rr;
          if (w === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
      }
    }
    strokeRays(t.bg, 5);    // cream backing
    strokeRays(INK, 2);     // ink core
    for (var s = 0; s < cr.spikes.length; s++) { // chip: glass-spike triangles (ink on the cream bite)
      var tri = cr.spikes[s];
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.moveTo(tri[0].x, tri[0].y);
      ctx.lineTo(tri[1].x, tri[1].y); ctx.lineTo(tri[2].x, tri[2].y);
      ctx.closePath(); ctx.fill();
    }
    for (var f = 0; f < cr.flecks.length; f++) { // chip: ink shard flecks w/ cream edge
      var fk = cr.flecks[f];
      ctx.fillStyle = t.bg; ctx.fillRect(fk.x - fk.s / 2 - 1, fk.y - fk.s / 2 - 1, fk.s + 2, fk.s + 2);
      ctx.fillStyle = INK; ctx.fillRect(fk.x - fk.s / 2, fk.y - fk.s / 2, fk.s, fk.s);
    }
    ctx.restore();
  }

  // Brief jagged glass-spike stump at the break, right after a half shatters.
  function drawStump(seg, ox, bodyW, which, t) {
    var a = Math.min(1, seg.stump / 0.12);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = t.fg;
    var y = seg.stumpY, n = 7, w = bodyW * 0.9, x0 = ox - w / 2, step = w / n;
    var dir = which === 'top' ? 1 : -1; // spikes point into the gap
    ctx.beginPath();
    ctx.moveTo(x0, y - dir * 24);
    for (var i = 0; i < n; i++) {
      var xb = x0 + (i + 0.5) * step, xc = x0 + (i + 1) * step;
      ctx.lineTo(xb, y + dir * (16 + Math.sin(i * 1.7) * 8));
      ctx.lineTo(xc, y - dir * 6);
    }
    ctx.lineTo(x0 + w, y - dir * 24);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawGrill(gr, t) {
    var x = gr.x, y = gr.y;
    var pw = PLATE_R * 2.35, ph = 26;
    // small flickering flames under the grill
    drawFlame(ctx, gr.ca.f, x - pw * 0.24, y + ph * 0.5 + 30, 34, 60, ORANGE, 0);
    drawFlame(ctx, gr.cb.f, x + pw * 0.24, y + ph * 0.5 + 30, 30, 54, ORANGE, 0);
    // ink slab + legs (woodcut flat)
    ctx.fillStyle = t.fg;
    ctx.fillRect(x - pw / 2, y + PLATE_R * 0.5, pw, ph);
    ctx.fillRect(x - pw / 2 + 10, y + PLATE_R * 0.5 + ph, 10, 26);
    ctx.fillRect(x + pw / 2 - 20, y + PLATE_R * 0.5 + ph, 10, 26);
    // orange coal dots
    ctx.fillStyle = ORANGE;
    for (var i = -2; i <= 2; i++) ctx.fillRect(x + i * 22 - 4, y + PLATE_R * 0.5 + 8, 8, 8);

    // plate circle
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, PLATE_R, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = t.dark ? '#26261f' : LIGHT200; ctx.fill();
    ctx.save(); ctx.clip();
    var art = (gr.cooked && PHOTO[gr.slug]) ? PHOTO[gr.slug] : DUO[gr.slug];
    if (art) {
      if (gr.cooked && PHOTO[gr.slug]) {
        var im = PHOTO[gr.slug];
        var sc = Math.max((PLATE_R * 2) / im.width, (PLATE_R * 2) / im.height);
        var w = im.width * sc, hh = im.height * sc;
        ctx.drawImage(im, x - w / 2, y - hh / 2, w, hh);
      } else {
        ctx.drawImage(DUO[gr.slug], x - PLATE_R, y - PLATE_R, PLATE_R * 2, PLATE_R * 2);
      }
    }
    ctx.restore();
    // ink ring
    ctx.lineWidth = 5; ctx.strokeStyle = t.fg;
    ctx.beginPath(); ctx.arc(x, y, PLATE_R, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // cook burst
    if (gr.burn > 0) {
      var a = gr.burn / 0.4;
      drawFlame(ctx, gr.ca.f, x, y, PLATE_R * 2.2 * a, PLATE_R * 2.8 * a, ORANGE, 0);
    }
    // dish label
    if (gr.label > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, gr.label);
      ctx.font = '700 30px ' + FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var txt = (DISH_LABEL[gr.slug] || '') + ' ✓';
      var wLbl = ctx.measureText(txt).width + 28;
      ctx.fillStyle = t.fg;
      roundRect(x - wLbl / 2, y - PLATE_R - 58, wLbl, 40, 10); ctx.fill();
      ctx.fillStyle = t.bg; ctx.fillText(txt, x, y - PLATE_R - 37);
      ctx.restore();
    }
  }

  function drawChili(ch) {
    var img = spriteFor('chili');
    if (img) ctx.drawImage(img, ch.x - CHILI_W / 2, ch.y - CHILI_H / 2, CHILI_W, CHILI_H);
  }

  function drawGround(t) {
    // charcoal brasas strip (the abanico fire fans are drawn separately, so some
    // clusters can sit BEHIND this strip and only peek out above it)
    ctx.fillStyle = t.fg;
    ctx.fillRect(-20, groundY, worldW + 40, GROUND_H + 20);
  }

  // Rooster state machine → which pose sprite to draw this frame.
  function roosterPose() {
    if (isGrifo) {
      if (transformT > 0) {                 // pollo → morph-1 → morph-2 → grifo
        var el = 0.48 - transformT;
        if (el < 0.16) return 'pollo-up';
        if (el < 0.32) return 'morph-1';
        return 'morph-2';
      }
      // eagle flight: climbing / level / diving by vertical velocity
      if (vy < -120 && SPR['grifo-up'])   return 'grifo-up';
      if (vy >  120 && SPR['grifo-down']) return 'grifo-down';
      return 'grifo';
    }
    if (exitMorphT > 0) return 'morph-2';    // brief flash back on grifo exit
    if (state === S_DYING || state === S_OVER) return 'pollo-crash';
    if (fireT > 0) return 'pollo-fire';      // firing overrides rising/falling
    // panic tumble ONLY on a sustained real dive (fast AND falling >~0.45s),
    // never on a normal inter-flap dip.
    if (vy > 520 && fallDiveT > 0.45) return 'pollo-fall';
    if (vy < 0) return (Math.floor(flapClock / 0.09) % 2 === 0) ? 'pollo-up' : 'pollo-down';
    return 'pollo-down';                      // gliding
  }

  function drawPlayer(t) {
    var name = roosterPose();
    var img = spriteFor(name);
    var box = poseBox(name);
    var w = box.w, hh = box.h;

    // blink during post-grifo invuln (skip some frames)
    if (invuln > 0 && Math.floor(invuln * 12) % 2 === 0 && !isGrifo && exitMorphT <= 0) return;

    ctx.save();
    ctx.translate(playerX, py);
    ctx.rotate(rot + (isGrifo ? grifoSpin : 0));   // barrel flip only adds spin in grifo
    // grifo fire trail (3-flame cluster scaled up) — live world fire, behind
    if (isGrifo) {
      var tx = -w * 0.52;
      drawFlame(ctx, trailFl[0].f, tx, hh * 0.05, 70, 150, ORANGE, -Math.PI / 2);
      drawFlame(ctx, trailFl[1].f, tx - 22, hh * 0.12, 54, 120, ORANGE, -Math.PI / 2);
      drawFlame(ctx, trailFl[2].f, tx - 40, -hh * 0.02, 46, 100, ORANGE, -Math.PI / 2);
    }
    if (img) ctx.drawImage(img, -w / 2, -hh / 2, w, hh);
    // FIRING: big UI flame emitted from the beak tip (the fire sprite has no baked
    // flame — this emitted flame does the read). Live world fire → animated frames.
    if (fireT > 0 && !isGrifo && state === S_PLAY) {
      var bx = w * box.bx, by = hh * box.by;
      drawFlame(ctx, beakFl.f, bx, by, 56, 100, ORANGE, Math.PI / 2);
      drawFlame(ctx, (beakFl.f + 3) % FLAME.length, bx + 16, by, 40, 74, ORANGE, Math.PI / 2);
    } else if (state === S_PLAY && !isGrifo && chili > 0) {
      // small idle ember at the beak ONLY when we hold a chili (ammo). The flap
      // sprites have clean beaks, so beak-fire visibility == having ammo.
      drawFlame(ctx, beakFl.f, w * box.bx, hh * box.by, 22, 40, ORANGE, Math.PI / 2 + 0.15);
    }
    ctx.restore();
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────
  // Flat legibility chip: light cream on cream world, ink on dark (grifo) world.
  // Thin ink border, small radius, NO shadow.
  function hudChip(t, x, y, w, h) {
    ctx.fillStyle = t.dark ? '#26261f' : LIGHT200;
    fillRoundRect(x, y, w, h, 12);
    ctx.lineWidth = 2; ctx.strokeStyle = t.fg;
    strokeRect(x, y, w, h, 12);
  }

  function drawHUD(t) {
    var narrow = worldW < 640;

    // chili stock top-left — on a cream chip so it reads over passing bottles
    var cw = 52, ch2 = cw * (178 / 256);
    var stockW = MAX_CHILI * (cw + 8) - 8;
    hudChip(t, 22, 30, stockW + 24, ch2 + 20);
    for (var i = 0; i < MAX_CHILI; i++) {
      var cx = 34 + i * (cw + 8), cy = 40;
      ctx.globalAlpha = i < chili ? 1 : 0.22;
      var img = spriteFor('chili');
      if (img) ctx.drawImage(img, cx, cy, cw, ch2);
      ctx.globalAlpha = 1;
    }

    // fuego meter top-right (or under score if narrow) — NO external label. The
    // identity lives INSIDE the bar: brand fuego icon + small uppercase label,
    // ink so it stays legible over the cream chip and the gold fill.
    var mw = narrow ? worldW * 0.5 : 260, mh = 36;
    var mx = narrow ? (worldW - mw) / 2 : worldW - mw - 34;
    var my = narrow ? 150 : 48;
    hudChip(t, mx - 8, my - 8, mw + 16, mh + 16);
    // frame
    ctx.lineWidth = 3; ctx.strokeStyle = t.fg;
    strokeRect(mx, my, mw, mh, 6);
    // gold fill
    ctx.fillStyle = GOLD;
    var fillW = (mw - 8) * Math.max(0, Math.min(1, fuego));
    if (fillW > 0) { fillRoundRect(mx + 4, my + 4, fillW, mh - 8, 4); }
    // identity INSIDE the bar
    var icoH = mh - 14, icoW = icoH * (256 / 289), pad = 9;
    var fico = SPR['fuego-ink'];
    if (fico) ctx.drawImage(fico, mx + pad, my + (mh - icoH) / 2, icoW, icoH);
    ctx.font = '800 16px ' + FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = INK;
    var lbl = isGrifo ? 'EL GRIFO' : 'FUEGO INTERIOR';
    ctx.fillText(lbl, mx + pad + icoW + 7, my + mh / 2 + 1);

    // score — big Neulis, top center (large enough to read on its own)
    ctx.fillStyle = t.fg;
    ctx.font = '900 ' + (narrow ? 84 : 104) + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(String(score), worldW / 2, 26);

    ctx.textAlign = 'left';
  }

  // ── Title composition (item 16) — bold, solid, on-brand STARTING screen ──────
  // NO demo/attract mode. Framing abanico fire-fans + hero fire-breathing rooster
  // + solid wordmark, instructions and CTA. Everything full-opacity (only the CTA
  // gets a gentle, clearly-legible pulse).
  function rrect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTitle(t) {
    var cx = worldW / 2;
    drawGround(t);
    for (var k = 0; k < titleFl.length; k++) titleFl[k].tick(0.016);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';

    // ── TITLE "PIRI PIRAOS" — bold italic, small brand fire accents on the corners ──
    var tfs = Math.min(worldW * 0.125, 122);
    var l1y = WORLD_H * 0.16, l2y = l1y + tfs * 0.84;
    ctx.font = 'italic 900 ' + tfs + 'px ' + FONT;
    var w1 = ctx.measureText('PIRI').width, w2 = ctx.measureText('PIRAOS').width, s = tfs, capT = tfs * 0.70;
    drawFlame(ctx, titleFl[0].f, cx - w1 * 0.5 - s * 0.14, l1y - capT + s * 0.06, s * 0.20, s * 0.46, ORANGE, -0.70);
    drawFlame(ctx, titleFl[1].f, cx - w1 * 0.5 + s * 0.02, l1y - capT - s * 0.02, s * 0.15, s * 0.34, ORANGE, -0.40);
    drawFlame(ctx, titleFl[2].f, cx + w2 * 0.5 - s * 0.02, l2y + s * 0.04, s * 0.15, s * 0.34, ORANGE, 0.40);
    drawFlame(ctx, titleFl[3].f, cx + w2 * 0.5 + s * 0.14, l2y - s * 0.02, s * 0.20, s * 0.46, ORANGE, 0.70);
    ctx.fillStyle = INK;
    ctx.fillText('PIRI', cx, l1y);
    ctx.fillText('PIRAOS', cx, l2y);

    // ── HERO ROOSTER — fire from the open beak (centered) ──
    var bob = Math.sin(bobT * 1.8) * 9;
    var hy = WORLD_H * 0.45 + bob;
    var box = poseBox('pollo-fire');
    var scale = Math.min(worldW * 0.23, WORLD_H * 0.145) / box.h;
    var bw = box.w * scale, bh = box.h * scale;
    var hx = cx - bw * 0.14;
    beakFl.tick(0.016);
    var bkx = hx + bw * 0.49, bky = hy - bh * 0.07;
    drawFlame(ctx, beakFl.f, bkx, bky, bh * 0.44, bh * 0.78, ORANGE, Math.PI / 2);
    drawFlame(ctx, (beakFl.f + 3) % FLAME.length, bkx + bh * 0.13, bky, bh * 0.30, bh * 0.54, ORANGE, Math.PI / 2);
    var himg = SPR['pollo-fire'];
    if (himg) ctx.drawImage(himg, hx - bw / 2, hy - bh / 2, bw, bh);

    // ── START button — chunky arcade pill (flat ink depth + orange face) ──
    var pulse = 1 + Math.sin(bobT * 2.6) * 0.028;
    var btnW = Math.min(worldW * 0.3, 280) * pulse, btnH = Math.min(worldW * 0.078, 78) * pulse;
    var btnX = cx - btnW / 2, btnY = WORLD_H * 0.585 - btnH / 2, br = btnH / 2;
    rrect(btnX + 6, btnY + 7, btnW, btnH, br); ctx.fillStyle = INK; ctx.fill();       // flat depth
    rrect(btnX, btnY, btnW, btnH, br); ctx.fillStyle = ORANGE; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = '900 ' + (btnH * 0.42) + 'px ' + FONT;
    ctx.textBaseline = 'middle';
    var lbl = 'JUGAR', lblW = ctx.measureText(lbl).width, triW = btnH * 0.30;
    var groupW = triW + btnH * 0.24 + lblW, gx = cx - groupW / 2, my = btnY + btnH / 2;
    ctx.beginPath();
    ctx.moveTo(gx, my - triW * 0.55); ctx.lineTo(gx, my + triW * 0.55); ctx.lineTo(gx + triW * 0.9, my); ctx.closePath(); ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillText(lbl, gx + triW + btnH * 0.24, my + 1);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';

    // ── difficulty toggle — FÁCIL | NORMAL segmented pills ──
    var mLbl = Math.min(worldW * 0.024, 22);
    ctx.font = '900 ' + mLbl + 'px ' + FONT;
    var opts = [['easy', 'FÁCIL'], ['normal', 'NORMAL']];
    var padm = mLbl * 0.9, gapm = mLbl * 0.5, mH = mLbl * 2.1;
    var wds = opts.map(function (o) { return ctx.measureText(o[1]).width + padm * 2; });
    var totW = wds[0] + wds[1] + gapm, mX = cx - totW / 2, mY = WORLD_H * 0.715 - mH / 2;
    titleModeBtns = [];
    var xc = mX;
    for (var mi = 0; mi < opts.length; mi++) {
      var active = mode === opts[mi][0];
      rrect(xc, mY, wds[mi], mH, mH / 2);
      ctx.fillStyle = active ? ORANGE : '#fbf8f5'; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.stroke();
      ctx.fillStyle = INK; ctx.textBaseline = 'middle';
      ctx.fillText(opts[mi][1], xc + wds[mi] / 2, mY + mH / 2 + 1);
      titleModeBtns.push({ x: xc, y: mY, w: wds[mi], h: mH, mode: opts[mi][0] });
      xc += wds[mi] + gapm;
    }
    ctx.textBaseline = 'alphabetic';

    // ── high-score badge — arcade style (ink pill, fuego icon, orange number) ──
    if (best > 0) {
      var numTxt = String(best);
      ctx.font = '900 ' + Math.min(worldW * 0.042, 40) + 'px ' + FONT; var numW = ctx.measureText(numTxt).width;
      ctx.font = '800 ' + Math.min(worldW * 0.026, 24) + 'px ' + FONT; var labW = ctx.measureText('MEJOR').width;
      var icoS = Math.min(worldW * 0.028, 26), pad = 24, gp = 12;
      var bw2 = pad * 2 + icoS + gp + labW + gp + numW, bh2 = Math.min(worldW * 0.056, 54);
      var bx2 = cx - bw2 / 2, by2 = WORLD_H * 0.86 - bh2 / 2, mid = by2 + bh2 / 2;
      rrect(bx2, by2, bw2, bh2, bh2 / 2); ctx.fillStyle = INK; ctx.fill();
      var ico = SPR['fuego-orange'];
      if (ico) ctx.drawImage(ico, bx2 + pad, mid - icoS * 0.6, icoS * 0.9, icoS * 1.2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = CREAM; ctx.font = '800 ' + Math.min(worldW * 0.026, 24) + 'px ' + FONT;
      ctx.fillText('MEJOR', bx2 + pad + icoS + gp, mid + 1);
      ctx.fillStyle = ORANGE; ctx.font = '900 ' + Math.min(worldW * 0.042, 40) + 'px ' + FONT;
      ctx.fillText(numTxt, bx2 + pad + icoS + gp + labW + gp, mid + 1);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    }

    ctx.textAlign = 'left';
  }

  function drawPauseOverlay(t) {
    ctx.fillStyle = 'rgba(29,29,27,0.35)';
    ctx.fillRect(0, 0, worldW, WORLD_H);
    ctx.fillStyle = CREAM;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 64px ' + FONT;
    ctx.fillText('EN PAUSA', worldW / 2, WORLD_H / 2 - 20);
    ctx.font = '700 26px ' + FONT;
    ctx.fillText('TOCA PARA CONTINUAR', worldW / 2, WORLD_H / 2 + 40);
  }
  function drawCountdown(t) {
    var n = Math.ceil(countdown);
    ctx.fillStyle = t.fg;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 160px ' + FONT;
    ctx.globalAlpha = countdown - Math.floor(countdown);
    ctx.fillText(String(n), worldW / 2, WORLD_H / 2);
    ctx.globalAlpha = 1;
  }

  // rounded-rect helpers (flat, hard corners kept subtle)
  function pathRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function roundRect(x, y, w, h, r) { pathRoundRect(x, y, w, h, r); }
  function fillRoundRect(x, y, w, h, r) { pathRoundRect(x, y, w, h, r); ctx.fill(); }
  function strokeRect(x, y, w, h, r) { pathRoundRect(x, y, w, h, r); ctx.stroke(); }

  // ── Resize (DPR aware) ─────────────────────────────────────────────────────
  function resize() {
    var rect = stage.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var cw = Math.max(320, rect.width), chh = Math.max(320, rect.height);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(chh * dpr);
    canvas.style.width = cw + 'px';
    canvas.style.height = chh + 'px';
    worldW = WORLD_H * (cw / chh);
    playerX = worldW * 0.28;
    groundY = WORLD_H - GROUND_H;
    rebuildScenery();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) { try { new ResizeObserver(resize).observe(stage); } catch (e) {} }

  // ── Main loop (fixed timestep accumulator) ──────────────────────────────────
  var last = performance.now(), acc = 0;
  function frame(now) {
    var dt = (now - last) / 1000;
    last = now;
    // Hard clamp: after a stall (backgrounded tab, GC pause, slow first paint)
    // never apply a giant timestep — that used to freefall the bird straight
    // into the ground the instant the game started.
    if (dt > 0.05) dt = 0.05;
    acc += dt;
    if (acc > 0.1) acc = 0.1;
    while (acc >= STEP) { update(STEP); acc -= STEP; }
    draw();
    requestAnimationFrame(frame);
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────
  function boot() {
    applyMute();
    resize();
    showTitle();                 // static, branded starting composition (no demo)
    loadAssets().then(function () { /* assets in */ });
    // make sure fonts are ready for crisp HUD text
    if (document.fonts && document.fonts.load) {
      document.fonts.load('900 100px "Neulis Neue"');
      document.fonts.load('700 24px "Neulis Neue"');
      document.fonts.load('400 68px "Salsita Funk"');
    }
    requestAnimationFrame(frame);
  }
  boot();
})();
