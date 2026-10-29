// 手繪貓咪：每科一隻，各有花色並圍著科目顏色的圍巾。
// 座標單位是「貓高」（屁股底部中心為原點，耳尖約 y = 1），場景再依像素大小縮放。
import * as THREE from 'three';
import { INK, Part, ellipse, inkMaterial, mirrorX, spline, strokeGeometry } from './ink.js';

const LINE = 0.028; // 外框線寬
const PINK = '#f2958a';
const BLUSH = '#f7b7a8';
const WHITE = '#fffdf8';
const NECK = [0, 0.42]; // 頭部旋轉中心
const EYE_Y = 0.63;
const EYE_X = 0.125;

// ── 基本形狀 ──────────────────────────────────────────
const BODY = spline(
  [
    [0, 0], [0.2, 0.005], [0.31, 0.06], [0.33, 0.17], [0.3, 0.3], [0.22, 0.42], [0.1, 0.49], [0, 0.5],
    [-0.1, 0.49], [-0.22, 0.42], [-0.3, 0.3], [-0.33, 0.17], [-0.31, 0.06], [-0.2, 0.005],
  ],
  { closed: true, n: 60 },
);
const HEAD = spline(
  [
    [0, 0.37], [0.18, 0.39], [0.31, 0.47], [0.355, 0.6], [0.33, 0.72],
    [0.3, 0.8], [0.285, 0.9], [0.27, 0.975], [0.21, 0.93], [0.11, 0.86],
    [0, 0.87],
    [-0.11, 0.86], [-0.21, 0.93], [-0.27, 0.975], [-0.285, 0.9], [-0.3, 0.8],
    [-0.33, 0.72], [-0.355, 0.6], [-0.31, 0.47], [-0.18, 0.39],
  ],
  { closed: true, n: 90 },
);
const EAR_R = spline([[0.3, 0.79], [0.285, 0.9], [0.27, 0.972], [0.21, 0.928], [0.11, 0.86], [0.2, 0.8]], { closed: true, n: 24 });
const INNER_EAR_R = spline([[0.258, 0.925], [0.272, 0.835], [0.165, 0.855]], { closed: true, n: 18 });
const SCARF = spline(
  [
    [-0.27, 0.42], [-0.14, 0.395], [0, 0.39], [0.14, 0.395], [0.27, 0.42],
    [0.29, 0.36], [0.27, 0.32], [0.14, 0.305], [0, 0.3], [-0.14, 0.305], [-0.27, 0.32], [-0.29, 0.36],
  ],
  { closed: true, n: 48 },
);
const KNOT = spline([[0.1, 0.33], [0.18, 0.31], [0.215, 0.2], [0.17, 0.165], [0.13, 0.21], [0.08, 0.3]], { closed: true, n: 24 });
const NOSE = spline([[-0.03, 0.586], [0.03, 0.586], [0, 0.556]], { closed: true, n: 18 });
const MOUTH_R = spline([[0, 0.557], [0.008, 0.535], [0.03, 0.527], [0.052, 0.537], [0.061, 0.553]], { n: 14 });
const WHISKERS_R = [
  spline([[0.21, 0.586], [0.29, 0.596], [0.38, 0.612]], { n: 10 }),
  spline([[0.21, 0.556], [0.29, 0.549], [0.37, 0.535]], { n: 10 }),
];

function seg(a, b, n = 8) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  return pts;
}

function tabby(color) {
  return {
    head(p) {
      p.stroke(seg([-0.065, 0.835], [-0.05, 0.77]), color, 0.032);
      p.stroke(seg([0, 0.852], [0, 0.772]), color, 0.034);
      p.stroke(seg([0.065, 0.835], [0.05, 0.77]), color, 0.032);
      for (const s of [1, -1]) {
        p.stroke(seg([0.352 * s, 0.67], [0.28 * s, 0.66]), color, 0.026);
        p.stroke(seg([0.35 * s, 0.632], [0.285 * s, 0.628]), color, 0.024);
      }
    },
    body(p) {
      for (const s of [1, -1]) {
        p.stroke(seg([0.32 * s, 0.25], [0.245 * s, 0.27]), color, 0.03);
        p.stroke(seg([0.33 * s, 0.17], [0.255 * s, 0.18]), color, 0.03);
      }
    },
  };
}

