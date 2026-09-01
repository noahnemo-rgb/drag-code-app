import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "syntax.editor_context";

export type EditorContext = {
  code: string;
  language: string;
  name?: string;
};

/** Persist the active editor buffer so the AI screen can attach it as context. */
export async function saveEditorContext(ctx: EditorContext | null): Promise<void> {
  if (!ctx || !ctx.code) {
    await AsyncStorage.removeItem(KEY);
    return;
  }
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify({
      code: ctx.code.slice(0, 4000),
      language: ctx.language,
      name: ctx.name,
    }),
  );
}

export async function loadEditorContext(): Promise<EditorContext | undefined> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as EditorContext;
    if (!parsed?.code || typeof parsed.code !== "string") return undefined;
    return {
      code: parsed.code,
      language: typeof parsed.language === "string" ? parsed.language : "unknown",
      name: typeof parsed.name === "string" ? parsed.name : undefined,
    };
  } catch {
    return undefined;
  }
}
