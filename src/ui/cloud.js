// 線上同步的畫面與時機：開 App、每輪結算後、回到前景、切到背景、恢復連線時自動同步；
// 設定面板裡可以開啟、加入、立即同步、停止、刪除雲端資料。
import { CloudError, checkCode, cloudOn, createCode, deleteCloud, makeRequest, normalizeCode, startCloud, stopCloud, syncCloud } from '../cloud.js';
import { copyText } from './clipboard.js';

/** 回到前景時，距離上次同步超過這麼久才再同步一次 */
const STALE_MS = 30_000;
/** 自動同步失敗後多久再試 */
const RETRY_MS = 60_000;

const offline = (e) => e instanceof CloudError && e.status === 0;
const missing = (e) => e instanceof CloudError && e.status === 404;

export function initCloud(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const request = makeRequest();
  const createBtn = $('#cloud-create');
  const joinForm = $('#cloud-join');
  const input = $('#cloud-input');
  /** @type {null | 'syncing' | 'offline' | 'failed'} */
  let status = null;
  let running = null;
  let pending = false;
  let retryTimer = 0;

  /** 同步一次；同步中又被叫到就排在這次之後再跑一次 */
  function sync(opts) {
    if (!cloudOn(ctx.state)) return Promise.resolve(0);
    if (running) {
      pending = true;
      return running;
    }
    running = run(opts).finally(() => {
      running = null;
      if (pending) {
        pending = false;
        auto();
      }
    });
    return running;
  }

  async function run({ keepalive = false } = {}) {
    status = 'syncing';
    render();
    try {
      const changed = await syncCloud(ctx.state, request, { keepalive });
      status = null;
      if (changed) {
        ctx.refreshHome?.();
        ctx.refreshSettings?.();
      }
      return changed;
    } catch (e) {
      status = offline(e) ? 'offline' : 'failed';
      // 雲端資料被另一台刪掉了：這台也停止同步
      if (missing(e)) {
        stopCloud(ctx.state);
        status = null;
      }
      throw e;
    } finally {
      ctx.save();
      render();
    }
  }

  /** 背景自動同步：失敗就過一陣子再試，只有雲端資料被刪除時才提示 */
  function auto(opts) {
    sync(opts).catch((e) => {
      if (missing(e)) ctx.toast('這組同步碼的雲端資料已被刪除，這台已停止同步');
      else if (!retryTimer) retryTimer = setTimeout(() => ((retryTimer = 0), auto()), RETRY_MS);
    });
  }

  ctx.cloudSync = auto;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) auto({ keepalive: true });
    else if (Date.now() - (ctx.state.cloud?.syncedAt ?? 0) > STALE_MS) auto();
  });
  window.addEventListener('online', () => auto());

  // ── 設定面板 ───────────────────────────────────────
  function render() {
    const on = cloudOn(ctx.state);
    $('#cloud-off').hidden = on;
    $('#cloud-on').hidden = !on;
    $('#cloud-badge').textContent = on ? '已開啟' : '';
    if (!on) return;
    $('#cloud-code').textContent = ctx.state.cloud.code;
    $('#cloud-status').textContent = statusText(status, ctx.state.cloud.syncedAt, Date.now());
  }
  ctx.renderCloud = render;

  async function busy(btn, task) {
    btn.disabled = true;
    try {
      await task();
    } finally {
      btn.disabled = false;
    }
  }

  createBtn.addEventListener('click', () =>
    busy(createBtn, async () => {
      let code;
      try {
        code = await createCode(request);
      } catch (e) {
        ctx.toast(offline(e) ? '沒有網路，連上後再試一次' : '暫時沒辦法建立同步碼，請稍後再試');
        return;
      }
      startCloud(ctx.state, code);
      ctx.save();
      render();
      ctx.toast('已開啟線上同步！在另一台輸入同步碼就能加入');
      auto();
    }),
  );

  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = normalizeCode(input.value);
    if (!code) {
      ctx.toast('同步碼是 16 個英文字母和數字，請再確認一次');
      return;
    }
    const btn = joinForm.querySelector('button');
    busy(btn, async () => {
      try {
        await checkCode(request, code);
        startCloud(ctx.state, code);
        const changed = await sync();
        input.value = '';
        ctx.toast(changed ? `已加入同步，合併了 ${changed} 題的紀錄` : '已加入同步');
      } catch (err) {
        if (missing(err)) ctx.toast('找不到這組同步碼，請再確認一次');
        else if (offline(err)) ctx.toast(cloudOn(ctx.state) ? '已加入，連上網路後會自動同步' : '沒有網路，連上後再試一次');
        else ctx.toast('同步失敗，稍後會再試');
      }
    });
  });

  $('#cloud-copy').addEventListener('click', async () => {
    ctx.toast((await copyText(ctx.state.cloud.code)) ? '已複製同步碼' : '沒辦法自動複製，請手動抄下同步碼');
  });

  const nowBtn = $('#cloud-now');
  nowBtn.addEventListener('click', () =>
    busy(nowBtn, async () => {
      try {
        const changed = await sync();
        ctx.toast(changed ? `同步完成，更新了 ${changed} 題的紀錄` : '同步完成，已經是最新的');
      } catch (e) {
        if (missing(e)) ctx.toast('這組同步碼的雲端資料已被刪除，這台已停止同步');
        else ctx.toast(offline(e) ? '沒有網路，連上後會自動同步' : '同步失敗，稍後會再試');
      }
    }),
  );

  $('#cloud-leave').addEventListener('click', () => {
    if (!confirm('這台裝置要停止同步嗎？\n這台的進度和雲端資料都會保留，之後輸入同一組同步碼就能再加入。')) return;
    stopCloud(ctx.state);
    ctx.save();
    render();
    ctx.toast('這台已停止同步');
  });

  const deleteBtn = $('#cloud-delete');
  deleteBtn.addEventListener('click', () => {
    if (!confirm('要刪除雲端上的同步資料嗎？\n每台裝置上的進度都會保留，但所有裝置都會停止同步。')) return;
    busy(deleteBtn, async () => {
      try {
        await deleteCloud(request, ctx.state.cloud.code);
      } catch (e) {
        if (!missing(e)) {
          ctx.toast(offline(e) ? '沒有網路，連上後再試一次' : '刪除失敗，請稍後再試');
          return;
        }
      }
      stopCloud(ctx.state);
      ctx.save();
      render();
      ctx.toast('已刪除雲端資料，這台已停止同步');
    });
  });
}

/** 「上次同步：3 分鐘前」 */
export function statusText(status, syncedAt, now) {
  if (status === 'syncing') return '同步中…';
  if (status === 'offline') return '目前沒有網路，連上後會自動同步';
  if (status === 'failed') return '同步失敗，稍後會再試';
  if (!syncedAt) return '還沒同步過';
  const min = Math.floor((now - syncedAt) / 60_000);
  if (min < 1) return '上次同步：剛剛';
  if (min < 60) return `上次同步：${min} 分鐘前`;
  const d = new Date(syncedAt);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return new Date(now).toDateString() === d.toDateString() ? `上次同步：今天 ${hm}` : `上次同步：${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
