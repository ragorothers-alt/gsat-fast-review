#!/usr/bin/env node
// 題庫格式驗證：node scripts/validate-questions.mjs [--partial] [檔案...]
// 不帶檔案時檢查 src/data/questions/ 底下全部 JSON。有錯誤時 exit code 1。
// topic 必須是 src/units.js 列出的單元，且每個單元至少 MIN_PER_UNIT 題。
// --partial：只檢查格式，不檢查單元題數（用來驗證還沒併入題庫的新題檔，檔名仍須是 <科目>.json）。
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import katex from 'katex';
import { SUBJECT_BY_ID, SUBJECTS } from '../src/subjects.js';
import { MIN_PER_UNIT, UNITS } from '../src/units.js';
import { splitMath } from '../src/rich-text.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUESTION_DIR = join(ROOT, 'src', 'data', 'questions');

const LIMITS = { q: 180, choice: 60, explain: 150 };
const WARN = { q: 120, explain: 100 };
const BANNED_CHOICES = /以上皆(是|非)|以上都(對|不對|是|不是)|all of the above|none of the above/i;
const CONTROL_CHARS = /[\u0000-\u0009\u000b-\u001f]/;
const CJK = /[㐀-鿿]/;
const KEYS = new Set(['id', 'subject', 'topic', 'type', 'q', 'choices', 'answer', 'explain', 'formula', 'level']);

const args = process.argv.slice(2);
const partial = args.includes('--partial');
const named = args.filter((a) => !a.startsWith('--'));
const files = named.length ? named : readdirSync(QUESTION_DIR).filter((f) => f.endsWith('.json')).map((f) => join(QUESTION_DIR, f));

if (!named.length) {
  const present = new Set(files.map((f) => basename(f, '.json')));
  for (const s of SUBJECTS) if (!present.has(s.id)) console.error(`✗ 缺少題庫檔 ${s.id}.json`);
}

let totalErrors = 0;
let totalWarnings = 0;
const seenIds = new Map();

for (const file of files) {
  const errors = [];
  const warnings = [];
  const subject = basename(file, '.json');
  if (!SUBJECT_BY_ID[subject]) errors.push(`檔名 ${subject} 不是已知科目`);

  let items;
  try {
    items = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    console.error(`✗ ${file}: JSON 解析失敗 — ${e.message}`);
    totalErrors++;
    continue;
  }
  if (!Array.isArray(items)) {
    console.error(`✗ ${file}: 最外層必須是陣列`);
    totalErrors++;
    continue;
  }

  const seenQ = new Map();
  const units = UNITS[subject] || [];
  const stats = { mc: 0, tf: 0, formula: 0, level: { 1: 0, 2: 0, 3: 0 }, topics: new Map(units.map((u) => [u, 0])) };

  items.forEach((it, idx) => {
    const tag = it && typeof it.id === 'string' ? it.id : `#${idx}`;
    const err = (m) => errors.push(`${tag}: ${m}`);
    const warn = (m) => warnings.push(`${tag}: ${m}`);
    if (!it || typeof it !== 'object') return err('不是物件');

    for (const k of Object.keys(it)) if (!KEYS.has(k)) err(`未知欄位 "${k}"`);

    if (typeof it.id !== 'string' || !new RegExp(`^${subject}-\\d{3,4}$`).test(it.id)) err(`id 必須是 "${subject}-001" 格式`);
    else if (seenIds.has(it.id)) err(`id 重複（也出現在 ${seenIds.get(it.id)}）`);
    else seenIds.set(it.id, basename(file));

    if (it.subject !== subject) err(`subject 應為 "${subject}"`);
    if (typeof it.topic !== 'string' || !it.topic.trim()) err('缺少 topic');
    else if (!units.includes(it.topic)) err(`topic「${it.topic}」不在 src/units.js 的 ${subject} 單元清單裡`);
    else stats.topics.set(it.topic, stats.topics.get(it.topic) + 1);
    if (typeof it.formula !== 'boolean') err('formula 必須是 true/false');
    else if (it.formula) stats.formula++;
    if (![1, 2, 3].includes(it.level)) err('level 必須是 1、2 或 3');
    else stats.level[it.level]++;

    checkText(it.q, 'q', LIMITS.q, WARN.q, err, warn);
    checkText(it.explain, 'explain', LIMITS.explain, WARN.explain, err, warn);

    if (typeof it.q === 'string') {
      const norm = it.q.replace(/\s+/g, '');
      if (seenQ.has(norm)) err(`題目文字與 ${seenQ.get(norm)} 重複`);
      else seenQ.set(norm, tag);
    }

    if (it.type === 'mc') {
      stats.mc++;
      if (!Array.isArray(it.choices) || it.choices.length !== 4) err('mc 題必須剛好 4 個選項');
      else {
        it.choices.forEach((c, i) => {
          checkText(c, `choices[${i}]`, LIMITS.choice, Infinity, err, warn);
          if (typeof c === 'string' && BANNED_CHOICES.test(c)) err(`choices[${i}] 不可用「以上皆是／皆非」類選項（選項會被打亂）`);
        });
        const norm = it.choices.map((c) => String(c).replace(/\s+/g, ''));
        if (new Set(norm).size !== norm.length) err('選項有重複');
      }
      if (!Number.isInteger(it.answer) || it.answer < 0 || it.answer > 3) err('mc 題 answer 必須是 0–3 的整數');
    } else if (it.type === 'tf') {
      stats.tf++;
      if (it.choices !== undefined) err('tf 題不可有 choices');
      if (typeof it.answer !== 'boolean') err('tf 題 answer 必須是 true/false');
    } else {
      err('type 必須是 "mc" 或 "tf"');
    }
  });

  if (!partial) {
    for (const [unit, count] of stats.topics) {
      if (count < MIN_PER_UNIT) errors.push(`單元「${unit}」只有 ${count} 題，至少要 ${MIN_PER_UNIT} 題`);
    }
  }

  const n = items.length;
  console.log(`\n${errors.length ? '✗' : '✓'} ${basename(file)}：${n} 題（單選 ${stats.mc}、是非 ${stats.tf}、公式 ${stats.formula}；難度 1/2/3 = ${stats.level[1]}/${stats.level[2]}/${stats.level[3]}）`);
  const topics = [...stats.topics].map(([t, c]) => `${t} ${c}`).join('、');
  if (topics) console.log(`  單元：${topics}`);
  if (warnings.length) {
    console.log(`  ⚠ ${warnings.length} 個警告`);
    for (const w of warnings.slice(0, 30)) console.log(`    - ${w}`);
    if (warnings.length > 30) console.log(`    …另有 ${warnings.length - 30} 個`);
  }
  for (const e of errors) console.log(`  ✗ ${e}`);
  totalErrors += errors.length;
  totalWarnings += warnings.length;
}

