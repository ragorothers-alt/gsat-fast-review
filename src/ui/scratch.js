// 草稿區：平板上常駐在題目旁邊（橫放在右、直放在下），手機上按鉛筆按鈕才拉出來。
// 筆跡存成點列，視窗縮放或復原時整頁重畫；換題自動翻新頁，按復原能翻回上一頁。

const COLORS = { ink: '#3b2f2a', red: '#d9473c' };
const PEN = 2.4;
const ERASER = 28;
const SIDE = '(orientation: landscape) and (min-width: 900px) and (min-height: 560px)';
const BOTTOM = '(orientation: portrait) and (min-width: 700px) and (min-height: 900px)';

export function initScratch(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const play = $('#play');
  const canvas = $('#scratch-canvas');
  const hint = $('#scratch-hint');
  const toggleBtn = $('#scratch-toggle');
  const closeBtn = $('#scratch-close');
  const toolBtns = [...document.querySelectorAll('#scratch [data-tool]')];
  const g = canvas.getContext('2d');
  const side = matchMedia(SIDE);
  const bottom = matchMedia(BOTTOM);
  const settings = ctx.state.settings;

  /** 依序畫上去的筆劃；{ clear: true } 是翻頁記號，復原時會翻回上一頁 */
  let entries = [];
  let live = null;
  let tool = 'ink';
  let penSeen = false;
  let open = false;
  let dpr = 1;

  const docked = () => play.dataset.dock !== '';

  function applyDock() {
    play.dataset.dock = side.matches ? 'side' : bottom.matches ? 'bottom' : '';
    closeBtn.textContent = docked() ? '收起' : '去作答 ›';
    setOpen(docked() && settings.scratch, false);
  }

  function setOpen(on, remember = true) {
    open = on;
    play.classList.toggle('scratch-open', on);
    toggleBtn.setAttribute('aria-pressed', String(on));
    // 只記住平板上的開關；手機上每次都從收起開始
    if (remember && docked()) {
      settings.scratch = on;
      ctx.save();
    }
  }

  // ── 繪圖 ─────────────────────────────────────────────
  /** 目前這一頁的筆劃（最後一個翻頁記號之後） */
  function page() {
    let i = entries.length;
    while (i > 0 && !entries[i - 1].clear) i--;
    return entries.slice(i);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    redraw();
  }

  function redraw() {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const strokes = page();
    for (const s of strokes) drawStroke(s, 0);
    hint.hidden = strokes.length > 0;
  }

  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  /**
   * 從第 from 個點畫到目前最後一點。以相鄰點的中點為端點、原始點為控制點畫二次曲線，
   * 轉折才會圓滑；最後半段等筆劃結束（done）才補上。
   */
  function drawStroke(s, from) {
    const p = s.pts;
    g.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
    g.strokeStyle = g.fillStyle = COLORS[s.tool] ?? COLORS.ink;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (from === 0) {
      g.beginPath();
      g.arc(p[0].x, p[0].y, p[0].w / 2, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = Math.max(1, from); i < p.length; i++) {
      const a = p[i - 1];
      const start = i === 1 ? a : mid(p[i - 2], a);
      const end = mid(a, p[i]);
      g.lineWidth = a.w;
      g.beginPath();
      g.moveTo(start.x, start.y);
      g.quadraticCurveTo(a.x, a.y, end.x, end.y);
      g.stroke();
    }
    if (s.done && p.length > 1) {
      const a = p[p.length - 2];
      const b = p[p.length - 1];
      const start = mid(a, b);
      g.lineWidth = b.w;
      g.beginPath();
      g.moveTo(start.x, start.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
  }

  function addPoint(e) {
    const x = e.clientX - live.rect.left;
    const y = e.clientY - live.rect.top;
    const last = live.pts[live.pts.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < 0.8) return;
    // 觸控筆依筆壓變粗細（稍微平滑，免得粗細跳動）；手指與滑鼠沒有可靠的筆壓，固定粗細
    let w = live.tool === 'eraser' ? ERASER : e.pointerType === 'pen' && e.pressure > 0 ? PEN * (0.45 + e.pressure * 1.1) : PEN;
    if (last) w = last.w * 0.6 + w * 0.4;
    live.pts.push({ x, y, w });
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (live) return;
    if (e.pointerType === 'pen') penSeen = true;
    // 用過觸控筆之後手指不畫線，手掌靠在螢幕上也不會亂畫
    else if (e.pointerType === 'touch' && penSeen) return;
    else if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // 指標已經放開（或是合成事件）時會丟錯，不影響畫線
    }
    // 筆尾或筆身的橡皮擦按鈕（button 5 / buttons 32）也能擦
    const erasing = tool === 'eraser' || e.button === 5 || (e.buttons & 32) !== 0;
    live = { id: e.pointerId, tool: erasing ? 'eraser' : tool, pts: [], rect: canvas.getBoundingClientRect() };
    addPoint(e);
    drawStroke(live, 0);
    hint.hidden = true;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!live || e.pointerId !== live.id) return;
    const from = live.pts.length;
    const events = e.getCoalescedEvents?.();
    for (const ev of events?.length ? events : [e]) addPoint(ev);
    if (live.pts.length > from) drawStroke(live, from);
  });

  const endStroke = (e) => {
    if (!live || e.pointerId !== live.id) return;
    live.done = true;
    drawStroke(live, live.pts.length);
    entries.push({ tool: live.tool, pts: live.pts, done: true });
    live = null;
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  new ResizeObserver(resize).observe(canvas);

  // ── 工具列 ───────────────────────────────────────────
  function undo() {
    if (live || !entries.length) return;
    entries.pop();
    redraw();
  }

  function clear() {
    if (live || !page().length) return;
    entries.push({ clear: true });
    redraw();
  }

  for (const btn of toolBtns) {
    btn.addEventListener('click', () => {
      tool = btn.dataset.tool;
      for (const b of toolBtns) b.setAttribute('aria-pressed', String(b === btn));
    });
  }
  $('#scratch-undo').addEventListener('click', undo);
  $('#scratch-clear').addEventListener('click', clear);
  toggleBtn.addEventListener('click', () => setOpen(!open));
  closeBtn.addEventListener('click', () => setOpen(false));

  document.addEventListener('keydown', (e) => {
    if (play.hidden || !open || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    undo();
  });

  side.addEventListener('change', applyDock);
  bottom.addEventListener('change', applyDock);
  applyDock();

  ctx.scratch = {
    /** 換題：這頁有寫東西才翻新頁；只留上一頁給復原，避免越積越多 */
    newPage() {
      if (!page().length) return;
      entries = [...page(), { clear: true }];
      redraw();
    },
    /** 作答後：手機上收起草稿，露出解析與「繼續」 */
    answered() {
      if (!docked() && open) setOpen(false, false);
    },
  };
}
