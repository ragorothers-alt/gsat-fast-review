// 結算畫面與錯題本共用的題目卡：科目、單元、發音／收藏／複製／回報按鈕、題目、正解（與考點）、解析與考點重點
import { conceptOf, loadConcepts } from '../data/concepts.js';
import { reportQuestion } from '../report.js';
import { openNote } from '../session.js';
import { SUBJECT_BY_ID } from '../subjects.js';
import { setFlag, setStar } from '../sync.js';
import { topicLabel } from '../units.js';
import { icon } from './icons.js';
import { passageDetails } from './passage.js';
import { richHTML, stemHTML } from './rich.js';
import { canSpeak, speak, speechText } from './speech.js';

/** 是非題的答案：手繪圈叉加字 */
export const tfLabel = (v) => (v ? `${icon('ok')}對` : `${icon('ng')}錯`);

/** 英文單字題：考的字在大考中心《高中英文參考詞彙表》第幾級（學測詞彙題的正解多在第 3–5 級） */
export const lvTag = (q) => (q.lv ? `<span class="lv-tag" title="大考中心《高中英文參考詞彙表》第 ${q.lv} 級">詞彙表第 ${q.lv} 級</span>` : '');

const escapeHTML = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

/**
 * 這題的考點（正解旁邊）：點了只練這個考點。考點清單還沒下載好時先藏起來，畫好之後用 fillConceptTags 補上名稱
 */
export function conceptTagHTML(q) {
  if (!q.kp) return '';
  const c = conceptOf(q);
  return `<button type="button" class="kp-tag kp-link" data-practice="${q.subject}/${q.kp}" title="只練這個考點"${c ? '' : ' hidden'}>考點：${c ? escapeHTML(c.name) : ''}</button>`;
}

/** 考點重點那一行（解析下面）的內容 */
const noteInner = (note) => `<b class="kp-note-h">考點重點</b>${richHTML(note)}`;

/**
 * 這題考點的重點（解析下面一句該記住的規則、公式或事實）。考點清單還沒下載好時先藏起來，
 * 由 fillConceptTags 補上；這個考點沒寫重點就不放
 */
export function conceptNoteHTML(q) {
  if (!q.kp) return '';
  const c = conceptOf(q);
  if (c && !c.note) return '';
  return `<p class="kp-note r-kp-note" data-kpnote="${q.subject}/${q.kp}"${c ? '' : ' hidden'}>${c ? noteInner(c.note) : ''}</p>`;
}

/** 畫面裡還沒有名稱的考點按鈕、還沒有內容的考點重點：下載那科的考點清單後填上再顯示（下載不了就維持藏著） */
export function fillConceptTags(root) {
  const pending = [...root.querySelectorAll('.kp-link[hidden], .r-kp-note[hidden]')];
  const keyOf = (el) => (el.dataset.practice ?? el.dataset.kpnote).split('/');
  for (const subject of new Set(pending.map((el) => keyOf(el)[0]))) {
    loadConcepts(subject).then(
      () => {
        for (const el of pending) {
          const [s, kp] = keyOf(el);
          const c = s === subject && conceptOf({ subject: s, kp });
          if (!c || !el.isConnected) continue;
          if (el.dataset.practice) el.textContent = `考點：${c.name}`;
          else if (c.note) el.innerHTML = noteInner(c.note);
          else continue; // 這個考點沒寫重點：維持藏著
          el.hidden = false;
        }
      },
      () => {},
    );
  }
}

/** 題目卡上的考點按鈕：開一輪只練這個考點；點到的不是考點按鈕就回傳 false */
export function practiceConceptFrom(ctx, target) {
  const btn = target.closest('[data-practice]');
  if (!btn) return false;
  ctx.startRound('concept', { concept: btn.dataset.practice });
  return true;
}

/**
 * 一個答案的 HTML：是非題是圈叉、單選題是選項、多選題是選了的幾個選項（照原始順序，用「；」隔開）；
 * 非選擇題只有參考答案（value 是 q.answer），自評寫到哪幾個要點見 mineHTML
 * @param {number | number[] | boolean | string} value
 */
export function answerHTML(q, value) {
  if (q.type === 'open') return richHTML(value);
  if (q.type === 'tf') return tfLabel(value);
  if (q.type === 'ms') return value?.length ? value.map((i) => richHTML(q.choices[i])).join('；') : '沒有選';
  return richHTML(q.choices[value]);
}

