// 音效（WebAudio 合成，不用音檔）與震動。預設靜音，避免在大眾運輸上突然出聲。
let ctx = null;
let enabled = false;

export function setSoundEnabled(on) {
  enabled = on;
}

function tone(freq, duration, { type = 'sine', gain = 0.07, delay = 0 } = {}) {
  if (!enabled) return;
  try {
    ctx ||= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration);
  } catch {
    // 不支援 WebAudio 就安靜
  }
}

function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // iOS 不支援震動
  }
}

export const sfx = {
  right(combo) {
    tone(620 + Math.min(combo, 12) * 45, 0.13, { type: 'triangle' });
    vibrate(12);
  },
  wrong() {
    tone(190, 0.22, { type: 'square', gain: 0.035 });
    vibrate([30, 40, 30]);
  },
  finish() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: 'triangle', delay: i * 0.09 }));
    vibrate(20);
  },
};
