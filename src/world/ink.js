// 手繪墨線工具：把折線轉成粗細有起伏的筆觸網格，填色則三角化成色塊。
// shader 依「抖動格」（每秒換 8 格、三格循環）讓輪廓微微顫動，模仿手繪動畫的 line boil。
import * as THREE from 'three';

export const INK = '#3b2f2a';
export const PAPER = '#fbf5ea';
// 夜間（黑板）：外框墨線換成粉筆色，背景紙換成黑板色
export const CHALK = '#ece4d4';
export const BOARD = '#232b28';
/** 填色相對墨線稍微錯位，像套色沒對準的印刷 */
const FILL_SHIFT = [0.006, -0.005];

export function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ── 曲線取樣（座標都是 [x, y] 陣列）────────────────────
export function ellipse(cx, cy, rx, ry, n = 32, rot = 0) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return pts;
}

/** 通過各點的平滑曲線（centripetal Catmull-Rom），回傳等距取樣點 */
export function spline(points, { closed = false, n = 40 } = {}) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, y]) => new THREE.Vector3(x, y, 0)),
    closed,
    'centripetal',
  );
  const pts = curve.getSpacedPoints(n).map((v) => [v.x, v.y]);
  return closed ? pts.slice(0, n) : pts;
}

export function mirrorX(points) {
  return points.map(([x, y]) => [-x, y]);
}

// 一維平滑雜訊：讓筆壓（線寬）沿線緩慢起伏
function hash1(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}

/**
 * 折線 → 三角形帶。
 * @param {number[][]} points
 * @param {number} width 線寬（與座標同單位）
 * @param {{ closed?: boolean, taper?: number, cap?: boolean, seed?: number, pressure?: number }} opts
 *   taper：兩端收尖的比例（0 不收）；cap：末端加圓頭；pressure：線寬起伏幅度
 */