/**
 * 花色。eyes：'ink' 黑豆眼，或 { iris: [左, 右] } 有顏色的眼睛；
 * faceInk：深色毛的貓，閉眼線與鬍鬚要用淺色才看得到。
 */
export const BREEDS = {
  calico: {
    fur: WHITE,
    ears: ['#f2a556', '#4a3f3a'],
    head: (p) => {
      p.fill(ellipse(-0.17, 0.73, 0.12, 0.1, 28, 0.3), '#f2a556');
      p.fill(ellipse(0.2, 0.78, 0.085, 0.07, 28, -0.4), '#4a3f3a');
    },
    body: (p) => {
      p.fill(ellipse(0.17, 0.2, 0.1, 0.09, 28, 0.5), '#f2a556');
      p.fill(ellipse(-0.19, 0.12, 0.07, 0.06, 28), '#4a3f3a');
    },
  },
  siamese: {
    fur: '#f6ead6',
    point: '#7a5a46',
    ears: ['#7a5a46', '#7a5a46'],
    eyes: { iris: ['#7cc3e8', '#7cc3e8'] },
    head: (p) => p.fill(ellipse(0, 0.565, 0.15, 0.1, 32), '#b08b70'),
  },
  black: {
    fur: '#4a413d',
    eyes: { iris: ['#f3d257', '#f3d257'] },
    faceInk: '#efe4d2',
    mouthInk: '#efe4d2',
  },
  blue: {
    fur: '#9fb0c2',
    eyes: { iris: ['#a6d46a', '#a6d46a'] },
    chest: '#c9d4df',
  },
  white: {
    fur: WHITE,
    eyes: { iris: ['#7cc3e8', '#f3d257'] },
  },
  orange: { fur: '#f5a65b', chest: '#fff1df', ...tabby('#d97b3c') },
  tuxedo: {
    fur: '#3f3734',
    paws: WHITE,
    chest: WHITE,
    eyes: { iris: ['#cde36a', '#cde36a'] },
    faceInk: '#efe4d2',
    head: (p) => p.fill(ellipse(0, 0.548, 0.16, 0.1, 32), WHITE),
  },
  cow: {
    fur: WHITE,
    ears: [null, '#3f3734'],
    head: (p) => p.fill(ellipse(0.15, 0.765, 0.12, 0.085, 28, 0.2), '#3f3734'),
    body: (p) => {
      p.fill(ellipse(-0.16, 0.25, 0.09, 0.08, 28, 0.3), '#3f3734');
      p.fill(ellipse(0.2, 0.1, 0.08, 0.06, 28), '#3f3734');
    },
  },
  brown: { fur: '#b98d65', chest: '#f1e1c8', eyes: { iris: ['#a6d46a', '#a6d46a'] }, ...tabby('#6f4f36') },
  cream: { fur: '#f4ddb8', ...tabby('#ddb37a') },
};

// ── 表情與小圖示（以 0,0 為中心、約 1 單位大）──────────
function heart() {
  const pts = [];
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    pts.push([(16 * Math.sin(t) ** 3) / 34, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 34 + 0.05]);
  }
  return pts;
}
const EMOTES = {
  heart: (p) => p.shape(heart(), '#f47b8e', 0.09, { edge: true }),
  sweat: (p) => p.shape(spline([[0, 0.5], [0.24, 0.02], [0.2, -0.3], [0, -0.4], [-0.2, -0.3], [-0.24, 0.02]], { closed: true, n: 36 }), '#a8d8f0', 0.09, { edge: true }),
  question: (p) => {
    p.stroke(spline([[-0.22, 0.24], [-0.1, 0.42], [0.12, 0.42], [0.22, 0.25], [0.12, 0.08], [0, -0.02], [0, -0.14]], { n: 30 }), INK, 0.12, { cap: true });
    p.fill(ellipse(0, -0.36, 0.08, 0.08, 16), INK);
  },
  exclaim: (p) => {
    p.stroke(seg([0, 0.46], [0, -0.1]), INK, 0.15, { taper: 0.4 });
    p.fill(ellipse(0, -0.34, 0.085, 0.085, 16), INK);
  },
  note: (p) => {
    p.fill(ellipse(-0.12, -0.3, 0.16, 0.11, 24, 0.4), INK);
    p.stroke(seg([0.025, -0.27], [0.025, 0.42]), INK, 0.08, { taper: 0 });
    p.stroke(spline([[0.025, 0.42], [0.2, 0.3], [0.25, 0.1]], { n: 12 }), INK, 0.08, { taper: 0.3 });
  },
};
const Z_GLYPH = [[-0.3, 0.3], [0.3, 0.3], [-0.3, -0.3], [0.3, -0.3]];

