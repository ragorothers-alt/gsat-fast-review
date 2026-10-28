// three.js 背景世界：科目星球繞著能量核心公轉，答題時給粒子與鏡頭回饋。
// 文字與按鈕都在 DOM 上層，這裡只負責視覺與點選星球。
import * as THREE from 'three';
import { SUBJECTS } from './subjects.js';

const BG = 0x070a1c;
const CORE_COLORS = [
  [0, new THREE.Color('#ffd166')],
  [5, new THREE.Color('#38d6ff')],
  [10, new THREE.Color('#f472b6')],
];
// 各畫面的鏡頭與亮度：focusY = 系統中心出現在螢幕由上往下的比例
const LAYOUTS = {
  home: { focusY: 0.34, dim: 1, zoom: 1 },
  play: { focusY: 0.5, dim: 0.28, zoom: 1.15 },
  result: { focusY: 0.3, dim: 0.75, zoom: 1.05 },
};
const ORBIT_MIN = 2.4;
const ORBIT_STEP = 0.36;
const ORBIT_MAX = ORBIT_MIN + ORBIT_STEP * (SUBJECTS.length - 1);
const FOV = 50;
const STAR_COUNT = 1100;
const MAX_PARTICLES = 420;

const NOOP_WORLD = {
  setScene() {},
  setSelected() {},
  setFocusSubject() {},
  setCombo() {},
  pulse() {},
  burst() {},
  shake() {},
  celebrate() {},
  onPlanetTap: null,
};

