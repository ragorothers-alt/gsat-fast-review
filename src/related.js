// 錯題延伸：找出跟某一題最像的題目。純邏輯，不碰 DOM，方便測試。
// 只在同科同單元裡找，比較題幹與解析的字詞重疊（中文取相鄰兩字、英文取單字），
// 單元裡到處都有的詞（「下列」「何者」）權重低，真正的關鍵詞權重高。

const cache = new WeakMap();

function grams(q) {
  let g = cache.get(q);
  if (g) return g;
  // 拿掉 LaTeX 指令名（\frac、\mathrm），只留內容
  const text = `${q.q} ${q.explain}`.replace(/\\[a-zA-Z]+/g, ' ').toLowerCase();
  g = new Set(text.match(/[a-z]{3,}/g) ?? []);
  for (const run of text.match(/[㐀-鿿]+/g) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) g.add(run.slice(i, i + 2));
  }
  cache.set(q, g);
  return g;
}

/**
 * 與 q 最相近的幾題（不含 q 本身）。
 * @param {object[]} bank
 * @param {object} q
 * @param {{ count?: number, exclude?: Iterable<string> }} [opts] exclude：不要出的題目 id
 */
export function relatedQuestions(bank, q, { count = 3, exclude = [] } = {}) {
  const skip = new Set(exclude);
  skip.add(q.id);
  const unit = bank.filter((c) => c.subject === q.subject && c.topic === q.topic);
  const df = new Map();
  for (const c of unit) for (const g of grams(c)) df.set(g, (df.get(g) || 0) + 1);
  const weight = (g) => Math.log((unit.length + 1) / (df.get(g) || 1));

  const mine = grams(q);
  const scored = [];
  for (const c of unit) {
    if (skip.has(c.id)) continue;
    const theirs = grams(c);
    let shared = 0;
    let total = 0;
    for (const g of mine) {
      const w = weight(g);
      total += w;
      if (theirs.has(g)) shared += w;
    }
    for (const g of theirs) if (!mine.has(g)) total += weight(g);
    scored.push({ c, score: total ? shared / total : 0 });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((x) => x.c);
}

/**
 * 錯題延伸練習的一輪：每題錯題各找幾題相近的，輪流排，讓每題錯題都練到。
 * @param {{ size: number, perSeed?: number, exclude?: Iterable<string> }} opts
 */
export function relatedQueue(bank, seeds, { size, perSeed = 3, exclude = [] }) {
  const skip = new Set([...exclude, ...seeds.map((q) => q.id)]);
  const lists = seeds.map((q) => relatedQuestions(bank, q, { count: perSeed, exclude: skip }));
  const out = [];
  const taken = new Set();
  for (let i = 0; i < perSeed; i++) {
    for (const list of lists) {
      const c = list[i];
      if (c && !taken.has(c.id) && out.length < size) {
        taken.add(c.id);
        out.push(c);
      }
    }
  }
  return out;
}
