import AsyncStorage from "@react-native-async-storage/async-storage";
import { FileItem, Language, Project } from "./api";

// Local-only storage mirroring the backend project/file shapes.

const PROJECTS_KEY = "syntax.local.projects";
const FILES_KEY = "syntax.local.files";
const SYNC_MODE_KEY = "syntax.sync_mode"; // "local" | "cloud"
const ACTIVE_PROJECT_KEY = "syntax.active_project";
const ACTIVE_FILE_KEY = "syntax.active_file";

export type SyncMode = "local" | "cloud";

const uuid = (): string =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

const isoNow = (): string => new Date().toISOString();

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
async function writeJson<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export const local = {
  async listProjects(): Promise<Project[]> {
    const list = await readJson<Project[]>(PROJECTS_KEY, []);
    return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async createProject(name: string): Promise<Project> {
    const list = await readJson<Project[]>(PROJECTS_KEY, []);
    const p: Project = { id: uuid(), name, created_at: isoNow(), updated_at: isoNow() };
    list.push(p);
    await writeJson(PROJECTS_KEY, list);
    return p;
  },
  async deleteProject(id: string): Promise<void> {
    const list = await readJson<Project[]>(PROJECTS_KEY, []);
    await writeJson(PROJECTS_KEY, list.filter((p) => p.id !== id));
    const files = await readJson<FileItem[]>(FILES_KEY, []);
    await writeJson(FILES_KEY, files.filter((f) => f.project_id !== id));
  },
  async renameProject(id: string, name: string): Promise<Project | null> {
    const list = await readJson<Project[]>(PROJECTS_KEY, []);
    const idx = list.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    list[idx] = { ...list[idx], name, updated_at: isoNow() };
    await writeJson(PROJECTS_KEY, list);
    return list[idx];
  },

  async listFiles(projectId: string): Promise<FileItem[]> {
    const files = await readJson<FileItem[]>(FILES_KEY, []);
    return files
      .filter((f) => f.project_id === projectId)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  async createFile(data: {
    project_id: string;
    name: string;
    language: Language;
    content?: string;
  }): Promise<FileItem> {
    const files = await readJson<FileItem[]>(FILES_KEY, []);
    const f: FileItem = {
      id: uuid(),
      project_id: data.project_id,
      name: data.name,
      language: data.language,
      content: data.content ?? "",
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    files.push(f);
    await writeJson(FILES_KEY, files);
    return f;
  },
  async updateFile(
    id: string,
    data: Partial<Pick<FileItem, "name" | "content" | "language">>,
  ): Promise<FileItem | null> {
    const files = await readJson<FileItem[]>(FILES_KEY, []);
    const idx = files.findIndex((f) => f.id === id);
    if (idx < 0) return null;
    files[idx] = { ...files[idx], ...data, updated_at: isoNow() };
    await writeJson(FILES_KEY, files);
    return files[idx];
  },
  async deleteFile(id: string): Promise<void> {
    const files = await readJson<FileItem[]>(FILES_KEY, []);
    await writeJson(FILES_KEY, files.filter((f) => f.id !== id));
  },
};

export const settings = {
  async getSyncMode(): Promise<SyncMode> {
    const raw = await AsyncStorage.getItem(SYNC_MODE_KEY);
    return raw === "cloud" ? "cloud" : "local";
  },
  async setSyncMode(mode: SyncMode): Promise<void> {
    await AsyncStorage.setItem(SYNC_MODE_KEY, mode);
  },
  async getActiveProject(): Promise<string | null> {
    return AsyncStorage.getItem(ACTIVE_PROJECT_KEY);
  },
  async setActiveProject(id: string | null): Promise<void> {
    if (!id) await AsyncStorage.removeItem(ACTIVE_PROJECT_KEY);
    else await AsyncStorage.setItem(ACTIVE_PROJECT_KEY, id);
  },
  async getActiveFile(): Promise<string | null> {
    return AsyncStorage.getItem(ACTIVE_FILE_KEY);
  },
  async setActiveFile(id: string | null): Promise<void> {
    if (!id) await AsyncStorage.removeItem(ACTIVE_FILE_KEY);
    else await AsyncStorage.setItem(ACTIVE_FILE_KEY, id);
  },
};
