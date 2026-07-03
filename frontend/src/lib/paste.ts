// Strips Markdown-style code fences (```lang ... ```) from pasted text so
// novice users can paste AI-model output directly into the editor without
// polluting their runnable file. If no fences are present, the input is
// returned unchanged.
export function stripMarkdownFences(input: string): string {
  if (!input.includes("```")) return input;

  // Grab every fenced block's inner code and join them. The optional language
  // label ("python", "typescript+react", "html", …) is discarded.
  const re = /```(?:[a-zA-Z][\w+\-.]*)?[ \t]*\r?\n?([\s\S]*?)\r?\n?```/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    blocks.push(match[1]);
  }

  if (blocks.length > 0) {
    return blocks.join("\n\n");
  }

  // Unbalanced or stray fences (rare): strip the markers but keep the rest.
  return input
    .replace(/```(?:[a-zA-Z][\w+\-.]*)?[ \t]*\r?\n?/g, "")
    .replace(/```/g, "");
}

// Heuristic used by the editor to decide whether an onChangeText event was a
// paste (rather than a keystroke). Pastes typically add many characters at
// once; a single keypress adds 1 (or 2 for surrogate pairs).
export function looksLikePaste(prevLen: number, nextLen: number): boolean {
  return nextLen - prevLen > 5;
}
