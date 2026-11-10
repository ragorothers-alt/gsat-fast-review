// 作答畫面的題目卡：放不下時縮小字級與「往下還有」的提示、作答後收起沒選到的錯誤選項、單元那一行、是非題的左右滑動。
// 只管卡片本身的 DOM；現在能不能作答、滑過去算什麼，由呼叫的人（ui/play.js）用參數告訴它

const SWIPE_THRESHOLD = 80;

/**
 * 小螢幕：題目卡放不下。
 * 先把題目字縮小一級；還是放不下就在卡片底部提示「往下還有」，免得沒看完題目就作答
 * @param {{ card: HTMLElement, text: HTMLElement, answers: HTMLElement, more: HTMLElement }} el
 *   card：題目卡；text：題幹；answers：選項區；more：「往下還有」的按鈕
 * @param {() => boolean} active 作答畫面上現在有題目（視窗大小改變時才需要重算提示）
 */
export function initCardFit(el, active) {
  function overflowing() {
    return el.card.scrollHeight - el.card.clientHeight > 2;
  }

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

  function fitCard() {
    el.card.scrollTop = 0;
    el.text.classList.remove('compact');
    el.card.classList.remove('tight');
    updateNeed();
    if (overflowing()) {
      el.text.classList.add('compact');
      updateNeed();
    }
    // 閱讀題組還是放不下：文章框再壓矮（剩兩三行，可以按「展開文章」看全文），題目一定要看得到
    if (overflowing() && el.card.classList.contains('grouped')) el.card.classList.add('tight');
    updateMore();
    el.answers.scrollTop = 0;
    updateAnswersMore();
  }

  // 篇章結構的長句選項在矮螢幕上自己捲動：下面還有選項時底部淡出
  function updateAnswersMore() {
    const a = el.answers;
    a.classList.toggle('more-below', a.scrollHeight - a.clientHeight - a.scrollTop > 4);
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

  function updateMore() {
    el.more.hidden = el.card.scrollHeight - el.card.clientHeight - el.card.scrollTop <= 6;
  }

  /**
   * 作答後（解析已經顯示）題目卡放不下：把沒選到的錯誤選項（.dim）各收成一行，高度讓給題目卡；
   * 正解和你選錯的那個照原樣。放得下就不收。回傳有沒有收
   */
  function foldDim() {
    if (!overflowing() || !el.answers.querySelector('.answer.dim')) return false;
    el.answers.classList.add('folded');
    return true;
  }

  // 點任何一個收起來的選項就全部展開。它們是停用的按鈕、收不到點擊（樣式裡也讓點擊穿過去），
  // 所以由選項區接：點的位置落在收起來的選項上才展開。展開後這題不再收
  el.answers.addEventListener('click', (e) => {
    if (!el.answers.classList.contains('folded')) return;
    const hit = [...el.answers.querySelectorAll('.answer.dim')].some((b) => {
      const r = b.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (!hit) return;
    el.answers.classList.remove('folded');
    updateMore();
  });

  el.card.addEventListener('scroll', updateMore, { passive: true });
  el.answers.addEventListener('scroll', updateAnswersMore, { passive: true });
  window.addEventListener('resize', () => {
    if (active()) {
      updateNeed();
      updateMore();
      updateAnswersMore();
    }
  });
  el.more.addEventListener('click', () => el.card.scrollBy({ top: el.card.clientHeight * 0.7, behavior: 'smooth' }));

  return { fitCard, updateMore, updateAnswersMore, updateNeed, showAnswer, foldDim };
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
