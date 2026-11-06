#!/usr/bin/env node
// 題庫的猜題線索檢查：不懂內容、只看選項的樣子就能猜中答案的統計痕跡。
// 題目大多是批量產生的，這些痕跡每次出新題都可能回來，所以每科算一次比例，超過門檻就警告。
//
//   node scripts/lint-cues.mjs             各科的指標（超過門檻的標 ⚠）
//   node scripts/lint-cues.mjs --strict    有科目超過門檻時 exit code 1（CI 用）
//   node scripts/lint-cues.mjs --ids       輸出每一題觸發了哪些線索（JSON），給改寫用
//   後面接檔案路徑時只檢查那些檔（例如改寫中的一批題目）
//
// 指標：
//   長度  有一個選項明顯最短或最長（和次短／次長差 3 字以上）時，選它猜中的比例。亂選是 25%；
//         太高是「選最長的」就猜得中，太低是「刪掉最長的」就能提高命中率，兩邊都設門檻
//   數值  四個選項都是數字的單選題，正解落在中間兩個值的比例。亂放是 50%
//   絕對  刪去法：刪掉有「只要…就」「一定」「完全」這類絕對詞的選項，從剩下的隨便選一個的命中率。亂選是 25%
//   語氣  英文是非題：敘述有 always／never／only 這類詞就猜「錯」、沒有就猜「對」的命中率。亂猜是 50%
//   多選絕對  多選題裡有絕對詞的選項是正解的比例。正解約占一半選項；太低就能「看到絕對詞就不選」
//   多選長度  多選題裡明顯最長的選項是正解的比例；太高「最長的一定選」、太低「最長的一定不選」
//   解析  數值單選題的解析沒寫出正解數值的題數（只列出來，不設門檻）
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { splitMath } from '../src/rich-text.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUESTION_DIR = join(ROOT, 'src', 'data', 'questions');

/** 門檻：超過就警告（--strict 時失敗） */
export const LIMITS = { length: 0.35, numeric: 0.62, absolute: 0.28, tone: 0.56, msAbsolute: 0.75, msLength: 0.75 };
/** 下限：太低也是線索。例如長度突出的選項從來不是正解，學生就能把它刪掉 */
export const FLOORS = { length: 0.08, msAbsolute: 0.25, msLength: 0.25 };
/** 長度差幾字以上才算「明顯」 */
const GAP = 3;
/** 列入比例前至少要有幾題，題數太少的比例不準 */
const MIN_N = 30;

export const ABSOLUTE = /只要|一定|必定|必然|必須|完全|任何|所有|全部|絕對|就能|就可|就會|唯一|永遠|從不|一律|總是|皆|都/;
const TONE = /\b(always|never|only|all|every|none|must|cannot|completely|entirely|any)\b/i;

/** 顯示長度：公式字元大約三個算一字（和 src/ui/rich.js 的 visibleLength 相同） */
export function visibleLength(text) {
  return splitMath(String(text)).segments.reduce((n, s) => n + (s.math ? Math.ceil(s.text.length / 3) : s.text.length), 0);
}

/** 長度明顯離群的選項：先看最短、再看最長；沒有就回傳 -1 */
export function lengthOutlier(choices) {
  const len = choices.map(visibleLength);
  const sorted = [...len].sort((a, b) => a - b);
  if (sorted[1] - sorted[0] >= GAP) return len.indexOf(sorted[0]);
  if (sorted[3] - sorted[2] >= GAP) return len.indexOf(sorted[3]);
  return -1;
}

/** 選項的數值；不是單純的數字（可帶共同的單位）回傳 null */
export function numericValue(choice) {
  const s = String(choice)
    .replace(/\$/g, '')
    .replace(/\\(,|;|!| )/g, '')
    .replace(/\\(d?frac)\{(-?[\d.]+)\}\{([\d.]+)\}/g, '($2/$3)')
    .replace(/\\times\s*10\^\{?(-?\d+)\}?/g, 'e$1')
    .replace(/\\%|%/g, '')
    .replace(/[\s{}]/g, '')
    .replace(/^([-−]?)/, (m) => (m ? '-' : ''));
  const m = s.match(/^(-?)\(?(-?[\d.]+)(?:\/([\d.]+))?\)?(e-?\d+)?(.*)$/);
  if (!m || m[5].length > 6) return null;
  let v = Number(m[2] + (m[4] ?? ''));
  if (m[3]) v /= Number(m[3]);
  if (m[1]) v = -v;
  return Number.isFinite(v) ? { v, unit: m[5] } : null;
}

