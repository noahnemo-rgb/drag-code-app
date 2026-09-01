import { secureDelete, secureGet, secureSet } from "./secure-store";

const OPENROUTER_KEY = "syntax.openrouter_key";
const OPENROUTER_MODEL_KEY = "syntax.openrouter_model";

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";

/** User-owned OpenRouter API key — used on iOS/Android (BYOK). Never sent to our backend. */
export const openRouterKey = {
  get: () => secureGet(OPENROUTER_KEY),
  set: (value: string) => secureSet(OPENROUTER_KEY, value.trim()),
  clear: () => secureDelete(OPENROUTER_KEY),
};

export const openRouterModel = {
  get: async (): Promise<string> => (await secureGet(OPENROUTER_MODEL_KEY)) || DEFAULT_OPENROUTER_MODEL,
  set: (value: string) => secureSet(OPENROUTER_MODEL_KEY, value.trim()),
  clear: () => secureDelete(OPENROUTER_MODEL_KEY),
};
