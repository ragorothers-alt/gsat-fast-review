// 學習分析：整體概況、弱點單元、近 14 天走勢、各科熟練度。從首頁的今日進度卡進來。
import { accuracyOf, dailySeries, subjectStats, weakUnits } from '../analysis.js';
import { DAY, mastery } from '../srs.js';
import { SUBJECTS, SUBJECT_BY_ID } from '../subjects.js';

const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const TRAIN_UNITS = 3;

export function initStats(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const screen = $('#stats');
  const known = new Set(ctx.bank.map((q) => q.id));
  let weak = [];

  ctx.showStats = () => {
    render();
    // 弱點單元所屬科目的貓趴在最上面的卡片上；還沒有弱點時換成目前選的科目
    const cast = [...new Set(weak.map((u) => u.subject))];
    ctx.world.setCast(cast.length ? cast : ctx.state.settings.subjects.slice(0, 3));
    ctx.show('stats');
    $('#stats .stats-scroll').scrollTop = 0;
  };

  function render() {
    const now = Date.now();
    const { cards, daily, settings } = ctx.state;

    const week = dailySeries(daily, now, 7);
    const prev = dailySeries(daily, now - 7 * DAY, 7);
    const practiced = Object.keys(cards).filter((id) => known.has(id)).length;
    // 題庫很大，剛開始練時熟練度很低；不到 10% 時多顯示一位小數，才看得出在進步
    const m = mastery(ctx.bank, cards) * 100;
    const tiles = [
      [`${practiced}`, '練過的題目'],
      [`${week.reduce((a, d) => a + d.answered, 0)}`, '近 7 天作答'],
      [pct(accuracyOf(week)), '近 7 天正確率'],
      [`${m < 10 ? m.toFixed(1) : Math.round(m)}%`, '整體熟練度'],
    ];
    $('#stats-tiles').innerHTML = tiles.map(([v, k]) => `<div class="tile"><b>${v}</b><span>${k}</span></div>`).join('');

    weak = weakUnits(ctx.bank, cards, { subjects: settings.subjects, excludedUnits: settings.excludedUnits, limit: 5 });
    renderWeak();

    renderChart(dailySeries(daily, now, 14), accuracyOf(week), accuracyOf(prev));

    $('#stats-subjects').innerHTML = subjectStats(ctx.bank, cards, SUBJECTS.map((s) => s.id))
      .map((s) => {
        const subj = SUBJECT_BY_ID[s.subject];
        const m = Math.round(s.mastery * 100);
        return `<li style="--c:${subj.color}">
          <span class="tag">${subj.name}</span>
          <span class="subject-meta">練過 ${s.practiced}／${s.total} 題・正確率 ${pct(s.accuracy)}</span>
          <span class="unit-meter" aria-label="熟練度 ${m}%"><i style="width:${m}%"></i></span>
        </li>`;
      })
      .join('');
  }

  function renderWeak() {
    const list = $('#stats-weak');
    const train = $('#stats-train');
    list.innerHTML = '';
    train.hidden = !weak.length;
    if (!weak.length) {
      list.innerHTML = '<li class="weak-empty">作答紀錄還不夠。每個單元作答 4 次以上才會列入比較，先多練幾輪吧！</li>';
      return;
    }
    train.textContent = `練最弱的 ${Math.min(TRAIN_UNITS, weak.length)} 個單元`;
    for (const u of weak) {
      const subj = SUBJECT_BY_ID[u.subject];
      const rate = Math.round(u.rate * 100);
      const li = document.createElement('li');
      li.innerHTML = `<button type="button" class="weak-unit" style="--c:${subj.color}">
        <span class="tag">${subj.name}</span>
        <span class="weak-name"></span>
        <span class="weak-meta">失誤 ${rate}%・作答 ${u.seen} 次${u.weak ? `・待練 ${u.weak} 題` : ''}</span>
        <span class="weak-go" aria-hidden="true">練 ›</span>
        <span class="unit-meter" aria-hidden="true"><i style="width:${rate}%"></i></span>
      </button>`;
      li.querySelector('.weak-name').textContent = u.unit;
      li.querySelector('button').addEventListener('click', () => ctx.startRound('weak', { units: [u.key] }));
      list.append(li);
    }
  }

  function renderChart(series, acc, prevAcc) {
    const max = Math.max(1, ...series.map((d) => d.answered));
    $('#stats-chart').innerHTML = series
      .map((d, i) => {
        const [, m, day] = d.key.split('-').map(Number);
        // 手機上一格很窄，只標頭、中間與今天
        const label = i === series.length - 1 ? '今天' : i === 0 || i === 7 ? `${m}/${day}` : '';
        const tip = d.answered ? `${m}/${day}：${d.answered} 題・正確率 ${pct(d.right / d.answered)}` : `${m}/${day}：沒有作答`;
        // 最高的長條 96px；有作答的日子至少看得到一點
        const h = d.answered ? Math.max(3, Math.round((d.answered / max) * 96)) : 0;
        return `<div class="bar${i === series.length - 1 ? ' today' : ''}" title="${tip}">
          <span class="bar-n">${d.answered || ''}</span>
          <i class="${h ? '' : 'zero'}" style="height:${h}px"></i>
          <span class="bar-day">${label}</span>
        </div>`;
      })
      .join('');
    const total = series.reduce((a, d) => a + d.answered, 0);
    $('#stats-chart').setAttribute('aria-label', `近 14 天共作答 ${total} 題`);
    const diff = acc !== null && prevAcc !== null ? Math.round((acc - prevAcc) * 100) : null;
    $('#stats-trend').textContent =
      acc === null ? '這 7 天還沒有作答' : `近 7 天正確率 ${pct(acc)}${diff === null ? '' : `，比前 7 天${diff >= 0 ? '高' : '低'} ${Math.abs(diff)} 個百分點`}`;
  }

  $('#stats-back').addEventListener('click', () => ctx.goHome());
  $('#stats-train').addEventListener('click', () => {
    ctx.startRound('weak', { units: weak.slice(0, TRAIN_UNITS).map((u) => u.key) });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !screen.hidden) ctx.goHome();
  });
}
