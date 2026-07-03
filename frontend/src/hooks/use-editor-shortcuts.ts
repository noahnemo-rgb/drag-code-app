import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Editor keyboard shortcuts + hardware-keyboard detection.
 *
 * Web / desktop: wires DOM `keydown` events for Cmd/Ctrl combos.
 * iOS / Android: uses `Keyboard.addListener` as a heuristic — if a `TextInput`
 * gains focus but the soft keyboard never comes up, we conclude the user is
 * on a hardware / Bluetooth keyboard. When that's the case, the OS already
 * suppresses the on-screen keyboard for us (no extra code needed).
 *
 * The caller passes action handlers; we return a boolean indicating whether
 * a hardware keyboard appears to be attached.
 */
export interface EditorShortcutHandlers {
  onFind: () => void;
  onSave: () => void;
  onRun: () => void;
  onEscape: () => void;
  onAi?: () => void;
}

export function useEditorShortcuts(handlers: EditorShortcutHandlers): boolean {
  const [hwKeyboard, setHwKeyboard] = useState<boolean>(Platform.OS === "web");

  // --- Native: watch soft-keyboard events to infer hardware keyboard ---
  useEffect(() => {
    if (Platform.OS === "web") return;

    const show = Keyboard.addListener("keyboardDidShow", () => setHwKeyboard(false));
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      // On hide we don't flip to `true` immediately — the user may just have
      // dismissed the soft keyboard temporarily. Detection remains sticky
      // until we actually observe a soft keyboard appear again.
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // --- Web: bind DOM keydown for real Cmd/Ctrl shortcuts ---
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // Cmd/Ctrl + F → Find
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        handlers.onFind();
        return;
      }
      // Cmd/Ctrl + S → Save (autosave — provide confirmation feedback)
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handlers.onSave();
        return;
      }
      // Cmd/Ctrl + Enter → Run
      if (mod && (e.key === "Enter" || e.key === "Return")) {
        e.preventDefault();
        handlers.onRun();
        return;
      }
      // Cmd/Ctrl + K → AI assistant
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        handlers.onAi?.();
        return;
      }
      // Escape → close find bar / dismiss modals
      if (e.key === "Escape") {
        handlers.onEscape();
        return;
      }
    };
    // Use capture so we get the event before the TextInput swallows it.
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [handlers]);

  return hwKeyboard;
}
