// 結算畫面：分數、正確率、這輪要再看一眼的題目
import { MODES } from '../session.js';
import { questionPrompt } from '../prompt.js';
import { today } from '../stats.js';
import { copyQuestion } from './clipboard.js';
import { openKeypointsFrom } from './keypoints.js';
import { reviewItem, speakItem, tfLabel, toggleMark } from './review-item.js';
import { richHTML } from './rich.js';
import { sfx } from './feedback.js';

export function initResult(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const byId = new Map(ctx.bank.map((q) => [q.id, q]));
  let last = { mode: 'blitz', opts: {} };
  let misses = [];

  ctx.showResult = (s) => {
    last = { mode: s.mode, opts: s.opts };
    const answered = s.right + s.wrong;
    const isBlitz = s.mode === 'blitz';
    const record = isBlitz && s.score > ctx.state.best.blitz;
    if (record) {
      ctx.state.best.blitz = s.score;
      ctx.save();
    }

    $('#r-mode').textContent = MODES[s.mode].name;
    $('#r-big').textContent = isBlitz ? `${s.score} 分` : `${s.right} / ${s.log.length}`;
    $('#r-badge').hidden = !record;
    $('#r-acc').textContent = answered ? `${Math.round((s.right / answered) * 100)}%` : '—';
    $('#r-combo').textContent = s.maxCombo;
    $('#r-today').textContent = today(ctx.state, Date.now()).answered;
    $('#r-cheer').textContent = cheer(s, answered);

    misses = s.log.filter((e) => e.outcome !== 'right');
    $('#r-review-title').textContent = misses.length ? `再看一眼（${misses.length} 題，已加入錯題複習）` : '全對！這輪沒有錯題';
    const { flags, stars } = ctx.state;
    $('#r-list').innerHTML = misses
      .map((e, i) => reviewItem(byId.get(e.id), { index: i, flagged: !!flags[e.id], starred: !!stars[e.id], note: mine(byId.get(e.id), e) }))
      .join('');
    $('#r-related').hidden = !misses.length;

    // 這輪出現最多的科目，牠們的貓會趴在成績卡上
    const counts = new Map();
    for (const e of s.log) {
      const subject = byId.get(e.id).subject;
      counts.set(subject, (counts.get(subject) || 0) + 1);
    }
    ctx.world.setCast([...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id));
    ctx.show('result');
    sfx.finish();
    ctx.cloudSync?.();
    ctx.reminder?.sync();
    if (record || (answered && !misses.length)) ctx.world.celebrate();
  };

  $('#r-again').addEventListener('click', () => ctx.startRound(last.mode, last.opts));
  $('#r-related').addEventListener('click', () => ctx.startRound('related', { seeds: misses.map((e) => e.id) }));
  $('#r-home').addEventListener('click', () => {
    ctx.goHome();
    // iPhone 沒加入主畫面的話，練完一輪回到首頁時提醒一次
    ctx.install?.nudge();
  });

  // 錯題清單裡也能念英文、收藏、複製、回報題目
  $('#r-list').addEventListener('click', (e) => {
    if (openKeypointsFrom(ctx, e.target) || speakItem(e.target, misses.map((m) => byId.get(m.id)))) return;
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const entry = misses[Number(copy.dataset.copy)];
      copyQuestion(questionPrompt(byId.get(entry.id), entry), ctx.toast);
      return;
    }
    toggleMark(ctx, e.target);
  });
}

/** 這一題你選了什麼 */
function mine(q, entry) {
  if (entry.outcome === 'skip') return '<span class="r-mine skip">看了解答</span>';
  return `<span class="r-mine">你選：${q.type === 'tf' ? tfLabel(entry.chosen) : richHTML(q.choices[entry.chosen])}</span>`;
}

function cheer(s, answered) {
  if (!answered) return '先看解答也是一種複習，下一輪再來！';
  const acc = s.right / answered;
  if (acc === 1) return '完美！記憶已經上鎖。';
  if (acc >= 0.8) return '很穩！錯的那幾題明天會再出現。';
  if (acc >= 0.5) return '一半以上了，錯題是最划算的複習。';
  return '剛起步最難，多刷幾輪就會熟。';
}
