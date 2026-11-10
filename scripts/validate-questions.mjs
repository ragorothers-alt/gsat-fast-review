#!/usr/bin/env node
// 題庫格式驗證：node scripts/validate-questions.mjs [--partial] [檔案...]
// 不帶檔案時檢查 src/data/questions/ 底下全部 JSON。有錯誤時 exit code 1。
// topic 必須是 src/units.js 列出的單元，且每個單元至少 MIN_PER_UNIT 題。
// 跨單元綜合的題目必須有 links（結合的 2–3 個同科單元），其他題目不可有；閱讀題組裡的跨單元題可以不寫。
// 閱讀題組（group + passage）：2–5 題連續排、文章逐字相同，克漏字的空格 __n__ 每格剛好一題。
// 非選擇題（type: "open"）：answer 是參考答案的字串，points 是 2–4 個評分要點；沒有選項，也沒有 formula。
// --partial：只檢查格式，不檢查單元題數（用來驗證還沒併入題庫的新題檔，檔名仍須是 <科目>.json）。
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFigure } from '../src/figure.js';
import { SUBJECT_BY_ID, SUBJECTS } from '../src/subjects.js';
import { CROSS_UNIT, MIN_PER_UNIT, UNITS } from '../src/units.js';
import { checkText } from './text-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUESTION_DIR = join(ROOT, 'src', 'data', 'questions');

const LIMITS = { q: 180, choice: 60, explain: 150 };
const WARN = { q: 120, explain: 100 };
// 英文題幹以字母計，同樣的字元數占的版面比中文少：照 111–115 學測詞彙題的題幹長度（50 題，中位數 108、最長 132 字元）
const WARN_Q = { english: 132 };
// 演算題（scratch: true）的解析要寫出完整的演算過程、多選題要逐一點出錯誤選項，都放寬一些
const SCRATCH_EXPLAIN = { max: 220, warn: 180 };
// 解析與題幹不能用 (A)(B) 指稱選項：選項會被打亂
const LETTER_REF = /[（(][A-E][)）]|選項\s*[A-E]\b/;
const BANNED_CHOICES = /以上皆(是|非)|以上都(對|不對|是|不是)|all of the above|none of the above/i;
const KEYS = new Set(['id', 'subject', 'topic', 'type', 'q', 'choices', 'answer', 'points', 'explain', 'formula', 'level', 'links', 'scratch', 'group', 'passage', 'lv', 'fig']);
/** 非選擇題（open）：參考答案、評分要點的長度與個數；不可有的欄位 */
const OPEN = { answer: 200, answerWarn: 160, point: 40, min: 2, max: 4 };
const OPEN_BANNED = ['choices', 'group', 'passage', 'fig', 'scratch', 'lv', 'formula'];
/** 圖表題（fig）：圖占掉題目卡一大塊，題幹要短 */
const FIG_Q = 120;
/** 題幹指著圖表（如圖、如下表、附圖…）：一定要有 fig。「例如表面」「由圖例」「表現」「下表皮」這些不算 */
const FIG_REF = /(?<!例)如(下|右|附)?[圖表](?![現示面達列例皮層])|[附下右][圖表](?![現示面達格例皮層])/;
/** 英文單字題才有 lv：考的字在大考中心《高中英文參考詞彙表》的級數 */
const LV_TOPICS = ['核心單字', '進階單字'];
// 閱讀題組的文章長度（字元；國文是字數，英文約 6 個字元一個字）與題數
const PASSAGE = { chinese: { min: 100, max: 800, warn: 650 }, english: { min: 400, max: 2000, warn: 1700 } };
const PASSAGE_DEFAULT = { min: 80, max: 600, warn: 450 };
const GROUP_SIZE = { min: 2, max: 5, bank: 7 };
/** 共用選項的題組（文意選填、篇章結構）：最多 8 個選項（數字鍵 1–8），篇章結構的句子選項可以長一點 */
const BANK = { max: 8, choice: 120 };
/** 克漏字的空格：__1__、__2__…，回傳編號 */
const blanksIn = (text) => [...text.matchAll(/__(\d+)__/g)].map((m) => Number(m[1]));

const args = process.argv.slice(2);
const partial = args.includes('--partial');
const named = args.filter((a) => !a.startsWith('--'));
const files = named.length ? named : readdirSync(QUESTION_DIR).filter((f) => f.endsWith('.json')).map((f) => join(QUESTION_DIR, f));

let totalErrors = 0;

