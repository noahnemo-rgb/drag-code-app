import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Tier } from "./tier-store";

export interface TierLimits {
  aiMessagesPerMonth: number;
  cloudSync: boolean;
  semanticSnippetSearch: boolean;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    aiMessagesPerMonth: 25,
    cloudSync: false,
    semanticSnippetSearch: false,
  },
  pro: {
    aiMessagesPerMonth: 500,
    cloudSync: true,
    semanticSnippetSearch: true,
  },
};

const AI_USAGE_KEY = "syntax.usage.ai_month";

function utcMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export async function getAiMessagesUsedThisMonth(): Promise<number> {
  const raw = await AsyncStorage.getItem(AI_USAGE_KEY);
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { month: string; count: number };
    return parsed.month === utcMonth() ? parsed.count : 0;
  } catch {
    return 0;
  }
}

export async function incrementAiMessageCount(): Promise<number> {
  const month = utcMonth();
  const used = (await getAiMessagesUsedThisMonth()) + 1;
  await AsyncStorage.setItem(AI_USAGE_KEY, JSON.stringify({ month, count: used }));
  return used;
}

export async function canSendAiMessage(tier: Tier): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = TIER_LIMITS[tier].aiMessagesPerMonth;
  const used = await getAiMessagesUsedThisMonth();
  return { ok: used < limit, used, limit };
}

export function canUseCloudSync(tier: Tier): boolean {
  return TIER_LIMITS[tier].cloudSync;
}

export function canUseSemanticSearch(tier: Tier): boolean {
  return TIER_LIMITS[tier].semanticSnippetSearch;
}

export function nextUtcMonthLabel(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}
