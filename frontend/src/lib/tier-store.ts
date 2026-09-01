import AsyncStorage from "@react-native-async-storage/async-storage";

export type Tier = "free" | "pro";

const TIER_KEY = "syntax.tier";

/** Dev/testing toggle until RevenueCat/Stripe is wired. Default: free. */
export async function getTier(): Promise<Tier> {
  const raw = await AsyncStorage.getItem(TIER_KEY);
  return raw === "pro" ? "pro" : "free";
}

export async function setTier(tier: Tier): Promise<void> {
  await AsyncStorage.setItem(TIER_KEY, tier);
}

export function tierLabel(tier: Tier): string {
  return tier === "pro" ? "Pro" : "Free";
}
