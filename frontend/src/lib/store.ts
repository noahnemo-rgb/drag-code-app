// Adapter that routes CRUD ops to local or cloud based on the current sync mode.
import { api, FileItem, Language, Project } from "./api";
import { local, settings, SyncMode } from "./storage";

export async function getMode(): Promise<SyncMode> {
  return settings.getSyncMode();
}

export const store = {
  async listProjects(mode: SyncMode): Promise<Project[]> {
    return mode === "cloud" ? api.listProjects() : local.listProjects();
  },
  async createProject(mode: SyncMode, name: string): Promise<Project> {
    return mode === "cloud" ? api.createProject(name) : local.createProject(name);
  },
  async deleteProject(mode: SyncMode, id: string): Promise<void> {
    if (mode === "cloud") await api.deleteProject(id);
    else await local.deleteProject(id);
  },
  async renameProject(mode: SyncMode, id: string, name: string): Promise<void> {
    if (mode === "cloud") await api.renameProject(id, name);
    else await local.renameProject(id, name);
  },

  async listFiles(mode: SyncMode, projectId: string): Promise<FileItem[]> {
    return mode === "cloud" ? api.listFiles(projectId) : local.listFiles(projectId);
  },
  async createFile(
    mode: SyncMode,
    data: { project_id: string; name: string; language: Language; content?: string },
  ): Promise<FileItem> {
    return mode === "cloud" ? api.createFile(data) : local.createFile(data);
  },
  async updateFile(
    mode: SyncMode,
    id: string,
    data: Partial<Pick<FileItem, "name" | "content" | "language">>,
  ): Promise<FileItem | null> {
    return mode === "cloud" ? api.updateFile(id, data) : local.updateFile(id, data);
  },
  async deleteFile(mode: SyncMode, id: string): Promise<void> {
    if (mode === "cloud") await api.deleteFile(id);
    else await local.deleteFile(id);
  },
};