/** 四個選項都是同單位的相異數字時，正解在數值大小上的名次（0 = 最小）；否則 null */
export function numericRank(q) {
  if (q.type !== 'mc') return null;
  const vals = q.choices.map(numericValue);
  if (vals.some((x) => !x) || new Set(vals.map((x) => x.unit)).size > 1) return null;
  const nums = vals.map((x) => x.v);
  if (new Set(nums).size < 4) return null;
  return [...nums].sort((a, b) => a - b).indexOf(nums[q.answer]);
}

/** 正解沒有絕對詞，三個誘答裡至少兩個有 */
export function absoluteGiveaway(q) {
  if (q.type !== 'mc') return false;
  const has = q.choices.map((c) => ABSOLUTE.test(c));
  return !has[q.answer] && has.filter((h, i) => h && i !== q.answer).length >= 2;
}

const DIGITS = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 一段文字裡出現的所有數值（分數、小數、科學記號、單一中文數字都算） */
function numbersIn(text) {
  const s = String(text)
    .replace(/\\(d?frac)\{(-?[\d.]+)\}\{([\d.]+)\}/g, '$2/$3')
    .replace(/\\times\s*10\^\{?(-?\d+)\}?/g, 'e$1')
    .replace(/[零一二兩三四五六七八九十](?=[個種次倍人株隻條對組])/g, (c) => String(DIGITS[c]))
    .replace(/[$\s{},]|\\[,;! ]/g, '')
    .replace(/−/g, '-');
  return [...s.matchAll(/-?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?(?:e-?\d+)?/g)].map(([t]) => {
    const [a, b] = t.split('/');
    return b ? Number(a) / Number(b) : Number(a);
  });
}

/** 刪去法的期望命中率：有些選項有絕對詞、有些沒有時，從沒有的裡面隨便選；全都有或全都沒有就是亂猜 */
export function eliminationHit(q) {
  const keep = q.choices.map((c, i) => (ABSOLUTE.test(c) ? -1 : i)).filter((i) => i >= 0);
  if (keep.length === 0 || keep.length === q.choices.length) return 1 / q.choices.length;
  return keep.includes(q.answer) ? 1 / keep.length : 0;
}

/** 數值題的解析有沒有寫出正解的數值 */
function explainsAnswer(q) {
  const ans = numericValue(q.choices[q.answer])?.v;
  if (ans === undefined) return true;
  return numbersIn(q.explain).some((v) => Math.abs(v - ans) <= 1e-9 * Math.max(1, Math.abs(ans)));
}

/** 多選題：有兩個以上的選項有絕對詞，而且全都不是正解（看到絕對詞就不選，這題就全對） */
export function msAbsoluteGiveaway(q) {
  if (q.type !== 'ms') return false;
  const abs = q.choices.map((c, i) => (ABSOLUTE.test(c) ? i : -1)).filter((i) => i >= 0);
  return abs.length >= 2 && abs.every((i) => !q.answer.includes(i));
}

/** 一題觸發了哪些線索 */
export function cuesOf(q) {
  const cues = [];
  if (q.type === 'ms') {
    if (msAbsoluteGiveaway(q)) cues.push('ms-absolute');
  } else if (q.type === 'mc') {
    if (lengthOutlier(q.choices) === q.answer) cues.push('length');
    const rank = numericRank(q);
    if (rank === 1 || rank === 2) cues.push('numeric-middle');
    if (rank !== null && !explainsAnswer(q)) cues.push('explain');
    if (absoluteGiveaway(q)) cues.push('absolute');
  } else if (q.subject === 'english' && TONE.test(q.q) && q.answer === false) {
    // 有 always／never 這類詞而且是錯的：語氣洩漏答案
    cues.push('tone');
  }
  return cues;
}

