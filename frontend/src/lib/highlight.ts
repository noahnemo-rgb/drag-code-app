// Lightweight token-level syntax highlighter.
// Returns an array of {text, color} spans per line.

import { Language } from "./api";

export const PALETTE = {
  text: "#EDEDED",
  keyword: "#FFB000",
  string: "#4CAF50",
  number: "#FF9800",
  comment: "#6E6E6E",
  builtin: "#009688",
  punct: "#A0A0A5",
};

const KEYWORDS: Record<Language, Set<string>> = {
  javascript: new Set([
    "var","let","const","function","return","if","else","for","while","do","switch","case","break","continue",
    "new","this","class","extends","import","export","from","default","try","catch","finally","throw","typeof",
    "instanceof","in","of","async","await","yield","true","false","null","undefined","void","delete",
  ]),
  typescript: new Set([
    "var","let","const","function","return","if","else","for","while","do","switch","case","break","continue",
    "new","this","class","extends","import","export","from","default","try","catch","finally","throw","typeof",
    "instanceof","in","of","async","await","yield","true","false","null","undefined","void","delete",
    "interface","type","enum","implements","public","private","protected","readonly","as","namespace","declare","abstract","keyof","never","unknown","any",
  ]),
  python: new Set([
    "def","return","if","elif","else","for","while","break","continue","pass","import","from","as","class",
    "try","except","finally","raise","with","lambda","yield","global","nonlocal","in","is","not","and","or",
    "True","False","None","async","await",
  ]),
  html: new Set(),
  css: new Set([
    "important","from","to",
  ]),
};

export type Span = { text: string; color: string };

interface RegexEntry {
  re: RegExp;
  color: string;
  isKeyword?: boolean;
}

function buildPatterns(lang: Language): RegexEntry[] {
  if (lang === "html") {
    return [
      { re: /<!--[\s\S]*?-->/g, color: PALETTE.comment },
      { re: /"[^"\n]*"|'[^'\n]*'/g, color: PALETTE.string },
      { re: /<\/?[a-zA-Z][a-zA-Z0-9-]*/g, color: PALETTE.keyword },
      { re: /[a-zA-Z-]+(?==)/g, color: PALETTE.builtin },
      { re: /[<>/=]/g, color: PALETTE.punct },
    ];
  }
  if (lang === "css") {
    return [
      { re: /\/\*[\s\S]*?\*\//g, color: PALETTE.comment },
      { re: /"[^"\n]*"|'[^'\n]*'/g, color: PALETTE.string },
      { re: /#[a-fA-F0-9]{3,8}\b|\b\d+(\.\d+)?(px|em|rem|%|vh|vw|s|ms)?\b/g, color: PALETTE.number },
      { re: /[.#][a-zA-Z_-][\w-]*/g, color: PALETTE.keyword },
      { re: /[a-zA-Z-]+(?=\s*:)/g, color: PALETTE.builtin },
      { re: /[{};:,]/g, color: PALETTE.punct },
    ];
  }
  if (lang === "python") {
    return [
      { re: /#[^\n]*/g, color: PALETTE.comment },
      { re: /"""[\s\S]*?"""|'''[\s\S]*?'''|"[^"\n]*"|'[^'\n]*'/g, color: PALETTE.string },
      { re: /\b\d+(\.\d+)?\b/g, color: PALETTE.number },
      { re: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, color: PALETTE.text, isKeyword: true },
      { re: /[{}()[\];:,.]/g, color: PALETTE.punct },
    ];
  }
  // JS/TS
  return [
    { re: /\/\/[^\n]*|\/\*[\s\S]*?\*\//g, color: PALETTE.comment },
    { re: /`[^`]*`|"[^"\n]*"|'[^'\n]*'/g, color: PALETTE.string },
    { re: /\b\d+(\.\d+)?\b/g, color: PALETTE.number },
    { re: /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g, color: PALETTE.text, isKeyword: true },
    { re: /[{}()[\];:,.]/g, color: PALETTE.punct },
  ];
}

interface Match {
  start: number;
  end: number;
  color: string;
}

export function highlightLine(source: string, lang: Language): Span[] {
  if (!source) return [{ text: "", color: PALETTE.text }];
  const patterns = buildPatterns(lang);
  const keywords = KEYWORDS[lang];

  const matches: Match[] = [];
  for (const p of patterns) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(source)) !== null) {
      if (m[0].length === 0) {
        p.re.lastIndex += 1;
        continue;
      }
      let color = p.color;
      if (p.isKeyword) {
        if (!keywords.has(m[0])) continue;
        color = PALETTE.keyword;
      }
      // Don't overlap earlier ranges
      const overlaps = matches.some(
        (x) => !(m!.index + m![0].length <= x.start || m!.index >= x.end),
      );
      if (overlaps) continue;
      matches.push({ start: m.index, end: m.index + m[0].length, color });
    }
  }
  matches.sort((a, b) => a.start - b.start);

  const spans: Span[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) spans.push({ text: source.slice(cursor, m.start), color: PALETTE.text });
    spans.push({ text: source.slice(m.start, m.end), color: m.color });
    cursor = m.end;
  }
  if (cursor < source.length) spans.push({ text: source.slice(cursor), color: PALETTE.text });
  return spans;
}
