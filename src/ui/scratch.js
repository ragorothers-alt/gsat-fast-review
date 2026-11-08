// 草稿區：平板上常駐在題目旁邊（橫放在右、直放在下），手機上按鉛筆按鈕才拉出來。
// 每題一頁（模擬考回到前面的題目，草稿還在）；頁的資料與規則在 scratch-pad.js。
// 紙往下延伸：寫到下半部後，兩指上下拖、滾輪或右下角的箭頭可以捲動；用過觸控筆之後，一指就能捲。
// 畫線後停住半秒會拉成直線（接近水平、垂直、45° 時對齊）。筆跡存成點列，縮放、捲動、復原時整頁重畫。
// 觸控筆懸空時按一下側鍵（S Pen 等），在筆和橡皮擦之間切換；選橡皮擦時，筆或滑鼠移到紙上會看到擦的範圍。
import { createPenButton, isAirPress } from '../pen-button.js';
import {
  HOLD_MIN,
  HOLD_MS,
  HOLD_SLOP,
  addStroke,
  clampScroll,
  clearPage,
  createBook,
  maxScroll,
  openPage,
  pathLength,
  redo,
  snapLine,
  undo,
  visible,
} from '../scratch-pad.js';

const COLORS = { ink: '#3b2f2a', red: '#d9473c' };
const PEN = 2.4;
const ERASER = 28;
/** 第二指放下時，第一指下筆不到這麼久（ms）的那一筆當成誤觸丟掉 */
const TOUCH_GRACE = 250;
const SIDE = '(orientation: landscape) and (min-width: 900px) and (min-height: 560px)';
const BOTTOM = '(orientation: portrait) and (min-width: 700px) and (min-height: 900px)';

