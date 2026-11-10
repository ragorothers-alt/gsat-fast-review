// 第一次開啟的設定：這台裝置還沒有作答紀錄時，開機後跳出底部面板，選考哪些科、學測日期與每日目標，
// 按「開始練習」就存進設定、直接開始自由練習；「之後再說」（或 Esc）不改設定。兩種都記下看過了，之後不再顯示。
// 要不要顯示、有哪些選項見 ../welcome.js
import { SUBJECTS } from '../subjects.js';
import { TRACKS, WELCOME_GOALS, WELCOME_KEY, needsWelcome, orderSubjects, trackOf } from '../welcome.js';
import { closeSheet, openSheet } from './sheet.js';

export function initWelcome(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const sheet = $('#welcome-sheet');
  const dateInput = $('#welcome-date');
  const startBtn = $('#welcome-start');
  const settings = ctx.state.settings;
  // 面板上選到一半的：按「開始練習」才寫進設定
  let picked = new Set(settings.subjects);
  let goal = settings.goal;

  const button = (parent, cls, label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cls;
    btn.textContent = label;
    parent.append(btn);
    return btn;
  };

  const trackBtns = TRACKS.map((t) => {
    const btn = button($('#welcome-tracks'), 'seg-btn', t.name);
    btn.addEventListener('click', () => {
      picked = new Set(t.subjects);
      render();
    });
    return [t.id, btn];
  });

  const subjectBtns = SUBJECTS.map((s) => {
    const btn = button($('#welcome-subjects'), 'chip', '');
    btn.style.setProperty('--c', s.color);
    btn.innerHTML = `<span class="chip-name">${s.name}</span>`;
    btn.addEventListener('click', () => {
      if (!picked.delete(s.id)) picked.add(s.id);
      render();
    });
    return [s.id, btn];
  });

  const goalBtns = WELCOME_GOALS.map((n) => {
    const btn = button($('#welcome-goals'), 'seg-btn', `${n} 題`);
    btn.addEventListener('click', () => {
      goal = n;
      render();
    });
    return [n, btn];
  });

  function render() {
    const track = trackOf([...picked]);
    for (const [id, btn] of trackBtns) btn.setAttribute('aria-pressed', String(id === track));
    for (const [id, btn] of subjectBtns) btn.setAttribute('aria-pressed', String(picked.has(id)));
    for (const [n, btn] of goalBtns) btn.setAttribute('aria-pressed', String(n === goal));
    // 至少要選一科
    startBtn.disabled = !picked.size;
    $('#welcome-note').textContent = picked.size ? `已選 ${picked.size} 科` : '至少選一科才能開始';
  }

  function markSeen() {
    try {
      localStorage.setItem(WELCOME_KEY, String(Date.now()));
    } catch {
      // 存不了就算了：下次開啟還沒有作答紀錄的話會再問一次
    }
  }

  /** 之後再說、Esc：不改設定，只記下看過了 */
  function skip() {
    markSeen();
    closeSheet(sheet);
  }

  $('#welcome-skip').addEventListener('click', skip);
  sheet.addEventListener('sheet-close', skip);
  // 不像其他面板點背景就關：第一次開啟時不小心點到外面，這份設定就不會再出現了

  startBtn.addEventListener('click', () => {
    if (!picked.size) return;
    settings.subjects = orderSubjects([...picked]);
    // 日期欄被清空時保留原本的日期
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) settings.examDate = dateInput.value;
    settings.goal = goal;
    ctx.save();
    markSeen();
    closeSheet(sheet);
    ctx.refreshHome?.();
    // 選的科目有還在背景下載的（開機時只先載入原本設定的科目）就等它載完再開始
    const missing = settings.subjects.some((id) => !ctx.bank.some((q) => q.subject === id));
    if (missing && ctx.bankLoading()) ctx.afterBank(() => ctx.startRound('free'));
    else ctx.startRound('free');
  });

  ctx.welcome = {
    /** 開機完成、首頁出現後呼叫：這台裝置沒有作答紀錄又沒看過，就打開面板。回傳有沒有打開 */
    open() {
      let seen = true;
      try {
        seen = !!localStorage.getItem(WELCOME_KEY);
      } catch {
        // 讀不到 localStorage（被封鎖）：設定也存不住，不問
      }
      if (!needsWelcome(ctx.state, seen)) return false;
      picked = new Set(settings.subjects);
      goal = settings.goal;
      dateInput.value = settings.examDate;
      render();
      openSheet(sheet);
      $('#welcome-sheet .settings-scroll').scrollTop = 0;
      return true;
    },
  };
}