// 所有貓共用同一份表情幾何與材質
let shared = null;
function sharedEmotes() {
  if (!shared) {
    const emoteGeo = Object.fromEntries(
      Object.entries(EMOTES).map(([k, draw]) => {
        const p = new Part();
        draw(p);
        return [k, p.geometry()];
      }),
    );
    const zGeo = new Part().stroke(Z_GLYPH, '#8a7b70', 0.13, { taper: 0, pressure: 0.2 }).geometry();
    shared = { emoteGeo, zGeo, emoteMat: inkMaterial({ amp: 0.04, seed: 9, allEdge: true }) };
  }
  return shared;
}

// ── 尾巴：每幀重算中心線，直接寫入頂點 ────────────────
const TAIL_N = 14;
const TAIL_BASE = [0.25, 0.08];
const TAIL_LEN = 0.52;
const TAIL_W = 0.085;
const TAIL_CAP = 4;

function tailGeometry(furHex) {
  const part = new Part();
  // 先放一條佔位的直線，頂點位置之後每幀覆寫
  const line = seg([0, 0], [TAIL_LEN, 0], TAIL_N);
  part.add(strokeGeometry(line, TAIL_W + LINE * 2, { taper: 0, cap: true, pressure: 0 }), INK, 0, 0, true);
  part.add(strokeGeometry(line, TAIL_W, { taper: 0, cap: true, pressure: 0 }), furHex);
  const g = part.geometry();
  g.attributes.position.setUsage(THREE.DynamicDrawUsage);
  return g;
}

