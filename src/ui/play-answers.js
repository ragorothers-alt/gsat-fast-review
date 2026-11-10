// 作答畫面的選項按鈕：建立按鈕，以及作答後在按鈕上蓋批改記號（單選／是非、多選、非選擇題的評分要點）。
// 只動傳進來的按鈕；哪個是正解、玩家選了什麼，都由呼叫的人（ui/play.js）算好傳進來
import { icon } from './icons.js';
import { plainText } from './rich.js';

/**
 * @param {string} label 按鈕上的字
 * @param {*} value 這顆按鈕代表的值（記在 btn._value）
 * @param {string} key 左邊顯示的快捷鍵
 * @param {boolean} isHTML label 是 HTML（richHTML 轉好的）還是純文字
 * @param {(value: *) => void} onChoose 按下去時呼叫
 */
export function answerButton(label, value, key, isHTML, onChoose) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'answer';
  btn.innerHTML = `<span class="key" aria-hidden="true">${key}</span><span class="answer-text"></span>`;
  const text = btn.querySelector('.answer-text');
  if (isHTML) text.innerHTML = label;
  else text.textContent = label;
  // 有公式的選項改念 plainText 轉出來的文字，螢幕閱讀器才念得出來；
  // 不用 aria-label，名稱才會跟著按鈕內容走（axe 的 label-in-name 規則）
  if (text.querySelector('math')) {
    const said = document.createElement('span');
    said.className = 'sr-only';
    said.textContent = plainText(text);
    text.setAttribute('aria-hidden', 'true');
    btn.append(said);
  }
  btn.addEventListener('click', () => onChoose(value));
  btn._value = value;
  return btn;
}

/**
 * 單選、是非題作答後：除了紅綠底色，再像老師批改一樣蓋上圈叉，分不出紅綠的人也看得出對錯；
 * 螢幕閱讀器另外念「（正解）」「（你選的）」
 * @param {Iterable<HTMLButtonElement>} buttons
 * @param {*} correctValue 正解那顆按鈕的值
 * @param {*} displayValue 玩家按的那顆按鈕的值（沒有就是 null）
 * @param {boolean} typed 答案是填的（演算題填答），不是點選項
 */
export function markChoices(buttons, correctValue, displayValue, typed) {
  for (const b of buttons) {
    b.disabled = true;
    if (b._value === correctValue) {
      b.classList.add('correct');
      b.insertAdjacentHTML('beforeend', `${icon('ok', 'mark')}<span class="sr-only">（正解）</span>`);
    } else if (b._value === displayValue) {
      b.classList.add('wrong');
      b.insertAdjacentHTML('beforeend', `${icon('ng', 'mark')}<span class="sr-only">（${typed ? '你填的' : '你選的'}）</span>`);
    } else b.classList.add('dim');
  }
}

/**
 * 多選題作答後：選對的打圈、選錯的打叉、該選沒選的標「漏選」
 * @param {Iterable<HTMLButtonElement>} buttons
 * @param {number[]} order 畫面上第 i 個按鈕 → 原始選項索引
 * @param {number[]} answer 正解的原始選項索引
 * @param {Set<number> | null} mine 玩家選的原始選項索引；按「不會」看解答時是 null（正解都標成正解，不算漏選）
 */
export function markMultiChoices(buttons, order, answer, mine) {
  for (const b of buttons) {
    const orig = order[b._value];
    const right = answer.includes(orig);
    b.disabled = true;
    b.removeAttribute('aria-pressed');
    if (right && (!mine || mine.has(orig))) {
      b.classList.add('correct');
      b.insertAdjacentHTML('beforeend', `${icon('ok', 'mark')}<span class="sr-only">（${mine ? '正解，你選了' : '正解'}）</span>`);
    } else if (right) {
      b.classList.add('correct', 'missed');
      b.insertAdjacentHTML('beforeend', `<span class="miss-tag" aria-hidden="true">漏選</span>${icon('ok', 'mark')}<span class="sr-only">（正解，你沒選）</span>`);
    } else if (mine?.has(orig)) {
      b.classList.add('wrong');
      b.insertAdjacentHTML('beforeend', `${icon('ng', 'mark')}<span class="sr-only">（不該選，你選了）</span>`);
    } else b.classList.add('dim');
  }
}

/**
 * 非選擇題作答後：自評寫到的要點打圈、沒寫到的淡掉；按「不會」時都不勾也不淡掉
 * @param {Iterable<HTMLButtonElement>} buttons 評分要點的按鈕
 * @param {Set<number>} mine 自評寫到的要點索引
 * @param {boolean} skipped 按「不會」看的參考答案
 */
export function markOpenPoints(buttons, mine, skipped) {
  for (const b of buttons) {
    b.disabled = true;
    b.removeAttribute('aria-pressed');
    if (mine.has(b._value)) {
      b.classList.add('correct');
      b.insertAdjacentHTML('beforeend', `${icon('ok', 'mark')}<span class="sr-only">（寫到了）</span>`);
    } else if (!skipped) b.classList.add('dim');
  }
}
