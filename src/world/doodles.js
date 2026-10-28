// 筆記紙上的手繪小塗鴉：慢慢往上飄。作答時連擊越高飄得越快，顏色也越接近當前科目色。
import * as THREE from 'three';
import { Part, ellipse, inkMaterial, spline } from './ink.js';

const COLOR = '#ddcfb8';
const W = 0.075;

/** 折線：每段補點，轉角才不會被平滑掉 */
function poly(points, per = 6) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    for (let j = 0; j < per; j++) out.push([ax + ((bx - ax) * j) / per, ay + ((by - ay) * j) / per]);
  }
  out.push(points[points.length - 1]);
  return out;
}

function starPoints(n = 5, r1 = 0.5, r2 = 0.24) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? r2 : r1;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

const SHAPES = [
  // 星星
  (p) => p.stroke(spline(starPoints(), { closed: true, n: 60 }), COLOR, W, { closed: true }),
  // 愛心
  (p) => {
    const pts = [];
    for (let i = 0; i < 40; i++) {
      const t = (i / 40) * Math.PI * 2;
      pts.push([(16 * Math.sin(t) ** 3) / 34, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 34]);
    }
    p.stroke(pts, COLOR, W, { closed: true });
  },
  // 肉球
  (p) => {
    p.stroke(spline([[-0.22, -0.08], [0, 0.03], [0.22, -0.08], [0.2, -0.3], [0, -0.38], [-0.2, -0.3]], { closed: true, n: 36 }), COLOR, W, { closed: true });
    for (const [x, y] of [[-0.31, 0.13], [-0.11, 0.3], [0.11, 0.3], [0.31, 0.13]]) p.stroke(ellipse(x, y, 0.075, 0.095, 18), COLOR, W * 0.85, { closed: true });
  },
  // 小魚
  (p) => {
    p.stroke(spline([[-0.42, 0], [-0.15, 0.2], [0.18, 0.12], [0.3, 0], [0.18, -0.12], [-0.15, -0.2]], { closed: true, n: 40 }), COLOR, W, { closed: true });
    p.stroke(poly([[0.3, 0], [0.5, 0.17], [0.48, -0.17], [0.3, 0]]), COLOR, W, { taper: 0 });
    p.fill(ellipse(-0.24, 0.04, 0.035, 0.035, 12), COLOR);
  },
  // π
  (p) => {
    p.stroke(spline([[-0.4, 0.22], [-0.1, 0.28], [0.42, 0.25]], { n: 16 }), COLOR, W);
    p.stroke(spline([[-0.15, 0.26], [-0.17, -0.05], [-0.25, -0.34]], { n: 12 }), COLOR, W);
    p.stroke(spline([[0.15, 0.26], [0.14, -0.18], [0.22, -0.33], [0.33, -0.28]], { n: 14 }), COLOR, W);
  },
  // √x
  (p) => {
    p.stroke(poly([[-0.48, -0.02], [-0.36, 0.05], [-0.2, -0.36], [0, 0.34], [0.48, 0.34]]), COLOR, W, { taper: 0.1 });
    p.stroke(poly([[0.08, 0.18], [0.36, -0.2]]), COLOR, W * 0.9);
    p.stroke(poly([[0.36, 0.18], [0.08, -0.2]]), COLOR, W * 0.9);
  },
  // Σ
  (p) => p.stroke(poly([[0.32, 0.36], [-0.3, 0.36], [0.08, 0], [-0.3, -0.36], [0.32, -0.36]]), COLOR, W, { taper: 0.08 }),
  // 音符
  (p) => {
    p.stroke(ellipse(-0.14, -0.3, 0.15, 0.1, 20, 0.4), COLOR, W, { closed: true });
    p.stroke(poly([[0.0, -0.27], [0.0, 0.42]]), COLOR, W);
    p.stroke(spline([[0.0, 0.42], [0.2, 0.3], [0.25, 0.1]], { n: 12 }), COLOR, W);
  },
  // 閃電
  (p) => p.stroke(poly([[0.1, 0.5], [-0.25, 0.0], [0.02, 0.0], [-0.12, -0.5], [0.28, 0.08], [0.0, 0.08], [0.1, 0.5]]), COLOR, W, { taper: 0 }),
  // 原子
  (p) => {
    for (const r of [0, 1.05, 2.1]) p.stroke(ellipse(0, 0, 0.48, 0.16, 40, r), COLOR, W * 0.8, { closed: true });
    p.fill(ellipse(0, 0, 0.06, 0.06, 12), COLOR);
  },
  // 葉子
  (p) => {
    p.stroke(spline([[-0.4, -0.35], [-0.3, 0.15], [0.1, 0.4], [0.42, 0.42], [0.35, 0.05], [0.05, -0.3]], { closed: true, n: 40 }), COLOR, W, { closed: true });
    p.stroke(spline([[-0.45, -0.45], [-0.05, 0.0], [0.38, 0.38]], { n: 16 }), COLOR, W * 0.8);
  },
  // 燒瓶
  (p) => {
    p.stroke(poly([[-0.1, 0.45], [-0.1, 0.1], [-0.38, -0.38], [0.38, -0.38], [0.1, 0.1], [0.1, 0.45]]), COLOR, W, { taper: 0.05 });
    p.stroke(poly([[-0.2, -0.12], [0.2, -0.12]]), COLOR, W * 0.8);
  },
  // 漩渦
  (p) => {
    const pts = [];
    for (let i = 0; i <= 50; i++) {
      const a = (i / 50) * Math.PI * 4.2;
      const r = 0.04 + (i / 50) * 0.42;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    p.stroke(pts, COLOR, W);
  },
  // 打開的書
  (p) => {
    p.stroke(spline([[0, -0.25], [-0.2, -0.18], [-0.46, -0.25], [-0.46, 0.28], [-0.2, 0.34], [0, 0.26]], { n: 30 }), COLOR, W, { taper: 0 });
    p.stroke(spline([[0, -0.25], [0.2, -0.18], [0.46, -0.25], [0.46, 0.28], [0.2, 0.34], [0, 0.26]], { n: 30 }), COLOR, W, { taper: 0 });
    p.stroke(poly([[0, 0.26], [0, -0.25]]), COLOR, W * 0.8);
  },
  // 問號
  (p) => {
    p.stroke(spline([[-0.2, 0.22], [-0.08, 0.4], [0.14, 0.4], [0.22, 0.22], [0.1, 0.06], [0, -0.04], [0, -0.16]], { n: 30 }), COLOR, W);
    p.fill(ellipse(0, -0.36, 0.05, 0.05, 12), COLOR);
  },
];

export function createDoodles(scene) {
  const material = inkMaterial({ amp: 0.035, seed: 5 });
  const geos = SHAPES.map((draw) => {
    const p = new Part();
    draw(p);
    return p.geometry();
  });
  const items = [];
  let width = 1;
  let height = 1;
  let next = Math.floor(Math.random() * geos.length);

  function spawn(d, anywhere) {
    d.x = Math.random() * width;
    d.y = anywhere ? Math.random() * height : height + 40;
    d.size = 18 + Math.random() * 18;
    d.speed = 6 + Math.random() * 9;
    d.rot = (Math.random() - 0.5) * 0.9;
    d.phase = Math.random() * Math.PI * 2;
  }

  return {
    material,
    resize(w, h) {
      width = w;
      height = h;
      const want = Math.round(Math.min(36, Math.max(10, (w * h) / 22000)));
      while (items.length < want) {
        const mesh = new THREE.Mesh(geos[next++ % geos.length], material);
        mesh.renderOrder = 10 + items.length;
        mesh.frustumCulled = false;
        scene.add(mesh);
        const d = { mesh };
        spawn(d, true);
        items.push(d);
      }
      while (items.length > want) scene.remove(items.pop().mesh);
      for (const d of items) if (d.x > w) d.x = Math.random() * w;
    },
    update(dt, t, speedMul, reduced) {
      for (const d of items) {
        if (!reduced) d.y -= d.speed * speedMul * dt;
        if (d.y < -50) spawn(d, false);
        d.mesh.position.set(d.x + Math.sin(t * 0.4 + d.phase) * 6, -d.y, 0);
        d.mesh.rotation.z = d.rot + Math.sin(t * 0.5 + d.phase) * 0.15;
        d.mesh.scale.setScalar(d.size);
      }
    },
  };
}
