// 考前重點卡：每個單元的必背重點與易錯陷阱。底部彈出面板，可以前後翻同一科的單元、直接練這個單元。
// 從錯題本的「重點」分頁、單元面板、學習分析的弱點單元、題目卡上的單元名稱打開。
import { loadKeypoints } from '../data/keypoints.js';
import { SUBJECT_BY_ID } from '../subjects.js';
import { mastery } from '../srs.js';
import { MODES } from '../session.js';
import { UNITS, unitKey } from '../units.js';
import { richHTML } from './rich.js';

export function initKeypoints(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const sheet = $('#keypoints-sheet');
  const points = $('#kp-points');
  const traps = $('#kp-traps');
  const status = $('#kp-status');
  let subject = null;
  let unit = null;
  let ticket = 0;

  const units = () => UNITS[subject];

  async function render() {
    const mine = ++ticket;
    const subj = SUBJECT_BY_ID[subject];
    const list = units();
    const i = list.indexOf(unit);
    sheet.style.setProperty('--c', subj.color);
    $('#kp-subject').textContent = subj.name;
    $('#kp-unit').textContent = unit;
    const qs = ctx.bank.filter((q) => q.subject === subject && q.topic === unit);
    $('#kp-meta').textContent = `第 ${i + 1} / ${list.length} 個單元・${qs.length} 題・熟練 ${Math.round(mastery(qs, ctx.state.cards) * 100)}%`;
    $('#kp-prev').disabled = i <= 0;
    $('#kp-next').disabled = i >= list.length - 1;
    $('#kp-train').textContent = `練這個單元（${MODES.weak.size} 題）`;
    $('#kp-scroll').scrollTop = 0;

    points.innerHTML = '';
    traps.innerHTML = '';
    $('#kp-body').hidden = true;
    status.hidden = false;
    status.textContent = '載入中…';
    let card = null;
    try {
      card = (await loadKeypoints(subject))?.find((c) => c.unit === unit) ?? null;
    } catch {
      if (mine === ticket) status.textContent = '重點卡載不下來，連上網路後再試一次';
      return;
    }
    if (mine !== ticket) return; // 等下載的時候已經翻到別的單元
    if (!card) {
      status.textContent = '這個單元的重點卡還在準備中';
      return;
    }
    points.innerHTML = card.points.map((t) => `<li>${richHTML(t)}</li>`).join('');
    traps.innerHTML = card.traps.map((t) => `<li>${richHTML(t)}</li>`).join('');
    status.hidden = true;
    $('#kp-body').hidden = false;
  }

  /** 打開某個單元的重點卡 */
  ctx.openKeypoints = (s, u) => {
    if (!UNITS[s]?.includes(u)) return;
    subject = s;
    unit = u;
    sheet.hidden = false;
    render();
  };

  function step(d) {
    const list = units();
    const i = list.indexOf(unit) + d;
    if (i < 0 || i >= list.length) return;
    unit = list[i];
    render();
  }

  function close() {
    sheet.hidden = true;
  }

  $('#kp-prev').addEventListener('click', () => step(-1));
  $('#kp-next').addEventListener('click', () => step(1));
  $('#kp-train').addEventListener('click', () => {
    // 從單元面板打開的話，底下那層面板也一起收起來
    for (const s of document.querySelectorAll('.sheet')) s.hidden = true;
    ctx.startRound('weak', { units: [unitKey(subject, unit)] });
  });
  $('#kp-close').addEventListener('click', close);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  // 疊在單元面板上面時，Esc 只關這一層；左右鍵翻單元
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

/** 單元名稱上的「重點卡」按鈕：data-kp="科目/單元"；點到的不是這種按鈕就回傳 false */
export function openKeypointsFrom(ctx, target) {
  const btn = target.closest('[data-kp]');
  if (!btn) return false;
  const [s, ...rest] = btn.dataset.kp.split('/');
  ctx.openKeypoints(s, rest.join('/'));
  return true;
}
