// Push / share destinations. All calls are made directly from the client so
// user secrets (GitHub PAT, webhook token) never touch our backend.
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// --- Secure keys ---
const GH_PAT_KEY = "syntax.gh_pat";
const WEBHOOK_TOKEN_KEY = "syntax.webhook_token";

// SecureStore is not available on web — fall back to AsyncStorage there.
async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}
async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") return AsyncStorage.setItem(key, value);
  return SecureStore.setItemAsync(key, value);
}
async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === "web") return AsyncStorage.removeItem(key);
  return SecureStore.deleteItemAsync(key);
}

// --- GitHub PAT ---
export const githubPat = {
  get: () => secureGet(GH_PAT_KEY),
  set: (t: string) => secureSet(GH_PAT_KEY, t),
  clear: () => secureDelete(GH_PAT_KEY),
};

// --- GitHub push config (non-secret) ---
export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  path: string; // path prefix or full path
}
const GH_CFG_KEY = "syntax.gh_cfg";
export async function loadGitHubConfig(): Promise<GitHubConfig | null> {
  const raw = await AsyncStorage.getItem(GH_CFG_KEY);
  return raw ? (JSON.parse(raw) as GitHubConfig) : null;
}
export async function saveGitHubConfig(c: GitHubConfig): Promise<void> {
  await AsyncStorage.setItem(GH_CFG_KEY, JSON.stringify(c));
}

// --- Webhook config ---
export interface WebhookConfig {
  url: string;
}
const WH_CFG_KEY = "syntax.webhook_cfg";
export const webhookToken = {
  get: () => secureGet(WEBHOOK_TOKEN_KEY),
  set: (t: string) => secureSet(WEBHOOK_TOKEN_KEY, t),
  clear: () => secureDelete(WEBHOOK_TOKEN_KEY),
};
export async function loadWebhookConfig(): Promise<WebhookConfig | null> {
  const raw = await AsyncStorage.getItem(WH_CFG_KEY);
  return raw ? (JSON.parse(raw) as WebhookConfig) : null;
}
export async function saveWebhookConfig(c: WebhookConfig): Promise<void> {
  await AsyncStorage.setItem(WH_CFG_KEY, JSON.stringify(c));
}

// --- Base64 encode (UTF-8 safe, cross-platform) ---
function utf8ToBase64(text: string): string {
  const g = globalThis as { btoa?: (s: string) => string; Buffer?: { from: (t: string, e: string) => { toString: (e: string) => string } } };
  if (g.btoa) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach((b: number) => (binary += String.fromCharCode(b)));
    return g.btoa(binary);
  }
  if (g.Buffer) return g.Buffer.from(text, "utf-8").toString("base64");
  throw new Error("No Base64 encoder available");
}

// --- Redact a token for error messages ---
export function redact(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

// --- GitHub push (create or update a single file) ---
export interface GitHubPushResult {
  commitSha: string;
  url: string;
}

export async function pushToGitHub(opts: {
  pat: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  message: string;
  content: string;
}): Promise<GitHubPushResult> {
  const { pat, owner, repo, branch, path, message, content } = opts;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
  const headers = {
    Authorization: `token ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "SyntaxMobileIDE/1.0",
    "Content-Type": "application/json",
  };
  // 1) Look up current SHA (if file exists) so we can update in place
  let sha: string | undefined;
  const getRes = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, { headers });
  if (getRes.ok) {
    const j = await getRes.json();
    if (!Array.isArray(j)) sha = j.sha;
  } else if (getRes.status !== 404) {
    const body = await getRes.text();
    throw new Error(`GitHub read failed (${getRes.status}): ${body.slice(0, 200)}`);
  }
  // 2) PUT create/update
  const putRes = await fetch(base, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message,
      content: utf8ToBase64(content),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!putRes.ok) {
    const body = await putRes.text();
    throw new Error(`GitHub push failed (${putRes.status}): ${body.slice(0, 200)}`);
  }
  const json = await putRes.json();
  return {
    commitSha: json.commit?.sha ?? "",
    url: json.content?.html_url ?? "",
  };
}

// --- Custom webhook push (HTTPS only) ---
export async function pushToWebhook(opts: {
  url: string;
  token?: string;
  filename: string;
  language: string;
  content: string;
}): Promise<{ status: number }> {
  const { url, token, filename, language, content } = opts;
  if (!/^https:\/\//i.test(url)) throw new Error("Webhook URL must use https://");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "SyntaxMobileIDE/1.0",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ filename, language, content, timestamp: new Date().toISOString() }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Webhook responded ${res.status}: ${body.slice(0, 200)}`);
  }
  return { status: res.status };
}

// --- Native share (OS share sheet) ---
export type ShareResult = { kind: "share" } | { kind: "clipboard"; message: string } | { kind: "cancelled" };

export async function shareViaNative(opts: { filename: string; content: string }): Promise<ShareResult> {
  const { filename, content } = opts;
  // On mobile: write to cache and open the Share sheet with the file.
  if (Platform.OS === "ios" || Platform.OS === "android") {
    if (await Sharing.isAvailableAsync()) {
      const uri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { dialogTitle: `Share ${filename}` });
      return { kind: "share" };
    }
  }
  // Web: try the Web Share API first, then fall back to clipboard.
  if (Platform.OS === "web") {
    const nav = (globalThis as { navigator?: { share?: (d: { title: string; text: string }) => Promise<void>; clipboard?: { writeText: (s: string) => Promise<void> } } }).navigator;
    try {
      if (nav?.share) {
        await nav.share({ title: filename, text: content });
        return { kind: "share" };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/abort|cancel/i.test(msg)) return { kind: "cancelled" };
    }
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(content);
      return { kind: "clipboard", message: `Copied ${filename} to clipboard — the Web Share API is unavailable in this browser.` };
    }
  }
  // Last-resort fallback: React Native Share text.
  await Share.share({ title: filename, message: content });
  return { kind: "share" };
}