export class Cat {
  /**
   * @param {{ id: string, breed: string, scarf: string, index: number }} opts
   */
  constructor({ id, breed, scarf, index }) {
    const b = BREEDS[breed];
    this.id = id;
    this.index = index;
    this.material = inkMaterial({ amp: 0.012, seed: index });
    const order = 100 + index * 10;

    this.root = new THREE.Group();

    // 尾巴（畫在身體後面）
    this.tailGeo = tailGeometry(b.point || b.fur);
    this.tail = new THREE.Mesh(this.tailGeo, this.material);
    this.tail.position.set(TAIL_BASE[0], TAIL_BASE[1], 0);
    this.tail.renderOrder = order;
    this.tail.frustumCulled = false;
    this.cx = new Float32Array(TAIL_N + 1);
    this.cy = new Float32Array(TAIL_N + 1);
    this.ch = new Float32Array(TAIL_N + 1);
    this.tx = new Float32Array(TAIL_N + 1);
    this.ty = new Float32Array(TAIL_N + 1);

    // 身體 + 前腳 + 圍巾
    const body = new Part();
    body.fill(BODY, b.fur);
    if (b.chest) body.fill(ellipse(0, 0.22, 0.13, 0.15, 32), b.chest);
    b.body?.(body);
    body.stroke(BODY, INK, LINE, { closed: true, seed: index, edge: true });
    for (const s of [-1, 1]) {
      const paw = ellipse(0.1 * s, 0.04, 0.075, 0.05, 24);
      body.shape(paw, b.paws || b.point || b.fur, LINE * 0.85);
      body.stroke(seg([0.1 * s - 0.022, 0.012], [0.1 * s - 0.022, 0.045], 4), INK, 0.012, { taper: 0.3 });
      body.stroke(seg([0.1 * s + 0.022, 0.012], [0.1 * s + 0.022, 0.045], 4), INK, 0.012, { taper: 0.3 });
    }
    body.shape(SCARF, scarf, LINE * 0.9);
    body.shape(KNOT, scarf, LINE * 0.85);
    this.body = body.mesh(this.material, order + 1);

    // 頭（含耳朵、花紋、鼻子、嘴巴、鬍鬚）
    const head = new Part(NECK);
    head.fill(HEAD, b.fur);
    const [earL, earR] = b.ears || [];
    if (earL) head.fill(mirrorX(EAR_R), earL);
    if (earR) head.fill(EAR_R, earR);
    head.fill(INNER_EAR_R, PINK).fill(mirrorX(INNER_EAR_R), PINK);
    b.head?.(head);
    head.fill(ellipse(-0.205, 0.55, 0.05, 0.026, 20), BLUSH).fill(ellipse(0.205, 0.55, 0.05, 0.026, 20), BLUSH);
    head.stroke(HEAD, INK, LINE, { closed: true, seed: index + 3, edge: true });
    const whisker = b.faceInk || INK;
    for (const w of WHISKERS_R) head.stroke(w, whisker, 0.011, { taper: 0.5 }).stroke(mirrorX(w), whisker, 0.011, { taper: 0.5 });
    head.shape(NOSE, PINK, 0.012);
    const mouth = b.mouthInk || INK;
    head.stroke(MOUTH_R, mouth, 0.016, { taper: 0.3 }).stroke(mirrorX(MOUTH_R), mouth, 0.016, { taper: 0.3 });
    this.head = head.mesh(this.material, order + 2);

    // 眼睛：每種表情一個網格，同時只顯示一個
    this.eyes = {
      open: this.eyePart(b, 'open').mesh(this.material, order + 3),
      closed: this.eyePart(b, 'closed').mesh(this.material, order + 3),
      happy: this.eyePart(b, 'happy').mesh(this.material, order + 3),
      shock: this.eyePart(b, 'shock').mesh(this.material, order + 3),
    };
    for (const m of Object.values(this.eyes)) {
      m.position.set(0, EYE_Y - NECK[1], 0);
      this.head.add(m);
    }

    // 睡覺的 zzz 與頭上的小圖示
    const { emoteGeo: eg, zGeo: zg, emoteMat: em } = sharedEmotes();
    this.zs = [0, 1, 2].map(() => {
      const z = new THREE.Mesh(zg, em);
      z.renderOrder = order + 5;
      z.frustumCulled = false;
      this.root.add(z);
      return z;
    });
    this.emotes = Object.fromEntries(
      Object.entries(eg).map(([k, g]) => {
        const m = new THREE.Mesh(g, em);
        m.renderOrder = order + 6;
        m.frustumCulled = false;
        m.visible = false;
        this.root.add(m);
        return [k, m];
      }),
    );

    this.root.add(this.tail, this.body, this.head);

    // ── 動畫狀態 ──
    this.x = 0;
    this.y = 0;
    this.size = 60;
    this.target = { x: 0, y: 0, size: 60 };
    this.awake = true;
    this.fade = 0;
    this.phase = index * 1.37;
    this.blinkIn = 1 + Math.random() * 3;
    this.blinkT = 0;
    this.hopT = 1;
    this.hopH = 0;
    this.hopDelay = 0;
    this.land = 0;
    this.expr = null;
    this.exprT = 0;
    this.emote = null;
    this.emoteT = 0;
    this.emoteDur = 0;
    this.tilt = 0;
    this.tiltT = 0;
    this.tremble = 0;
    this.look = [0, 0];
    this.lookTarget = [0, 0];
    this.excite = 0;
  }

  eyePart(b, kind) {
    const p = new Part([0, EYE_Y]);
    const lineInk = b.faceInk || INK;
    [-1, 1].forEach((s, i) => {
      const cx = EYE_X * s;
      if (kind === 'open') {
        if (b.eyes?.iris) {
          p.shape(ellipse(cx, EYE_Y, 0.05, 0.056, 28), b.eyes.iris[i], 0.013);
          p.fill(ellipse(cx, EYE_Y - 0.002, 0.018, 0.042, 20), INK);
        } else {
          p.fill(ellipse(cx, EYE_Y, 0.042, 0.052, 28), INK);
        }
        p.fill(ellipse(cx + 0.014, EYE_Y + 0.018, 0.014, 0.016, 12), WHITE);
      } else if (kind === 'closed') {
        p.stroke(spline([[cx - 0.05, EYE_Y + 0.005], [cx, EYE_Y - 0.02], [cx + 0.05, EYE_Y + 0.005]], { n: 12 }), lineInk, 0.02);
      } else if (kind === 'happy') {
        p.stroke(spline([[cx - 0.05, EYE_Y - 0.015], [cx, EYE_Y + 0.018], [cx + 0.05, EYE_Y - 0.015]], { n: 12 }), lineInk, 0.022);
      } else {
        // > <
        const d = s < 0 ? 1 : -1;
        p.stroke([[cx - 0.04 * d, EYE_Y + 0.03], [cx + 0.035 * d, EYE_Y], [cx - 0.04 * d, EYE_Y - 0.03]], lineInk, 0.022, { taper: 0.25 });
      }
    });
    return p;
  }

