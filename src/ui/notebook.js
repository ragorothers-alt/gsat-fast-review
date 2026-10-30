// 錯題本：四個分頁
//   錯題：還沒學會的題目（答錯或按過「不會」），可以直接練一輪
//   收藏：作答時按星星收起來的題目
//   重點：每個單元的考前重點卡（點了打開 ui/keypoints.js 的面板）
//   搜尋：全部題目的題幹、選項與解析
// 都可以依科目篩選；題目可以複製給 ChatGPT、收藏或回報。
import { questionPrompt } from '../prompt.js';
import { DAY, isWeak, mastery } from '../srs.js';
import { MODES } from '../session.js';
import { SUBJECTS, SUBJECT_BY_ID } from '../subjects.js';
import { UNITS, unitKey } from '../units.js';
import { copyQuestion } from './clipboard.js';
import { openKeypointsFrom } from './keypoints.js';
import { reviewItem, speakItem, toggleMark } from './review-item.js';

/** 一次畫幾題（題目多時公式排版很花時間，捲到底再按「再顯示」） */
const PAGE = 20;
/** 打字停下來多久才搜尋 */
const SEARCH_DELAY = 180;

const VIEWS = {
  wrong: {
    label: '題還沒學會',
    note: '答錯或按過「不會」的題目會留在這裡，之後隔開時間再答對三次才會離開。考前翻一翻，或直接練一輪。',
    empty: '這裡還沒有錯題。答錯或按「不會」的題目會自動收進來。',
  },
  star: {
    label: '題收藏',
    note: '作答或看解析時，按題目右上角的星星就會收進來；開了線上同步的話，每台裝置都看得到。',
    empty: '還沒有收藏的題目。覺得值得再看一次的題目，按右上角的星星收起來。',
  },
  cards: {
    label: '個單元',
    note: '每個單元整理了必背重點與易錯陷阱，考前一張一張翻；題目卡上的單元名稱也點得開。',
    empty: '',
  },
  search: {
    label: '題符合',
    note: '搜尋全部題目的題幹、選項與解析；用空格隔開幾個詞，可以找同時出現的題目。',
    empty: '輸入關鍵字開始搜尋，例如單元名稱、人名或專有名詞。',
  },
};

/** 搜尋用的正規化：全形轉半形、不分大小寫、臺＝台，拿掉公式的 LaTeX 記號（$\mathrm{H_2O}$ → h2o） */
function norm(s) {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/臺/g, '台')
    .replace(/\\(mathrm|text|rm|mathbf|operatorname|left|right)\b/g, '')
    .replace(/[{}_^$\\]/g, '');
}

