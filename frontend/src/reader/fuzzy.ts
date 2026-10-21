// Tiny fuzzy matcher for chapter titles. Every query token must match the title:
//   - a number token prefers an exact number word ("3" → "Genesis 3" before "Genesis 30"),
//     then a number-word prefix;
//   - a text token prefers a word prefix ("gen" → "Genesis"), then a substring,
//     then an in-order subsequence of the whole title ("jhn" → "John").
// Higher scores rank first; ties keep the original (reading) order.

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i] && ++i === needle.length) return true;
  return needle.length === 0;
}

// Returns [score, index of the matched title word (-1 if matched across words)],
// preferring a word after `after` so query order can line up with title order.
function tokenMatch(token: string, title: string, titleWords: string[], after: number): [number, number] {
  const pick = (pred: (w: string) => boolean): number => {
    const later = titleWords.findIndex((w, i) => i > after && pred(w));
    return later >= 0 ? later : titleWords.findIndex(pred);
  };
  if (/^\d+$/.test(token)) {
    const exact = pick((w) => w === token);
    if (exact >= 0) return [4, exact];
    const prefix = pick((w) => /^\d+$/.test(w) && w.startsWith(token));
    return prefix >= 0 ? [1, prefix] : [0, -1];
  }
  const prefix = pick((w) => w.startsWith(token));
  if (prefix >= 0) return [3, prefix];
  if (title.includes(token)) return [2, -1];
  if (isSubsequence(token, title.replace(/\s+/g, ''))) return [1, -1];
  return [0, -1];
}

/** Score title against query; 0 means no match. An empty query matches everything (score 1). */
export function fuzzyScore(query: string, title: string): number {
  const tokens = words(fold(query));
  if (tokens.length === 0) return 1;
  const t = fold(title);
  const tw = words(t);
  let total = 0;
  let prev = -1;
  for (const tok of tokens) {
    const [s, idx] = tokenMatch(tok, t, tw, prev);
    if (s === 0) return 0;
    total += s;
    // Small bonus when query words appear in the title's word order ("2 nephi" → "2 Nephi …").
    if (idx > prev) total += 0.5;
    if (idx >= 0) prev = idx;
  }
  return total;
}

export function fuzzyFilter<T>(items: T[], query: string, text: (item: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item, i) => ({ item, i, s: fuzzyScore(query, text(item)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}
