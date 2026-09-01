import { getDeviceId } from "./device-id";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

export type Language = "javascript" | "typescript" | "python" | "html" | "css";

export interface Project {
  id: string;
  name: string;
  owner_id?: string;
  created_at: string;
  updated_at: string;
}

export interface FileItem {
  id: string;
  project_id: string;
  name: string;
  language: Language;
  content: string;
  owner_id?: string;
  created_at: string;
  updated_at: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}

async function authHeaders(extra?: HeadersInit): Promise<Record<string, string>> {
  const deviceId = await getDeviceId();
  return {
    "Content-Type": "application/json",
    "X-Device-Id": deviceId,
    ...(extra as Record<string, string> | undefined),
  };
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await authHeaders(init?.headers);
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) throw new Error(`API ${path} ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export const api = {
  listProjects: () => j<Project[]>("/projects"),
  createProject: (name: string) =>
    j<Project>("/projects", { method: "POST", body: JSON.stringify({ name }) }),
  deleteProject: (id: string) => j<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),
  renameProject: (id: string, name: string) =>
    j<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),

  listFiles: (projectId: string) => j<FileItem[]>(`/files?project_id=${encodeURIComponent(projectId)}`),
  createFile: (data: { project_id: string; name: string; language: Language; content?: string }) =>
    j<FileItem>("/files", { method: "POST", body: JSON.stringify(data) }),
  updateFile: (id: string, data: Partial<Pick<FileItem, "name" | "content" | "language">>) =>
    j<FileItem>(`/files/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteFile: (id: string) => j<{ ok: boolean }>(`/files/${id}`, { method: "DELETE" }),

  runCode: (language: Language, code: string) =>
    j<RunResult>("/run", { method: "POST", body: JSON.stringify({ language, code }) }),

  chatStreamUrl: () => `${BASE}/api/chat/stream`,
  getChatHistory: (sessionId: string) =>
    j<{ id: string; session_id: string; role: string; content: string; created_at: string }[]>(
      `/chat/history/${sessionId}`,
    ),
  clearChatHistory: (sessionId: string) =>
    j<{ ok: boolean }>(`/chat/history/${sessionId}`, { method: "DELETE" }),

  listSnippets: (params: { language?: Language; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.language) qs.set("language", params.language);
    if (params.q) qs.set("q", params.q);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return j<Snippet[]>(`/snippets${suffix}`);
  },
  createSnippet: (data: SnippetCreate) =>
    j<Snippet>("/snippets", { method: "POST", body: JSON.stringify(data) }),
  updateSnippet: (id: string, data: SnippetUpdate) =>
    j<Snippet>(`/snippets/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  starSnippet: (id: string, deviceId: string) =>
    j<Snippet>(`/snippets/${id}/star`, {
      method: "POST",
      body: JSON.stringify({ device_id: deviceId }),
    }),
  isStarred: (id: string, deviceId: string) =>
    j<{ starred: boolean }>(`/snippets/${id}/starred?device_id=${encodeURIComponent(deviceId)}`),
  deleteSnippet: (id: string, deviceId: string) =>
    j<{ ok: boolean }>(`/snippets/${id}?device_id=${encodeURIComponent(deviceId)}`, { method: "DELETE" }),
};

export interface Snippet {
  id: string;
  author: string;
  author_device?: string;
  title: string;
  description: string;
  language: Language;
  code: string;
  tags: string[];
  stars: number;
  created_at: string;
}

export interface SnippetCreate {
  author: string;
  author_device?: string;
  title: string;
  description?: string;
  language: Language;
  code: string;
  tags?: string[];
}

export interface SnippetUpdate {
  device_id: string;
  title?: string;
  description?: string;
  language?: Language;
  code?: string;
  tags?: string[];
}

type ChatStreamBody = {
  session_id: string;
  message: string;
  context_code?: string;
  context_language?: string;
};

/**
 * Progressive text streaming via XHR.
 * React Native's fetch often exposes a null `response.body`, so ReadableStream
 * readers break on device. XHR `onprogress` works on both RN and web.
 */
function streamChatXhr(
  url: string,
  body: ChatStreamBody,
  headers: Record<string, string>,
  onChunk: (text: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    let last = 0;
    const emit = () => {
      const text = xhr.responseText ?? "";
      if (text.length > last) {
        const chunk = text.slice(last);
        last = text.length;
        onChunk(chunk);
      }
    };
    xhr.onprogress = emit;
    xhr.onload = () => {
      emit();
      const full = xhr.responseText ?? "";
      if (xhr.status >= 200 && xhr.status < 300) resolve(full);
      else reject(new Error(`Chat stream failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Chat stream network error"));
    xhr.onabort = () => reject(new Error("Chat stream aborted"));
    xhr.send(JSON.stringify(body));
  });
}

async function streamChatFetch(
  url: string,
  body: ChatStreamBody,
  headers: Record<string, string>,
  onChunk: (text: string) => void,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Chat stream failed: ${res.status}`);
  if (res.body && typeof (res.body as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      full += chunk;
      onChunk(chunk);
    }
    return full;
  }
  // Fetch succeeded but streaming body is unavailable — deliver all at once.
  const text = await res.text();
  if (text) onChunk(text);
  return text;
}

export const streamChat = async (
  sessionId: string,
  message: string,
  context: { code?: string; language?: string } | undefined,
  onChunk: (text: string) => void,
): Promise<string> => {
  const url = `${BASE}/api/chat/stream`;
  const headers = await authHeaders();
  const body: ChatStreamBody = {
    session_id: sessionId,
    message,
    context_code: context?.code,
    context_language: context?.language,
  };

  // Prefer XHR on native (reliable progressive chunks). On web, try fetch streams
  // first and fall back to XHR if the body reader is missing or throws.
  const isNative = typeof navigator !== "undefined" && (navigator as { product?: string }).product === "ReactNative";
  if (isNative || typeof XMLHttpRequest !== "undefined") {
    if (isNative) return streamChatXhr(url, body, headers, onChunk);
    try {
      return await streamChatFetch(url, body, headers, onChunk);
    } catch {
      return streamChatXhr(url, body, headers, onChunk);
    }
  }
  return streamChatFetch(url, body, headers, onChunk);
};
