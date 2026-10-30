#!/usr/bin/env node
// 考前重點卡格式驗證：node scripts/validate-keypoints.mjs [檔案...]
// 不帶檔案時檢查 src/data/keypoints/ 底下全部 JSON。每科一個檔（檔名 <科目>.json），
// 內容是 [{ unit, points: [...], traps: [...] }]，單元要和 src/units.js 一一對應、順序相同。有錯誤時 exit code 1。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUBJECT_BY_ID } from '../src/subjects.js';
import { UNITS } from '../src/units.js';
import { checkText } from './text-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'src', 'data', 'keypoints');
/** 每個單元幾條重點、幾條易錯陷阱 */
const POINTS = [5, 8];
const TRAPS = [2, 4];
/** 每條的長度：超過上限是錯誤，超過建議值是警告 */
const MAX = 90;
const WARN_AT = 70;
const KEYS = new Set(['unit', 'points', 'traps']);

const named = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = named.length ? named : existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => join(DIR, f)) : [];

let totalErrors = 0;
let totalWarnings = 0;
for (const file of files) {
  const errors = [];
  const warnings = [];
  const subject = basename(file, '.json');
  const units = UNITS[subject];
  if (!SUBJECT_BY_ID[subject] || !units) errors.push(`檔名 ${subject} 不是已知科目`);
  let items = [];
  try {
    items = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
    if (!Array.isArray(items)) throw new Error('最外層必須是陣列');
  } catch (e) {
    console.error(`✗ ${file}: ${e.message}`);
    totalErrors++;
    continue;
  }
  if (units) {
    const got = items.map((it) => it?.unit);
    if (got.join('|') !== units.join('|')) errors.push(`單元必須和 src/units.js 一致、順序相同：\n      應為 ${units.join('、')}\n      實際 ${got.join('、')}`);
  }
  let points = 0;
  let traps = 0;
  items.forEach((it, i) => {
    const tag = typeof it?.unit === 'string' ? it.unit : `#${i}`;
    const err = (m) => errors.push(`${tag}: ${m}`);
    const warn = (m) => warnings.push(`${tag}: ${m}`);
    if (!it || typeof it !== 'object') return err('不是物件');
    for (const k of Object.keys(it)) if (!KEYS.has(k)) err(`未知欄位 "${k}"`);
    for (const [key, [min, max]] of [['points', POINTS], ['traps', TRAPS]]) {
      const list = it[key];
      if (!Array.isArray(list) || list.length < min || list.length > max) {
        err(`${key} 必須是 ${min}–${max} 條的陣列`);
        continue;
      }
      list.forEach((t, j) => checkText(t, `${key}[${j}]`, MAX, WARN_AT, err, warn));
      if (new Set(list.map((t) => String(t).replace(/\s+/g, ''))).size !== list.length) err(`${key} 有重複的條目`);
    }
    points += it.points?.length ?? 0;
    traps += it.traps?.length ?? 0;
  });
  console.log(`\n${errors.length ? '✗' : '✓'} ${basename(file)}：${items.length} 個單元、重點 ${points} 條、易錯 ${traps} 條`);
  if (warnings.length) {
    console.log(`  ⚠ ${warnings.length} 個警告`);
    for (const w of warnings.slice(0, 30)) console.log(`    - ${w}`);
  }
  for (const e of errors) console.log(`  ✗ ${e}`);
  totalErrors += errors.length;
  totalWarnings += warnings.length;
}

console.log(`\n合計：${files.length} 個檔案、${totalErrors} 個錯誤、${totalWarnings} 個警告`);
process.exit(totalErrors ? 1 : 0);