/** 各科的指標 */
export function measure(bank) {
  const by = {};
  for (const q of bank) {
    const m = (by[q.subject] ||= { mc: 0, lenN: 0, lenHit: 0, numN: 0, numMid: 0, absHit: 0, tfN: 0, toneHit: 0, msAbsN: 0, msAbsHit: 0, msLenN: 0, msLenHit: 0, explain: [] });
    if (q.type === 'ms') {
      q.choices.forEach((c, i) => {
        if (!ABSOLUTE.test(c)) return;
        m.msAbsN++;
        if (q.answer.includes(i)) m.msAbsHit++;
      });
      // 最長的選項比第二長的多 GAP 字以上才算明顯
      const len = q.choices.map(visibleLength);
      const sorted = [...len].sort((a, b) => b - a);
      if (sorted[0] - sorted[1] >= GAP) {
        m.msLenN++;
        if (q.answer.includes(len.indexOf(sorted[0]))) m.msLenHit++;
      }
    } else if (q.type === 'mc') {
      m.mc++;
      const out = lengthOutlier(q.choices);
      if (out >= 0) {
        m.lenN++;
        if (out === q.answer) m.lenHit++;
      }
      const rank = numericRank(q);
      if (rank !== null) {
        m.numN++;
        if (rank === 1 || rank === 2) m.numMid++;
        if (!explainsAnswer(q)) m.explain.push(q.id);
      }
      m.absHit += eliminationHit(q);
    } else if (q.subject === 'english') {
      m.tfN++;
      // 有語氣詞猜錯、沒有猜對
      if (TONE.test(q.q) !== q.answer) m.toneHit++;
    }
  }
  const out = {};
  for (const [s, m] of Object.entries(by)) {
    out[s] = {
      length: m.lenN >= MIN_N ? m.lenHit / m.lenN : null,
      numeric: m.numN >= MIN_N ? m.numMid / m.numN : null,
      absolute: m.mc >= MIN_N ? m.absHit / m.mc : null,
      tone: m.tfN >= MIN_N ? m.toneHit / m.tfN : null,
      msAbsolute: m.msAbsN >= MIN_N ? m.msAbsHit / m.msAbsN : null,
      msLength: m.msLenN >= MIN_N ? m.msLenHit / m.msLenN : null,
      counts: { mc: m.mc, length: m.lenN, numeric: m.numN, tf: m.tfN, msAbsolute: m.msAbsN, msLength: m.msLenN },
      explain: m.explain,
    };
  }
  return out;
}

/** 讀題庫；指定檔案時只讀那些檔（例如改寫中的一批題目） */
function loadBank(files) {
  const list = files.length ? files : readdirSync(QUESTION_DIR).filter((f) => f.endsWith('.json')).map((f) => join(QUESTION_DIR, f));
  return list.flatMap((f) => JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')).map((q) => ({ ...q, subject: q.subject ?? basename(f, '.json') })));
}

function main() {
  const args = process.argv.slice(2);
  const bank = loadBank(args.filter((a) => !a.startsWith('--')));
  if (args.includes('--ids')) {
    const out = {};
    for (const q of bank) {
      const cues = cuesOf(q);
      if (cues.length) out[q.id] = cues;
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }
  const pct = (x) => (x === null ? '  –  ' : `${(x * 100).toFixed(1).padStart(5)}%`);
  let over = 0;
  console.log('猜題線索（門檻：長度 8–35%、數值 ≤ 62%、絕對 ≤ 28%、語氣 ≤ 56%、多選絕對與多選長度 25–75%）');
  console.log('科目        長度     數值     絕對     語氣     多選絕對  多選長度  解析沒寫答案');
  for (const [s, m] of Object.entries(measure(bank))) {
    const cells = ['length', 'numeric', 'absolute', 'tone', 'msAbsolute', 'msLength'].map((k) => {
      const bad = m[k] !== null && (m[k] > LIMITS[k] || m[k] < (FLOORS[k] ?? 0));
      if (bad) over++;
      return `${pct(m[k])}${bad ? '⚠' : ' '}`;
    });
    console.log(`${s.padEnd(10)}  ${cells.join('  ')}  ${m.explain.length}`);
  }
  console.log(over ? `\n⚠ ${over} 項超過門檻` : '\n✓ 各科都在門檻內');
  if (over && args.includes('--strict')) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
