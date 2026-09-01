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
