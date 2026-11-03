// 回看剛剛的題目：作答時按「上一題」，從底部彈出這輪做過的題目（當時的選項順序、你選的、正解與解析），
// 可以一路往前翻。看的時候計時暫停、不能作答，關掉就回到原本那題（play.js 負責暫停與恢復）。
import { questionPrompt } from '../prompt.js';
import { SUBJECT_BY_ID } from '../subjects.js';
import { topicLabel } from '../units.js';
import { copyQuestion } from './clipboard.js';
import { icon } from './icons.js';
import { richHTML } from './rich.js';
import { speakItem, tfLabel, toggleMark } from './review-item.js';
import { canSpeak, stopSpeaking } from './speech.js';

const RESULT = { right: '答對', wrong: '答錯', skip: '看了解答', guess: '答對・猜的', unsure: '答對・不太確定' };

/**
 * 這題當時畫面上的選項，照當時的順序：value 是原始選項索引（是非題為 false、true），
 * state 是 'right'（正解）、'wrong'（選錯的那個）或 ''。
 * @param {object} q 題目
 * @param {{ chosen?: number | boolean | null, order?: number[] }} entry 這輪的作答紀錄；order 是單選題當時打亂後的順序
 */
export function seenChoices(q, entry) {
  const values = q.type === 'tf' ? [false, true] : (entry.order ?? [0, 1, 2, 3]);
  return values.map((value) => ({ value, state: value === q.answer ? 'right' : value === entry.chosen ? 'wrong' : '' }));
}

export function initPast(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const sheet = $('#past-sheet');
  const card = $('#past-card');
  let items = []; // [{ q, entry, n }]，舊到新
  let at = 0;
  let done = null;
  let opener = null;

  /**
   * @param {{ q: object, entry: object, n: number }[]} list 這輪做過的題目（舊到新），n 是第幾題
   * @param {{ current: number, timed: boolean, onClose: () => void }} opts current：現在這題是第幾題
   */
  ctx.openPast = (list, { current, timed, onClose }) => {
    items = list;
    at = list.length - 1;
    done = onClose;
    opener = document.activeElement;
    $('#past-back').textContent = `回到第 ${current} 題`;
    $('#past-tip').hidden = !timed;
    sheet.hidden = false;
    render();
    $('#past-back').focus({ preventScroll: true });
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
        const mark = state ? `${icon(state === 'right' ? 'ok' : 'ng', 'mark')}<span class="sr-only">（${state === 'right' ? '正解' : '你選的'}）</span>` : '';
        return `<li class="past-choice ${state}">${q.type === 'mc' ? `<span class="key" aria-hidden="true">${i + 1}</span>` : ''}<span class="answer-text">${label}</span>${mark}</li>`;
      })
      .join('');
    card.innerHTML = `<div class="card-tag"><span class="tag">${subj.name}</span><span class="topic">${topicLabel(q)}</span>${canSpeak(q) ? `<button type="button" class="speak-btn" data-speak="0" aria-label="念出這句英文">${icon('speaker')}</button>` : ''}<button type="button" class="star-btn" data-star="${q.id}" aria-pressed="${!!stars[q.id]}" aria-label="收藏這題">${icon('star')}</button><button type="button" class="copy-btn" data-copy aria-label="複製題目（可以貼給 ChatGPT 問）">${icon('copy')}</button><button type="button" class="flag-btn" data-flag="${q.id}" aria-pressed="${!!flags[q.id]}" aria-label="回報這題有問題">${icon('flag')}</button></div>
      <div class="r-q">${richHTML(q.q)}</div>
      <ol class="past-choices ${q.type}">${choices}</ol>
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
    sheet.hidden = true;
    stopSpeaking();
    done?.();
    opener?.focus?.({ preventScroll: true });
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

  // 打開時鍵盤只給這個面板：Esc 關掉（不是結束這一輪）、左右鍵往前往後翻
  window.addEventListener(
    'keydown',
    (e) => {
      if (sheet.hidden) return;
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        close();
      } else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    },
    { capture: true },
  );
}
