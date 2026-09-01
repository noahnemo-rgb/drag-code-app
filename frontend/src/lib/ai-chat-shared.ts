export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface StreamAiChatParams {
  message: string;
  history: ChatTurn[];
  context?: { code?: string; language?: string };
  onChunk: (text: string) => void;
}

export const SYSTEM_PROMPT =
  "You are Syntax, an expert mobile coding assistant. Help the user write, understand, and debug code. " +
  "When you generate code, ALWAYS enclose it in markdown fenced blocks with the language name, e.g. ```python ...``` . " +
  "Keep answers concise and focused. When explaining, use short bullet points.";

export const PUTER_DEFAULT_MODEL = "openai/gpt-4o-mini";

export function buildUserText(message: string, context?: { code?: string; language?: string }): string {
  if (!context?.code) return message;
  return (
    `[Current file language: ${context.language || "unknown"}]\n` +
    `[Current file content]\n\`\`\`\n${context.code.slice(0, 4000)}\n\`\`\`\n\n` +
    `User question: ${message}`
  );
}

export function buildOpenRouterMessages(
  history: ChatTurn[],
  userText: string,
): { role: "system" | "user" | "assistant"; content: string }[] {
  const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];
  for (const turn of history.slice(-20)) {
    if (turn.content.trim()) {
      msgs.push({ role: turn.role, content: turn.content });
    }
  }
  msgs.push({ role: "user", content: userText });
  return msgs;
}

export function formatAiError(error: unknown): string {
  const err = error as { code?: string; status?: number; message?: string };
  if (err?.code === "too_many_requests" || err?.status === 429) {
    return "Too many AI requests. Wait a few seconds and try again.";
  }
  if (err?.code === "insufficient_funds" || err?.status === 402) {
    return "Your AI allowance is exhausted. Add credits or upgrade your provider account, then try again.";
  }
  if (err?.code === "subscription_required") {
    return "This AI feature requires a paid provider plan.";
  }
  if (typeof err?.message === "string" && err.message.trim()) {
    return err.message;
  }
  return String(error);
}

/** Parse OpenRouter SSE chunks from accumulated XHR/fetch response text. */
export function drainOpenRouterSse(fullText: string, parsedThrough: number): { text: string; parsedThrough: number } {
  let text = "";
  const slice = fullText.slice(parsedThrough);
  const lines = slice.split("\n");
  // If the last line is incomplete, leave it for the next drain call.
  const completeLines = slice.endsWith("\n") ? lines : lines.slice(0, -1);
  let consumed = parsedThrough;
  for (const line of completeLines) {
    consumed += line.length + 1;
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data === "[DONE]") continue;
    try {
      const chunk = JSON.parse(data) as {
        error?: { message?: string };
        choices?: { delta?: { content?: string } }[];
      };
      if (chunk.error?.message) throw new Error(chunk.error.message);
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) text += content;
    } catch (e) {
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }
  return { text, parsedThrough: consumed };
}

export type AiProviderInfo = {
  label: string;
  description: string;
  configured: boolean;
};
