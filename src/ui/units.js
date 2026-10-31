// 單元選擇：底部彈出面板，一科一個分頁，打勾的單元才會出題；每個單元旁邊可以打開考前重點卡。
import { SUBJECTS, SUBJECT_BY_ID } from '../subjects.js';
import { mastery } from '../srs.js';
import { icon } from './icons.js';
import { UNITS, unitKey } from '../units.js';

/** 分頁上方的提醒：數學 A、B 的範圍不同 */
const NOTES = {
  math: '只考數學 A 可以關掉「數B 專屬主題」；只考數學 B 可以關掉「空間向量與平面直線」。',
};

/**
 * @param {object} ctx
 * @param {() => void} onChange 選擇改變後（已存檔）呼叫，讓首頁重畫
 */
export function initUnitSheet(ctx, onChange) {
  const $ = (sel) => document.querySelector(sel);
  const sheet = $('#units-sheet');
  const tabsEl = $('#units-tabs');
  const listEl = $('#units-list');
  const allBtn = $('#units-all');
  const settings = ctx.state.settings;
  let current = SUBJECTS[0].id;

  // 單元改名或刪掉後，舊存檔裡的鍵就沒用了
  const known = new Set(SUBJECTS.flatMap((s) => (UNITS[s.id] || []).map((u) => unitKey(s.id, u))));
  settings.excludedUnits = (settings.excludedUnits || []).filter((k) => known.has(k));

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
    tabsEl.append(btn);
    return btn;
  });

  const isOn = (subject, unit) => settings.subjects.includes(subject) && !settings.excludedUnits.includes(unitKey(subject, unit));

  function setExcluded(subject, units) {
    const prefix = `${subject}/`;
    settings.excludedUnits = settings.excludedUnits.filter((k) => !k.startsWith(prefix)).concat(units.map((u) => unitKey(subject, u)));
  }

  function setSubject(subject, on) {
    const set = new Set(settings.subjects);
    on ? set.add(subject) : set.delete(subject);
    settings.subjects = SUBJECTS.map((s) => s.id).filter((id) => set.has(id));
  }

  function toggleUnit(unit) {
    const units = UNITS[current];
    if (!settings.subjects.includes(current)) {
      // 這科原本沒選：只練剛點的這個單元
      setSubject(current, true);
      setExcluded(current, units.filter((u) => u !== unit));
    } else if (isOn(current, unit)) {
      const off = units.filter((u) => u === unit || !isOn(current, u));
      // 全部取消 = 不練這一科，下次再選這科時恢復全部單元
      if (off.length === units.length) {
        setSubject(current, false);
        setExcluded(current, []);
      } else setExcluded(current, off);
    } else {
      setExcluded(current, units.filter((u) => u !== unit && !isOn(current, u)));
    }
    commit();
  }

  function commit() {
    ctx.save();
    render();
    onChange();
  }

  allBtn.addEventListener('click', () => {
    const allOn = UNITS[current].every((u) => isOn(current, u));
    setSubject(current, !allOn);
    setExcluded(current, []);
    commit();
  });

  function render() {
    tabs.forEach((t, i) => {
      const id = SUBJECTS[i].id;
      t.setAttribute('aria-selected', String(id === current));
      t.classList.toggle('on', settings.subjects.includes(id));
    });
    const subj = SUBJECT_BY_ID[current];
    const note = $('#units-note');
    note.hidden = !NOTES[current];
    note.textContent = NOTES[current] ?? '';
    listEl.style.setProperty('--c', subj.color);
    listEl.innerHTML = '';
    for (const unit of UNITS[current]) {
      const qs = ctx.bank.filter((q) => q.subject === current && q.topic === unit);
      const m = Math.round(mastery(qs, ctx.state.cards) * 100);
      const on = isOn(current, unit);
      const li = document.createElement('li');
      li.className = 'unit-row';
      li.innerHTML = `<button type="button" class="unit" aria-pressed="${on}">
        <span class="unit-check" aria-hidden="true">✓</span>
        <span class="unit-name"></span>
        <span class="unit-meta">${qs.length} 題・熟練 ${m}%</span>
        <span class="unit-meter" aria-hidden="true"><i style="width:${m}%"></i></span>
      </button><button type="button" class="kp-btn" aria-label="${unit}：考前重點">${icon('card')}重點</button>`;
      li.querySelector('.unit-name').textContent = unit;
      li.querySelector('.unit').addEventListener('click', () => toggleUnit(unit));
      li.querySelector('.kp-btn').addEventListener('click', () => ctx.openKeypoints(current, unit));
      listEl.append(li);
    }
    allBtn.textContent = UNITS[current].every((u) => isOn(current, u)) ? '這科全不選' : '這科全選';
  }

  function close() {
    sheet.hidden = true;
  }

  $('#units-close').addEventListener('click', close);
  $('#units-done').addEventListener('click', close);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) close();
  });

  return {
    /** @param {string} [subject] 預設開第一個有選的科目 */
    open(subject) {
      current = subject || settings.subjects[0] || SUBJECTS[0].id;
      render();
      sheet.hidden = false;
      tabs[SUBJECTS.findIndex((s) => s.id === current)].scrollIntoView({ block: 'nearest', inline: 'center' });
    },
  };
}