// 少了一整科的題庫檔：App 會靜靜地少一科，一定要擋下來
if (!named.length) {
  const present = new Set(files.map((f) => basename(f, '.json')));
  for (const s of SUBJECTS) {
    if (present.has(s.id)) continue;
    console.error(`✗ 缺少題庫檔 ${s.id}.json`);
    totalErrors++;
  }
}
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
  const stats = { mc: 0, tf: 0, ms: 0, open: 0, formula: 0, scratch: 0, grouped: 0, fig: 0, level: { 1: 0, 2: 0, 3: 0 }, topics: new Map(units.map((u) => [u, 0])) };
  /** 題組代號 → 這組的題目（檔案裡的順序） */
  const groups = new Map();

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
      // 題組裡的跨單元題考的是整篇的閱讀理解，可以不寫 links
      if (links === undefined && it.group !== undefined) {
        // 不寫也可以
      } else if (!Array.isArray(links) || links.length < 2 || links.length > 3) err(`${CROSS_UNIT}的題目要有 links：結合的 2–3 個單元`);
      else {
        for (const u of links) if (u === CROSS_UNIT || !units.includes(u)) err(`links 的「${u}」不是 ${subject} 的一般單元`);
        if (new Set(links).size !== links.length) err('links 有重複的單元');
      }
    } else if (it.links !== undefined) err(`只有${CROSS_UNIT}的題目可以有 links`);
    const open = it.type === 'open';
    // 非選擇題沒有選項、不屬於題組，也沒有 formula（其他題型的 formula 必填）
    if (open) {
      for (const k of OPEN_BANNED) if (it[k] !== undefined) err(`非選擇題（open）不可有 ${k}`);
    } else if (typeof it.formula !== 'boolean') err('formula 必須是 true/false');
    else if (it.formula) stats.formula++;
    if (!open && it.points !== undefined) err('只有非選擇題（open）可以有 points');
    if (![1, 2, 3].includes(it.level)) err('level 必須是 1、2 或 3');
    else stats.level[it.level]++;
    if (it.lv !== undefined && !open) {
      if (subject !== 'english' || !LV_TOPICS.includes(it.topic) || it.type !== 'mc') err(`lv 只用在英文${LV_TOPICS.join('、')}的單選題`);
      else if (![1, 2, 3, 4, 5, 6].includes(it.lv)) err('lv 必須是 1–6（參考詞彙表的級數）');
    }
    if (it.scratch !== undefined && !open) {
      if (it.scratch !== true) err('scratch 只能是 true（不是演算題就不要寫這個欄位）');
      else {
        stats.scratch++;
        if (it.type !== 'mc' || it.level !== 3) err('演算題（scratch）必須是 level 3 的單選題');
      }
    }

    // 英文的非選擇題是中譯英，題幹是中文句子：照一般（中文）題幹的建議長度，不用英文字母計的那個
    checkText(it.q, 'q', LIMITS.q, (!open && WARN_Q[subject]) || WARN.q, err, warn);
    // 非選擇題的解析要說明參考答案怎麼來、每個要點為什麼重要，和演算題一樣放寬
    if (it.scratch || it.type === 'ms' || open) checkText(it.explain, 'explain', SCRATCH_EXPLAIN.max, SCRATCH_EXPLAIN.warn, err, warn);
    else checkText(it.explain, 'explain', LIMITS.explain, WARN.explain, err, warn);
    if (it.type === 'ms' && [it.q, it.explain].some((t) => typeof t === 'string' && LETTER_REF.test(t))) err('多選題的選項會被打亂，題幹與解析不可用 (A)(B) 指稱選項');
    // 英文題沒有公式：沒跳脫的 $ 多半是金額（$8,000），兩個 $ 之間會被排成公式
    const texts = [it.q, it.explain, it.passage, ...(Array.isArray(it.choices) ? it.choices : []), ...(open ? [it.answer, ...(Array.isArray(it.points) ? it.points : [])] : [])];
    if (subject === 'english' && texts.some((t) => typeof t === 'string' && /(^|[^\\])\$/.test(t))) err('英文題不用 LaTeX 公式：字面上的錢字號要寫成 \\$（JSON 裡是 "\\\\$"）');

    // 非選擇題不可有 group、passage（上面已經報錯），不再當成題組檢查一次
    if (!open && (it.group !== undefined || it.passage !== undefined)) {
      stats.grouped++;
      if (typeof it.group !== 'string' || !new RegExp(`^${subject}-g\\d{3,4}$`).test(it.group)) err(`group 必須是 "${subject}-g001" 格式`);
      const lim = PASSAGE[subject] ?? PASSAGE_DEFAULT;
      checkText(it.passage, 'passage', lim.max, lim.warn, err, warn);
      if (typeof it.passage === 'string' && it.passage.length < lim.min) err(`passage 太短（${it.passage.length} 字，至少 ${lim.min}）`);
      if (it.type === 'tf') err('題組的題目不可是是非題');
      if (it.scratch) err('題組的題目不可標 scratch');
      if (typeof it.group === 'string') (groups.get(it.group) ?? groups.set(it.group, []).get(it.group)).push(it);
    }
    if (it.fig !== undefined) {
      stats.fig++;
      if (it.type !== 'mc' && it.type !== 'ms') err('圖表題（fig）只能是單選或多選題');
      if (it.group !== undefined) err('題組的題目不可有 fig');
      for (const m of checkFigure(it.fig)) err(m);
      if (typeof it.q === 'string' && it.q.length > FIG_Q) err(`圖表題的題幹上限 ${FIG_Q} 字（現在 ${it.q.length} 字）：數據放在圖裡，題幹只寫情境與要問的`);
      const word = it.fig?.type === 'table' ? '表' : '圖';
      if (typeof it.q === 'string' && !it.q.includes(word)) err(`圖表題的題幹要指出要看${word}（例如「如${word}」）`);
    } else if (it.group === undefined && typeof it.q === 'string' && FIG_REF.test(it.q)) {
      err('題幹提到圖或表，但沒有 fig：要讀圖表的題目用 fig 欄位給資料');
    }
    if (it.group === undefined && [it.q, ...(Array.isArray(it.choices) ? it.choices : [])].some((t) => typeof t === 'string' && blanksIn(t).length)) {
      err('只有題組的題目可以用 __1__ 這種空格代號');
    }

    if (typeof it.q === 'string') {
      // 題組裡的克漏字題幹（「__3__ 處應填入…」）各組都一樣，只在同一組裡比
      const norm = (it.group ? `${it.group}|` : '') + it.q.replace(/\s+/g, '');
      if (seenQ.has(norm)) err(`題目文字與 ${seenQ.get(norm)} 重複`);
      else seenQ.set(norm, tag);
    }

    if (it.type === 'mc') {
      stats.mc++;
      // 共用選項的題組（文意選填、篇章結構）：5–8 個選項，整組共用
      const bank = it.group !== undefined && Array.isArray(it.choices) && it.choices.length > 4;
      const n = bank ? it.choices.length : 4;
      if (bank && n > BANK.max) err(`共用選項最多 ${BANK.max} 個`);
      if (!Array.isArray(it.choices) || (!bank && it.choices.length !== 4)) err('mc 題必須剛好 4 個選項（題組共用選項時 5–8 個）');
      else {
        it.choices.forEach((c, i) => {
          checkText(c, `choices[${i}]`, bank ? BANK.choice : LIMITS.choice, Infinity, err, warn);
          if (typeof c === 'string' && BANNED_CHOICES.test(c)) err(`choices[${i}] 不可用「以上皆是／皆非」類選項（選項會被打亂）`);
        });
        const norm = it.choices.map((c) => String(c).replace(/\s+/g, ''));
        if (new Set(norm).size !== norm.length) err('選項有重複');
      }
      if (!Number.isInteger(it.answer) || it.answer < 0 || it.answer >= n) err(`mc 題 answer 必須是 0–${n - 1} 的整數`);
    } else if (it.type === 'ms') {
      stats.ms++;
      if (!Array.isArray(it.choices) || it.choices.length !== 5) err('ms 題必須剛好 5 個選項');
      else {
        it.choices.forEach((c, i) => {
          checkText(c, `choices[${i}]`, LIMITS.choice, Infinity, err, warn);
          if (typeof c === 'string' && BANNED_CHOICES.test(c)) err(`choices[${i}] 不可用「以上皆是／皆非」類選項（選項會被打亂）`);
        });
        if (new Set(it.choices.map((c) => String(c).replace(/\s+/g, ''))).size !== 5) err('選項有重複');
      }
      const a = it.answer;
      const ok = Array.isArray(a) && a.length >= 1 && a.every((x, i) => Number.isInteger(x) && x >= 0 && x <= 4 && (i === 0 || x > a[i - 1]));
      if (!ok) err('ms 題 answer 必須是由小到大、不重複的 0–4 整數陣列，至少 1 個');
      if (it.scratch) err('多選題不可標 scratch');
    } else if (it.type === 'tf') {
      stats.tf++;
      if (it.choices !== undefined) err('tf 題不可有 choices');
      if (typeof it.answer !== 'boolean') err('tf 題 answer 必須是 true/false');
    } else if (open) {
      stats.open++;
      // 參考答案是字串（英文的中譯英是英文句子，其他科是中文的簡答）；評分要點是作答後自己對照、逐一勾選的具體項目
      checkText(it.answer, 'answer', OPEN.answer, OPEN.answerWarn, err, warn);
      if (!Array.isArray(it.points) || it.points.length < OPEN.min || it.points.length > OPEN.max) err(`open 題的 points 必須是 ${OPEN.min}–${OPEN.max} 個評分要點`);
      else {
        it.points.forEach((p, i) => checkText(p, `points[${i}]`, OPEN.point, Infinity, err, warn));
        if (new Set(it.points.map((p) => String(p).replace(/\s+/g, ''))).size !== it.points.length) err('評分要點有重複');
      }
    } else {
      err('type 必須是 "mc"、"tf"、"ms" 或 "open"');
    }
  });

  // 題組：題數、文章逐字相同、克漏字的空格依序編號，每格剛好一題、題目照空格順序排
  for (const [g, members] of groups) {
    const err = (m) => errors.push(`${g}: ${m}`);
    const max = members.some((m) => Array.isArray(m.choices) && m.choices.length > 4 && m.type === 'mc') ? GROUP_SIZE.bank : GROUP_SIZE.max;
    if (members.length < GROUP_SIZE.min || members.length > max) err(`一個題組要有 ${GROUP_SIZE.min}–${max} 題（現在 ${members.length} 題）`);
    const passage = members[0].passage;
    if (typeof passage !== 'string') continue;
    const differ = members.filter((m) => m.passage !== passage).map((m) => m.id);
    if (differ.length) err(`同組的 passage 必須逐字相同（${differ.join('、')} 不同）`);
    const blanks = blanksIn(passage);
    if (blanks.some((n, i) => n !== i + 1)) err(`文章的空格要從 __1__ 起依序編號（現在是 ${blanks.join('、')}）`);
    const asked = [];
    for (const m of members) {
      const inQ = typeof m.q === 'string' ? blanksIn(m.q) : [];
      if (inQ.length > 1) err(`${m.id} 的題幹只能有一個空格代號`);
      if (inQ.length && !blanks.includes(inQ[0])) err(`${m.id} 問的 __${inQ[0]}__ 不在文章裡`);
      // 空格題的題幹固定一句中文（英文題組也一樣），不同出題輪次才不會中英混雜
      if (inQ.length === 1 && !/^__\d+__ 處最適合填入哪一個(選項|句子)？$/.test(m.q)) err(`${m.id} 的題幹要寫成「__${inQ[0]}__ 處最適合填入哪一個選項？」（篇章結構寫「句子」）`);
      if (inQ.length) asked.push(inQ[0]);
    }
    for (const n of blanks) if (asked.filter((x) => x === n).length !== 1) err(`空格 __${n}__ 要剛好有一題（現在 ${asked.filter((x) => x === n).length} 題）`);
    if (asked.some((n, i) => i && n < asked[i - 1])) err('克漏字的題目要照空格順序排');
    // 共用選項：每一題的選項逐字相同、每題都問一個空格、每個選項最多是一格的答案，而且至少多一個用不到的選項（最後一格才不會用刪去法直接得分）
    const banks = members.filter((m) => m.type === 'mc' && Array.isArray(m.choices) && m.choices.length > 4);
    if (banks.length) {
      const shared = JSON.stringify(members[0].choices);
      if (banks.length !== members.length || members.some((m) => JSON.stringify(m.choices) !== shared)) err('共用選項的題組，每一題的 choices 都要逐字相同');
      if (members.some((m) => !blanksIn(m.q ?? '').length)) err('共用選項的題組，每一題都要問一個空格');
      const answers = members.map((m) => m.answer);
      if (new Set(answers).size !== answers.length) err('共用選項的題組，每個選項最多是一格的答案');
      if (members[0].choices.length - members.length < 1) err(`共用選項要比空格多至少 1 個（現在 ${members[0].choices.length} 個選項、${members.length} 格）`);
      // 選項照空格順序排（第 1 格答 A、第 2 格答 B…）就猜得到
      if (answers.every((a, i) => !i || a > answers[i - 1])) err('共用選項的答案不可以照空格順序遞增，選項要打散');
    }
    const pos = members.map((m) => items.indexOf(m));
    if (pos.some((p, i) => i && p !== pos[i - 1] + 1)) err('同組的題目要連續排在一起');
  }

  if (!partial) {
    for (const [unit, count] of stats.topics) {
      if (count < MIN_PER_UNIT) errors.push(`單元「${unit}」只有 ${count} 題，至少要 ${MIN_PER_UNIT} 題`);
    }
  }

  const n = items.length;
  console.log(`\n${errors.length ? '✗' : '✓'} ${basename(file)}：${n} 題（單選 ${stats.mc}、是非 ${stats.tf}、多選 ${stats.ms}${stats.open ? `、非選 ${stats.open}` : ''}、公式 ${stats.formula}、演算 ${stats.scratch}${stats.grouped ? `、題組 ${groups.size} 組 ${stats.grouped} 題` : ''}${stats.fig ? `、圖表 ${stats.fig}` : ''}；難度 1/2/3 = ${stats.level[1]}/${stats.level[2]}/${stats.level[3]}）`);
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
