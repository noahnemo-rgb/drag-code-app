import { DEFAULT_OPENROUTER_MODEL, openRouterKey, openRouterModel } from "./ai-keys";
import {
  buildOpenRouterMessages,
  buildUserText,
  drainOpenRouterSse,
  formatAiError,
  type AiProviderInfo,
  type StreamAiChatParams,
} from "./ai-chat-shared";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

async function streamOpenRouterXhr(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  onChunk: (text: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", OPENROUTER_URL);
    xhr.setRequestHeader("Authorization", `Bearer ${apiKey}`);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("HTTP-Referer", "https://syntax.ide");
    xhr.setRequestHeader("X-Title", "Syntax Mobile IDE");
    let parsedThrough = 0;
    let full = "";
    xhr.onprogress = () => {
      const raw = xhr.responseText ?? "";
      const { text, parsedThrough: next } = drainOpenRouterSse(raw, parsedThrough);
      parsedThrough = next;
      if (text) {
        full += text;
        onChunk(text);
      }
    };
    xhr.onload = () => {
      const raw = xhr.responseText ?? "";
      const { text, parsedThrough: next } = drainOpenRouterSse(raw, parsedThrough);
      if (text) {
        full += text;
        onChunk(text);
      }
      parsedThrough = next;
      if (xhr.status >= 200 && xhr.status < 300) resolve(full);
      else reject(new Error(`OpenRouter HTTP ${xhr.status}: ${raw.slice(0, 300)}`));
    };
    xhr.onerror = () => reject(new Error("OpenRouter network error"));
    xhr.send(JSON.stringify({ model, messages, stream: true }));
  });
}

export async function getAiProviderInfo(): Promise<AiProviderInfo> {
  const key = await openRouterKey.get();
  const model = await openRouterModel.get();
  return {
    label: "OpenRouter (your key)",
    description: key
      ? `Using model ${model}. Usage is billed to your OpenRouter account.`
      : "Add your OpenRouter API key in AI settings. Your key stays on this device and is never sent to our servers.",
    configured: Boolean(key?.trim()),
  };
}

export async function signInAiProvider(): Promise<void> {
  // No-op on native — user configures an API key instead.
}

export async function streamAiChat(params: StreamAiChatParams): Promise<string> {
  const apiKey = await openRouterKey.get();
  if (!apiKey?.trim()) {
    throw new Error("OpenRouter API key not set. Open AI settings (gear icon) and add your key.");
  }
  const model = await openRouterModel.get();
  const userText = buildUserText(params.message, params.context);
  const messages = buildOpenRouterMessages(params.history, userText);
  try {
    return await streamOpenRouterXhr(apiKey, model || DEFAULT_OPENROUTER_MODEL, messages, params.onChunk);
  } catch (e) {
    throw new Error(formatAiError(e));
  }
}
