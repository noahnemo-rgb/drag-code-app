import AsyncStorage from "@react-native-async-storage/async-storage";

const MAX_MRU = 20;

// Load a persisted MRU list of string ids. Newest first.
export async function loadMru(key: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string").slice(0, MAX_MRU) : [];
  } catch {
    return [];
  }
}

// Push an id to the top of the MRU (moving it if it was already present).
export async function pushMru(key: string, id: string): Promise<string[]> {
  const current = await loadMru(key);
  const next = [id, ...current.filter((x) => x !== id)].slice(0, MAX_MRU);
  await AsyncStorage.setItem(key, JSON.stringify(next));
  return next;
}

// Return a recency bonus (0..maxBonus) based on how far up an id is in the MRU list.
// idx 0 (most recent) → maxBonus. Not-in-list → 0.
export function recencyBonus(mru: string[], id: string, maxBonus = 15): number {
  const idx = mru.indexOf(id);
  if (idx === -1) return 0;
  const t = 1 - idx / Math.max(mru.length, 1);
  return Math.round(maxBonus * t);
}

// Sort a list of items by MRU rank (newest first), keeping non-MRU items in original order at the end.
export function sortByMru<T>(items: T[], mru: string[], getId: (item: T) => string): T[] {
  const rank = new Map<string, number>();
  mru.forEach((id, i) => rank.set(id, i));
  return [...items].sort((a, b) => {
    const ra = rank.has(getId(a)) ? (rank.get(getId(a)) as number) : Number.POSITIVE_INFINITY;
    const rb = rank.has(getId(b)) ? (rank.get(getId(b)) as number) : Number.POSITIVE_INFINITY;
    return ra - rb;
  });
}
