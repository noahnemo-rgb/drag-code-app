// Tiny fuzzy matcher: scores strings by consecutive character matches, starts, and hits.
// Returns a positive score for a match, -1 if no match.
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  if (q.length > t.length) return -1;

  let ti = 0;
  let score = 0;
  let streak = 0;
  let prevMatched = false;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (let k = ti; k < t.length; k++) {
      if (t[k] === ch) {
        found = k;
        break;
      }
    }
    if (found === -1) return -1;
    // Base score
    score += 10;
    // Bonus for consecutive matches
    if (prevMatched && found === ti) {
      streak += 1;
      score += 15 + streak * 2;
    } else {
      streak = 0;
    }
    // Bonus for matching at word boundary
    if (found === 0 || /[\s._\-/]/.test(t[found - 1])) {
      score += 8;
    }
    // Penalty for gaps
    score -= (found - ti);
    ti = found + 1;
    prevMatched = true;
  }
  // Slight bonus for shorter targets (a shorter match is more relevant)
  score += Math.max(0, 20 - t.length);
  return score;
}

export function fuzzyFilter<T>(query: string, items: T[], getText: (item: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(query, getText(item)) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}

// Highlight helper: returns spans marking which characters of `text` matched
// the fuzzy query. Falls back to a substring highlight when the query appears
// verbatim in the text (matches our content-line search behaviour).
export function highlightMatches(
  query: string,
  text: string,
): { text: string; matched: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, matched: false }];
  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();

  // 1) Prefer contiguous substring highlight (common case: content-line search)
  const subIdx = lowerText.indexOf(lowerQ);
  if (subIdx !== -1) {
    const out: { text: string; matched: boolean }[] = [];
    if (subIdx > 0) out.push({ text: text.slice(0, subIdx), matched: false });
    out.push({ text: text.slice(subIdx, subIdx + q.length), matched: true });
    if (subIdx + q.length < text.length) {
      out.push({ text: text.slice(subIdx + q.length), matched: false });
    }
    return out;
  }

  // 2) Fall back to fuzzy per-character match
  const positions = new Set<number>();
  let ti = 0;
  for (let qi = 0; qi < lowerQ.length; qi++) {
    const idx = lowerText.indexOf(lowerQ[qi], ti);
    if (idx === -1) return [{ text, matched: false }];
    positions.add(idx);
    ti = idx + 1;
  }
  const spans: { text: string; matched: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const matched = positions.has(i);
    let j = i + 1;
    while (j < text.length && positions.has(j) === matched) j++;
    spans.push({ text: text.slice(i, j), matched });
    i = j;
  }
  return spans;
}
