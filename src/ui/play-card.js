// 作答畫面的題目卡：放不下時縮小字級與「往下還有」的提示、作答後收起沒選到的錯誤選項、單元那一行、是非題的左右滑動。
// 只管卡片本身的 DOM；現在能不能作答、滑過去算什麼，由呼叫的人（ui/play.js）用參數告訴它

const SWIPE_THRESHOLD = 80;

/**
 * 小螢幕：題目卡放不下。
 * 先把題目字縮小一級；還是放不下就在卡片底部提示「往下還有」，免得沒看完題目就作答
 * @param {{ card: HTMLElement, text: HTMLElement, answers: HTMLElement, more: HTMLElement, answersMore?: HTMLElement }} el
 *   card：題目卡；text：題幹；answers：選項區；more：「往下還有」的按鈕；answersMore：選項區下面還有幾個選項的提示
 * @param {() => boolean} active 作答畫面上現在有題目（視窗大小改變時才需要重算提示）
 */
export function initCardFit(el, active) {
  let glide = 0; // reveal 的捲動動畫（requestAnimationFrame 的 id）

  function overflowing() {
    return el.card.scrollHeight - el.card.clientHeight > 2;
  }

  /** 設定裡的字體大小（--fs）：1 是標準 */
  const fontScale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs')) || 1;

  /**
   * 題目卡照內容需要多高（含卡片上方留給貓的那一條），記在 --card-need。
   * 非選擇題的版面用它當題目卡高度的下限（answers.css）：內容短就只留內容的高度，其餘都給參考答案與評分要點。
   * 題目卡的內容變了（換題、換字級、顯示解析）就重算
   */
  function updateNeed() {
    const wrap = el.card.parentElement;
    if (!wrap) return;
    const frame = el.card.offsetHeight - el.card.clientHeight;
    const pad = parseFloat(getComputedStyle(wrap).paddingTop) || 0;
    wrap.style.setProperty('--card-need', `${Math.ceil(el.card.scrollHeight + frame + pad)}px`);
  }

  /**
   * 縮小字級後圖表題的圖先縮到最小（272px）；卡片下面還有空的話，照剩下的高度把圖放大回去一些（--fig-fit，
   * 樣式裡不超過原本的大小），刻度和軸標題才不會小到看不清楚。放大後反而放不下就維持最小
   */
  function fitFigure() {
    el.text.style.removeProperty('--fig-fit');
    const svg = el.text.querySelector('.fig-svg');
    const wrap = el.card.parentElement;
    if (!svg || !wrap || overflowing()) return;
    const pad = parseFloat(getComputedStyle(wrap).paddingTop) || 0;
    const room = wrap.clientHeight - pad - el.card.offsetHeight - 4;
    const { width, height } = svg.getBoundingClientRect();
    if (room < 8 || !width || !height) return;
    el.text.style.setProperty('--fig-fit', `${Math.floor(width + (room * width) / height)}px`);
    if (overflowing()) el.text.style.removeProperty('--fig-fit');
  }

  function fitCard() {
    // 上一題解析還在捲（reveal）就停掉，新題目從最上面開始
    cancelAnimationFrame(glide);
    el.card.scrollTop = 0;
    stackTopic();
    el.text.classList.remove('compact');
    el.text.style.removeProperty('--fig-fit');
    el.card.classList.remove('tight');
    updateNeed();
    // 非選題看了參考答案（評分要點占掉高度）：自己選了大字、特大字的，題幹不縮小，放不下就用「往下還有」捲著看——
    // 選大字就是要讀得清楚，按了按鈕題幹突然小四分之一反而難讀
    const keepSize = el.answers.classList.contains('open') && !!el.answers.querySelector('.answer') && fontScale() > 1;
    if (overflowing() && !keepSize) {
      el.text.classList.add('compact');
      fitFigure();
      updateNeed();
    }
    // 閱讀題組還是放不下：文章框再壓矮（剩兩三行，可以按「展開文章」看全文），題目一定要看得到
    if (overflowing() && el.card.classList.contains('grouped')) el.card.classList.add('tight');
    updateMore();
    el.answers.scrollTop = 0;
    updateAnswersMore();
  }

  // 選項區在矮螢幕上自己捲動（篇章結構的長句選項、小手機上多選題的第五個選項、非選題的評分要點）：
  // 下面還有選項時底部淡出，另外浮一顆「還有 N 個選項 ↓」——只露出一點點的選項很容易沒看到就送出
  function updateAnswersMore() {
    const a = el.answers;
    const below = a.scrollHeight - a.clientHeight - a.scrollTop > 4;
    a.classList.toggle('more-below', below);
    if (!el.answersMore) return;
    let n = 0;
    if (below) {
      // 只露出一部分的也算：下緣在選項區外面就是沒看完整（以前用中心點判斷，露出大半的要點會漏算，提示整個不出現）
      const bottom = a.getBoundingClientRect().bottom;
      for (const b of a.querySelectorAll('.answer')) {
        const r = b.getBoundingClientRect();
        if (r.height && r.bottom > bottom + 2) n++;
      }
    }
    el.answersMore.hidden = !n;
    if (n) el.answersMore.textContent = `還有 ${n} 個${a.classList.contains('open') ? '要點' : '選項'} ↓`;
  }

  /**
   * 題目卡第一行的單元名稱被右邊的按鈕（發音、收藏、複製、回報）擠到只剩兩三個字（360 寬的手機、英文題）：
   * 整個單元名稱移到下一行（.card-tag.stack），看得出現在練的是哪個單元
   */
  function stackTopic() {
    const tag = el.card.querySelector('.card-tag');
    if (!tag) return;
    tag.classList.remove('stack');
    const name = tag.querySelector('.topic-name');
    if (!name) return;
    const cut = name.scrollHeight > name.clientHeight + 1 || name.scrollWidth > name.clientWidth + 1;
    if (cut && name.clientWidth < 5 * (parseFloat(getComputedStyle(name).fontSize) || 13)) tag.classList.add('stack');
  }

  /** 選項區會捲動時，把這個選項捲進看得到的地方（作答後的正解） */
  function showAnswer(b) {
    const a = el.answers;
    if (!b || a.scrollHeight <= a.clientHeight) return;
    const box = a.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    if (r.top < box.top) a.scrollTop -= box.top - r.top + 8;
    else if (r.bottom > box.bottom) a.scrollTop += r.bottom - box.bottom + 8;
  }

  /** 題目的圖表還在題目卡看得到的範圍下面（上半部都還沒露出來）：回傳那張圖 */
  function figureBelow() {
    const fig = el.text.querySelector('.fig-svg');
    if (!fig) return null;
    const r = fig.getBoundingClientRect();
    return r.height && r.top + Math.min(r.height / 2, 60) > el.card.getBoundingClientRect().bottom ? fig : null;
  }

  /**
   * 「往下還有」：題目卡還沒捲到底就顯示。圖表題的圖整個在下面時改寫「往下看圖」，點了直接捲到圖——
   * 小手機上一開始只看得到文章和題幹，不說的話會以為題目沒有附圖
   */
  function updateMore() {
    el.more.hidden = el.card.scrollHeight - el.card.clientHeight - el.card.scrollTop <= 6;
    if (el.more.hidden) return;
    const fig = !!figureBelow();
    const btn = el.more.querySelector('button');
    if (!btn || btn.dataset.fig === String(fig)) return;
    btn.dataset.fig = String(fig);
    btn.lastChild.nodeValue = fig ? '往下看圖' : '往下還有';
    btn.setAttribute('aria-label', fig ? '往下看圖，捲到題目的圖表' : '往下還有，捲下去看完整題目');
  }

  /**
   * 作答後（解析已經顯示）題目卡放不下：把沒選到的錯誤選項（.dim）各收成一行，高度讓給題目卡；
   * 正解和你選錯的那個照原樣。放得下就不收。回傳有沒有收
   */
  function foldDim() {
    if (!overflowing() || !el.answers.querySelector('.answer.dim')) return false;
    el.answers.classList.add('folded');
    // 收起來的選項是停用的按鈕，鍵盤與螢幕閱讀器碰不到：另外放一顆「展開全部選項」（換題時選項區整個重畫，它也跟著不見）
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link-btn unfold-btn';
    btn.textContent = '展開全部選項';
    btn.addEventListener('click', unfold);
    el.answers.append(btn);
    return true;
  }

  function unfold() {
    const btn = el.answers.querySelector('.unfold-btn');
    // 用鍵盤按的：按鈕消失後焦點留在選項區，往下讀就是展開的選項（不掉回頁首）
    const keyboard = btn && document.activeElement === btn;
    el.answers.classList.remove('folded');
    btn?.remove();
    if (keyboard) {
      el.answers.tabIndex = -1;
      el.answers.focus({ preventScroll: true });
    }
    updateMore();
    updateAnswersMore();
  }

  // 點任何一個收起來的選項就全部展開。它們是停用的按鈕、收不到點擊（樣式裡也讓點擊穿過去），
  // 所以由選項區接：點的位置落在收起來的選項上才展開。展開後這題不再收
  el.answers.addEventListener('click', (e) => {
    if (!el.answers.classList.contains('folded')) return;
    const hit = [...el.answers.querySelectorAll('.answer.dim')].some((b) => {
      const r = b.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (hit) unfold();
  });

  el.card.addEventListener('scroll', updateMore, { passive: true });
  el.answers.addEventListener('scroll', updateAnswersMore, { passive: true });
  // 選項區的大小變了（轉向、視窗縮放、題目卡重新分配高度）：等版面排好的下一格再重算「還有 N 個」；
  // resize 事件當下版面常常還沒排好，量到的是舊的高度
  if (typeof ResizeObserver === 'function') {
    let pending = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => active() && updateAnswersMore());
    }).observe(el.answers);
  }
  el.answersMore?.addEventListener('click', () => {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.answers.scrollTo({ top: el.answers.scrollHeight, behavior: still ? 'auto' : 'smooth' });
  });
  window.addEventListener('resize', () => {
    if (active()) {
      updateNeed();
      updateMore();
      updateAnswersMore();
    }
  });
  el.more.addEventListener('click', () => {
    const fig = figureBelow();
    if (fig) return reveal(fig);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.card.scrollBy({ top: el.card.clientHeight * 0.7, behavior: still ? 'auto' : 'smooth' });
  });

  /**
   * 把 target 捲進題目卡看得到的範圍（像 scrollIntoView 的 nearest），動畫自己用 requestAnimationFrame 做：
   * 瀏覽器的 smooth scrollIntoView 換題時停不掉（直接設 scrollTop 也擋不住），看完解析馬上按「繼續」，
   * 新題目會被上一題的捲動帶著往下捲一二十 px。題目卡本身不用捲時照舊交給瀏覽器（桌機上捲的是整頁）
   */
  function reveal(target) {
    cancelAnimationFrame(glide);
    const card = el.card;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!overflowing()) return target.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
    const c = card.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const delta = t.top < c.top ? t.top - c.top : t.bottom > c.bottom ? Math.min(t.bottom - c.bottom, t.top - c.top) : 0;
    if (!delta) return;
    const from = card.scrollTop;
    const to = Math.max(0, Math.min(card.scrollHeight - card.clientHeight, from + delta));
    if (still) {
      card.scrollTop = to;
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / 280);
      card.scrollTop = from + (to - from) * (1 - (1 - p) ** 3);
      if (p < 1) glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  }

  return { fitCard, updateMore, updateAnswersMore, updateNeed, showAnswer, foldDim, reveal };
}