export function createWorld(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  } catch {
    canvas.hidden = true;
    document.body.classList.add('no-webgl');
    return NOOP_WORLD;
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(BG);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 300);
  const glowTex = makeGlowTexture();

  scene.add(new THREE.AmbientLight(0x8090ff, 0.6));
  const coreLight = new THREE.PointLight(0xfff1c1, 2.4, 0, 0);
  scene.add(coreLight);

  // ── 星空 ──────────────────────────────────────────────
  const starPos = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) resetStar(starPos, i, true);
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({
      size: 0.9,
      map: glowTex,
      color: 0xc9d2ff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  scene.add(stars);

  // ── 核心與星球 ────────────────────────────────────────
  const system = new THREE.Group();
  system.rotation.x = 0.5;
  scene.add(system);

  const coreMat = new THREE.MeshBasicMaterial({ color: CORE_COLORS[0][1].clone() });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 3), coreMat);
  const shellMat = new THREE.MeshBasicMaterial({ color: CORE_COLORS[0][1].clone(), wireframe: true, transparent: true, opacity: 0.35 });
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 1), shellMat);
  const coreGlow = makeSprite(glowTex, '#ffb347', 6.5, 0.85);
  system.add(core, shell, coreGlow);

  const hitTargets = [];
  const planets = SUBJECTS.map((s, i) => {
    const color = new THREE.Color(s.color);
    const radius = ORBIT_MIN + i * ORBIT_STEP;
    const orbit = new THREE.Group();
    orbit.rotation.set(Math.sin(i * 2.1) * 0.12, 0, Math.cos(i * 1.7) * 0.12);
    system.add(orbit);

    const ringMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false });
    const ring = new THREE.LineLoop(circleGeometry(radius, 128), ringMat);
    orbit.add(ring);

    const pivot = new THREE.Group();
    pivot.rotation.y = i * 2.39996; // 黃金角，讓星球錯開
    orbit.add(pivot);

    const holder = new THREE.Group();
    holder.position.set(radius, 0, 0);
    pivot.add(holder);

    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.55, metalness: 0.1 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 16), mat);
    const glow = makeSprite(glowTex, s.color, 1.9, 0.55);
    // 星球很小，另外放一顆看不見的大球當點擊範圍
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 8, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
    );
    hit.userData.subject = s.id;
    hitTargets.push(hit);
    holder.add(mesh, glow, hit);

    return { id: s.id, pivot, holder, mat, glow, ringMat, speed: 0.3 / Math.sqrt(radius), selected: true, focus: false, scale: 1 };
  });

  // ── 粒子爆炸 ──────────────────────────────────────────
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  const pCol = new Float32Array(MAX_PARTICLES * 3);
  const pLife = new Float32Array(MAX_PARTICLES);
  const pSize = new Float32Array(MAX_PARTICLES);
  const pVel = new Float32Array(MAX_PARTICLES * 3);
  let pCursor = 0;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3));
  pGeo.setAttribute('aLife', new THREE.BufferAttribute(pLife, 1));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aLife;
      attribute float aSize;
      uniform float uScale;
      varying vec3 vColor;
      varying float vLife;
      void main() {
        vColor = aColor;
        vLife = aLife;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale * max(aLife, 0.0) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * clamp(vLife, 0.0, 1.0);
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const particles = new THREE.Points(pGeo, pMat);
  particles.frustumCulled = false;
  scene.add(particles);

  // ── 狀態 ──────────────────────────────────────────────
  let mode = 'home';
  const layout = { ...LAYOUTS.home };
  let combo = 0;
  let warp = 0;
  let pulseAmt = 0;
  let shakeT = 0;
  let fitDistance = 20;
  let width = 1;
  let height = 1;
  const coreTarget = CORE_COLORS[0][1].clone();
  const clock = new THREE.Clock();
  const tmpV = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const white = new THREE.Color('#ffffff');

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    // 讓最外圈軌道左右都放得進畫面
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    fitDistance = Math.max(15, (ORBIT_MAX * 1.12) / (tanHalf * camera.aspect));
    const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
    pMat.uniforms.uScale.value = buf.y / (2 * tanHalf);
  }
  resize();
  window.addEventListener('resize', resize);

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const k = 1 - Math.exp(-dt * 3);
    const target = LAYOUTS[mode];
    layout.focusY += (target.focusY - layout.focusY) * k;
    layout.dim += (target.dim - layout.dim) * k;
    layout.zoom += (target.zoom - layout.zoom) * k;

    // 鏡頭
    const dist = fitDistance * layout.zoom;
    let sx = 0;
    let sy = 0;
    if (shakeT > 0) {
      shakeT -= dt;
      const amp = Math.max(0, shakeT) * 1.2;
      sx = (Math.random() - 0.5) * amp;
      sy = (Math.random() - 0.5) * amp;
    }
    camera.position.set(sx, sy, dist);
    camera.lookAt(sx * 0.5, sy * 0.5, 0);
    camera.setViewOffset(width, height, 0, height * (0.5 - layout.focusY), width, height);

    // 核心
    pulseAmt *= Math.exp(-dt * 4);
    const breathe = reduced ? 0 : Math.sin(t * 2) * 0.03;
    core.scale.setScalar(1 + pulseAmt * 0.45 + breathe);
    shell.scale.setScalar(1 + pulseAmt * 0.25);
    coreGlow.scale.setScalar(6.5 * (1 + pulseAmt * 0.6) * (0.6 + 0.4 * layout.dim));
    core.rotation.y += dt * 0.3;
    shell.rotation.y -= dt * 0.15;
    shell.rotation.x += dt * 0.07;
    coreMat.color.lerp(coreTarget, k);
    shellMat.color.copy(coreMat.color);
    coreGlow.material.color.copy(coreMat.color);

    // 星球
    const orbitSpeed = reduced ? 0.25 : mode === 'play' ? 0.5 : 1;
    for (const p of planets) {
      p.pivot.rotation.y += p.speed * dt * orbitSpeed;
      const want = (p.selected ? 1 : 0.55) * (p.focus ? 1.7 : 1);
      p.scale += (want - p.scale) * k;
      p.holder.scale.setScalar(p.scale);
      const lit = (p.selected ? 1 : 0.25) * (p.focus ? 1.6 : 1) * layout.dim;
      p.mat.emissiveIntensity = 0.15 + 0.35 * lit;
      p.glow.material.opacity = 0.65 * lit;
      p.ringMat.opacity = 0.22 * lit;
    }

    // 星空：答題連擊越高，越像在曲速前進
    const warpTarget = mode === 'play' && !reduced ? Math.min(1 + combo * 0.45, 8) : 0;
    warp += (warpTarget - warp) * k;
    if (warp > 0.02) {
      const pos = starGeo.attributes.position;
      const limit = camera.position.z + 2;
      for (let i = 0; i < STAR_COUNT; i++) {
        const z = starPos[i * 3 + 2] + warp * dt * 9;
        if (z > limit) resetStar(starPos, i, false);
        else starPos[i * 3 + 2] = z;
      }
      pos.needsUpdate = true;
    }
    stars.rotation.z += dt * (reduced ? 0.002 : 0.01);

    updateParticles(dt);
    renderer.render(scene, camera);
  }

  function updateParticles(dt) {
    const damp = Math.exp(-dt * 3.2);
    let alive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (pLife[i] <= 0) continue;
      alive = true;
      const j = i * 3;
      pVel[j] *= damp;
      pVel[j + 1] = pVel[j + 1] * damp - 2.2 * dt;
      pVel[j + 2] *= damp;
      pPos[j] += pVel[j] * dt;
      pPos[j + 1] += pVel[j + 1] * dt;
      pPos[j + 2] += pVel[j + 2] * dt;
      pLife[i] -= dt * 1.25;
    }
    if (alive) {
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.aLife.needsUpdate = true;
    }
  }

  /** 把螢幕座標投到核心前方的平面上 */
  function screenToWorld(x, y, planeZ = 3) {
    tmpV.set((x / width) * 2 - 1, -(y / height) * 2 + 1, 0.5).unproject(camera);
    tmpV.sub(camera.position).normalize();
    const dist = (planeZ - camera.position.z) / tmpV.z;
    return tmpV.multiplyScalar(dist).add(camera.position);
  }

  function burst(x, y, color = '#ffd166', count = 36) {
    if (reduced) count = Math.ceil(count / 3);
    const origin = screenToWorld(x, y).clone();
    const base = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = pCursor;
      pCursor = (pCursor + 1) % MAX_PARTICLES;
      const j = i * 3;
      pPos[j] = origin.x;
      pPos[j + 1] = origin.y;
      pPos[j + 2] = origin.z;
      // 球面上隨機方向
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const speed = 2.5 + Math.random() * 4.5;
      pVel[j] = r * Math.cos(th) * speed;
      pVel[j + 1] = r * Math.sin(th) * speed + 1.5;
      pVel[j + 2] = u * speed;
      tmpC.copy(base).lerp(white, Math.random() * 0.45);
      pCol[j] = tmpC.r;
      pCol[j + 1] = tmpC.g;
      pCol[j + 2] = tmpC.b;
      pLife[i] = 0.8 + Math.random() * 0.4;
      pSize[i] = 0.18 + Math.random() * 0.3;
    }
    pGeo.attributes.aColor.needsUpdate = true;
    pGeo.attributes.aSize.needsUpdate = true;
  }

  // ── 點選星球 ──────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || mode !== 'home') return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 500;
    down = null;
    if (moved > 12 || !quick) return;
    ndc.set((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(hitTargets, false)[0];
    if (hit && api.onPlanetTap) {
      const id = hit.object.userData.subject;
      burst(e.clientX, e.clientY, SUBJECTS.find((s) => s.id === id).color, 18);
      api.onPlanetTap(id);
    }
  });

  // 切到背景時停止繪圖省電
  function syncLoop() {
    if (document.hidden) renderer.setAnimationLoop(null);
    else {
      clock.getDelta();
      renderer.setAnimationLoop(frame);
    }
  }
  document.addEventListener('visibilitychange', syncLoop);
  syncLoop();

  const api = {
    onPlanetTap: null,
    setScene(name) {
      mode = name;
      if (name !== 'play') api.setCombo(0);
    },
    setSelected(ids) {
      const set = new Set(ids);
      for (const p of planets) p.selected = set.has(p.id);
    },
    setFocusSubject(id) {
      for (const p of planets) p.focus = p.id === id;
    },
    setCombo(n) {
      combo = n;
      let c = CORE_COLORS[0][1];
      for (const [min, color] of CORE_COLORS) if (n >= min) c = color;
      coreTarget.copy(c);
    },
    pulse() {
      pulseAmt = 1;
    },
    burst,
    shake() {
      if (!reduced) shakeT = 0.35;
    },
    celebrate() {
      const colors = SUBJECTS.map((s) => s.color);
      for (let n = 0; n < 6; n++) {
        setTimeout(() => {
          burst(width * (0.2 + Math.random() * 0.6), height * (0.15 + Math.random() * 0.3), colors[n % colors.length], 40);
        }, n * 160);
      }
      pulseAmt = 1;
    },
  };
  return api;
}

function resetStar(arr, i, anywhere) {
  const j = i * 3;
  arr[j] = (Math.random() - 0.5) * 140;
  arr[j + 1] = (Math.random() - 0.5) * 140;
  arr[j + 2] = anywhere ? -Math.random() * 160 + 10 : -150 - Math.random() * 10;
}

function circleGeometry(radius, segments) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

function makeSprite(map, color, scale, opacity) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  sprite.scale.setScalar(scale);
  return sprite;
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.65)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.15)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
