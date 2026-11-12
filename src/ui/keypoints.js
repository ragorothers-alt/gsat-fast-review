// 考前重點卡：每個單元的必背重點與易錯陷阱。底部彈出面板，可以前後翻同一科的單元、直接練這個單元。
// 從錯題本的「重點」分頁、單元面板、學習分析的弱點單元、題目卡上的單元名稱打開。
import { conceptCoverage, conceptPrefix, conceptProgress } from '../analysis.js';
import { loadConcepts } from '../data/concepts.js';
import { loadKeypoints } from '../data/keypoints.js';
import { SUBJECT_BY_ID } from '../subjects.js';
import { mastery } from '../srs.js';
import { MODES } from '../session.js';
import { UNITS, unitKey } from '../units.js';
import { richHTML } from './rich.js';
import { closeAllSheets, closeSheet, openSheet, topSheet } from './sheet.js';

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
    // 這個單元練過幾個考點（跨單元綜合通常借用別的單元的考點，沒有自己的，就不寫）
    const progress = conceptProgress(ctx.bank, ctx.state.cards, subject);
    const cover = conceptCoverage(progress, conceptPrefix(subject, unit));
    $('#kp-meta').textContent =
      `第 ${i + 1} / ${list.length} 個單元・${qs.length} 題・熟練 ${Math.round(mastery(qs, ctx.state.cards) * 100)}%` + (cover.total ? `・考點 ${cover.touched}／${cover.total}` : '');
    renderConcepts(mine, progress, cover);
    $('#kp-prev').disabled = i <= 0;
    $('#kp-next').disabled = i >= list.length - 1;
    $('#kp-train').textContent = `練這個單元（${MODES.weak.size} 題）`;
    $('#kp-scroll').scrollTop = 0;

    points.innerHTML = '';
    traps.innerHTML = '';
    $('#kp-body').hidden = true;
    status.hidden = false;
    status.textContent = '載入中…';
    let card;
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

  /**
   * 這個單元的考點：每個考點練過幾題；還沒練過的、還有錯題的各用不同的樣子標出來。
   * 考點清單另外下載，和重點卡各自顯示（其中一個載不下來不影響另一個）
   */
  async function renderConcepts(mine, progress, cover) {
    const box = $('#kp-concepts');
    box.hidden = true;
    if (!cover.total) return;
    let mineUnit;
    try {
      mineUnit = (await loadConcepts(subject))?.find((c) => c.unit === unit);
    } catch {
      return; // 離線又還沒快取：上面那行已經寫了練過幾個，名稱就先不列
    }
    if (mine !== ticket || !mineUnit) return;
    const listEl = $('#kp-concept-list');
    listEl.innerHTML = '';
    for (const c of mineUnit.concepts) {
      const p = progress.get(c.id) ?? { size: 0, seen: 0, weak: 0, done: 0 };
      const li = document.createElement('li');
      // 點一個考點就只練這個考點（錯題本裡的先出）；題目全都答對過、不再出的考點按不了
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `kp-chip ${p.weak ? 'weak' : p.seen ? 'done' : 'todo'}`;
      btn.title = c.scope;
      btn.dataset.concept = `${subject}/${c.id}`;
      btn.disabled = p.size > 0 && p.done >= p.size;
      const name = document.createElement('span');
      name.className = 'kp-chip-name';
      name.textContent = c.name;
      const n = document.createElement('span');
      n.className = 'kp-chip-n';
      n.textContent = btn.disabled ? `全部答對過・${p.size} 題` : p.weak ? `錯題 ${p.weak}・練過 ${p.seen}／${p.size}` : p.seen ? `練過 ${p.seen}／${p.size}` : `還沒練・${p.size} 題`;
      // 螢幕閱讀器念「練這個考點：名稱、進度」；看得到的字要包含在念出來的名稱裡，所以不用 aria-label
      const say = document.createElement('span');
      say.className = 'sr-only';
      say.textContent = '練這個考點：';
      const sep = document.createElement('span');
      sep.className = 'sr-only';
      sep.textContent = '，';
      btn.append(say, name, sep, n);
      li.append(btn);
      listEl.append(li);
    }
    $('#kp-concepts-n').textContent = `練過 ${cover.touched}／${cover.total}`;
    box.hidden = false;
  }

  /** 打開某個單元的重點卡 */
  ctx.openKeypoints = (s, u) => {
    if (!UNITS[s]?.includes(u)) return;
    subject = s;
    unit = u;
    render();
    openSheet(sheet);
  };

  function step(d) {
    const list = units();
    const i = list.indexOf(unit) + d;
    if (i < 0 || i >= list.length) return;
    unit = list[i];
    render();
  }

  const close = () => closeSheet(sheet);

  $('#kp-concept-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-concept]');
    if (!btn || btn.disabled) return;
    closeAllSheets();
    ctx.startRound('concept', { concept: btn.dataset.concept });
  });
  $('#kp-prev').addEventListener('click', () => step(-1));
  $('#kp-next').addEventListener('click', () => step(1));
  $('#kp-train').addEventListener('click', () => {
    // 從單元面板打開的話，底下那層面板也一起收起來
    closeAllSheets();
    // 重點卡可能是沒選的科目、或首頁關掉的單元（從錯題本、闖關面板打開）：照樣出這個單元的題
    ctx.startRound('weak', { units: [unitKey(subject, unit)], subjects: [subject] });
  });
  $('#kp-close').addEventListener('click', close);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  sheet.addEventListener('sheet-close', close);
  // 左右鍵翻單元（面板在最上層時）
  window.addEventListener('keydown', (e) => {
    if (topSheet() !== sheet) return;
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });
}

/** 單元名稱上的「重點卡」按鈕：data-kp="科目/單元"；點到的不是這種按鈕就回傳 false */
export function openKeypointsFrom(ctx, target) {
  const btn = target.closest('[data-kp]');
  if (!btn) return false;
  const [s, ...rest] = btn.dataset.kp.split('/');
  ctx.openKeypoints(s, rest.join('/'));
  return true;
}