  setTarget(x, y, size) {
    this.target.x = x;
    this.target.y = y;
    this.target.size = size;
  }

  teleport(x, y, size) {
    this.setTarget(x, y, size);
    this.x = x;
    this.y = y;
    this.size = size;
  }

  /** 是否完全在畫面下方之外 */
  offstage(height) {
    return this.y - this.size * 1.05 > height;
  }

  hop(height = 0.3, delay = 0) {
    this.hopT = 0;
    this.hopH = height;
    this.hopDelay = delay;
  }

  express(kind, dur = 0.9) {
    this.expr = kind;
    this.exprT = dur;
  }

  showEmote(kind, dur = 1.1) {
    this.emote = kind;
    this.emoteT = 0;
    this.emoteDur = dur;
  }

  tiltHead(angle, dur = 1) {
    this.tilt = angle;
    this.tiltT = dur;
  }

  /** 點擊判定：以身體中段為圓心 */
  hit(px, py) {
    return Math.hypot(px - this.x, py - (this.y - this.size * 0.5)) < this.size * 0.55;
  }

  update(dt, t, reduced) {
    const k = 1 - Math.exp(-dt * 7);
    this.x += (this.target.x - this.x) * k;
    this.y += (this.target.y - this.y) * k;
    this.size += (this.target.size - this.size) * k;
    this.fade += ((this.awake ? 0 : 0.55) - this.fade) * (1 - Math.exp(-dt * 4));
    this.material.uniforms.uFade.value = this.fade;
    this.material.uniforms.uAmp.value = reduced ? 0 : 1.1 / this.size;

    // 跳躍：拋物線位移 + 起跳拉長、落地壓扁
    let lift = 0;
    let stretch = 0;
    if (this.hopDelay > 0) this.hopDelay -= dt;
    else if (this.hopT < 1) {
      this.hopT = Math.min(1, this.hopT + dt / 0.46);
      const p = this.hopT;
      lift = this.hopH * 4 * p * (1 - p);
      stretch = 0.1 * Math.sin(Math.PI * p);
      if (this.hopT === 1) this.land = 0.14;
    }
    this.land *= Math.exp(-dt * 9);
    const sy = 1 + stretch - this.land;
    const sx = 1 - stretch * 0.6 + this.land * 0.8;
    let shakeX = 0;
    if (this.tremble > 0) {
      this.tremble -= dt;
      shakeX = Math.sin(t * 60) * 0.025 * Math.min(1, this.tremble * 4);
    }
    this.root.position.set(this.x + shakeX * this.size, -this.y + lift * this.size, 0);
    this.root.scale.set(this.size * sx, this.size * sy, 1);

    // 呼吸、搖頭、尾巴
    const calm = reduced ? 0.3 : 1;
    const asleep = !this.awake;
    this.body.scale.y = 1 + 0.02 * Math.sin(t * (asleep ? 1.3 : 2.2) + this.phase) * calm;
    if (this.tiltT > 0) this.tiltT -= dt;
    const tiltWant = asleep ? 0.16 : this.tiltT > 0 ? this.tilt : 0.05 * Math.sin(t * 0.8 + this.phase) * calm;
    this.head.rotation.z += (tiltWant - this.head.rotation.z) * (1 - Math.exp(-dt * 6));
    this.head.position.y = NECK[1] - (asleep ? 0.03 : 0) * this.fade * 1.8;

    // 眼睛：眨眼、看人、表情
    if (this.exprT > 0) this.exprT -= dt;
    const kind = asleep ? 'closed' : this.exprT > 0 ? this.expr : 'open';
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkT = 0.13;
      this.blinkIn = Math.random() < 0.2 ? 0.25 : 2.2 + Math.random() * 4;
    }
    if (this.blinkT > 0) this.blinkT -= dt;
    this.look[0] += (this.lookTarget[0] - this.look[0]) * (1 - Math.exp(-dt * 8));
    this.look[1] += (this.lookTarget[1] - this.look[1]) * (1 - Math.exp(-dt * 8));
    for (const [name, m] of Object.entries(this.eyes)) {
      m.visible = name === kind;
      if (name === 'open') {
        m.scale.y = this.blinkT > 0 ? 0.12 : 1;
        m.position.x = this.look[0];
        m.position.y = EYE_Y - NECK[1] + this.look[1];
      }
    }

