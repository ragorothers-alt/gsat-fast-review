// 閱讀題組的文章框（作答畫面與模擬考共用）：放在題目卡上方、可以自己捲動。
// 換到新的題組才重畫（同組的下一題保留捲動位置）；克漏字標出這題問的空格，捲到看得見的地方。
import { blankOf } from '../groups.js';
import { passageHTML } from './rich.js';

/**
 * @param {HTMLElement} box 文章框（#q-passage）
 * @param {object} q 目前的題目
 * @param {string} [label] 題組的位置，例如「題組第 2／4 題」，給螢幕閱讀器
 * @returns {boolean} 這題是不是換到了新的題組（要從頭讀文章）
 */
export function showPassage(box, q, label = '') {
  const card = box.closest('.card');
  setReading(false);
  document.querySelector('#read-full').hidden = !q.group;
  if (!q.group) {
    box.hidden = true;
    box.replaceChildren();
    delete box.dataset.group;
    card?.classList.remove('grouped');
    return false;
  }
  const fresh = box.dataset.group !== q.group;
  if (fresh) {
    box.innerHTML = passageHTML(q.passage);
    box.dataset.group = q.group;
  }
  box.hidden = false;
  card?.classList.add('grouped');
  box.setAttribute('aria-label', `文章${label ? `（${label}）` : ''}`);
  if (fresh) box.scrollTop = 0;
  const n = blankOf(q);
  for (const b of box.querySelectorAll('.blank')) {
    const on = Number(b.dataset.blank) === n;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  }
  const on = box.querySelector('.blank.on');
  // 空格放在框的上三分之一：前後文都看得到。等選項排好、題目卡調整完文章框的高度（fitCard）再捲
  if (on) {
    const behavior = fresh || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    requestAnimationFrame(() => box.scrollTo({ top: Math.max(0, on.offsetTop - box.clientHeight / 3), behavior }));
  }
  return fresh;
}

/** 「展開文章」：收起選項與底下的按鈕，文章占滿題目卡；再按一次回到題目 */
function setReading(on) {
  const btn = document.querySelector('#read-full');
  document.querySelector('#play').classList.toggle('reading', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? '‹ 回到題目' : '展開文章';
}

/** 作答畫面開始時接上「展開文章」按鈕（作答與模擬考共用同一顆） */
export function initReadFull() {
  const btn = document.querySelector('#read-full');
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    setReading(on);
    // 展開後焦點移到文章，方向鍵就能捲動
    if (on) document.querySelector('#q-passage').focus({ preventScroll: true });
  });
}

/**
 * 結算、錯題本、回看上一題的題目卡：題組的文章收在可以展開的區塊裡，克漏字標出這題問的空格；不是題組就是空字串
 */
export function passageDetails(q) {
  if (!q.group) return '';
  const n = blankOf(q);
  const html = passageHTML(q.passage).replace(`class="blank" data-blank="${n}"`, `class="blank on" data-blank="${n}"`);
  return `<details class="r-passage"><summary>題組文章</summary><div class="passage-body" role="region" tabindex="0" aria-label="題組文章">${html}</div></details>`;
}

/** 題組裡的第幾題：queue 裡同組、相鄰的題目 → { k, n }；不是題組就是 null */
export function groupPosition(queue, index) {
  const q = queue[index];
  if (!q?.group) return null;
  let start = index;
  while (start > 0 && queue[start - 1]?.group === q.group) start--;
  let end = index;
  while (end + 1 < queue.length && queue[end + 1]?.group === q.group) end++;
  return { k: index - start + 1, n: end - start + 1 };
}
