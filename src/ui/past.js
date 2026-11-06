// 回看剛剛的題目：作答時按「上一題」，從底部彈出這輪做過的題目（當時的選項順序、你選的、正解與解析），
// 可以一路往前翻。看的時候計時暫停、不能作答，關掉就回到原本那題（play.js 負責暫停與恢復）。
import { questionPrompt } from '../prompt.js';
import { SUBJECT_BY_ID } from '../subjects.js';
import { topicLabel } from '../units.js';
import { copyQuestion } from './clipboard.js';
import { icon } from './icons.js';
import { passageDetails } from './passage.js';
import { richHTML, stemHTML } from './rich.js';
import { speakItem, tfLabel, toggleMark } from './review-item.js';
import { canSpeak, stopSpeaking } from './speech.js';
import { closeSheet, openSheet, topSheet } from './sheet.js';

const RESULT = { right: '答對', wrong: '答錯', skip: '看了解答', guess: '答對・猜的', unsure: '答對・不太確定', blank: '沒作答' };

/**
 * 這題當時畫面上的選項，照當時的順序：value 是原始選項索引（是非題為 false、true），
 * state 是 'right'（正解）、'wrong'（選錯的那個）、'missed'（多選題該選沒選的正解）或 ''。
 * @param {object} q 題目
 * @param {{ chosen?: number | number[] | boolean | null, order?: number[] }} entry 這輪的作答紀錄；order 是選項當時打亂後的順序
 */
export function seenChoices(q, entry) {
  const values = q.type === 'tf' ? [false, true] : (entry.order ?? q.choices.map((_, i) => i));
  if (q.type === 'ms') {
    // 看解答、沒作答時沒有選：正解都標成正解，不算漏選
    const mine = Array.isArray(entry.chosen) ? new Set(entry.chosen) : null;
    return values.map((value) => ({
      value,
      state: q.answer.includes(value) ? (!mine || mine.has(value) ? 'right' : 'missed') : mine?.has(value) ? 'wrong' : '',
    }));
  }
  return values.map((value) => ({ value, state: value === q.answer ? 'right' : value === entry.chosen ? 'wrong' : '' }));
}

/** 回看時選項上的圈叉與給螢幕閱讀器的說明 */
const STATE_MARK = {
  right: ['ok', '正解'],
  wrong: ['ng', '你選的'],
  missed: ['ok', '正解，你沒選'],
};

export function initPast(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const sheet = $('#past-sheet');
  const card = $('#past-card');
  let items = []; // [{ q, entry, n }]，舊到新
  let at = 0;
  let done = null;

  /**
   * @param {{ q: object, entry: object, n: number }[]} list 這輪做過的題目（舊到新），n 是第幾題
   * @param {{ current?: number, timed: boolean, onClose: () => void, start?: number, backLabel?: string }} opts
   *   current：現在這題是第幾題；start：先看第幾筆（預設最後一筆）；backLabel：關閉按鈕的字（模擬考成績單用）
   */
  ctx.openPast = (list, { current, timed, onClose, start = list.length - 1, backLabel = `回到第 ${current} 題` }) => {
    items = list;
    at = start;
    done = onClose;
    $('#past-back').textContent = backLabel;
    $('#past-tip').hidden = !timed;
    render();
    openSheet(sheet, { focus: $('#past-back') });
  };

  function render() {
    const { q, entry, n } = items[at];
    const subj = SUBJECT_BY_ID[q.subject];
    const result = entry.mark ?? entry.outcome;
    sheet.style.setProperty('--c', subj.color);
    $('#past-n').textContent = `第 ${n} 題`;
    const chip = $('#past-result');
    chip.textContent = RESULT[result];
    chip.dataset.result = result === 'right' || result === 'wrong' ? result : 'other';
    $('#past-prev').disabled = at <= 0;
    $('#past-next').disabled = at >= items.length - 1;

    const { flags, stars } = ctx.state;
    const choices = seenChoices(q, entry)
      .map(({ value, state }, i) => {
        const label = q.type === 'tf' ? tfLabel(value) : richHTML(q.choices[value]);
        const [mark, said] = STATE_MARK[state] ?? [];
        const tag = state === 'missed' ? '<span class="miss-tag" aria-hidden="true">漏選</span>' : '';
        const marked = mark ? `${tag}${icon(mark, 'mark')}<span class="sr-only">（${said}）</span>` : '';
        // 漏選的正解也用正解的底色，另外標「漏選」
        const cls = state === 'missed' ? 'right missed' : state;
        return `<li class="past-choice ${cls}">${q.type === 'tf' ? '' : `<span class="key" aria-hidden="true">${i + 1}</span>`}<span class="answer-text">${label}</span>${marked}</li>`;
      })
      .join('');
    // 演算題自己填的答案不是任何一個選項時，選項上標不出來，另外寫一行
    const typed = entry.typed !== undefined && (entry.chosen === null || entry.chosen === undefined) ? `<p class="past-typed">你填的答案：${entry.typed}（不是任何一個選項）</p>` : '';
    card.innerHTML = `<div class="card-tag"><span class="tag">${subj.name}</span><span class="topic">${topicLabel(q)}</span>${canSpeak(q) ? `<button type="button" class="speak-btn" data-speak="0" aria-label="念出這句英文">${icon('speaker')}</button>` : ''}<button type="button" class="star-btn" data-star="${q.id}" aria-pressed="${!!stars[q.id]}" aria-label="收藏這題">${icon('star')}</button><button type="button" class="copy-btn" data-copy aria-label="複製題目（可以貼給 ChatGPT 問）">${icon('copy')}</button><button type="button" class="flag-btn" data-flag="${q.id}" aria-pressed="${!!flags[q.id]}" aria-label="回報這題有問題">${icon('flag')}</button></div>
      ${passageDetails(q)}<div class="r-q">${stemHTML(q)}</div>
      ${typed}<ol class="past-choices ${q.type}">${choices}</ol>
      <div class="explain"><b>${icon('bulb')}解析</b>${richHTML(q.explain)}</div>`;
    $('#past-scroll').scrollTop = 0;
  }

  function step(d) {
    const i = at + d;
    if (i < 0 || i >= items.length) return;
    at = i;
    stopSpeaking();
    render();
  }

  function close() {
    if (sheet.hidden) return;
    closeSheet(sheet);
    stopSpeaking();
    done?.();
  }

  $('#past-prev').addEventListener('click', () => step(-1));
  $('#past-next').addEventListener('click', () => step(1));
  $('#past-back').addEventListener('click', close);
  $('#past-close').addEventListener('click', close);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });

  // 念英文、收藏、複製、回報（複製時附上當時選的答案，(A)–(D) 跟當時畫面一致）
  card.addEventListener('click', (e) => {
    const { q, entry } = items[at];
    if (speakItem(e.target, [q])) return;
    if (e.target.closest('[data-copy]')) {
      copyQuestion(questionPrompt(q, entry), ctx.toast);
      return;
    }
    toggleMark(ctx, e.target);
  });

  // Esc 關掉（不是結束這一輪，見 sheet.js）、左右鍵往前往後翻
  sheet.addEventListener('sheet-close', close);
  window.addEventListener('keydown', (e) => {
    if (topSheet() !== sheet) return;
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });
}
