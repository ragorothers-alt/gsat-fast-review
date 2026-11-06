// 閱讀題組的文章框（作答畫面與模擬考共用）：放在題目卡上方、可以自己捲動。
// 換到新的題組才重畫（同組的下一題保留捲動位置）；克漏字標出這題問的空格，捲到看得見的地方。
import { blankOf, isBank } from '../groups.js';
import { passageHTML, visibleLength } from './rich.js';

/**
 * 單選題選項區的 class：短選項排兩欄；共用選項（文意選填、篇章結構）的字詞排兩欄、句子排一欄並縮小字級
 */
export function choicesClass(q) {
  if (isBank(q)) return q.choices.every((c) => visibleLength(c) <= 16) ? 'answers mc bank grid-2' : 'answers mc bank sentences';
  return `answers mc${q.choices.every((c) => visibleLength(c) <= 10) ? ' grid-2' : ''}`;
}

/**
 * 共用選項：別的空格已經填掉的選項加上標籤（還是可以選，像在考卷上自己刪去）
 * @param {HTMLElement} answers 選項區
 * @param {Set<number>} used 已填的原始選項索引
 * @param {(button: HTMLElement) => number} origOf 按鈕 → 原始選項索引
 * @param {'used' | 'picked'} how used：作答畫面，前面的空格（正解已公布）用掉的；picked：模擬考，自己在別格選了的
 */
export function markUsed(answers, used, origOf, how = 'used') {
  const [tag, said] = how === 'used' ? ['已用', '前面的空格已經用了這個'] : ['別格已選', '另一格選了這個'];
  for (const b of answers.children) {
    if (!used.has(origOf(b))) continue;
    b.classList.add('used');
    b.insertAdjacentHTML('beforeend', `<span class="used-tag" aria-hidden="true">${tag}</span><span class="sr-only">（${said}）</span>`);
  }
}

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
