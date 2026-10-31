// 單元闖關的選關面板：一科一個分頁，列出每個單元過關了沒；點目前這關或已過關的單元就開始闖
import { SUBJECTS, SUBJECT_BY_ID } from '../subjects.js';
import { PATH_SIZE, currentUnit, pathProgress, pathUnits, settleRuns, unitStatus } from '../path.js';
import { UNITS } from '../units.js';
import { icon } from './icons.js';

export function initPathSheet(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const sheet = $('#path-sheet');
  const listEl = $('#path-list');
  const goBtn = $('#path-go');
  const settings = ctx.state.settings;
  let current = SUBJECTS[0].id;
  let next = null;

  const tabs = SUBJECTS.map((s) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sheet-tab';
    btn.setAttribute('role', 'tab');
    btn.style.setProperty('--c', s.color);
    btn.textContent = s.name;
    btn.addEventListener('click', () => {
      current = s.id;
      render();
    });
    $('#path-tabs').append(btn);
    return btn;
  });

  const MARK = { done: '✓', current: icon('paw'), locked: '', off: '' };

  const started = (prog) => !!prog && (prog.cleared.length > 0 || Object.keys(prog.runs).length > 0);

  function render() {
    tabs.forEach((t, i) => {
      const id = SUBJECTS[i].id;
      t.setAttribute('aria-selected', String(id === current));
      // 有闖過的科目標成實心
      t.classList.toggle('on', started(ctx.state.path?.[id]));
    });
    const units = pathUnits(current, settings.excludedUnits);
    const prog = pathProgress(ctx.state, current);
    settleRuns(prog);
    next = currentUnit(units, prog);
    listEl.style.setProperty('--c', SUBJECT_BY_ID[current].color);
    listEl.innerHTML = '';
    for (const unit of UNITS[current]) {
      const status = units.includes(unit) ? unitStatus(units, prog, unit) : 'off';
      const run = prog.runs[unit];
      const meta = {
        done: run ? `重闖中 ${run.index} / ${run.ids.length}` : '已過關・可以重闖',
        current: run ? `進行中 ${run.index} / ${run.ids.length}` : `現在這關・先出 ${PATH_SIZE} 題`,
        locked: '先過前面的關',
        off: '已在「選單元」關掉',
      }[status];
      const open = status === 'done' || status === 'current';
      const li = document.createElement('li');
      li.className = 'unit-row';
      // 還不能闖的關仍可以點：跳出提示說明原因
      li.innerHTML = `<button type="button" class="unit path-unit" data-status="${status}"${open ? '' : ' aria-disabled="true"'}>
        <span class="unit-check" aria-hidden="true">${MARK[status]}</span>
        <span class="unit-name"></span>
        <span class="unit-meta">${meta}</span>
      </button><button type="button" class="kp-btn" aria-label="${unit}：考前重點">${icon('card')}重點</button>`;
      li.querySelector('.unit-name').textContent = unit;
      li.querySelector('.path-unit').addEventListener('click', () => {
        if (open) start(unit);
        else if (status === 'locked') ctx.toast(`先過「${next}」才能挑戰這一關`);
        else ctx.toast('這個單元在首頁的「選單元」裡關掉了，打開後才會出現在闖關裡');
      });
      // 闖關前先看一下這單元的重點
      li.querySelector('.kp-btn').addEventListener('click', () => ctx.openKeypoints(current, unit));
      listEl.append(li);
    }
    goBtn.disabled = !next;
    goBtn.textContent = next ? `${prog.runs[next] ? '繼續' : '開始'}：${next}` : '這科全部過關了';
    $('#path-reset').disabled = !started(prog);
  }

  function start(unit) {
    close();
    ctx.startRound('path', { subject: current, unit });
  }

  goBtn.addEventListener('click', () => next && start(next));
  $('#path-reset').addEventListener('click', () => {
    const name = SUBJECT_BY_ID[current].name;
    if (!confirm(`要讓「${name}」從第一關重新闖嗎？\n只會清掉過關紀錄，作答紀錄與錯題本都會保留。`)) return;
    ctx.state.path[current] = { cleared: [], runs: {} };
    ctx.save();
    render();
    ctx.refreshHome?.();
  });

  function close() {
    sheet.hidden = true;
  }

  $('#path-close').addEventListener('click', close);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) close();
  });

  /** @param {string} [subject] 預設開最近闖的科目，沒有就開第一個有選的科目 */
  ctx.openPath = (subject) => {
    current = subject || ctx.state.pathLast || settings.subjects[0] || SUBJECTS[0].id;
    render();
    sheet.hidden = false;
    tabs[SUBJECTS.findIndex((s) => s.id === current)].scrollIntoView({ block: 'nearest', inline: 'center' });
  };
}
