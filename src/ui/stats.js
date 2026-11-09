// 學習分析：整體概況、考前規劃、複習預報、題庫存量、弱點單元、近 14 天走勢、各科熟練度。從首頁的今日進度卡進來。
import { LOW_STOCK, accuracyOf, bankStock, dailySeries, daysUntil, isLowStock, lowStock, subjectStats, vocabLevelStats, weakUnits } from '../analysis.js';
import { dueBuckets, estimateRates, keepUpGoal, keepsUp, reviewForecast, studyPlan } from '../forecast.js';
import { DAY, mastery } from '../srs.js';
import { GOALS, dayKey, shiftDay, today } from '../stats.js';
import { SUBJECTS, SUBJECT_BY_ID } from '../subjects.js';
import { isUnitOff } from '../units.js';
import { icon } from './icons.js';

const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const TRAIN_UNITS = 3;
/** 複習預報看幾天（含今天） */
const FORECAST_DAYS = 14;
/** 題庫存量上方最多列幾個新題快用完的單元，其餘展開各科看 */
const LOW_SHOWN = 6;

export function initStats(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const screen = $('#stats');
  const known = ctx.byId;
  let weak = [];

  /** @param {string} [section] 直接捲到這一區（例如首頁的「看存量」進來是 stock） */
  ctx.showStats = (section) => {
    render();
    // 弱點單元所屬科目的貓趴在最上面的卡片上；還沒有弱點時換成目前選的科目
    const cast = [...new Set(weak.map((u) => u.subject))];
    ctx.world.setCast(cast.length ? cast : ctx.state.settings.subjects.slice(0, 3));
    ctx.show('stats');
    $('#stats .stats-scroll').scrollTop = 0;
    if (section) $(`#stats-${section}`)?.scrollIntoView({ block: 'start' });
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

    const scope = forecastScope(now);
    renderPlan(now, week, scope);
    renderForecast(now, scope);
    renderStock();
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
          <span class="unit-meter" role="img" aria-label="熟練度 ${m}%"><i style="width:${m}%"></i></span>
        </li>`;
      })
      .join('');

    renderVocab();
  }

  /** 英文單字依詞彙表級數：練過題數、正確率、熟練度；「練這一級」出這一級還沒學會的題目 */
  function renderVocab() {
    const levels = vocabLevelStats(ctx.bank, ctx.state.cards);
    $('#stats-vocab').hidden = !levels.length;
    const color = SUBJECT_BY_ID.english.color;
    $('#vocab-levels').innerHTML = levels
      .map((r) => {
        const m = Math.round(r.mastery * 100);
        return `<li style="--c:${color}">
          <span class="tag">第 ${r.lv} 級</span>
          <span class="subject-meta">練過 ${r.practiced}／${r.total} 題・正確率 ${pct(r.accuracy)}</span>
          <span class="unit-meter" role="img" aria-label="熟練度 ${m}%"><i style="width:${m}%"></i></span>
          <button type="button" class="link-btn vocab-train" data-lv="${r.lv}" ${r.todo.length ? '' : 'disabled'} aria-label="練詞彙表第 ${r.lv} 級的單字題">練這一級</button>
        </li>`;
      })
      .join('');
    vocabTodo = new Map(levels.map((r) => [r.lv, r.todo]));
  }
  let vocabTodo = new Map();
  $('#vocab-levels').addEventListener('click', (e) => {
    const btn = e.target.closest('.vocab-train');
    if (!btn || btn.disabled) return;
    ctx.startRound('vocab', { ids: vocabTodo.get(Number(btn.dataset.lv)) ?? [] });
  });

  /**
   * 考前規劃與複習預報共用：選的範圍（被回報的不算）、範圍內練過的卡片依到期日分組、推估用的答對比例
   * @returns {{ total: number, fresh: number, buckets: Map<number, number[]>, rates: { recall: number, first: number } }}
   */
  function forecastScope(now) {
    const { cards, flags, settings, daily } = ctx.state;
    const selected = new Set(settings.subjects);
    const off = new Set(settings.excludedUnits);
    const pool = ctx.bank.filter((q) => selected.has(q.subject) && !isUnitOff(q, off) && !flags[q.id]);
    const seen = pool.map((q) => cards[q.id]).filter(Boolean);
    return {
      total: pool.length,
      fresh: pool.length - seen.length,
      buckets: dueBuckets(seen, now),
      rates: estimateRates(seen, accuracyOf(dailySeries(daily, now, 14))),
    };
  }

  /** 考前規劃：照目前步調考前能練到多少、全部練過一輪每天要做幾題（扣掉之後每天的複習量） */
  function renderPlan(now, week, { total, fresh, buckets, rates }) {
    const { settings } = ctx.state;
    const left = daysUntil(settings.examDate, now);
    $('#stats-plan').hidden = left <= 0;
    if (left <= 0) return;
    // 這 7 天幾乎沒練的話，改用每日目標推估
    const recent = week.reduce((a, d) => a + d.answered, 0) / 7;
    const byGoal = recent < 1;
    const p = studyPlan({ buckets, total, fresh, daysLeft: left, pace: byGoal ? settings.goal : recent, goals: GOALS, ...rates });
    const n = (x) => x.toLocaleString('zh-TW');
    const goalBtn = $('#plan-goal');
    goalBtn.hidden = true;

    if (!total) {
      $('#plan-text').textContent = '先在首頁選要練的科目。';
    } else if (!p.remaining) {
      $('#plan-text').textContent = `距學測 ${left} 天。選的範圍 ${n(total)} 題已經全部練過了！接下來靠錯題複習和弱點加強，把還不熟的練到熟。`;
    } else {
      const pace = byGoal ? `照每日目標 ${settings.goal} 題` : `照近 7 天每天約 ${Math.round(recent)} 題`;
      $('#plan-text').textContent =
        `距學測 ${left} 天，選的範圍有 ${n(total)} 題，已練過 ${n(total - fresh)} 題。${pace}的步調，扣掉該複習的，考前大約能再練到 ${n(p.projected)} 題新題。` +
        (p.needDaily === null
          ? '選的範圍考前做不完一輪，先在首頁的「單元」挑重點，或用弱點加強集中火力。'
          : `想在考前全部練過一輪，每天要做約 ${n(p.needDaily)} 題（其中複習約 ${n(p.needReview)} 題）。` +
            (p.suggest === null ? '題目太多的話，先在首頁的「單元」挑重點，或用弱點加強集中火力。' : ''));
      if (p.suggest !== null && p.suggest > settings.goal) {
        goalBtn.hidden = false;
        goalBtn.textContent = `把每日目標改成 ${p.suggest} 題`;
        goalBtn.dataset.goal = String(p.suggest);
      }
    }
    const done = Math.round(p.coverage * 100);
    const proj = Math.round(p.projectedCoverage * 100);
    $('#plan-done').style.width = `${p.coverage * 100}%`;
    $('#plan-proj').style.width = `${(p.projectedCoverage - p.coverage) * 100}%`;
    $('#plan-legend').textContent = p.remaining ? `已練過 ${done}%・照這個步調考前約 ${proj}%` : '';
  }

  /**
   * 複習預報：照每日目標，未來 14 天每天有幾題到期要複習、還能做幾題新題。
   * 出題時到期的複習先出、每 2 題複習配 1 題新題；到期的比做得完的多就會越積越多：算出跟得上的每日目標，一鍵調整
   */
  function renderForecast(now, { total, fresh, buckets, rates }) {
    const goal = ctx.state.settings.goal;
    const opts = { days: FORECAST_DAYS, fresh, today: today(ctx.state, now).answered, ...rates };
    const rows = reviewForecast(buckets, { ...opts, goal });
    const r = (x) => Math.round(x);
    const key0 = dayKey(now);
    const label = (i) => {
      const [, m, d] = shiftDay(key0, i).split('-').map(Number);
      return `${m}/${d}`;
    };
    const ahead = rows.slice(1, 8);
    const avgDue = r(ahead.reduce((a, x) => a + x.due, 0) / ahead.length);
    const avgFresh = r(ahead.reduce((a, x) => a + x.fresh, 0) / ahead.length);
    const piling = !keepsUp(rows);
    const keepUp = piling ? keepUpGoal(buckets, { ...opts, goals: GOALS }) : null;
    const goalBtn = $('#forecast-goal');
    goalBtn.hidden = !keepUp;
    if (keepUp) {
      goalBtn.textContent = `把每日目標改成 ${keepUp} 題`;
      goalBtn.dataset.goal = String(keepUp);
    }

    $('#forecast-text').textContent = !total
      ? '先在首頁選要練的科目。'
      : `已經練過的題目裡，今天到期 ${r(rows[0].due)} 題，明天約 ${r(rows[1].due)} 題，接下來 7 天平均每天約 ${avgDue} 題要複習（之後新做的題目答錯了也會加進來）。` +
        (piling
          ? `出題時到期的複習先出（每 2 題複習配 1 題新題），照每日目標 ${goal} 題還是做不完，會越積越多。` +
            (keepUp ? `每日目標調到 ${keepUp} 題就跟得上。` : '先用「錯題複習」把到期的錯題做完，或把練的單元收少一點。')
          : fresh
            ? `照每日目標 ${goal} 題，複習做得完，每天還能做約 ${avgFresh} 題新題。`
            : '選的範圍都練過了，接下來每天都是複習。');

    const max = Math.max(1, ...rows.map((x) => x.due));
    const chart = $('#forecast-chart');
    chart.innerHTML = rows
      .map((x, i) => {
        const n = r(x.due);
        const h = n ? Math.max(2, Math.round((x.due / max) * 96)) : 0;
        const day = i === 0 ? '今天' : i === 1 ? '明天' : i === 7 || i === FORECAST_DAYS - 1 ? label(i) : '';
        const left = r(x.carry);
        const tip = `${label(i)}：到期約 ${n} 題${left ? `，照每日目標會剩 ${left} 題留到隔天` : ''}，新題約 ${r(x.fresh)} 題`;
        return `<div class="bar${left ? ' over' : ''}" title="${tip}">
          <span class="bar-n">${n || ''}</span>
          <i class="${h ? '' : 'zero'}" style="height:${h}px"></i>
          <span class="bar-day">${day}</span>
        </div>`;
      })
      .join('');
    chart.setAttribute('aria-label', `未來 14 天每天到期要複習的題數：明天約 ${r(rows[1].due)} 題，平均每天約 ${avgDue} 題`);
  }

  $('#forecast-goal').addEventListener('click', (e) => {
    ctx.state.settings.goal = Number(e.currentTarget.dataset.goal);
    ctx.save();
    render();
    ctx.toast(`每日目標改成 ${ctx.state.settings.goal} 題`);
  });

  /** 題庫存量：選的範圍還有幾題沒做過；新題快用完的單元列在上面，各科可以展開看每個單元 */
  function renderStock() {
    const { cards, flags, settings } = ctx.state;
    const stock = bankStock(ctx.bank, cards, { subjects: settings.subjects, excludedUnits: settings.excludedUnits, flags });
    const low = lowStock(stock);
    const n = (x) => x.toLocaleString('zh-TW');
    const share = (u) => (u.total ? (u.fresh / u.total) * 100 : 0);

    if (!stock.subjects.length) {
      $('#stock-text').textContent = '先在首頁選要練的科目。';
    } else {
      $('#stock-text').textContent =
        `選的範圍還有 ${n(stock.fresh)} 題沒做過（共 ${n(stock.total)} 題）。` +
        (low.length
          ? `有 ${low.length} 個單元的新題剩不到 ${LOW_STOCK} 題，做完後這些單元只會出複習題：`
          : `每個單元都還有 ${LOW_STOCK} 題以上沒做過，新題夠用。`);
    }

    $('#stock-low').innerHTML =
      low
        .slice(0, LOW_SHOWN)
        .map((u) => {
          const subj = SUBJECT_BY_ID[u.subject];
          return `<li style="--c:${subj.color}"><span class="tag">${subj.name}</span><span class="stock-name">${u.unit}</span><b>${u.fresh ? `剩 ${u.fresh} 題` : '全做過'}</b></li>`;
        })
        .join('') + (low.length > LOW_SHOWN ? `<li class="stock-more">還有 ${low.length - LOW_SHOWN} 個單元，展開下面各科可以看到</li>` : '');

    // 展開狀態要留著：作答回來重畫時，原本打開的科目維持打開
    const open = new Set([...document.querySelectorAll('#stock-subjects details[open]')].map((d) => d.dataset.subject));
    $('#stock-subjects').innerHTML = stock.subjects
      .map((s) => {
        const subj = SUBJECT_BY_ID[s.subject];
        const lowN = s.units.filter(isLowStock).length;
        const units = s.units
          .map(
            (u) => `<li class="stock-unit${isLowStock(u) ? ' low' : ''}">
              <span class="stock-name">${u.unit}</span>
              <span class="stock-n">剩 ${u.fresh}／${u.total}</span>
              <span class="unit-meter" aria-hidden="true"><i style="width:${share(u)}%"></i></span>
            </li>`,
          )
          .join('');
        return `<li style="--c:${subj.color}"><details data-subject="${s.subject}"${open.has(s.subject) ? ' open' : ''}>
          <summary>
            <span class="tag">${subj.name}</span>
            <span class="subject-meta">還沒做過 ${n(s.fresh)}／${n(s.total)} 題${lowN ? `<em>${lowN} 個單元的新題快用完</em>` : ''}</span>
            <span class="unit-meter" aria-hidden="true"><i style="width:${share(s)}%"></i></span>
          </summary>
          <ul class="stock-units">${units}</ul>
        </details></li>`;
      })
      .join('');
  }

  $('#plan-goal').addEventListener('click', (e) => {
    ctx.state.settings.goal = Number(e.currentTarget.dataset.goal);
    ctx.save();
    render();
    ctx.toast(`每日目標改成 ${ctx.state.settings.goal} 題`);
  });

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
      li.className = 'unit-row';
      li.innerHTML = `<button type="button" class="weak-unit" style="--c:${subj.color}">
        <span class="tag">${subj.name}</span>
        <span class="weak-name"></span>
        <span class="weak-meta">失誤 ${rate}%${u.share ? `・學測占${subj.name} ${u.share}%` : ''}・作答 ${u.seen} 次${u.weak ? `・待練 ${u.weak} 題` : ''}</span>
        <span class="weak-go" aria-hidden="true">練 ›</span>
        <span class="unit-meter" aria-hidden="true"><i style="width:${rate}%"></i></span>
      </button><button type="button" class="kp-btn" aria-label="${u.unit}：考前重點">${icon('card')}重點</button>`;
      li.querySelector('.weak-name').textContent = u.unit;
      li.querySelector('.weak-unit').addEventListener('click', () => ctx.startRound('weak', { units: [u.key] }));
      li.querySelector('.kp-btn').addEventListener('click', () => ctx.openKeypoints(u.subject, u.unit));
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
