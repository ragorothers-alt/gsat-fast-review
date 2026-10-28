// 複製文字到剪貼簿；回傳是否成功
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 舊瀏覽器或沒有剪貼簿權限時，改用隱藏的文字框複製
    const ta = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** 複製題目給 AI 家教；複製不了時改開分享選單（手機上可以直接分享到 ChatGPT App） */
export async function copyQuestion(text, toast) {
  if (await copyText(text)) return toast('已複製題目，貼到 ChatGPT 問問看');
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  toast('這個瀏覽器沒辦法自動複製');
}
