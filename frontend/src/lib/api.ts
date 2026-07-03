const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

export type Language = "javascript" | "typescript" | "python" | "html" | "css";

export interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface FileItem {
  id: string;
  project_id: string;
  name: string;
  language: Language;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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
};

export const streamChat = async (
  sessionId: string,
  message: string,
  context: { code?: string; language?: string } | undefined,
  onChunk: (text: string) => void,
): Promise<string> => {
  const res = await fetch(`${BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      message,
      context_code: context?.code,
      context_language: context?.language,
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Chat stream failed: ${res.status}`);
  }
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
};
