#!/usr/bin/env node
// 題庫格式驗證：node scripts/validate-questions.mjs [--partial] [檔案...]
// 不帶檔案時檢查 src/data/questions/ 底下全部 JSON。有錯誤時 exit code 1。
// topic 必須是 src/units.js 列出的單元，且每個單元至少 MIN_PER_UNIT 題。
// 跨單元綜合的題目必須有 links（結合的 2–3 個同科單元），其他題目不可有。
// --partial：只檢查格式，不檢查單元題數（用來驗證還沒併入題庫的新題檔，檔名仍須是 <科目>.json）。
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUBJECT_BY_ID, SUBJECTS } from '../src/subjects.js';
import { CROSS_UNIT, MIN_PER_UNIT, UNITS } from '../src/units.js';
import { checkText } from './text-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUESTION_DIR = join(ROOT, 'src', 'data', 'questions');

const LIMITS = { q: 180, choice: 60, explain: 150 };
const WARN = { q: 120, explain: 100 };
const BANNED_CHOICES = /以上皆(是|非)|以上都(對|不對|是|不是)|all of the above|none of the above/i;
const KEYS = new Set(['id', 'subject', 'topic', 'type', 'q', 'choices', 'answer', 'explain', 'formula', 'level', 'links']);

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
    if (it.topic === CROSS_UNIT) {
      const links = it.links;
      if (!Array.isArray(links) || links.length < 2 || links.length > 3) err(`${CROSS_UNIT}的題目要有 links：結合的 2–3 個單元`);
      else {
        for (const u of links) if (u === CROSS_UNIT || !units.includes(u)) err(`links 的「${u}」不是 ${subject} 的一般單元`);
        if (new Set(links).size !== links.length) err('links 有重複的單元');
      }
    } else if (it.links !== undefined) err(`只有${CROSS_UNIT}的題目可以有 links`);
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
