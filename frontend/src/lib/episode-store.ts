// Global Episode Mode state — persisted across app launches. A tiny
// subscription store keeps every component in sync without pulling in Zustand.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

const STORAGE_KEY = "syntax.episode.enabled";

type Listener = (enabled: boolean) => void;
let _enabled = false;
let _hydrated = false;
const _listeners = new Set<Listener>();

function emit() {
  for (const l of _listeners) l(_enabled);
}

async function hydrate() {
  if (_hydrated) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    _enabled = raw === "1";
  } catch { /* noop */ }
  _hydrated = true;
  emit();
}

export async function setEpisodeEnabled(next: boolean): Promise<void> {
  _enabled = next;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch { /* noop */ }
  emit();
}

export function getEpisodeEnabled(): boolean {
  return _enabled;
}

export function useEpisodeMode(): { enabled: boolean; toggle: () => void; setEnabled: (v: boolean) => void } {
  const [enabled, setEnabled] = useState<boolean>(_enabled);
  useEffect(() => {
    const listener: Listener = (v) => setEnabled(v);
    _listeners.add(listener);
    void hydrate();
    return () => { _listeners.delete(listener); };
  }, []);
  return {
    enabled,
    toggle: () => { void setEpisodeEnabled(!_enabled); },
    setEnabled: (v) => { void setEpisodeEnabled(v); },
  };
}