/**
 * 題目卡上「單元」那一行的 HTML：［題組 2／4・］［單元名稱］［・類似題・多選］。
 * 題組位置和後面的標記不換行、不截斷；放不下時截斷的是中間的單元名稱（樣式見 play.css 的 .topic-fixed、.topic-name）
 * @param {{ where?: string, name?: string, kinds?: string[] }} parts
 *   where：題組裡的第幾題（例如「題組 2／4」）；name：單元名稱的 HTML；kinds：接在後面的標記，空字串略過
 */
export function topicHTML({ where = '', name = '', kinds = [] }) {
  const tail = kinds
    .filter(Boolean)
    .map((k) => `・${k}`)
    .join('');
  return (
    (where ? `<span class="topic-fixed">${where}・</span>` : '') +
    (name ? `<span class="topic-name">${name}</span>` : '') +
    (tail ? `<span class="topic-fixed">${tail}</span>` : '')
  );
}

/**
 * 是非題：卡片左右滑。
 * @param {HTMLElement} card 題目卡
 * @param {{ canStart: () => boolean, onSwipe: (right: boolean) => boolean | null }} opts
 *   canStart：現在這題可以用滑的作答；
 *   onSwipe：滑過門檻放開時呼叫（right：往右滑）。回傳 true 讓卡片順勢飛出、false 拉回中間、null 表示這次不算作答
 * @returns {() => void} 把卡片放回原位（換題時用）
 */
