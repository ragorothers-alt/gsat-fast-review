// 英文題的發音：用瀏覽器內建的語音合成（離線也能念，聲音依裝置而定）。
// 作答前在空格處停頓；作答後把正解填進空格，念出完整的句子。

const supported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
let voice = null;

/** 優先用裝置內建（不必連網）的美式英文聲音 */
function pickVoice() {
  const en = speechSynthesis.getVoices().filter((v) => /^en[-_]US/i.test(v.lang));
  voice = en.find((v) => v.localService) ?? en[0] ?? null;
}

if (supported) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

export const canSpeak = (q) => supported && q.subject === 'english';

/**
 * 要念的英文。filled：把正解填進唯一的空格（單選題、作答後）。
 * 對話題的「A:」「B:」不念；其他空格念成停頓。
 */
export function speechText(q, { filled = false } = {}) {
  let s = q.q;
  if (filled && q.type === 'mc' && (s.match(/_{2,}/g) ?? []).length === 1) s = s.replace(/_{2,}/, q.choices[q.answer]);
  return s
    .replace(/_{2,}/g, ' … ')
    .replace(/(^|\s)[AB]:\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function speak(text) {
  if (!supported) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.92;
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (supported) speechSynthesis.cancel();
}