export function strokeGeometry(points, width, { closed = false, taper = closed ? 0 : 0.2, cap = false, seed = 0, pressure = 0.3 } = {}) {
  const n = points.length;
  const samples = [];
  for (let i = 0; i < n; i++) {
    const prev = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const u = closed ? i / n : i / Math.max(1, n - 1);
    let w = width * (1 - pressure / 2 + pressure * noise1(u * 5 + seed * 3.7));
    if (taper > 0) w *= Math.max(0.25, Math.min(1, u / taper, (1 - u) / taper)) ** 0.6;
    samples.push({ x: points[i][0], y: points[i][1], tx, ty, h: w / 2 });
  }
  if (cap && !closed && n > 1) {
    const end = samples[n - 1];
    for (let j = 1; j <= 4; j++) {
      const a = (j / 4) * (Math.PI / 2);
      samples.push({ x: end.x + end.tx * end.h * Math.sin(a), y: end.y + end.ty * end.h * Math.sin(a), tx: end.tx, ty: end.ty, h: end.h * Math.cos(a) + 1e-4 });
    }
  }
  const pos = [];
  for (const s of samples) pos.push(s.x - s.ty * s.h, s.y + s.tx * s.h, s.x + s.ty * s.h, s.y - s.tx * s.h);
  const m = samples.length;
  const idx = [];
  const segs = closed ? m : m - 1;
  for (let i = 0; i < segs; i++) {
    const a = 2 * i;
    const b = 2 * ((i + 1) % m);
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  return { pos, idx };
}

export function fillGeometry(points) {
  const contour = points.map(([x, y]) => new THREE.Vector2(x, y));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  return { pos: points.flat(), idx: tris.flat() };
}

/**
 * 一個部位（身體、頭…）的所有色塊與墨線合成一個網格，依加入順序由下往上畫。
 * origin 是部位的旋轉中心，幾何會平移成以它為原點。
 * edge：這條墨線是貼著背景的外框。夜間模式只把外框換成粉筆色，眼睛、嘴巴等五官仍是墨色，畫在淺色毛上才看得到。
 */
export class Part {
  constructor(origin = [0, 0]) {
    this.ox = origin[0];
    this.oy = origin[1];
    this.pos = [];
    this.col = [];
    this.edge = [];
    this.idx = [];
  }

  add({ pos, idx }, hex, dx = 0, dy = 0, edge = false) {
    const base = this.pos.length / 3;
    const [r, g, b] = rgb(hex);
    for (let i = 0; i < pos.length; i += 2) {
      this.pos.push(pos[i] + dx - this.ox, pos[i + 1] + dy - this.oy, 0);
      this.col.push(r, g, b);
      this.edge.push(edge ? 1 : 0);
    }
    for (const k of idx) this.idx.push(base + k);
    return this;
  }

  fill(points, hex) {
    return this.add(fillGeometry(points), hex, FILL_SHIFT[0], FILL_SHIFT[1]);
  }

  /** @param {{ edge?: boolean } & Parameters<typeof strokeGeometry>[2]} [opts] */
  stroke(points, hex, width, opts = {}) {
    return this.add(strokeGeometry(points, width, opts), hex, 0, 0, opts.edge);
  }

  /** 填色 + 墨線外框 */
  shape(points, fillHex, width, { edge = false } = {}) {
    return this.fill(points, fillHex).stroke(points, INK, width, { closed: true, edge });
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('edge', new THREE.Float32BufferAttribute(this.edge, 1));
    g.setIndex(this.idx);
    return g;
  }

  mesh(material, renderOrder) {
    const m = new THREE.Mesh(this.geometry(), material);
    m.position.set(this.ox, this.oy, 0);
    m.renderOrder = renderOrder;
    m.frustumCulled = false;
    return m;
  }
}

// ── 材質 ──────────────────────────────────────────────
const VERT = /* glsl */ `
  uniform float uBoil;
  uniform float uAmp;
  uniform float uSeed;
  attribute float edge;
  varying vec3 vColor;
  varying float vEdge;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    vColor = color;
    vEdge = edge;
    vec2 p = position.xy;
    float s = uBoil * 7.31 + uSeed * 3.17;
    vec2 off = vec2(vnoise(p * 5.0 + s), vnoise(p * 5.0 + s + 19.7)) - 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p + off * 2.0 * uAmp, 0.0, 1.0);
  }`;

const FRAG = /* glsl */ `
  uniform float uFade;
  uniform vec3 uPaper;
  uniform vec3 uTint;
  uniform float uTintAmt;
  uniform float uNight;
  uniform float uAllEdge;
  uniform vec3 uNightFlat;
  uniform float uNightFlatAmt;
  varying vec3 vColor;
  varying float vEdge;
  const vec3 INK = vec3(${rgb(INK).join(', ')});
  const vec3 CHALK = vec3(${rgb(CHALK).join(', ')});
  void main() {
    vec3 c = vColor;
    if (uNight > 0.0) {
      // 夜間：貼著背景的外框墨線換成粉筆色，色塊稍微壓暗；背景塗鴉整個換成淡淡的粉筆灰
      float ink = max(vEdge, uAllEdge) * (1.0 - smoothstep(0.02, 0.1, distance(vColor, INK)));
      vec3 night = mix(mix(c * 0.86, CHALK, ink), uNightFlat, uNightFlatAmt);
      c = mix(c, night, uNight);
    }
    c = mix(c, uTint, uTintAmt);
    float grey = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, mix(vec3(grey), uPaper, 0.6), uFade);
    gl_FragColor = vec4(c, 1.0);
  }`;

/** 全部墨線材質共用的抖動格，每幀由場景更新 */
export const boil = { value: 0 };
/** 全部材質共用：夜間模式（0 或 1）與背景紙色 */
export const night = { value: 0 };
export const paper = { value: new THREE.Vector3(...rgb(PAPER)) };

export function setNightUniforms(on) {
  night.value = on ? 1 : 0;
  paper.value.set(...rgb(on ? BOARD : PAPER));
}

/**
 * 顏色直接用 sRGB 數值（不經 three 的色彩管理），所以這裡的 shader 不做輸出轉換。
 * @param {{ amp?: number, seed?: number, allEdge?: boolean, nightFlat?: string }} opts
 *   amp = 抖動幅度（與幾何同單位）；allEdge：夜間時所有墨線都換成粉筆色（浮在背景上的小圖示）；
 *   nightFlat：夜間時整個網格改成這個顏色（背景塗鴉）
 */
export function inkMaterial({ amp = 0.01, seed = 0, allEdge = false, nightFlat = null } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBoil: boil,
      uAmp: { value: amp },
      uSeed: { value: seed },
      uFade: { value: 0 },
      uPaper: paper,
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uTintAmt: { value: 0 },
      uNight: night,
      uAllEdge: { value: allEdge ? 1 : 0 },
      uNightFlat: { value: new THREE.Vector3(...rgb(nightFlat ?? INK)) },
      uNightFlatAmt: { value: nightFlat ? 1 : 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    vertexColors: true,
    depthTest: false,
    depthWrite: false,
  });
}