    this.updateTail(t, asleep, calm);

    // zzz：從頭頂右上方飄出，大小 0 → 1 → 0
    this.zs.forEach((z, i) => {
      const show = asleep && this.fade > 0.25 && !reduced;
      z.visible = show;
      if (!show) return;
      const p = (t * 0.45 + i / 3 + this.phase) % 1;
      z.position.set(0.24 + p * 0.22, 0.95 + p * 0.38, 0);
      z.scale.setScalar(0.11 * Math.sin(Math.PI * p) * (0.7 + i * 0.15));
    });

    // 頭上小圖示：彈出 → 停留 → 縮回
    for (const [name, m] of Object.entries(this.emotes)) m.visible = name === this.emote;
    if (this.emote) {
      this.emoteT += dt;
      const e = this.emoteT;
      const d = this.emoteDur;
      const pop = e < 0.22 ? backOut(e / 0.22) : e > d - 0.2 ? Math.max(0, (d - e) / 0.2) : 1;
      const m = this.emotes[this.emote];
      m.position.set(0.34, 1.02 + Math.min(e, 0.4) * 0.12, 0);
      m.scale.setScalar(0.24 * pop);
      m.rotation.z = Math.sin(e * 7) * 0.12;
      if (e >= d) this.emote = null;
    }
  }

  updateTail(t, asleep, calm) {
    const swing = asleep ? 0.12 : 0.42 + this.excite * 0.25;
    const speed = asleep ? 0.9 : 2.1 + this.excite * 2.2;
    let a = asleep ? -0.05 : -0.2;
    let x = 0;
    let y = 0;
    const step = TAIL_LEN / TAIL_N;
    const sway = Math.sin(t * speed + this.phase) * swing * calm;
    for (let i = 0; i <= TAIL_N; i++) {
      const u = i / TAIL_N;
      this.cx[i] = x;
      this.cy[i] = y;
      this.ch[i] = 1 - u * 0.15;
      const da = (asleep ? 0.1 : 0.17) + sway * 0.16 * u + Math.sin(t * speed * 1.3 - i * 0.5 + this.phase) * 0.03 * calm;
      a += da;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
    }
    for (let i = 0; i <= TAIL_N; i++) {
      const j0 = Math.max(0, i - 1);
      const j1 = Math.min(TAIL_N, i + 1);
      let dx = this.cx[j1] - this.cx[j0];
      let dy = this.cy[j1] - this.cy[j0];
      const len = Math.hypot(dx, dy) || 1;
      this.tx[i] = dx / len;
      this.ty[i] = dy / len;
    }
    // 先寫粗的墨線，再寫細的毛色，各自在末端補半圓頭
    const arr = this.tailGeo.attributes.position.array;
    let o = 0;
    const put = (x, y, tx, ty, h) => {
      arr[o++] = x - ty * h;
      arr[o++] = y + tx * h;
      arr[o++] = 0;
      arr[o++] = x + ty * h;
      arr[o++] = y - tx * h;
      arr[o++] = 0;
    };
    const e = TAIL_N;
    for (const w of [TAIL_W + LINE * 2, TAIL_W]) {
      for (let i = 0; i <= TAIL_N; i++) put(this.cx[i], this.cy[i], this.tx[i], this.ty[i], (w / 2) * this.ch[i]);
      const r = (w / 2) * this.ch[e];
      for (let j = 1; j <= TAIL_CAP; j++) {
        const ang = (j / TAIL_CAP) * (Math.PI / 2);
        const d = Math.sin(ang) * r;
        put(this.cx[e] + this.tx[e] * d, this.cy[e] + this.ty[e] * d, this.tx[e], this.ty[e], Math.cos(ang) * r + 1e-4);
      }
    }
    this.tailGeo.attributes.position.needsUpdate = true;
  }
}

function backOut(x) {
  const c = 1.9;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
}
