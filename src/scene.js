// three.js 背景：米色筆記紙上的手繪貓咪。每科一隻貓，首頁坐在兩層書架上（點牠們叫醒或哄睡，
// 等於切換科目）；作答時當前科目的貓從題目卡後面探頭，答對開心跳、答錯冒冷汗；結算時一起趴在成績卡上。
// 文字與按鈕都在 DOM 上層，這裡只負責畫面與點貓。畫面座標 1 單位 = 1 CSS px，y 軸朝上（= -clientY）。
import * as THREE from 'three';
import { SUBJECTS } from './subjects.js';
import { Cat } from './world/cats.js';
import { createDoodles } from './world/doodles.js';
import { INK, Part, boil, inkMaterial, rgb, spline } from './world/ink.js';
import { createParticles } from './world/particles.js';

const BREED_OF = {
  chinese: 'calico',
  english: 'siamese',
  math: 'black',
  physics: 'blue',
  chemistry: 'white',
  biology: 'orange',
  earth: 'tuxedo',
  history: 'cow',
  geography: 'brown',
  civics: 'cream',
};
const BOIL_FPS = 8;
const SHELF_UNIT = 100; // 書架幾何用 100px 當 1 單位，抖動才會跟貓一致
const MAX_CAST = 5;

const NOOP_WORLD = {
  setScene() {},
  setSelected() {},
  setFocusSubject() {},
  setCast() {},
  setCombo() {},
  react() {},
  burst() {},
  shake() {},
  celebrate() {},
  onCatTap: null,
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Record<'home'|'play'|'result'|'stats', () => DOMRect | null>} anchors 各畫面貓咪要對齊的 DOM 區塊
 */
