// 錯題本：一頁翻完還沒學會的題目（答錯或按過「不會」），可以依科目篩選、複製給 ChatGPT、直接練一輪
import { questionPrompt } from '../prompt.js';
import { DAY, isWeak } from '../srs.js';
import { MODES } from '../session.js';
import { SUBJECTS, SUBJECT_BY_ID } from '../subjects.js';
import { setFlag } from '../sync.js';
import { copyQuestion } from './clipboard.js';
import { reviewItem } from './review-item.js';

/** 一次畫幾題（題目多時公式排版很花時間，捲到底再按「再顯示」） */
const PAGE = 20;

export function initNotebook(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const screen = $('#notebook');
  const list = $('#notebook-list');
  const more = $('#notebook-more');
  let filter = 'all';
  let all = [];
  let items = [];
  let shown = 0;

  /** 錯題，最近錯的在前面；被回報的題目先不列 */
  function collect() {
    const { cards, flags } = ctx.state;
    return ctx.bank.filter((q) => isWeak(cards[q.id]) && !flags[q.id]).sort((a, b) => cards[b.id].last - cards[a.id].last);
  }

  function note(q, now) {
    const c = ctx.state.cards[q.id];
    const skips = c.seen - c.right - c.wrong;
    const parts = [c.wrong ? `答錯 ${c.wrong} 次` : '', skips > 0 ? `看解答 ${skips} 次` : '', ago(now - c.last)].filter(Boolean);
    return `<span class="r-mine">${parts.join('・')}</span>`;
  }

  function render() {
    all = collect();
    const counts = new Map();
    for (const q of all) counts.set(q.subject, (counts.get(q.subject) || 0) + 1);
    if (filter !== 'all' && !counts.has(filter)) filter = 'all';
    items = filter === 'all' ? all : all.filter((q) => q.subject === filter);

    $('#notebook-count').textContent = all.length;
    const tabs = [['all', '全部', all.length], ...SUBJECTS.filter((s) => counts.has(s.id)).map((s) => [s.id, s.name, counts.get(s.id)])];
    $('#notebook-tabs').innerHTML = tabs
      .map(
        ([id, name, n]) =>
          `<button type="button" class="sheet-tab on" role="tab" data-filter="${id}" aria-selected="${id === filter}" style="--c:${SUBJECT_BY_ID[id]?.color ?? 'var(--accent)'}">${name} ${n}</button>`,
      )
      .join('');
    $('#notebook-tabs').hidden = all.length === 0;
    $('#notebook-empty').hidden = all.length > 0;
    const train = $('#notebook-train');
    train.disabled = !items.length;
    train.textContent = items.length ? `練一輪錯題（${Math.min(items.length, MODES.review.size)} 題）` : '練一輪錯題';

    list.innerHTML = '';
    shown = 0;
    renderMore();
  }

  function renderMore() {
    const now = Date.now();
    const next = items.slice(shown, shown + PAGE);
    list.insertAdjacentHTML(
      'beforeend',
      next.map((q, i) => reviewItem(q, { index: shown + i, flagged: !!ctx.state.flags[q.id], note: note(q, now) })).join(''),
    );
    shown += next.length;
    const left = items.length - shown;
    more.hidden = left <= 0;
    more.textContent = `再顯示 ${Math.min(left, PAGE)} 題（還有 ${left} 題）`;
  }

  ctx.showNotebook = () => {
    filter = 'all';
    render();
    // 錯最多的科目，牠們的貓趴在最上面的卡片上
    const bySubject = new Map();
    for (const q of all) bySubject.set(q.subject, (bySubject.get(q.subject) || 0) + 1);
    const cast = [...bySubject].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 3);
    ctx.world.setCast(cast.length ? cast : ctx.state.settings.subjects.slice(0, 3));
    ctx.show('notebook');
    $('#notebook-scroll').scrollTop = 0;
  };

  $('#notebook-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-filter]');
    if (!tab) return;
    filter = tab.dataset.filter;
    render();
  });
  more.addEventListener('click', renderMore);

  list.addEventListener('click', (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const q = items[Number(copy.dataset.copy)];
      // 錯題本沒有記下當時選了什麼，只附上正解與解析
      copyQuestion(questionPrompt(q, { outcome: 'review' }), ctx.toast);
      return;
    }
    const btn = e.target.closest('[data-flag]');
    if (!btn) return;
    const id = btn.dataset.flag;
    const { flags } = ctx.state;
    setFlag(ctx.state, id, !flags[id], Date.now());
    ctx.save();
    btn.setAttribute('aria-pressed', String(!!flags[id]));
    ctx.toast(flags[id] ? '已回報這題，之後先不出' : '已取消回報');
  });

  $('#notebook-train').addEventListener('click', () => {
    ctx.startRound('review', { subjects: filter === 'all' ? SUBJECTS.map((s) => s.id) : [filter] });
  });
  $('#notebook-back').addEventListener('click', () => ctx.goHome());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !screen.hidden) ctx.goHome();
  });
}

function ago(ms) {
  const days = Math.floor(ms / DAY);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  return `${days} 天前`;
}