export function initCardSwipe(card, { canStart, onSwipe }) {
  let drag = null;
  card.addEventListener('pointerdown', (e) => {
    // 卡片上的按鈕（複製、回報）不能被滑動手勢搶走指標，否則點不到
    if (!canStart() || e.target.closest('button')) return;
    drag = { x: e.clientX, y: e.clientY, dx: 0, active: false };
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.dx = e.clientX - drag.x;
    // 主要是垂直移動時當作捲動，不算滑動作答
    if (!drag.active && Math.abs(drag.dx) > 8 && Math.abs(drag.dx) > Math.abs(e.clientY - drag.y)) drag.active = true;
    if (!drag.active) return;
    card.classList.add('dragging');
    card.style.transform = `translateX(${drag.dx}px) rotate(${drag.dx / 22}deg)`;
    card.style.setProperty('--yes', String(Math.max(0, Math.min(1, drag.dx / SWIPE_THRESHOLD))));
    card.style.setProperty('--no', String(Math.max(0, Math.min(1, -drag.dx / SWIPE_THRESHOLD))));
  });
  const endDrag = () => {
    if (!drag) return;
    const { dx, active } = drag;
    drag = null;
    const flyOut = active && Math.abs(dx) >= SWIPE_THRESHOLD ? onSwipe(dx > 0) : null;
    if (flyOut === null) return reset();
    card.classList.remove('dragging');
    // 答對且馬上換題就讓卡片順勢飛出；要看解析的拉回中間
    const dir = Math.sign(dx);
    card.style.transform = flyOut ? `translateX(${dir * 120}%) rotate(${dir * 16}deg)` : '';
  };
  card.addEventListener('pointerup', endDrag);
  card.addEventListener('pointercancel', endDrag);

  function reset() {
    card.classList.remove('dragging');
    card.style.transform = '';
    card.style.setProperty('--yes', '0');
    card.style.setProperty('--no', '0');
  }
  return reset;
}