export function initNotebook(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const screen = $('#notebook');
  const list = $('#notebook-list');
  const more = $('#notebook-more');
  const input = $('#notebook-search');
  const viewBtns = [...document.querySelectorAll('#notebook-views [data-view]')];
  let view = 'wrong';
  let filter = 'all';
  let all = [];
  let items = [];
  let shown = 0;
  let hay = null;
  let timer = 0;

  /** 錯題，最近錯的在前面；被回報的題目先不列 */
  function wrongItems() {
    const { cards, flags } = ctx.state;
    return ctx.bank.filter((q) => isWeak(cards[q.id]) && !flags[q.id]).sort((a, b) => cards[b.id].last - cards[a.id].last);
  }

  /** 收藏，最近收的在前面 */
  function starItems() {
    const { stars } = ctx.state;
    return ctx.bank.filter((q) => stars[q.id]).sort((a, b) => stars[b.id] - stars[a.id]);
  }

  /** 重點分頁的單元清單，依科目、單元的順序 */
  function unitItems() {
    return SUBJECTS.flatMap((s) => (UNITS[s.id] ?? []).map((unit) => ({ subject: s.id, unit })));
  }

  /** 每個詞都要出現；題幹、選項、單元裡就找得到的排前面，只在解析裡出現的排後面 */
  function searchItems(query) {
    const terms = norm(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    hay ||= new Map(
      ctx.bank.map((q) => [q.id, [norm([q.id, SUBJECT_BY_ID[q.subject].name, q.topic, q.q, ...(q.choices ?? [])].join('\n')), norm(q.explain)]]),
    );
    const front = [];
    const back = [];
    for (const q of ctx.bank) {
      const [main, explain] = hay.get(q.id);
      if (terms.every((w) => main.includes(w))) front.push(q);
      else if (terms.every((w) => main.includes(w) || explain.includes(w))) back.push(q);
    }
    return [...front, ...back];
  }

  function note(q, now) {
    const c = ctx.state.cards[q.id];
    if (view === 'wrong') {
      const skips = c.seen - c.right - c.wrong;
      const parts = [c.wrong ? `答錯 ${c.wrong} 次` : '', skips > 0 ? `看解答 ${skips} 次` : '', ago(now - c.last)].filter(Boolean);
      return `<span class="r-mine">${parts.join('・')}</span>`;
    }
    const record = c?.seen ? `答過 ${c.seen} 次、答對 ${c.right} 次` : '還沒答過';
    const parts = view === 'star' ? [`${ago(now - ctx.state.stars[q.id])}收藏`, record] : [record];
    return `<span class="r-note">${parts.join('・')}</span>`;
  }

  function render() {
    all = view === 'wrong' ? wrongItems() : view === 'star' ? starItems() : view === 'cards' ? unitItems() : searchItems(input.value);
    const counts = new Map();
    for (const q of all) counts.set(q.subject, (counts.get(q.subject) || 0) + 1);
    if (filter !== 'all' && !counts.has(filter)) filter = 'all';
    items = filter === 'all' ? all : all.filter((q) => q.subject === filter);

    for (const b of viewBtns) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    $('#nb-n-wrong').textContent = view === 'wrong' ? all.length : wrongItems().length;
    $('#nb-n-star').textContent = Object.keys(ctx.state.stars).length || '';
    const v = VIEWS[view];
    const searching = view === 'search';
    const query = input.value.trim();
    $('#notebook-search-box').hidden = !searching;
    $('#notebook-count').textContent = all.length;
    $('#notebook-count-label').textContent = v.label;
    $('#notebook-count').parentElement.hidden = searching && !query;
    $('#notebook-note').textContent = v.note;

    const tabs = [['all', '全部', all.length], ...SUBJECTS.filter((s) => counts.has(s.id)).map((s) => [s.id, s.name, counts.get(s.id)])];
    $('#notebook-tabs').innerHTML = tabs
      .map(
        ([id, name, n]) =>
          `<button type="button" class="sheet-tab on" role="tab" data-filter="${id}" aria-selected="${id === filter}" style="--c:${SUBJECT_BY_ID[id]?.color ?? 'var(--accent)'}">${name} ${n}</button>`,
      )
      .join('');
    $('#notebook-tabs').hidden = all.length === 0;
    const empty = $('#notebook-empty');
    empty.hidden = all.length > 0;
    empty.textContent = searching && query ? `找不到同時有「${query.split(/\s+/).join('」「')}」的題目，換個說法試試。` : v.empty;

    const train = $('#notebook-train');
    train.parentElement.hidden = view === 'cards';
    train.disabled = !items.length;
    const size = MODES[view === 'wrong' ? 'review' : view === 'star' ? 'starred' : 'picked'].size;
    const what = view === 'wrong' ? '練一輪錯題' : view === 'star' ? '練收藏的題目' : '練搜尋到的題目';
    train.textContent = items.length ? `${what}（${Math.min(items.length, size)} 題）` : what;

    list.innerHTML = '';
    shown = 0;
    renderMore();
  }

  /** 重點分頁：單元清單，附上熟練度 */
  function renderUnits() {
    const byUnit = new Map();
    for (const q of ctx.bank) {
      const key = unitKey(q.subject, q.topic);
      if (!byUnit.has(key)) byUnit.set(key, []);
      byUnit.get(key).push(q);
    }
    list.innerHTML = items
      .map(({ subject, unit }) => {
        const subj = SUBJECT_BY_ID[subject];
        const m = Math.round(mastery(byUnit.get(unitKey(subject, unit)) ?? [], ctx.state.cards) * 100);
        return `<li><button type="button" class="kp-unit" data-kp="${subject}/${unit}" style="--c:${subj.color}"><span class="tag">${subj.name}</span><span class="kp-unit-name">${unit}</span><span class="kp-unit-meta">熟練 ${m}%</span><span class="unit-meter" aria-hidden="true"><i style="width:${m}%"></i></span></button></li>`;
      })
      .join('');
    more.hidden = true;
  }

  function renderMore() {
    if (view === 'cards') return renderUnits();
    const now = Date.now();
    const { flags, stars } = ctx.state;
    const next = items.slice(shown, shown + PAGE);
    list.insertAdjacentHTML(
      'beforeend',
      next.map((q, i) => reviewItem(q, { index: shown + i, flagged: !!flags[q.id], starred: !!stars[q.id], note: note(q, now) })).join(''),
    );
    shown += next.length;
    const left = items.length - shown;
    more.hidden = left <= 0;
    more.textContent = `再顯示 ${Math.min(left, PAGE)} 題（還有 ${left} 題）`;
  }

  function setView(next) {
    view = next;
    filter = 'all';
    render();
    $('#notebook-scroll').scrollTop = 0;
    if (view === 'search') input.focus({ preventScroll: true });
  }

  /** @param {'wrong'|'star'|'cards'|'search'} [initial] 打開哪個分頁；沒指定就回到上次看的 */
  ctx.showNotebook = (initial) => {
    if (initial) view = initial;
    filter = 'all';
    render();
    // 錯最多的科目，牠們的貓趴在最上面的卡片上
    const bySubject = new Map();
    for (const q of wrongItems()) bySubject.set(q.subject, (bySubject.get(q.subject) || 0) + 1);
    const cast = [...bySubject].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 3);
    ctx.world.setCast(cast.length ? cast : ctx.state.settings.subjects.slice(0, 3));
    ctx.show('notebook');
    $('#notebook-scroll').scrollTop = 0;
  };

  for (const b of viewBtns) b.addEventListener('click', () => b.dataset.view !== view && setView(b.dataset.view));
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(render, SEARCH_DELAY);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    clearTimeout(timer);
    render();
    input.blur(); // 手機上收起鍵盤，才看得到結果
  });

  $('#notebook-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-filter]');
    if (!tab) return;
    filter = tab.dataset.filter;
    render();
  });
  more.addEventListener('click', renderMore);

  list.addEventListener('click', (e) => {
    if (openKeypointsFrom(ctx, e.target) || speakItem(e.target, items)) return;
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const q = items[Number(copy.dataset.copy)];
      // 錯題本沒有記下當時選了什麼，只附上正解與解析
      copyQuestion(questionPrompt(q, { outcome: 'review' }), ctx.toast);
      return;
    }
    if (toggleMark(ctx, e.target)?.kind === 'stars') $('#nb-n-star').textContent = Object.keys(ctx.state.stars).length || '';
  });

  $('#notebook-train').addEventListener('click', () => {
    if (view === 'wrong') ctx.startRound('review', { subjects: filter === 'all' ? SUBJECTS.map((s) => s.id) : [filter] });
    else ctx.startRound(view === 'star' ? 'starred' : 'picked', { ids: items.map((q) => q.id) });
  });
  $('#notebook-back').addEventListener('click', () => ctx.goHome());
  document.addEventListener('keydown', (e) => {
    // 搜尋框裡按 Esc 是清空關鍵字（瀏覽器內建），不離開
    if (e.key === 'Escape' && !screen.hidden && !(e.target === input && input.value)) ctx.goHome();
  });
}

function ago(ms) {
  const days = Math.floor(ms / DAY);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  return `${days} 天前`;
}
