// 答對時噴出的小愛心、星星、肉球、閃光：一張 4 格的貼圖，紅色通道是填色、綠色通道是墨線。
import * as THREE from 'three';
import { INK, rgb } from './ink.js';

const MAX = 360;
const CELLS = 4;
const PALETTE = ['#f47b8e', '#f2b632', '#ffffff', '#f7a5c0'];

export function createParticles(scene, pixelRatio) {
  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 3);
  const life = new Float32Array(MAX);
  const size = new Float32Array(MAX);
  const shape = new Float32Array(MAX);
  const rot = new Float32Array(MAX);
  const vel = new Float32Array(MAX * 2);
  const spin = new Float32Array(MAX);
  const dur = new Float32Array(MAX);
  let cursor = 0;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aShape', new THREE.BufferAttribute(shape, 1));
  geo.setAttribute('aRot', new THREE.BufferAttribute(rot, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: makeAtlas() }, uRatio: { value: pixelRatio }, uInk: { value: new THREE.Vector3(...rgb(INK)) } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aLife;
      attribute float aSize;
      attribute float aShape;
      attribute float aRot;
      uniform float uRatio;
      varying vec3 vColor;
      varying float vLife;
      varying float vShape;
      varying float vRot;
      void main() {
        vColor = aColor;
        vLife = aLife;
        vShape = aShape;
        vRot = aRot;
        // 出生時彈大、臨死前縮小
        float grow = aLife > 0.0 ? min(1.0, (1.0 - aLife) * 8.0 + 0.3) * min(1.0, aLife * 4.0) : 0.0;
        gl_PointSize = aSize * uRatio * grow;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uInk;
      varying vec3 vColor;
      varying float vLife;
      varying float vShape;
      varying float vRot;
      void main() {
        vec2 pc = gl_PointCoord - 0.5;
        float c = cos(vRot);
        float s = sin(vRot);
        pc = vec2(c * pc.x - s * pc.y, s * pc.x + c * pc.y) + 0.5;
        if (pc.x < 0.0 || pc.x > 1.0 || pc.y < 0.0 || pc.y > 1.0) discard;
        vec4 t = texture2D(uMap, vec2((vShape + pc.x) / ${CELLS.toFixed(1)}, 1.0 - pc.y));
        if (t.a < 0.02) discard;
        vec3 color = (vColor * t.r + uInk * t.g) / max(t.r + t.g, 0.001);
        gl_FragColor = vec4(color, t.a);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 900;
  scene.add(points);

  const tmp = new THREE.Color();
  const white = new THREE.Color('#ffffff');

  return {
    /** x, y 為螢幕座標（CSS px） */
    burst(x, y, color, count) {
      const base = new THREE.Color(color);
      for (let n = 0; n < count; n++) {
        const i = cursor;
        cursor = (cursor + 1) % MAX;
        pos[i * 3] = x;
        pos[i * 3 + 1] = -y;
        pos[i * 3 + 2] = 0;
        const a = Math.random() * Math.PI * 2;
        const speed = 110 + Math.random() * 260;
        vel[i * 2] = Math.cos(a) * speed;
        vel[i * 2 + 1] = Math.sin(a) * speed + 150;
        const r = Math.random();
        // 一半用科目色，一半用粉紅、芥末黃等點綴色
        if (r < 0.55) tmp.copy(base).lerp(white, Math.random() * 0.25);
        else tmp.set(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
        // ShaderMaterial 不做色彩轉換，直接放 sRGB 數值
        const srgb = tmp.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
        col[i * 3] = srgb.r;
        col[i * 3 + 1] = srgb.g;
        col[i * 3 + 2] = srgb.b;
        shape[i] = Math.floor(Math.random() * CELLS);
        size[i] = 13 + Math.random() * 13;
        rot[i] = (Math.random() - 0.5) * 1.2;
        spin[i] = (Math.random() - 0.5) * 5;
        dur[i] = 0.8 + Math.random() * 0.5;
        life[i] = 1;
      }
      for (const name of ['aColor', 'aSize', 'aShape']) geo.attributes[name].needsUpdate = true;
    },
    update(dt) {
      const damp = Math.exp(-dt * 2.6);
      let alive = false;
      for (let i = 0; i < MAX; i++) {
        if (life[i] <= 0) continue;
        alive = true;
        vel[i * 2] *= damp;
        vel[i * 2 + 1] = vel[i * 2 + 1] * damp - 520 * dt;
        pos[i * 3] += vel[i * 2] * dt;
        pos[i * 3 + 1] += vel[i * 2 + 1] * dt;
        rot[i] += spin[i] * dt;
        life[i] = Math.max(0, life[i] - dt / dur[i]);
      }
      if (alive) for (const name of ['position', 'aLife', 'aRot']) geo.attributes[name].needsUpdate = true;
    },
  };
}

/** 4 格貼圖：愛心、星星、肉球、閃光。填色畫紅、外框畫綠，shader 再換成實際顏色 */
function makeAtlas() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S * CELLS;
  c.height = S;
  const g = c.getContext('2d');
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const draw = (i, path) => {
    g.save();
    g.translate(i * S + S / 2, S / 2);
    g.fillStyle = '#ff0000';
    g.fill(path);
    g.strokeStyle = '#00ff00';
    g.lineWidth = 4.5;
    g.stroke(path);
    g.restore();
  };

  const heart = new Path2D();
  heart.moveTo(0, 18);
  heart.bezierCurveTo(-26, 2, -20, -22, 0, -10);
  heart.bezierCurveTo(20, -22, 26, 2, 0, 18);
  draw(0, heart);

  const star = new Path2D();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 ? 9 : 21;
    k ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  star.closePath();
  draw(1, star);

  const paw = new Path2D();
  paw.ellipse(0, 8, 12, 10, 0, 0, Math.PI * 2);
  for (const [x, y] of [[-15, -6], [-6, -16], [6, -16], [15, -6]]) {
    paw.moveTo(x + 5, y);
    paw.ellipse(x, y, 5, 6, 0, 0, Math.PI * 2);
  }
  draw(2, paw);

  const spark = new Path2D();
  spark.moveTo(0, -22);
  spark.quadraticCurveTo(3, -3, 22, 0);
  spark.quadraticCurveTo(3, 3, 0, 22);
  spark.quadraticCurveTo(-3, 3, -22, 0);
  spark.quadraticCurveTo(-3, -3, 0, -22);
  draw(3, spark);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
