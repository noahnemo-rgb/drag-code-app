import {
  buildUserText,
  formatAiError,
  PUTER_DEFAULT_MODEL,
  SYSTEM_PROMPT,
  type AiProviderInfo,
  type StreamAiChatParams,
} from "./ai-chat-shared";

type PuterModule = typeof import("@heyputer/puter.js");

async function loadPuter(): Promise<PuterModule["puter"]> {
  const mod = await import("@heyputer/puter.js");
  return mod.puter;
}

function buildPuterPrompt(history: StreamAiChatParams["history"], userText: string): string {
  const lines: string[] = [`System: ${SYSTEM_PROMPT}`];
  // Puter single-prompt API — include recent turns as plain text.
  const recent = history.slice(-10);
  if (recent.length) {
    lines.push("Previous conversation:");
    for (const turn of recent) {
      lines.push(`${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`);
    }
    lines.push("");
  }
  lines.push(`User: ${userText}`);
  return lines.join("\n");
}

export async function getAiProviderInfo(): Promise<AiProviderInfo> {
  try {
    const puter = await loadPuter();
    const signedIn = puter.auth.isSignedIn();
    return {
      label: "Puter (your account)",
      description: signedIn
        ? "Signed in to Puter. AI usage is billed to your Puter account, not the app developer."
        : "Sign in to Puter when prompted. AI usage is billed to your Puter account — no developer API key required.",
      configured: signedIn,
    };
  } catch {
    return {
      label: "Puter (your account)",
      description: "Sign in to Puter when prompted. AI usage is billed to your Puter account.",
      configured: false,
    };
  }
}

export async function signInAiProvider(): Promise<void> {
  const puter = await loadPuter();
  await puter.auth.signIn();
}

export async function streamAiChat(params: StreamAiChatParams): Promise<string> {
  const puter = await loadPuter();
  const userText = buildUserText(params.message, params.context);
  const prompt = buildPuterPrompt(params.history, userText);
  let full = "";
  try {
    const stream = await puter.ai.chat(prompt, {
      model: PUTER_DEFAULT_MODEL,
      stream: true,
    });
    for await (const part of stream as AsyncIterable<{ text?: string; message?: { content?: string } }>) {
      const chunk = part?.text ?? part?.message?.content ?? "";
      if (chunk) {
        full += chunk;
        params.onChunk(chunk);
      }
    }
    if (!full) {
      // Non-streaming fallback shape
      const response = await puter.ai.chat(prompt, { model: PUTER_DEFAULT_MODEL });
      const content = (response as { message?: { content?: string } })?.message?.content ?? String(response);
      full = content;
      if (content) params.onChunk(content);
    }
    return full;
  } catch (e) {
    throw new Error(formatAiError(e));
  }
}