export function initScratch(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const play = $('#play');
  const canvas = $('#scratch-canvas');
  const sheet = $('#scratch-sheet');
  const hint = $('#scratch-hint');
  const tip = $('#scratch-tip');
  const penTip = $('#scratch-pen');
  const ring = $('#scratch-ring');
  const toggleBtn = $('#scratch-toggle');
  const closeBtn = $('#scratch-close');
  const undoBtn = $('#scratch-undo');
  const redoBtn = $('#scratch-redo');
  const clearBtn = $('#scratch-clear');
  const nav = $('#scratch-nav');
  const upBtn = $('#scratch-up');
  const downBtn = $('#scratch-down');
  const track = $('#scratch-track');
  const thumb = $('#scratch-thumb');
  const toolBtns = [...document.querySelectorAll('#scratch [data-tool]')];
  const g = canvas.getContext('2d');
  const side = matchMedia(SIDE);
  const bottom = matchMedia(BOTTOM);
  const coarse = matchMedia('(pointer: coarse)');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const settings = ctx.state.settings;

  const book = createBook();
  let page = openPage(book, 'start');
  /** 正在畫的一筆；停住拉直之後 straight = true，只留起點 a、終點 b */
  let live = null;
  /** 捲動中：按在紙上的手指的平均 y */
  let pan = null;
  /** 按在紙上的手指：pointerId → clientY */
  const touches = new Map();
  /** 拉直線時這頁其他筆劃的快照：每次移動先貼回快照再畫直線，不用整頁重畫 */
  let base = null;
  let holdTimer = 0;
  let glide = 0;
  let tool = 'ink';
  /** 最後用的筆（黑或紅）：側鍵從橡皮擦切回來時用 */
  let lastInk = 'ink';
  /** 觸控筆的側鍵；按下時原本的工具（按著時碰過螢幕、按太久的話，放開時換回來） */
  const penButton = createPenButton();
  let pressTool = null;
  let ringTimer = 0;
  let penSeen = false;
  let open = false;
  let dpr = 1;
  let viewH = 0;

  const docked = () => play.dataset.dock !== '';

  function applyDock() {
    play.dataset.dock = side.matches ? 'side' : bottom.matches ? 'bottom' : '';
    closeBtn.textContent = docked() ? '收起' : '作答 ›';
    setOpen(docked() && settings.scratch, false);
  }

  function setOpen(on, remember = true) {
    open = on;
    hideRing();
    play.classList.toggle('scratch-open', on);
    toggleBtn.setAttribute('aria-pressed', String(on));
    // 只記住平板上的開關；手機上每次都從收起開始
    if (remember && docked()) {
      settings.scratch = on;
      ctx.save();
    }
  }

  // ── 繪圖 ─────────────────────────────────────────────
  /** 用頁面座標畫：往下捲了多少，整張紙就往上移多少 */
  const pageTransform = (gc) => gc.setTransform(dpr, 0, 0, dpr, 0, -page.scroll * dpr);

  function paint(gc) {
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.globalCompositeOperation = 'source-over';
    gc.clearRect(0, 0, canvas.width, canvas.height);
    pageTransform(gc);
    for (const s of visible(page)) drawStroke(gc, s, 0);
  }

  function redraw() {
    paint(g);
    if (live?.straight) {
      base = snapshot();
      renderStraight();
    } else if (live) drawStroke(g, live, 0);
    refresh();
  }

  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  function drawLine(gc, s, a, b) {
    gc.globalCompositeOperation = 'source-over';
    gc.strokeStyle = COLORS[s.tool] ?? COLORS.ink;
    gc.lineCap = 'round';
    gc.lineWidth = a.w;
    gc.beginPath();
    gc.moveTo(a.x, a.y);
    gc.lineTo(b.x, b.y);
    gc.stroke();
  }

  /**
   * 從第 from 個點畫到目前最後一點。以相鄰點的中點為端點、原始點為控制點畫二次曲線，
   * 轉折才會圓滑；最後半段等筆劃結束（done）才補上。拉直的線只有兩個點，直接畫直線。
   */
  function drawStroke(gc, s, from) {
    if (s.straight) return drawLine(gc, s, s.pts[0], s.pts[1]);
    const p = s.pts;
    gc.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
    gc.strokeStyle = gc.fillStyle = COLORS[s.tool] ?? COLORS.ink;
    gc.lineCap = 'round';
    gc.lineJoin = 'round';
    if (from === 0) {
      gc.beginPath();
      gc.arc(p[0].x, p[0].y, p[0].w / 2, 0, Math.PI * 2);
      gc.fill();
    }
    for (let i = Math.max(1, from); i < p.length; i++) {
      const a = p[i - 1];
      const start = i === 1 ? a : mid(p[i - 2], a);
      const end = mid(a, p[i]);
      gc.lineWidth = a.w;
      gc.beginPath();
      gc.moveTo(start.x, start.y);
      gc.quadraticCurveTo(a.x, a.y, end.x, end.y);
      gc.stroke();
    }
    if (s.done && p.length > 1) {
      const a = p[p.length - 2];
      const b = p[p.length - 1];
      const start = mid(a, b);
      gc.lineWidth = b.w;
      gc.beginPath();
      gc.moveTo(start.x, start.y);
      gc.lineTo(b.x, b.y);
      gc.stroke();
    }
  }

  function snapshot() {
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    paint(c.getContext('2d'));
    return c;
  }

  function renderStraight() {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(base, 0, 0);
    pageTransform(g);
    drawLine(g, live, live.a, live.b);
  }

  /** 工具列與捲動的狀態：能不能復原、重做、清空，能捲時顯示捲軸與上下箭頭 */
  function refresh() {
    const strokes = visible(page);
    hint.hidden = strokes.length > 0 || live !== null;
    undoBtn.disabled = !page.entries.length;
    redoBtn.disabled = !page.redo.length;
    clearBtn.disabled = !strokes.length;
    sheet.style.backgroundPosition = `0 ${-page.scroll}px`;
    const max = Math.max(maxScroll(page, viewH), page.scroll);
    const scrollable = viewH > 0 && max > 0.5;
    nav.hidden = !scrollable;
    track.hidden = !scrollable;
    if (!scrollable) return;
    upBtn.disabled = page.scroll <= 0.5;
    downBtn.disabled = page.scroll >= max - 0.5;
    const total = max + viewH;
    thumb.style.top = `${(page.scroll / total) * 100}%`;
    thumb.style.height = `${(viewH / total) * 100}%`;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    viewH = r.height;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    redraw();
  }

  /** 下筆、捲動前確認畫布大小：ResizeObserver 晚到時（背景分頁、較舊的 WebView）先自己校正，免得畫在預設的 300×150 上 */
  function ensureSize() {
    const k = Math.min(window.devicePixelRatio || 1, 2.5);
    // clientWidth/Height 是整數、getBoundingClientRect 可能帶小數：差一兩 px 不算
    if (Math.abs(canvas.clientHeight - viewH) > 1.5 || Math.abs(canvas.width - canvas.clientWidth * k) > 2 * k) resize();
  }

  // ── 捲動 ─────────────────────────────────────────────
  function scrollTo(y) {
    const next = clampScroll(page, y, viewH);
    if (next === page.scroll) return;
    page.scroll = next;
    redraw();
  }

  const stopGlide = () => cancelAnimationFrame(glide);

  /** 上下箭頭：0.2 秒滑過去（減少動態效果時直接跳過去） */
  function glideTo(y) {
    stopGlide();
    const from = page.scroll;
    const to = clampScroll(page, y, viewH);
    if (still.matches || to === from) return scrollTo(to);
    const t0 = performance.now();
    const p = page;
    const step = (t) => {
      if (page !== p || live) return;
      const k = Math.min(1, (t - t0) / 200);
      page.scroll = from + (to - from) * (1 - (1 - k) ** 3);
      redraw();
      if (k < 1) glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  }

  upBtn.addEventListener('click', () => glideTo(page.scroll - viewH * 0.6));
  downBtn.addEventListener('click', () => glideTo(page.scroll + viewH * 0.6));

  canvas.addEventListener(
    'wheel',
    (e) => {
      ensureSize();
      // 觸控板的雙指縮放（ctrlKey）不攔；這頁還不能捲時讓外面的畫面照常捲
      if (e.ctrlKey || live || pan || Math.max(maxScroll(page, viewH), page.scroll) <= 0.5) return;
      e.preventDefault();
      stopGlide();
      scrollTo(page.scroll + e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewH : 1));
    },
    { passive: false },
  );

  // ── 工具與觸控筆的側鍵 ───────────────────────────────
  function setTool(next) {
    tool = next;
    if (next !== 'eraser') lastInk = next;
    for (const b of toolBtns) b.setAttribute('aria-pressed', String(b.dataset.tool === next));
  }

  /**
   * 側鍵（見 pen-button.js）：懸空按一下，在筆和橡皮擦之間切換。按著側鍵下筆（瀏覽器有送來的話）是暫時換工具，
   * 放開換回原本的；按太久也換回來。Android 的 Chrome 收不到按著側鍵的下筆，只能用按一下切換。
   */
  function onPenButton(what) {
    if (what === 'press') {
      pressTool = tool;
      setTool(tool === 'eraser' ? lastInk : 'eraser');
    } else if (what === 'hold' && pressTool) setTool(pressTool);
    if (what === 'click' || what === 'hold') pressTool = null;
  }

  function notePen() {
    if (penSeen) return;
    penSeen = true;
    renderTip();
  }

  /** 橡皮擦的範圍：筆懸空或滑鼠移到紙上時，指標周圍畫一個圈（手指會蓋住，不畫） */
  function updateRing(e) {
    if (e.pointerType === 'touch' || (live?.tool ?? tool) !== 'eraser') return hideRing();
    const r = canvas.getBoundingClientRect();
    ring.style.transform = `translate(${e.clientX - r.left - ERASER / 2}px, ${e.clientY - r.top - ERASER / 2}px)`;
    ring.hidden = false;
    clearTimeout(ringTimer);
    // Android 不送「筆離開感應範圍」的事件：筆一陣子沒動就收起來
    if (e.pointerType === 'pen') ringTimer = setTimeout(hideRing, 1500);
  }

  function hideRing() {
    clearTimeout(ringTimer);
    if (!ring.hidden) ring.hidden = true;
  }

  // ── 筆 ───────────────────────────────────────────────
  const toPage = (e, rect) => ({ x: e.clientX - rect.left, y: e.clientY - rect.top + page.scroll });

  function addPoint(e) {
    const { x, y } = toPage(e, live.rect);
    const last = live.pts[live.pts.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < 0.8) return;
    // 觸控筆依筆壓變粗細（稍微平滑，免得粗細跳動）；手指與滑鼠沒有可靠的筆壓，固定粗細
    let w = live.tool === 'eraser' ? ERASER : e.pointerType === 'pen' && e.pressure > 0 ? PEN * (0.45 + e.pressure * 1.1) : PEN;
    if (last) w = last.w * 0.6 + w * 0.4;
    live.pts.push({ x, y, w });
  }

  /** 筆停在原地（HOLD_SLOP 內）HOLD_MS 就拉直；一移開就重新計時 */
  function armHold() {
    if (!live || live.straight || live.tool === 'eraser') return;
    const p = live.pts[live.pts.length - 1];
    if (live.anchor && Math.hypot(p.x - live.anchor.x, p.y - live.anchor.y) <= HOLD_SLOP) return;
    live.anchor = p;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(straighten, HOLD_MS);
  }

  function straighten() {
    if (!live || live.straight || live.tool === 'eraser' || pathLength(live.pts) < HOLD_MIN) return;
    const w = live.pts.reduce((sum, p) => sum + p.w, 0) / live.pts.length;
    const a = live.pts[0];
    live.straight = true;
    live.a = { x: a.x, y: a.y, w };
    live.b = { ...snapLine(live.a, live.pts[live.pts.length - 1]), w };
    base = snapshot();
    renderStraight();
    navigator.vibrate?.(8);
  }

  /** 收下這一筆（discard：第二指放下前誤觸的一點，丟掉） */
  function endStroke(discard) {
    clearTimeout(holdTimer);
    const s = live;
    live = null;
    base = null;
    if (discard) return redraw();
    if (s.straight) {
      addStroke(page, { tool: s.tool, pts: [s.a, s.b], straight: true, done: true });
      return redraw();
    }
    s.done = true;
    drawStroke(g, s, s.pts.length);
    addStroke(page, { tool: s.tool, pts: s.pts, done: true });
    refresh();
  }

  function capture(e) {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // 指標已經放開（或是合成事件）時會丟錯，不影響畫線
    }
  }

  const touchY = () => [...touches.values()].reduce((sum, y) => sum + y, 0) / touches.size;

  canvas.addEventListener('pointerdown', (e) => {
    ensureSize();
    if (e.pointerType === 'pen') {
      notePen();
      onPenButton(penButton.handle(e));
      // 懸空按側鍵（電腦上的繪圖筆）：只切換工具，不下筆
      if (isAirPress(e)) return updateRing(e);
    }
    if (e.pointerType === 'touch') {
      hideRing();
      touches.set(e.pointerId, e.clientY);
      // 兩指是捲動；用過觸控筆之後手指不畫線（手掌靠在螢幕上也不會亂畫），一指就能捲
      if (touches.size > 1 || penSeen) {
        e.preventDefault();
        capture(e);
        if (live?.pointerType === 'touch') endStroke(performance.now() - live.t0 < TOUCH_GRACE);
        stopGlide();
        pan = { y: touchY() };
        return;
      }
    }
    if (live || pan) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    capture(e);
    stopGlide();
    // 筆尾或筆身的橡皮擦按鈕（button 5 / buttons 32）也能擦
    const erasing = tool === 'eraser' || e.button === 5 || (e.buttons & 32) !== 0;
    live = { id: e.pointerId, pointerType: e.pointerType, t0: performance.now(), tool: erasing ? 'eraser' : tool, pts: [], rect: canvas.getBoundingClientRect() };
    addPoint(e);
    drawStroke(g, live, 0);
    hint.hidden = true;
    updateRing(e);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'pen') {
      notePen();
      onPenButton(penButton.handle(e));
    }
    if (e.pointerType !== 'touch') updateRing(e);
    if (touches.has(e.pointerId)) touches.set(e.pointerId, e.clientY);
    if (pan) {
      if (!touches.has(e.pointerId)) return;
      const y = touchY();
      scrollTo(page.scroll + pan.y - y);
      pan.y = y;
      return;
    }
    if (!live || e.pointerId !== live.id) return;
    if (live.straight) {
      live.b = { ...snapLine(live.a, toPage(e, live.rect)), w: live.a.w };
      renderStraight();
      return;
    }
    const from = live.pts.length;
    const events = e.getCoalescedEvents?.();
    for (const ev of events?.length ? events : [e]) addPoint(ev);
    if (live.pts.length > from) {
      drawStroke(g, live, from);
      armHold();
    }
  });

  const lift = (e) => {
    if (e.pointerType === 'pen') onPenButton(penButton.handle(e));
    const wasTouch = touches.delete(e.pointerId);
    if (pan && wasTouch) {
      // 還有手指按著就接著捲（以剩下的手指為準）；全部放開才結束，剩下的那指不會變成畫線
      if (touches.size) pan.y = touchY();
      else pan = null;
      return;
    }
    if (live && e.pointerId === live.id) endStroke(false);
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener('pointerleave', (e) => e.pointerType !== 'touch' && hideRing());

  // 紙上不跳選單：手指或筆尖長按（停住拉直線時）、按住側鍵點螢幕（Chrome 只送這個，pointerType 是空字串）。
  // 滑鼠右鍵照常（Safari 的 contextmenu 沒有 pointerType，也照常）
  canvas.addEventListener('contextmenu', (e) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== undefined) e.preventDefault();
    penButton.handle(e);
  });

  new ResizeObserver(resize).observe(canvas);

  // ── 工具列 ───────────────────────────────────────────
  const doUndo = () => !live && undo(page) && redraw();
  const doRedo = () => !live && redo(page) && redraw();
  const doClear = () => !live && clearPage(page) && redraw();

  for (const btn of toolBtns) {
    btn.addEventListener('click', () => {
      setTool(btn.dataset.tool);
      pressTool = null;
    });
  }
  undoBtn.addEventListener('click', doUndo);
  redoBtn.addEventListener('click', doRedo);
  clearBtn.addEventListener('click', doClear);
  toggleBtn.addEventListener('click', () => setOpen(!open));
  closeBtn.addEventListener('click', () => setOpen(false));

  // Ctrl+Z 復原；Ctrl+Shift+Z、Ctrl+Y 重做
  document.addEventListener('keydown', (e) => {
    if (play.hidden || !open || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const again = (k === 'z' && e.shiftKey) || k === 'y';
    if (k !== 'z' && !again) return;
    e.preventDefault();
    if (again) doRedo();
    else doUndo();
  });

  /** 空白頁的提示：觸控螢幕說兩指捲動（用過觸控筆之後一指就能捲），滑鼠說滾輪；用過觸控筆才提側鍵 */
  function renderTip() {
    tip.textContent = coarse.matches ? `寫到下半部後，${penSeen ? '一指' : '兩指'}上下拖可以捲動` : '寫到下半部後，滾輪可以捲動';
    penTip.hidden = !penSeen;
  }
  coarse.addEventListener('change', renderTip);
  renderTip();

  side.addEventListener('change', applyDock);
  bottom.addEventListener('change', applyDock);
  applyDock();
  refresh();

  /** 演算題：草稿區收著時讓鉛筆按鈕顯眼一點，提示這題要動筆算 */
  function nudge(on) {
    toggleBtn.classList.toggle('nudge', on);
    toggleBtn.setAttribute('aria-label', on ? '草稿區（這題要動筆算）' : '草稿區');
  }

  ctx.scratch = {
    /** 換題：翻到這一題的頁。key 每題不同；模擬考回到同一題是同一個 key，草稿還在 */
    newPage(q, key = q?.id ?? 'start') {
      nudge(Boolean(q?.scratch));
      if (live) endStroke(false);
      pan = null;
      touches.clear();
      stopGlide();
      page = openPage(book, key);
      redraw();
    },
    /** 作答後：手機上收起草稿，露出解析與「繼續」 */
    answered() {
      if (!docked() && open) setOpen(false, false);
    },
    /** 開始新的一輪或進模擬考：手機上從收起開始（上一輪中途離開時草稿可能還開著，會蓋住選項） */
    start() {
      if (!docked() && open) setOpen(false, false);
    },
  };
}