export function createWorld(canvas, anchors) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    canvas.hidden = true;
    document.body.classList.add('no-webgl');
    return NOOP_WORLD;
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
  camera.position.z = 5;

  const doodles = createDoodles(scene);
  const particles = createParticles(scene, pixelRatio);
  const cats = SUBJECTS.map((s, i) => {
    const cat = new Cat({ id: s.id, breed: BREED_OF[s.id], scarf: s.color, index: i });
    scene.add(cat.root);
    return cat;
  });
  const catById = Object.fromEntries(cats.map((c) => [c.id, c]));
  const labels = SUBJECTS.map((s) => {
    const label = makeLabel(s.name, pixelRatio);
    scene.add(label);
    return label;
  });
  const shelfMat = inkMaterial({ amp: 0.9 / SHELF_UNIT, seed: 11 });
  let shelves = [];
  let shelfKey = '';

  // ── 狀態 ──────────────────────────────────────────────
  let mode = 'home';
  let selected = new Set(SUBJECTS.map((s) => s.id));
  let selectedReady = false;
  let focusId = null;
  let cast = [];
  let combo = 0;
  let speedMul = 1;
  let tintAmt = 0;
  let shakeT = 0;
  let placed = false;
  let width = 1;
  let height = 1;
  const pointer = { x: 0, y: 0, at: -1e9 };
  const clock = new THREE.Clock();
  const tint = new THREE.Vector3(1, 1, 1);

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    renderer.setSize(width, height);
    camera.left = 0;
    camera.right = width;
    camera.top = 0;
    camera.bottom = -height;
    camera.updateProjectionMatrix();
    doodles.resize(width, height);
  }
  resize();
  window.addEventListener('resize', resize);

  // ── 版面：每幀讀一次錨點位置，貓咪平滑移過去 ──────────
  function place(cat, x, y, size) {
    if (placed) cat.setTarget(x, y, size);
    else cat.teleport(x, y, size);
  }

  /** 進場的貓若還在畫面外，先瞬移到卡片後面藏好，再探頭出來 */
  function peek(cat, x, topEdge, size) {
    if (cat.entering) {
      cat.entering = false;
      if (cat.offstage(height) || !placed) cat.teleport(x, topEdge + size * 1.1, size);
      else cat.hop(0.5);
    }
    cat.setTarget(x, topEdge + size * 0.44, size);
  }

  function hide(cat) {
    cat.setTarget(cat.target.x, height + cat.size * 1.6, cat.size);
  }

  /** 剛下場的貓先縮回卡片後面，到位後再瞬移到畫面外，不會從卡片和選項之間的空隙滑過 */
  function duck(cat, topEdge) {
    cat.setTarget(cat.target.x, topEdge + cat.size * 1.15, cat.size);
    if (Math.abs(cat.y - cat.target.y) < 3) {
      cat.ducking = false;
      cat.teleport(cat.x, height + cat.size * 2, cat.size);
    }
  }

  function layoutHome(r) {
    const cols = 5;
    const rowH = r.height / 2;
    const cellW = r.width / cols;
    // 貓腳下：8px 的木板，再往下是科目名
    const labelH = rowH > 80 ? 30 : 10;
    const size = clamp(Math.min(cellW * 0.86, rowH - labelH - 8), 30, 104);
    const rows = [];
    cats.forEach((cat, i) => {
      const row = Math.floor(i / cols);
      const x = r.left + cellW * ((i % cols) + 0.5);
      const y = r.top + rowH * (row + 1) - labelH - 3;
      rows[row] = y;
      place(cat, x, y, size);
      const label = labels[i];
      label.visible = labelH > 10;
      label.position.set(Math.round(x), -Math.round(y + 21), 0);
      label.material.opacity += ((selected.has(cat.id) ? 1 : 0.45) - label.material.opacity) * 0.15;
    });
    buildShelves(r, rows);
  }

  function layoutPlay(r) {
    const size = clamp(r.width * 0.2, 58, 88);
    for (const cat of cats) {
      if (cat.id === focusId) peek(cat, r.left + r.width * (cat.index % 2 ? 0.22 : 0.78), r.top, size);
      else if (cat.ducking) duck(cat, r.top);
      else hide(cat);
    }
  }

  function layoutResult(r) {
    const n = cast.length;
    const size = clamp(r.width / (n + 0.8), 50, 82);
    const gap = Math.min(r.width / Math.max(n, 1), size * 1.15);
    const start = r.left + r.width / 2 - (gap * (n - 1)) / 2;
    for (const cat of cats) {
      const i = cast.indexOf(cat.id);
      if (i < 0) hide(cat);
      else peek(cat, start + gap * i, r.top, size);
    }
  }

  function layout() {
    const r = anchors[mode]?.();
    if (!r || !r.width || !r.height) return;
    if (mode === 'home') layoutHome(r);
    else if (mode === 'play') layoutPlay(r);
    else layoutResult(r);
    for (const s of shelves) s.visible = mode === 'home';
    for (const l of labels) if (mode !== 'home') l.visible = false;
    placed = true;
  }

  function buildShelves(r, rows) {
    const key = [r.left, r.width, ...rows].map(Math.round).join(',');
    if (key === shelfKey) return;
    shelfKey = key;
    for (const s of shelves) {
      scene.remove(s);
      s.geometry.dispose();
    }
    const u = SHELF_UNIT;
    const x0 = (r.left + 4) / u;
    const x1 = (r.left + r.width - 4) / u;
    shelves = rows.map((y, i) => {
      const yy = -y / u;
      const mid = (x0 + x1) / 2;
      const plank = spline(
        [[x0, yy], [mid, yy - 0.012], [x1, yy], [x1 + 0.012, yy - 0.04], [x1, yy - 0.08], [mid, yy - 0.09], [x0, yy - 0.08], [x0 - 0.012, yy - 0.04]],
        { closed: true, n: 80 },
      );
      const p = new Part().fill(plank, '#ecd8b5').stroke(plank, INK, 2.4 / u, { closed: true, seed: i, pressure: 0.4 });
      const m = p.mesh(shelfMat, 60 + i);
      m.scale.setScalar(u);
      scene.add(m);
      return m;
    });
  }

  // ── 每幀 ──────────────────────────────────────────────
  let elapsed = 0;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = (elapsed += dt);
    boil.value = reduced ? 0 : Math.floor(t * BOIL_FPS) % 3;
    layout();

    let sx = 0;
    let sy = 0;
    if (shakeT > 0) {
      shakeT -= dt;
      const a = Math.max(0, shakeT) * 26;
      sx = (Math.random() - 0.5) * a;
      sy = (Math.random() - 0.5) * a;
    }
    camera.position.set(sx, sy, 5);

    const fresh = performance.now() - pointer.at < 5000;
    for (const cat of cats) {
      cat.awake = mode !== 'home' || selected.has(cat.id);
      if (mode === 'home' && fresh) {
        cat.lookTarget[0] = clamp((pointer.x - cat.x) / (cat.size * 3), -1, 1) * 0.022;
        cat.lookTarget[1] = clamp((cat.y - cat.size * 0.63 - pointer.y) / (cat.size * 3), -1, 1) * 0.018;
      } else if ((cat.glanceIn = (cat.glanceIn ?? 0) - dt) <= 0) {
        // 作答時多半低頭看題目
        cat.glanceIn = 1.5 + Math.random() * 3.5;
        const down = mode === 'play' && Math.random() < 0.7;
        cat.lookTarget[0] = down ? 0 : (Math.random() - 0.5) * 0.04;
        cat.lookTarget[1] = down ? -0.016 : (Math.random() - 0.5) * 0.03;
      }
      cat.update(dt, t, reduced);
    }

    const playing = mode === 'play';
    speedMul += ((playing ? 1 + Math.min(combo, 12) * 0.3 : 1) - speedMul) * (1 - Math.exp(-dt * 2));
    tintAmt += ((playing && focusId ? Math.min(combo / 12, 1) * 0.75 : 0) - tintAmt) * (1 - Math.exp(-dt * 2));
    doodles.material.uniforms.uTint.value.copy(tint);
    doodles.material.uniforms.uTintAmt.value = tintAmt;
    doodles.update(dt, t, speedMul, reduced);
    particles.update(dt);
    renderer.render(scene, camera);
  }

  // ── 點貓 ──────────────────────────────────────────────
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
    const cat = [...cats].reverse().find((c) => c.hit(e.clientX, e.clientY));
    if (cat && api.onCatTap) {
      burst(e.clientX, e.clientY, SUBJECTS[cat.index].color, 10);
      api.onCatTap(cat.id);
    }
  });
  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.at = performance.now();
  });
  window.addEventListener('pointerdown', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.at = performance.now();
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

  function burst(x, y, color = '#f2b632', count = 30) {
    particles.burst(x, y, color, reduced ? Math.ceil(count / 3) : count);
  }

  const api = {
    /** 首頁點到貓時呼叫，參數是科目 id */
    onCatTap: null,
    setScene(name) {
      if (name === mode) return;
      mode = name;
      if (name !== 'play') api.setCombo(0);
      for (const cat of cats) cat.ducking = false;
      if (name === 'result' || name === 'stats') for (const id of cast) catById[id].entering = true;
    },
    setSelected(ids) {
      const next = new Set(ids);
      if (selectedReady && mode === 'home') {
        for (const cat of cats) {
          const was = selected.has(cat.id);
          const now = next.has(cat.id);
          if (now && !was) {
            if (!reduced) cat.hop(0.32);
            cat.express('happy', 0.7);
            cat.showEmote('exclaim', 0.9);
          }
        }
      }
      selected = next;
      selectedReady = true;
    },
    setFocusSubject(id) {
      if (id === focusId) return;
      if (focusId && mode === 'play') catById[focusId].ducking = true;
      focusId = id;
      if (id) {
        catById[id].entering = true;
        tint.set(...rgb(SUBJECTS[catById[id].index].color));
      }
    },
    /** 結算畫面要出場的貓（依序，最多 5 隻） */
    setCast(ids) {
      cast = ids.filter((id) => catById[id]).slice(0, MAX_CAST);
    },
    setCombo(n) {
      combo = n;
      const cat = focusId && catById[focusId];
      if (cat) cat.excite = Math.min(n / 8, 1);
      if (!n) for (const c of cats) c.excite = 0;
    },
    /** 當前科目的貓對作答結果做反應 */
    react(outcome) {
      const cat = focusId && catById[focusId];
      if (!cat) return;
      if (outcome === 'right') {
        if (!reduced) cat.hop(0.3 + Math.min(combo, 10) * 0.02);
        cat.express('happy', 0.8);
        cat.showEmote(combo >= 3 && combo % 3 === 0 ? 'note' : 'heart', 0.9);
      } else if (outcome === 'wrong') {
        cat.express('shock', 1.1);
        cat.showEmote('sweat', 1.2);
        if (!reduced) cat.tremble = 0.45;
      } else {
        cat.tiltHead(0.28, 1.3);
        cat.showEmote('question', 1.3);
      }
    },
    burst,
    shake() {
      if (!reduced) shakeT = 0.3;
    },
    celebrate() {
      cast.forEach((id, i) => {
        const cat = catById[id];
        if (!reduced) cat.hop(0.45, 0.25 + i * 0.12);
        cat.express('happy', 1.6);
        cat.showEmote(i % 2 ? 'heart' : 'note', 1.4);
      });
      const colors = SUBJECTS.map((s) => s.color);
      for (let n = 0; n < 6; n++) {
        setTimeout(() => burst(width * (0.15 + Math.random() * 0.7), height * (0.1 + Math.random() * 0.25), colors[n % colors.length], 34), n * 150);
      }
    },
  };
  return api;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** 貓咪腳下的科目名（canvas 字貼圖） */
function makeLabel(text, ratio) {
  const fontPx = 13;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `700 ${fontPx * ratio}px system-ui, -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width + 6 * ratio);
  const h = Math.ceil(18 * ratio);
  c.width = w;
  c.height = h;
  g.font = font;
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + ratio);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }),
  );
  mesh.scale.set(w / ratio, h / ratio, 1);
  mesh.renderOrder = 400;
  mesh.frustumCulled = false;
  return mesh;
}
