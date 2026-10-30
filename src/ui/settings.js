// 設定：每日目標、學測日期、外觀、音效、每日提醒、安裝、進度備份與同步、回報的題目、關於與診斷。底部彈出面板。
import { daysUntil } from '../analysis.js';
import { foldLegacy } from '../cloud.js';
import { GOALS, dayKey } from '../stats.js';
import { DEFAULT_EXAM_DATE } from '../storage.js';
import { SUBJECT_BY_ID } from '../subjects.js';
import { exportBackup, mergeState, parseBackup, setFlag } from '../sync.js';
import { FONT_SCALES, THEMES, applyAppearance } from './appearance.js';
import { copyText } from './clipboard.js';
import { setSoundEnabled } from './feedback.js';
import { richHTML } from './rich.js';

/**
 * @param {object} ctx
 * @param {() => void} onChange 設定或進度改變後（已存檔）呼叫，讓首頁重畫
 */
export function initSettings(ctx, onChange) {
  const $ = (sel) => document.querySelector(sel);
  const sheet = $('#settings-sheet');
  const settings = ctx.state.settings;
  const byId = new Map(ctx.bank.map((q) => [q.id, q]));
  const dateInput = $('#exam-date');
  const soundBtn = $('#sound-toggle');
  const fileInput = $('#import-file');
  const flagList = $('#flag-list');

  // 題庫裡已經沒有的題目不必再列在回報清單
  for (const id of Object.keys(ctx.state.flags)) if (!byId.has(id)) delete ctx.state.flags[id];

  function commit() {
    ctx.save();
    render();
    onChange();
  }

  // ── 每日目標 ───────────────────────────────────────
  const goalBtns = GOALS.map((n) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-btn';
    btn.textContent = `${n} 題`;
    btn.addEventListener('click', () => {
      settings.goal = n;
      commit();
    });
    $('#goal-options').append(btn);
    return btn;
  });

  // ── 學測日期 ───────────────────────────────────────
  dateInput.addEventListener('change', () => {
    // 清空日期欄時保留原本的日期
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) return render();
    settings.examDate = dateInput.value;
    commit();
  });
  $('#exam-reset').addEventListener('click', () => {
    settings.examDate = DEFAULT_EXAM_DATE;
    commit();
  });

  // ── 外觀 ───────────────────────────────────────────
  const segButtons = (container, options, key) =>
    options.map(([value, label]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'seg-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        settings[key] = value;
        applyAppearance(settings, ctx.world);
        commit();
      });
      $(container).append(btn);
      return [value, btn];
    });
  const themeBtns = segButtons('#theme-options', THEMES, 'theme');
  const fontBtns = segButtons('#font-options', FONT_SCALES, 'fontScale');

  // ── 音效 ───────────────────────────────────────────
  setSoundEnabled(settings.sound);
  soundBtn.addEventListener('click', () => {
    settings.sound = !settings.sound;
    setSoundEnabled(settings.sound);
    commit();
  });

  // ── 進度備份與同步 ─────────────────────────────────
  $('#export-progress').addEventListener('click', async () => {
    const now = Date.now();
    const name = `學測快問快答進度-${dayKey(now)}.json`;
    const file = new File([exportBackup(ctx.state, now)], name, { type: 'application/json' });
    const count = Object.keys(ctx.state.cards).length;
    // 手機、平板用分享面板（AirDrop、LINE…）；電腦直接下載
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: '學測快問快答進度' });
        ctx.toast(`已匯出 ${count} 題的作答紀錄`);
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ctx.toast(`已匯出 ${count} 題的作答紀錄`);
  });

  $('#import-progress').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = ''; // 同一個檔案可以再選一次
    if (!file) return;
    try {
      const incoming = parseBackup(await file.text());
      const { state, added, updated } = mergeState(ctx.state, incoming);
      Object.assign(ctx.state, state);
      // 開過線上同步時，每日作答量由同步紀錄重算：匯入的當成開始同步前的舊紀錄
      foldLegacy(ctx.state, incoming.daily, Date.now());
      commit();
      ctx.cloudSync?.();
      ctx.toast(added || updated ? `匯入完成：新增 ${added} 題、更新 ${updated} 題的紀錄` : '匯入完成：沒有比這台更新的紀錄');
    } catch (e) {
      ctx.toast(e instanceof Error && e.message.includes('進度備份') ? e.message : '讀不到這個檔案，請再試一次');
    }
  });

  // ── 回報的題目 ─────────────────────────────────────
  const flagged = () =>
    Object.entries(ctx.state.flags)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => byId.get(id))
      .filter(Boolean);

  function renderFlags() {
    const qs = flagged();
    $('#flag-count').textContent = qs.length ? `${qs.length} 題` : '';
    $('#copy-flags').hidden = !qs.length;
    $('#flag-report').hidden = true;
    flagList.innerHTML = '';
    if (!qs.length) {
      flagList.innerHTML = '<li class="flag-empty">目前沒有回報的題目</li>';
      return;
    }
    for (const q of qs) {
      const subj = SUBJECT_BY_ID[q.subject];
      const li = document.createElement('li');
      li.className = 'flag-item';
      li.style.setProperty('--c', subj.color);
      li.innerHTML = `<span class="tag">${subj.name}</span><span class="flag-text"></span><button type="button" class="link-btn">取消</button>`;
      li.querySelector('.flag-text').innerHTML = `<b>${q.id}</b> ${richHTML(q.q)}`;
      li.querySelector('button').addEventListener('click', () => {
        setFlag(ctx.state, q.id, false, Date.now());
        commit();
      });
      flagList.append(li);
    }
  }

  $('#copy-flags').addEventListener('click', async () => {
    const qs = flagged();
    const text = flagReport(qs);
    const report = $('#flag-report');
    if (await copyText(text)) {
      report.hidden = true;
      ctx.toast(`已複製 ${qs.length} 題，貼給題庫維護者就好`);
      return;
    }
    // 複製不了就把清單攤開、全選，讓玩家自己長按複製
    report.value = text;
    report.hidden = false;
    report.focus();
    report.select();
    ctx.toast('沒辦法自動複製，請長按下方文字手動複製');
  });

  // ── 面板 ───────────────────────────────────────────
  function render() {
    goalBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(GOALS[i] === settings.goal)));
    dateInput.value = settings.examDate;
    const left = daysUntil(settings.examDate, Date.now());
    $('#exam-left').textContent = left > 0 ? `還有 ${left} 天` : left === 0 ? '就是今天' : '已經考完了';
    $('#exam-reset').hidden = settings.examDate === DEFAULT_EXAM_DATE;
    soundBtn.setAttribute('aria-checked', String(settings.sound));
    for (const [value, btn] of themeBtns) btn.setAttribute('aria-pressed', String(settings.theme === value));
    for (const [value, btn] of fontBtns) btn.setAttribute('aria-pressed', String(settings.fontScale === value));
    ctx.renderCloud?.();
    ctx.renderReminder?.();
    ctx.renderInstall?.();
    ctx.renderAbout?.();
    renderFlags();
  }

  // 線上同步拉回別台的回報後重畫（面板正開著才需要）
  ctx.refreshSettings = () => {
    if (!sheet.hidden) render();
  };

  function close() {
    sheet.hidden = true;
  }

  $('#settings-close').addEventListener('click', close);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) close();
  });

  return {
    /** @param {string} [section] 打開後捲到哪個區塊（CSS 選擇器） */
    open(section) {
      render();
      sheet.hidden = false;
      if (section) $(section)?.scrollIntoView({ block: 'start' });
      else $('#settings-sheet .settings-scroll').scrollTop = 0;
    },
  };
}

/** 給題庫維護者的回報清單：附上目前的答案與解析，方便判斷哪裡錯 */
function flagReport(qs) {
  const lines = [`學測快問快答・回報題目（${qs.length} 題）`];
  qs.forEach((q, i) => {
    const subj = SUBJECT_BY_ID[q.subject];
    const answer = q.type === 'tf' ? (q.answer ? '對' : '錯') : q.choices[q.answer];
    lines.push('', `${i + 1}. ${q.id}｜${subj.name}・${q.topic}`, `題目：${q.q}`);
    if (q.type === 'mc') lines.push(`選項：${q.choices.join(' ／ ')}`);
    lines.push(`目前答案：${answer}`, `解析：${q.explain}`);
  });
  return lines.join('\n');
}