/** 作答紀錄裡你的答案：演算題填的數不是任何一個選項時，顯示填的數；非選擇題是自評寫到幾個要點 */
export function mineHTML(q, entry) {
  if (q.type === 'open') return openNote(q, entry.chosen);
  if (entry.typed !== undefined && (entry.chosen === null || entry.chosen === undefined)) return `你填：${entry.typed}`;
  return `${entry.typed !== undefined ? '你填' : '你選'}：${answerHTML(q, entry.chosen)}`;
}

/**
 * 非選擇題的參考答案區塊（作答畫面、回看上一題共用）。
 * region：作答畫面的作答區放不下時會捲動，作答後要點按鈕都停用了，要留一個鍵盤到得了的地方才捲得動
 */
export const openRefHTML = (q, region = false) =>
  `<div class="open-ref"${region ? ' role="region" tabindex="0" aria-label="參考答案"' : ''}><b class="open-label"${region ? ' aria-hidden="true"' : ''}>參考答案</b><div class="open-ref-text">${richHTML(q.answer)}</div></div>`;

/**
 * 非選擇題的評分要點清單（結算、錯題本、回看上一題）。
 * @param {Question} q
 * @param {number[] | null} [got] 自評寫到的要點索引：有給就在那幾個要點蓋圈（回看上一題）
 */
export function openPointsHTML(q, got = null) {
  const items = q.points.map((p, i) => {
    const hit = got?.includes(i);
    return `<li class="open-point">${richHTML(p)}${hit ? `${icon('ok', 'open-got')}<span class="sr-only">（寫到了）</span>` : ''}</li>`;
  });
  return `<ul class="open-points" aria-label="評分要點">${items.join('')}</ul>`;
}

/**
 * @param {object} q 題目
 * @param {{ index: number, flagged: boolean, starred: boolean, note: string }} opts
 *   index：複製、發音按鈕對應的位置；note：正解前面那一段（你選了什麼、錯過幾次…）的 HTML
 */
export function reviewItem(q, { index, flagged, starred, note }) {
  const subj = SUBJECT_BY_ID[q.subject];
  const open = q.type === 'open';
  const answer = answerHTML(q, q.answer);
  return `<li class="r-item" style="--c:${subj.color}">
    <div class="card-tag"><span class="tag">${subj.name}</span><button type="button" class="topic topic-link" data-kp="${q.subject}/${q.topic}" title="看這個單元的考前重點">${topicLabel(q)}</button>${canSpeak(q) ? `<button type="button" class="speak-btn" data-speak="${index}" aria-label="念出這句英文">${icon('speaker')}</button>` : ''}<button type="button" class="star-btn" data-star="${q.id}" aria-pressed="${starred}" aria-label="收藏這題">${icon('star')}</button><button type="button" class="copy-btn" data-copy="${index}" aria-label="複製題目（可以貼給 ChatGPT 問）">${icon('copy')}</button><button type="button" class="flag-btn" data-flag="${q.id}" aria-pressed="${flagged}" aria-label="回報這題有問題">${icon('flag')}</button></div>
    ${passageDetails(q)}<div class="r-q">${stemHTML(q)}</div>
    <div class="r-ans">${note}<span class="r-right">${open ? '參考答案' : '正解'}：${answer}</span>${lvTag(q)}${conceptTagHTML(q)}</div>
    ${open ? openPointsHTML(q) : ''}<div class="r-explain">${richHTML(q.explain)}</div>${conceptNoteHTML(q)}
  </li>`;
}

/** 題目卡上的發音按鈕：念出填好正解的英文句子；點到的不是發音按鈕就回傳 false */
export function speakItem(target, items) {
  const btn = target.closest('[data-speak]');
  if (!btn) return false;
  const q = items[Number(btn.dataset.speak)];
  if (q) speak(speechText(q, { filled: true }));
  return true;
}

/**
 * 題目卡上的收藏、回報按鈕：切換標記、存檔、提示。點到的不是這兩種按鈕就回傳 null，
 * 否則回傳 { kind, id, on }，讓呼叫的畫面決定要不要重畫。
 */
export function toggleMark(ctx, target) {
  const btn = target.closest('[data-star], [data-flag]');
  if (!btn) return null;
  const kind = btn.dataset.star ? 'stars' : 'flags';
  const id = btn.dataset.star ?? btn.dataset.flag;
  const on = !ctx.state[kind][id];
  (kind === 'stars' ? setStar : setFlag)(ctx.state, id, on, Date.now());
  if (kind === 'flags' && on) reportQuestion(id);
  ctx.save();
  btn.setAttribute('aria-pressed', String(on));
  if (kind === 'stars') ctx.toast(on ? '已收藏，在錯題本的「收藏」找得到' : '已取消收藏');
  else ctx.toast(on ? '已回報這題，之後先不出' : '已取消回報');
  return { kind, id, on };
}
