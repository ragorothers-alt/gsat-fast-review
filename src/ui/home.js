// 首頁：科目選擇、今日進度、學測倒數、模式入口
import { daysUntil, weakUnits } from '../analysis.js';
import { SUBJECTS } from '../subjects.js';
import { isWeak, mastery } from '../srs.js';
import { currentStreak, today } from '../stats.js';
import { UNITS, unitKey } from '../units.js';
import { initSettings } from './settings.js';
import { initUnitSheet } from './units.js';

export function initHome(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const chipsEl = $('#subject-chips');
  const settings = ctx.state.settings;

  // 舊存檔裡若有已不存在的科目就濾掉
  settings.subjects = settings.subjects.filter((id) => SUBJECTS.some((s) => s.id === id));

  const chips = SUBJECTS.map((s) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.subject = s.id;
    btn.style.setProperty('--c', s.color);
    btn.innerHTML = `<span class="chip-name">${s.name}</span><span class="chip-meter"><i></i></span><span class="chip-units" hidden></span>`;
    btn.addEventListener('click', () => toggle(s.id));
    chipsEl.append(btn);
    return btn;
  });

  function toggle(id) {
    const set = new Set(settings.subjects);
    set.has(id) ? set.delete(id) : set.add(id);
    settings.subjects = SUBJECTS.map((s) => s.id).filter((x) => set.has(x));
    ctx.save();
    render();
  }

  ctx.world.onCatTap = toggle;

  const unitSheet = initUnitSheet(ctx, () => render());
  $('#open-units').addEventListener('click', () => unitSheet.open());

  $('#toggle-all').addEventListener('click', () => {
    const all = settings.subjects.length === SUBJECTS.length;
    settings.subjects = all ? [] : SUBJECTS.map((s) => s.id);
    ctx.save();
    render();
  });

  const settingsSheet = initSettings(ctx, () => render());
  $('#open-settings').addEventListener('click', () => settingsSheet.open());
  $('#daily').addEventListener('click', () => ctx.showStats());

  document.querySelectorAll('#home [data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => ctx.startRound(btn.dataset.mode));
  });

  function render() {
    const now = Date.now();
    const { cards, flags } = ctx.state;
    const selected = new Set(settings.subjects);
    const off = new Set(settings.excludedUnits);
    // 被回報的題目暫時不出，也不算進題數
    const inSelection = ctx.bank.filter((q) => selected.has(q.subject) && !off.has(unitKey(q.subject, q.topic)) && !flags[q.id]);

    chips.forEach((chip) => {
      const id = chip.dataset.subject;
      const qs = ctx.bank.filter((q) => q.subject === id);
      const m = Math.round(mastery(qs, cards) * 100);
      chip.setAttribute('aria-pressed', String(selected.has(id)));
      chip.querySelector('i').style.width = `${m}%`;
      // 只練部分單元時，右上角標出練幾個單元
      const units = UNITS[id] || [];
      const onUnits = units.filter((u) => !off.has(unitKey(id, u))).length;
      const badge = chip.querySelector('.chip-units');
      badge.hidden = !selected.has(id) || onUnits === units.length;
      badge.textContent = onUnits;
      chip.title = qs.length ? `熟練度 ${m}%・${qs.length} 題・練 ${onUnits}/${units.length} 個單元` : '題庫準備中';
    });
    $('#toggle-all').textContent = selected.size === SUBJECTS.length ? '清除' : '全選';

    $('#streak b').textContent = currentStreak(ctx.state, now);
    const day = today(ctx.state, now);
    const goal = settings.goal;
    $('#daily-count').textContent = day.answered;
    $('#daily-goal').textContent = goal;
    const ring = $('#daily-ring');
    ring.style.strokeDasharray = `${Math.min(100, (day.answered / goal) * 100)} 100`;
    ring.style.opacity = day.answered ? '1' : '0'; // 0 題時圓頭線帽會留一個點
    $('#daily-acc').textContent = day.answered ? `正確率 ${Math.round((day.right / day.answered) * 100)}%` : '今天還沒開始，來一輪吧！';
    $('#daily').classList.toggle('done', day.answered >= goal);

    // 考完就不再倒數
    const left = daysUntil(settings.examDate, now);
    $('#countdown').hidden = left < 0;
    $('#countdown-days').textContent = left;

    $('#best-blitz').textContent = ctx.state.best.blitz;
    $('#formula-count').textContent = inSelection.filter((q) => q.formula).length;
    $('#weak-count').textContent = inSelection.filter((q) => isWeak(cards[q.id])).length;
    const weak = weakUnits(ctx.bank, cards, { subjects: settings.subjects, excludedUnits: settings.excludedUnits });
    $('#weak-units-sub').textContent = weak.length ? `最弱 ${weak.length} 單元` : '先多練幾輪';

    const disabled = !inSelection.length;
    document.querySelectorAll('#home [data-mode]').forEach((b) => (b.disabled = disabled));
    $('#bank-info').textContent = ctx.bank.length
      ? disabled
        ? '先選至少一科再開始'
        : `已選 ${selected.size} 科・${inSelection.length} 題（題庫共 ${ctx.bank.length} 題）`
      : '題庫準備中…';

    ctx.world.setSelected(settings.subjects);
  }

  // 線上同步拉回別台的紀錄後重畫（首頁正開著才需要）
  ctx.refreshHome = () => {
    if (!$('#home').hidden) render();
  };

  ctx.goHome = () => {
    // 新版已在背景下載好：趁回到首頁時換上，不打斷作答
    if (ctx.updateReady) return ctx.applyUpdate();
    render();
    ctx.show('home');
  };
}
