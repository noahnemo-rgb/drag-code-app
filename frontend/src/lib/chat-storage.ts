import AsyncStorage from "@react-native-async-storage/async-storage";

export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

const historyKey = (sessionId: string) => `syntax.chat.history.${sessionId}`;

export async function loadChatHistory(sessionId: string): Promise<StoredChatMessage[]> {
  const raw = await AsyncStorage.getItem(historyKey(sessionId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendChatTurn(
  sessionId: string,
  userContent: string,
  assistantContent: string,
): Promise<StoredChatMessage[]> {
  const existing = await loadChatHistory(sessionId);
  const now = new Date().toISOString();
  const next: StoredChatMessage[] = [
    ...existing,
    { id: `u-${Date.now()}`, role: "user", content: userContent, created_at: now },
    {
      id: `a-${Date.now() + 1}`,
      role: "assistant",
      content: assistantContent,
      created_at: now,
    },
  ];
  // Keep the last 80 messages (~40 turns) to bound storage.
  const trimmed = next.slice(-80);
  await AsyncStorage.setItem(historyKey(sessionId), JSON.stringify(trimmed));
  return trimmed;
}

export async function clearChatHistory(sessionId: string): Promise<void> {
  await AsyncStorage.removeItem(historyKey(sessionId));
}