console.log(`\n合計：${totalErrors} 個錯誤、${totalWarnings} 個警告`);
process.exit(totalErrors ? 1 : 0);

/** \mathrm{...} 的最外層有 + 或箭頭：KaTeX 把整組當成一塊，不能在中間換行 */
function equationInMathrm(tex) {
  for (let at = tex.indexOf('\\mathrm{'); at >= 0; at = tex.indexOf('\\mathrm{', at + 1)) {
    let depth = 0;
    for (let i = at + 8; i < tex.length; i++) {
      const ch = tex[i];
      if (ch === '{') depth++;
      else if (ch === '}' && depth-- === 0) break;
      else if (depth === 0 && ((ch === '+' && tex[i - 1] !== '^') || /^\\(rightarrow|rightleftharpoons|longrightarrow|to)(?![a-zA-Z])/.test(tex.slice(i)))) return true;
    }
  }
  return false;
}

function checkText(value, field, max, warnAt, err, warn) {
  if (typeof value !== 'string' || !value.trim()) return err(`${field} 必須是非空字串`);
  if (CONTROL_CHARS.test(value)) {
    return err(`${field} 含控制字元——多半是 JSON 裡的 LaTeX 反斜線沒有寫成兩個（例如 "\\frac" 要寫 "\\\\frac"）`);
  }
  const { segments, balanced } = splitMath(value);
  if (!balanced) err(`${field} 的 $ 沒有成對`);
  let visible = 0;
  for (const seg of segments) {
    if (!seg.math) {
      visible += seg.text.length;
      continue;
    }
    visible += Math.ceil(seg.text.length / 3);
    if (seg.text.includes('\n')) err(`${field} 的公式內不可換行`);
    try {
      katex.renderToString(seg.text, { throwOnError: true, strict: 'ignore' });
    } catch (e) {
      err(`${field} 的 LaTeX 無法解析：$${seg.text}$ — ${e.message.split('\n')[0]}`);
    }
    if (CJK.test(seg.text.replace(/\\text\{[^}]*\}/g, ''))) warn(`${field} 的公式內有中文，請改用 \\text{} 或移到 $ 外`);
    if (equationInMathrm(seg.text)) {
      err(`${field} 的整條方程式包在同一個 \\mathrm{} 裡，手機上無法換行；請每個化學式各自包，例如 $\\mathrm{H_2}+\\mathrm{Cl_2}\\rightarrow\\mathrm{2HCl}$`);
    }
  }
  if (visible > max) err(`${field} 太長（約 ${visible} 字，上限 ${max}）`);
  else if (visible > warnAt) warn(`${field} 偏長（約 ${visible} 字，建議 ≤ ${warnAt}）`);
}
