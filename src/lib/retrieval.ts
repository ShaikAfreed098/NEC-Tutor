import type { Chunk } from "./types";
const stopwords = new Set("a an the is are was were be to of in on for and or it this that what how why explain describe me my please about using from with can do does i you your some give tell next more detail simple example examples".split(" "));
export function tokens(text: string) { return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => t.length > 1 && !stopwords.has(t)); }
export function chunkPage(text: string, size = 1400, overlap = 220) {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const result: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) { const boundary = clean.lastIndexOf(" ", end); if (boundary > start + size * 0.6) end = boundary; }
    const value = clean.slice(start, end).trim();
    if (value.length > 35) result.push(value);
    if (end === clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return result;
}
export function lexicalRetrieve(chunks: Chunk[], query: string, subject: string, unit: number | null, limit = 5) {
  const pool = chunks.filter(c => (!subject || subject === "all" || c.subject === subject) && (!unit || c.unit === unit));
  const terms = [...new Set(tokens(query))];
  if (!terms.length) return [];
  const documents = pool.map(c => ({ chunk: c, terms: tokens(c.text) }));
  const frequencies = new Map(terms.map(t => [t, documents.filter(d => d.terms.includes(t)).length]));
  const average = documents.reduce((sum, d) => sum + d.terms.length, 0) / Math.max(documents.length, 1);
  return documents.map(({ chunk, terms: words }) => {
    let score = 0; let matched = 0;
    for (const term of terms) {
      const count = words.filter(w => w === term).length;
      if (count) matched++;
      const idf = Math.log(1 + (pool.length - (frequencies.get(term) || 0) + 0.5) / ((frequencies.get(term) || 0) + 0.5));
      score += idf * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * words.length / Math.max(average, 1)));
    }
    return { chunk, score, matched };
  }).filter(r => r.score > 0.15 && r.matched / terms.length >= 0.3).sort((a, b) => b.score - a.score).filter((r, i, all) => all.findIndex(x => x.chunk.documentId === r.chunk.documentId && x.chunk.page === r.chunk.page) === i).slice(0, limit);
}
export function normalizeVector(values: number[]) {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  if (!norm || values.some(v => !Number.isFinite(v))) throw new Error("Invalid embedding vector");
  return values.map(v => v / norm);
}
