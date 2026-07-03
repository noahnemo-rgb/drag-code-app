import { Feather } from "@expo/vector-icons";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Linking,
  Modal,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TextInputSelectionChangeEventData,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { FileItem, Language, Project, Snippet } from "@/src/lib/api";
import { highlightLine, PALETTE } from "@/src/lib/highlight";
import { store } from "@/src/lib/store";
import { settings, SyncMode } from "@/src/lib/storage";
import { fuzzyScore } from "@/src/lib/fuzzy";
import { useEditorShortcuts } from "@/src/hooks/use-editor-shortcuts";
import { COLORS, FONT, RADIUS, SPACING, TEXT } from "@/src/theme";

const EDITOR_FONT_SIZE = 13;
const EDITOR_LINE_HEIGHT = 20;
const GUTTER_WIDTH = 44;

const LANGS: { key: Language; label: string; ext: string }[] = [
  { key: "javascript", label: "JavaScript", ext: "js" },
  { key: "typescript", label: "TypeScript", ext: "ts" },
  { key: "python", label: "Python", ext: "py" },
  { key: "html", label: "HTML", ext: "html" },
  { key: "css", label: "CSS", ext: "css" },
];

const SYMBOLS = ["{", "}", "(", ")", "[", "]", "<", ">", ";", ":", "=", "+", "-", "*", "/", "\"", "'", "`", ",", ".", "!", "?", "&", "|", "#", "$", "@", "%"];

const SHORTCUTS: { label: string; combo: string }[] = [
  { label: "Find in file", combo: "⌘ + F" },
  { label: "Save", combo: "⌘ + S" },
  { label: "Run", combo: "⌘ + Enter" },
  { label: "AI assistant", combo: "⌘ + K" },
  { label: "Quick file switcher", combo: "⌘ + P" },
  { label: "Shortcuts sheet", combo: "⌘ + /" },
  { label: "Close overlay", combo: "Esc" },
];

const EXT_TO_LANG: Record<string, Language> = {
  js: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python",
  html: "html", htm: "html",
  css: "css",
};

const inferLang = (name: string): Language => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? "javascript";
};

const starterFor = (lang: Language): string => {
  switch (lang) {
    case "python": return "print('Hello from Syntax IDE')\n";
    case "javascript": return "console.log('Hello from Syntax IDE');\n";
    case "typescript": return "const greeting: string = 'Hello from Syntax IDE';\nconsole.log(greeting);\n";
    case "html": return "<!doctype html>\n<html>\n  <body>\n    <h1>Hello Syntax IDE</h1>\n  </body>\n</html>\n";
    case "css": return "body {\n  background: #111;\n  color: #FFB000;\n}\n";
  }
};

export default function EditorScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [syncMode, setSyncMode] = useState<SyncMode>("local");
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [savedContent, setSavedContent] = useState<string>("");
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const [hasSelection, setHasSelection] = useState<boolean>(false);
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number } | undefined>(undefined);
  const inputRef = useRef<TextInput>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [running, setRunning] = useState<boolean>(false);
  const [runOutput, setRunOutput] = useState<{ stdout: string; stderr: string; ok: boolean } | null>(null);

  // Drawer
  const drawerX = useRef(new Animated.Value(-Dimensions.get("window").width * 0.85)).current;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerWidth = Math.min(320, Dimensions.get("window").width * 0.85);

  // Sheets & modals
  const runSheetRef = useRef<BottomSheetModal>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [showNewFile, setShowNewFile] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileLang, setNewFileLang] = useState<Language>("javascript");
  const [newProjectName, setNewProjectName] = useState("");
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showBtInfo, setShowBtInfo] = useState(false);
  const [savedToast, setSavedToast] = useState<boolean>(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showQuickFile, setShowQuickFile] = useState(false);
  const [quickFileQuery, setQuickFileQuery] = useState("");
  const [quickFileIndex, setQuickFileIndex] = useState(0);
  const [snippetsCache, setSnippetsCache] = useState<Snippet[]>([]);

  const activeFile = useMemo(() => files.find((f) => f.id === activeFileId) ?? null, [files, activeFileId]);

  type QuickResult =
    | { kind: "file"; file: FileItem; score: number }
    | { kind: "line"; file: FileItem; line: number; text: string; score: number }
    | { kind: "snippet"; snippet: Snippet; score: number };

  const quickResults = useMemo<QuickResult[]>(() => {
    const q = quickFileQuery.trim();
    // Empty query → just show files (fast + focused)
    if (!q) {
      return files.slice(0, 30).map((file) => ({ kind: "file" as const, file, score: 0 }));
    }

    const results: QuickResult[] = [];

    // 1) File-name fuzzy matches
    for (const f of files) {
      const s = fuzzyScore(q, f.name);
      if (s >= 0) results.push({ kind: "file", file: f, score: s + 20 }); // bias file names higher
    }

    // 2) File-content substring matches (case-insensitive, per line)
    const needle = q.toLowerCase();
    for (const f of files) {
      if (!f.content) continue;
      const lines = f.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const idx = lines[i].toLowerCase().indexOf(needle);
        if (idx === -1) continue;
        // Score: base + boundary bonus + shorter-line bonus
        let score = 30;
        if (idx === 0 || /[\s({[\-.]/.test(lines[i][idx - 1] ?? "")) score += 5;
        score += Math.max(0, 15 - Math.floor(lines[i].length / 8));
        results.push({ kind: "line", file: f, line: i + 1, text: lines[i], score });
      }
    }

    // 3) Snippet-title fuzzy matches
    for (const s of snippetsCache) {
      const titleScore = fuzzyScore(q, s.title);
      if (titleScore >= 0) {
        results.push({ kind: "snippet", snippet: s, score: titleScore + 5 });
        continue;
      }
      // Also consider description / tags
      const inDesc = s.description && s.description.toLowerCase().includes(needle);
      const inTags = s.tags?.some((t) => t.toLowerCase().includes(needle));
      if (inDesc || inTags) {
        results.push({ kind: "snippet", snippet: s, score: 12 });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 40);
  }, [files, snippetsCache, quickFileQuery]);

  useEffect(() => {
    setQuickFileIndex(0);
  }, [quickFileQuery]);

  // Prefetch snippets when the switcher opens so the palette can search them.
  useEffect(() => {
    if (!showQuickFile) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await (await import("@/src/lib/api")).api.listSnippets();
        if (!cancelled) setSnippetsCache(list);
      } catch {
        // network error — palette still works with files only
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showQuickFile]);

  // Load projects & restore state on mount
  useEffect(() => {
    (async () => {
      const mode = await settings.getSyncMode();
      setSyncMode(mode);
      await refreshProjects(mode);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshProjects = useCallback(async (mode: SyncMode) => {
    setLoading(true);
    try {
      let list = await store.listProjects(mode);
      if (list.length === 0) {
        // Seed a default project + file
        const p = await store.createProject(mode, "Welcome");
        const f = await store.createFile(mode, {
          project_id: p.id,
          name: "hello.py",
          language: "python",
          content: starterFor("python"),
        });
        list = [p];
        setFiles([f]);
        setActiveProjectId(p.id);
        setActiveFileId(f.id);
        setContent(f.content);
        setSavedContent(f.content);
      }
      setProjects(list);
      // Restore active project
      const savedProj = await settings.getActiveProject();
      const proj = list.find((p) => p.id === savedProj) ?? list[0];
      if (proj) {
        setActiveProjectId(proj.id);
        const projFiles = await store.listFiles(mode, proj.id);
        setFiles(projFiles);
        const savedFile = await settings.getActiveFile();
        const f = projFiles.find((x) => x.id === savedFile) ?? projFiles[0] ?? null;
        setActiveFileId(f?.id ?? null);
        setContent(f?.content ?? "");
        setSavedContent(f?.content ?? "");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const switchMode = useCallback(async (mode: SyncMode) => {
    setSyncMode(mode);
    await settings.setSyncMode(mode);
    Haptics.selectionAsync();
    await refreshProjects(mode);
  }, [refreshProjects]);

  const selectProject = useCallback(async (projectId: string) => {
    setActiveProjectId(projectId);
    await settings.setActiveProject(projectId);
    const projFiles = await store.listFiles(syncMode, projectId);
    setFiles(projFiles);
    const f = projFiles[0] ?? null;
    setActiveFileId(f?.id ?? null);
    setContent(f?.content ?? "");
    setSavedContent(f?.content ?? "");
    await settings.setActiveFile(f?.id ?? null);
  }, [syncMode]);

  const selectFile = useCallback(async (fileId: string) => {
    // save current first
    if (activeFile && content !== savedContent) {
      await store.updateFile(syncMode, activeFile.id, { content });
    }
    const f = files.find((x) => x.id === fileId) ?? null;
    setActiveFileId(fileId);
    setContent(f?.content ?? "");
    setSavedContent(f?.content ?? "");
    selectionRef.current = { start: 0, end: 0 };
    setForcedSelection({ start: 0, end: 0 });
    setTimeout(() => setForcedSelection(undefined), 50);
    await settings.setActiveFile(fileId);
    closeDrawer();
  }, [activeFile, content, savedContent, syncMode, files]);

  // Autosave when content changes (debounced)
  useEffect(() => {
    if (!activeFile) return;
    if (content === savedContent) return;
    const t = setTimeout(async () => {
      await store.updateFile(syncMode, activeFile.id, { content });
      setSavedContent(content);
    }, 700);
    return () => clearTimeout(t);
  }, [content, savedContent, activeFile, syncMode]);

  const openDrawer = () => {
    setDrawerOpen(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.timing(drawerX, { toValue: 0, duration: 220, useNativeDriver: Platform.OS !== "web" }).start();
  };
  const closeDrawer = () => {
    Animated.timing(drawerX, { toValue: -drawerWidth, duration: 200, useNativeDriver: Platform.OS !== "web" }).start(() => setDrawerOpen(false));
  };

  const insertSymbol = (sym: string) => {
    insertAtCursor(sym);
  };

  const insertAtCursor = (text: string) => {
    setContent((c) => {
      const sel = selectionRef.current;
      const s = Math.max(0, Math.min(sel.start, c.length));
      const e = Math.max(s, Math.min(sel.end, c.length));
      const next = c.slice(0, s) + text + c.slice(e);
      const newPos = s + text.length;
      setForcedSelection({ start: newPos, end: newPos });
      selectionRef.current = { start: newPos, end: newPos };
      // Release control after applying, so the user can move the cursor freely again.
      setTimeout(() => setForcedSelection(undefined), 50);
      return next;
    });
  };

  const jumpToLineInActiveFile = (line1Based: number) => {
    // Compute the absolute character offset for the target line in the current content.
    const lines = content.split("\n");
    const target = Math.max(0, Math.min(line1Based - 1, lines.length - 1));
    let offset = 0;
    for (let i = 0; i < target; i++) offset += lines[i].length + 1;
    const endOfLine = offset + (lines[target]?.length ?? 0);
    selectionRef.current = { start: offset, end: endOfLine };
    setForcedSelection({ start: offset, end: endOfLine });
    setTimeout(() => setForcedSelection(undefined), 60);
  };

  const openQuickResult = async (r: QuickResult) => {
    setShowQuickFile(false);
    if (r.kind === "file") {
      await selectFile(r.file.id);
      return;
    }
    if (r.kind === "line") {
      if (r.file.id !== activeFileId) {
        await selectFile(r.file.id);
        setTimeout(() => jumpToLineInActiveFile(r.line), 120);
      } else {
        jumpToLineInActiveFile(r.line);
      }
      return;
    }
    if (r.kind === "snippet") {
      insertAtCursor(r.snippet.code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };


  // When returning from AI screen or Snippets, apply any pending "insert at cursor" payload
  // after the file has finished loading (avoid the load overwriting our insertion).
  const pendingInsertRef = useRef<string | null>(null);
  const loadingRef = useRef<boolean>(true);
  const activeFileIdRef = useRef<string | null>(null);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  useEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);

  const tryApplyPending = useCallback(() => {
    const pending = pendingInsertRef.current;
    if (!pending) return;
    if (loadingRef.current) return;
    if (!activeFileIdRef.current) return;
    pendingInsertRef.current = null;
    insertAtCursor(pending);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const pending = await AsyncStorage.getItem("syntax.pending_insert");
        if (!cancelled && pending) {
          await AsyncStorage.removeItem("syntax.pending_insert");
          pendingInsertRef.current = pending;
          // Fires immediately if the file is already loaded (returning from a pushed screen).
          tryApplyPending();
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [tryApplyPending]),
  );

  useEffect(() => {
    // Also try when initial load completes for the first time.
    tryApplyPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, activeFileId]);

  const explainSelection = async () => {
    if (!activeFile) return;
    const sel = selectionRef.current;
    if (sel.end <= sel.start) return;
    const snippet = content.slice(sel.start, sel.end);
    const prompt = `Explain what the following ${activeFile.language} code does. Be concise and use bullet points.\n\n\`\`\`${activeFile.language}\n${snippet}\n\`\`\``;
    await AsyncStorage.setItem("syntax.pending_prompt", prompt);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/ai");
  };

  const openBluetoothSettings = async () => {
    Haptics.selectionAsync();
    try {
      if (Platform.OS === "android") {
        // Direct deep-link to the Android system Bluetooth settings screen.
        await Linking.sendIntent("android.settings.BLUETOOTH_SETTINGS");
        return;
      }
      if (Platform.OS === "ios") {
        // iOS blocks apps from opening OS Bluetooth settings directly.
        // Open the app's Settings page (best available) and show a hint modal.
        setShowBtInfo(true);
        await Linking.openSettings();
        return;
      }
      // Web / other — no BT capability, just show the info modal.
      setShowBtInfo(true);
    } catch {
      setShowBtInfo(true);
    }
  };

  const runCurrent = async () => {
    if (!activeFile) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    // Save first
    if (content !== savedContent) {
      await store.updateFile(syncMode, activeFile.id, { content });
      setSavedContent(content);
    }
    setRunning(true);
    setRunOutput(null);
    setPreviewHtml(null);
    runSheetRef.current?.present();
    try {
      if (activeFile.language === "html") {
        setPreviewHtml(content);
        setRunOutput({ stdout: "Rendering preview...", stderr: "", ok: true });
      } else {
        const res = await (await import("@/src/lib/api")).api.runCode(activeFile.language, content);
        setRunOutput({ stdout: res.stdout, stderr: res.stderr, ok: res.exit_code === 0 });
      }
    } catch (e: unknown) {
      setRunOutput({ stdout: "", stderr: String(e), ok: false });
    } finally {
      setRunning(false);
    }
  };

  const doCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    const p = await store.createProject(syncMode, name);
    setNewProjectName("");
    setShowNewProject(false);
    setProjects((prev) => [p, ...prev]);
    await selectProject(p.id);
  };

  // ---- Keyboard shortcuts + hardware-keyboard detection ----
  const hwKeyboard = useEditorShortcuts({
    onFind: () => setFindOpen(true),
    onSave: async () => {
      if (!activeFile) return;
      if (content !== savedContent) {
        await store.updateFile(syncMode, activeFile.id, { content });
        setSavedContent(content);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1200);
    },
    onRun: () => {
      void runCurrent();
    },
    onEscape: () => {
      if (showQuickFile) setShowQuickFile(false);
      else if (showShortcuts) setShowShortcuts(false);
      else if (findOpen) closeFind();
      else if (showLangMenu) setShowLangMenu(false);
      else if (showNewFile) setShowNewFile(false);
      else if (showNewProject) setShowNewProject(false);
      else if (showBtInfo) setShowBtInfo(false);
    },
    onAi: () => router.push("/ai"),
    onShortcuts: () => setShowShortcuts(true),
    onQuickFile: () => {
      setQuickFileQuery("");
      setQuickFileIndex(0);
      setShowQuickFile(true);
    },
  });

  const doCreateFile = async () => {
    if (!activeProjectId) return;
    const name = newFileName.trim();
    if (!name) return;
    const finalName = name.includes(".") ? name : `${name}.${LANGS.find((l) => l.key === newFileLang)?.ext ?? "txt"}`;
    const lang = inferLang(finalName) ?? newFileLang;
    const f = await store.createFile(syncMode, {
      project_id: activeProjectId,
      name: finalName,
      language: lang,
      content: starterFor(lang),
    });
    setFiles((prev) => [...prev, f].sort((a, b) => a.name.localeCompare(b.name)));
    setNewFileName("");
    setShowNewFile(false);
    setActiveFileId(f.id);
    setContent(f.content);
    setSavedContent(f.content);
    await settings.setActiveFile(f.id);
  };

  const doDeleteFile = async (id: string) => {
    await store.deleteFile(syncMode, id);
    const remaining = files.filter((f) => f.id !== id);
    setFiles(remaining);
    if (activeFileId === id) {
      const next = remaining[0] ?? null;
      setActiveFileId(next?.id ?? null);
      setContent(next?.content ?? "");
      setSavedContent(next?.content ?? "");
      await settings.setActiveFile(next?.id ?? null);
    }
  };

  const doDeleteProject = async (id: string) => {
    await store.deleteProject(syncMode, id);
    const remaining = projects.filter((p) => p.id !== id);
    setProjects(remaining);
    if (activeProjectId === id) {
      const next = remaining[0] ?? null;
      if (next) await selectProject(next.id);
      else {
        setActiveProjectId(null);
        setFiles([]);
        setActiveFileId(null);
        setContent("");
      }
    }
  };

  const changeLanguage = async (lang: Language) => {
    setShowLangMenu(false);
    if (!activeFile) return;
    await store.updateFile(syncMode, activeFile.id, { language: lang });
    setFiles((prev) => prev.map((f) => (f.id === activeFile.id ? { ...f, language: lang } : f)));
  };

  // ---- Find & Replace ----
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);

  const matches = useMemo<{ start: number; end: number }[]>(() => {
    if (!findQuery) return [];
    const out: { start: number; end: number }[] = [];
    const hay = caseSensitive ? content : content.toLowerCase();
    const needle = caseSensitive ? findQuery : findQuery.toLowerCase();
    if (!needle) return out;
    let i = 0;
    while (i <= hay.length - needle.length) {
      const idx = hay.indexOf(needle, i);
      if (idx === -1) break;
      out.push({ start: idx, end: idx + needle.length });
      i = idx + needle.length;
    }
    return out;
  }, [content, findQuery, caseSensitive]);

  const jumpToMatch = useCallback(
    (i: number) => {
      if (matches.length === 0) return;
      const safe = ((i % matches.length) + matches.length) % matches.length;
      setMatchIndex(safe);
      const m = matches[safe];
      selectionRef.current = { start: m.start, end: m.end };
      setForcedSelection({ start: m.start, end: m.end });
      setTimeout(() => setForcedSelection(undefined), 60);
    },
    [matches],
  );

  useEffect(() => {
    // Reset index when matches change
    if (matches.length === 0) {
      setMatchIndex(0);
      return;
    }
    if (matchIndex >= matches.length) setMatchIndex(0);
  }, [matches, matchIndex]);

  const replaceCurrent = () => {
    if (matches.length === 0) return;
    const m = matches[matchIndex];
    setContent((c) => c.slice(0, m.start) + replaceQuery + c.slice(m.end));
    const newPos = m.start + replaceQuery.length;
    selectionRef.current = { start: newPos, end: newPos };
    setForcedSelection({ start: newPos, end: newPos });
    setTimeout(() => setForcedSelection(undefined), 60);
  };

  const replaceAll = () => {
    if (matches.length === 0) return;
    // Rebuild content in one pass since matches are non-overlapping and sorted.
    let out = "";
    let cursor = 0;
    for (const m of matches) {
      out += content.slice(cursor, m.start) + replaceQuery;
      cursor = m.end;
    }
    out += content.slice(cursor);
    setContent(out);
    setMatchIndex(0);
  };

  const closeFind = () => {
    setFindOpen(false);
    setFindQuery("");
    setReplaceQuery("");
    setMatchIndex(0);
  };

  const lines = content.length ? content.split("\n") : [""];
  const lang: Language = activeFile?.language ?? "javascript";

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.6} pressBehavior="close" />
    ),
    [],
  );

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header} testID="editor-header">
        <Pressable onPress={openDrawer} style={styles.iconBtn} testID="open-drawer-btn" hitSlop={8}>
          <Feather name="menu" size={22} color={COLORS.onSurface} />
        </Pressable>
        <Pressable style={styles.filenameWrap} onPress={() => setShowLangMenu(true)} testID="filename-lang-picker">
          <Text style={styles.filename} numberOfLines={1} testID="active-filename">
            {activeFile?.name ?? "No file"}
          </Text>
          <View style={styles.filenameSubRow}>
            <Text style={styles.langLabel}>{LANGS.find((l) => l.key === lang)?.label ?? "—"}</Text>
            {hwKeyboard ? (
              <View style={styles.hwBadge} testID="hw-keyboard-badge">
                <Text style={styles.hwBadgeLabel}>HW ⌘</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
        <Pressable onPress={() => router.push("/snippets")} style={styles.iconBtn} testID="open-snippets-btn" hitSlop={8}>
          <Feather name="package" size={20} color={COLORS.onSurface} />
        </Pressable>
        <Pressable onPress={() => setFindOpen((v) => !v)} style={styles.iconBtn} testID="toggle-find-btn" hitSlop={8}>
          <Feather name="search" size={20} color={findOpen ? COLORS.brand : COLORS.onSurface} />
        </Pressable>
        <Pressable onPress={() => router.push("/ai")} style={styles.iconBtn} testID="open-ai-btn" hitSlop={8}>
          <Feather name="cpu" size={20} color={COLORS.onSurface} />
        </Pressable>
        <Pressable
          onPress={runCurrent}
          disabled={!activeFile || running}
          style={[styles.runBtn, (!activeFile || running) && { opacity: 0.5 }]}
          testID="run-code-btn"
        >
          {running ? (
            <ActivityIndicator size="small" color={COLORS.onBrand} />
          ) : (
            <Feather name="play" size={16} color={COLORS.onBrand} />
          )}
          <Text style={styles.runBtnLabel}>Run</Text>
        </Pressable>
      </View>

      {/* Find & Replace bar */}
      {findOpen ? (
        <View style={styles.findBar} testID="find-bar">
          <View style={styles.findRow}>
            <Feather name="search" size={14} color={COLORS.onSurfaceSecondary} />
            <TextInput
              value={findQuery}
              onChangeText={setFindQuery}
              placeholder="Find"
              placeholderTextColor={COLORS.onSurfaceSecondary}
              style={styles.findInput}
              autoCapitalize="none"
              autoCorrect={false}
              testID="find-input"
            />
            <Text style={styles.findCount} testID="find-count">
              {matches.length === 0 ? "0/0" : `${matchIndex + 1}/${matches.length}`}
            </Text>
            <Pressable
              onPress={() => setCaseSensitive((v) => !v)}
              style={[styles.findMiniBtn, caseSensitive && styles.findMiniBtnActive]}
              testID="case-toggle"
              hitSlop={6}
            >
              <Text style={[styles.findMiniLabel, caseSensitive && { color: COLORS.brand }]}>Aa</Text>
            </Pressable>
            <Pressable
              onPress={() => jumpToMatch(matchIndex - 1)}
              disabled={matches.length === 0}
              style={[styles.findIconBtn, matches.length === 0 && { opacity: 0.4 }]}
              testID="find-prev"
              hitSlop={6}
            >
              <Feather name="chevron-up" size={16} color={COLORS.onSurface} />
            </Pressable>
            <Pressable
              onPress={() => jumpToMatch(matchIndex + 1)}
              disabled={matches.length === 0}
              style={[styles.findIconBtn, matches.length === 0 && { opacity: 0.4 }]}
              testID="find-next"
              hitSlop={6}
            >
              <Feather name="chevron-down" size={16} color={COLORS.onSurface} />
            </Pressable>
            <Pressable onPress={closeFind} style={styles.findIconBtn} testID="find-close" hitSlop={6}>
              <Feather name="x" size={16} color={COLORS.onSurface} />
            </Pressable>
          </View>
          <View style={styles.findRow}>
            <Feather name="corner-down-right" size={14} color={COLORS.onSurfaceSecondary} />
            <TextInput
              value={replaceQuery}
              onChangeText={setReplaceQuery}
              placeholder="Replace"
              placeholderTextColor={COLORS.onSurfaceSecondary}
              style={styles.findInput}
              autoCapitalize="none"
              autoCorrect={false}
              testID="replace-input"
            />
            <Pressable
              onPress={replaceCurrent}
              disabled={matches.length === 0}
              style={[styles.findActionBtn, matches.length === 0 && { opacity: 0.4 }]}
              testID="replace-one-btn"
            >
              <Text style={styles.findActionLabel}>Replace</Text>
            </Pressable>
            <Pressable
              onPress={replaceAll}
              disabled={matches.length === 0}
              style={[styles.findActionBtn, matches.length === 0 && { opacity: 0.4 }]}
              testID="replace-all-btn"
            >
              <Text style={styles.findActionLabel}>All</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Editor */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={COLORS.brand} />
          </View>
        ) : !activeFile ? (
          <View style={styles.centerFill}>
            <Feather name="file-plus" size={40} color={COLORS.brand} />
            <Text style={styles.emptyTitle}>No file open</Text>
            <Text style={styles.emptySub}>Open a file from the explorer to start coding.</Text>
            <Pressable onPress={openDrawer} style={styles.primaryBtn} testID="open-explorer-cta">
              <Text style={styles.primaryBtnLabel}>Toggle Explorer</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            style={styles.editorScroll}
            contentContainerStyle={{ paddingBottom: SPACING.xl }}
            horizontal={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.editorRow}>
              {/* Gutter */}
              <View style={styles.gutter}>
                {lines.map((_, i) => (
                  <Text key={i} style={styles.gutterNum}>
                    {i + 1}
                  </Text>
                ))}
              </View>
              {/* Editor area with overlay highlight */}
              <View style={styles.editArea}>
                <View style={styles.highlightLayer}>
                  {lines.map((line, i) => (
                    <Text key={i} style={styles.codeLine} allowFontScaling={false}>
                      {highlightLine(line, lang).map((s, j) => (
                        <Text key={j} style={{ color: s.color }}>
                          {s.text}
                        </Text>
                      ))}
                      {line === "" ? " " : ""}
                    </Text>
                  ))}
                </View>
                <TextInput
                  ref={inputRef}
                  style={styles.input}
                  value={content}
                  onChangeText={setContent}
                  onSelectionChange={(e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
                    const s = e.nativeEvent.selection;
                    selectionRef.current = s;
                    setHasSelection(s.end > s.start);
                  }}
                  selection={forcedSelection}
                  multiline
                  autoCorrect={false}
                  autoCapitalize="none"
                  spellCheck={false}
                  keyboardType="default"
                  selectionColor={COLORS.brand}
                  textAlignVertical="top"
                  testID="code-input"
                  scrollEnabled={false}
                />
              </View>
            </View>
          </ScrollView>
        )}

        {/* Explain selection pill */}
        {activeFile && hasSelection ? (
          <View style={styles.explainPillWrap} pointerEvents="box-none">
            <Pressable onPress={explainSelection} style={styles.explainPill} testID="explain-selection-btn">
              <Feather name="cpu" size={14} color={COLORS.onBrand} />
              <Text style={styles.explainPillLabel}>Explain with AI</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Saved toast (fires on Cmd/Ctrl+S) */}
        {savedToast ? (
          <View style={styles.savedToast} pointerEvents="none" testID="saved-toast">
            <Feather name="check" size={14} color={COLORS.onBrand} />
            <Text style={styles.savedToastLabel}>Saved</Text>
          </View>
        ) : null}

        {/* Symbol strip */}
        {activeFile ? (
          <View style={styles.symbolStripWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.symbolStripContent}
              testID="symbol-strip"
            >
              {SYMBOLS.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => insertSymbol(s)}
                  style={styles.symbolChip}
                  testID={`symbol-${s}`}
                >
                  <Text style={styles.symbolText}>{s}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => insertSymbol("  ")} style={styles.symbolChip} testID="symbol-tab">
                <Text style={styles.symbolText}>Tab</Text>
              </Pressable>
            </ScrollView>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      {/* Drawer overlay */}
      {drawerOpen ? (
        <Pressable style={styles.drawerBackdrop} onPress={closeDrawer} testID="drawer-backdrop" />
      ) : null}
      <Animated.View
        style={[
          styles.drawer,
          { width: drawerWidth, transform: [{ translateX: drawerX }], paddingTop: insets.top + SPACING.md, paddingBottom: insets.bottom + SPACING.md },
        ]}
        testID="file-explorer"
      >
        <View style={styles.drawerHeader}>
          <Text style={styles.drawerTitle}>Syntax IDE</Text>
          <Pressable onPress={closeDrawer} style={styles.iconBtn} testID="close-drawer-btn">
            <Feather name="x" size={20} color={COLORS.onSurface} />
          </Pressable>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: SPACING.lg }}>
          <View style={styles.drawerSection}>
            <View style={styles.drawerSectionHead}>
              <Text style={styles.drawerSectionTitle}>Projects</Text>
              <Pressable onPress={() => setShowNewProject(true)} style={styles.ghostBtn} testID="new-project-btn">
                <Feather name="plus" size={14} color={COLORS.brand} />
                <Text style={styles.ghostBtnLabel}>New</Text>
              </Pressable>
            </View>
            {projects.map((p) => {
              const isActive = p.id === activeProjectId;
              return (
                <View key={p.id} style={styles.projectRow}>
                  <Pressable
                    onPress={() => selectProject(p.id)}
                    style={[styles.projectItem, isActive && styles.projectItemActive]}
                    testID={`project-${p.id}`}
                  >
                    <Feather name="folder" size={14} color={isActive ? COLORS.brand : COLORS.onSurfaceSecondary} />
                    <Text style={[styles.projectName, isActive && { color: COLORS.brand }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => doDeleteProject(p.id)} hitSlop={8} testID={`delete-project-${p.id}`}>
                    <Feather name="trash-2" size={14} color={COLORS.onSurfaceSecondary} />
                  </Pressable>
                </View>
              );
            })}
          </View>

          <View style={styles.drawerSection}>
            <View style={styles.drawerSectionHead}>
              <Text style={styles.drawerSectionTitle}>Files</Text>
              <Pressable
                onPress={() => setShowNewFile(true)}
                style={[styles.ghostBtn, !activeProjectId && { opacity: 0.4 }]}
                disabled={!activeProjectId}
                testID="new-file-btn"
              >
                <Feather name="plus" size={14} color={COLORS.brand} />
                <Text style={styles.ghostBtnLabel}>New</Text>
              </Pressable>
            </View>
            {files.length === 0 ? (
              <Text style={styles.emptyMuted}>No files in this project.</Text>
            ) : (
              files.map((f) => {
                const isActive = f.id === activeFileId;
                return (
                  <Pressable
                    key={f.id}
                    onPress={() => selectFile(f.id)}
                    style={[styles.fileItem, isActive && styles.fileItemActive]}
                    testID={`file-${f.id}`}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: SPACING.sm }}>
                      <Feather name="file" size={13} color={isActive ? COLORS.brand : COLORS.onSurfaceSecondary} />
                      <Text style={[styles.fileName, isActive && { color: COLORS.brand }]} numberOfLines={1}>
                        {f.name}
                      </Text>
                    </View>
                    <Pressable onPress={() => doDeleteFile(f.id)} hitSlop={8} testID={`delete-file-${f.id}`}>
                      <Feather name="trash-2" size={13} color={COLORS.onSurfaceSecondary} />
                    </Pressable>
                  </Pressable>
                );
              })
            )}
          </View>
        </ScrollView>

        <View style={styles.drawerFooter}>
          <Pressable
            onPress={openBluetoothSettings}
            style={styles.btBtn}
            testID="connect-bt-keyboard-btn"
          >
            <Feather name="bluetooth" size={16} color={COLORS.brand} />
            <View style={{ flex: 1 }}>
              <Text style={styles.footerLabel}>Bluetooth keyboard</Text>
              <Text style={styles.footerSub} numberOfLines={1}>
                {Platform.OS === "android"
                  ? "Open system Bluetooth settings"
                  : Platform.OS === "ios"
                  ? "Open Settings to pair"
                  : "Mobile only"}
              </Text>
            </View>
            <Feather name="external-link" size={14} color={COLORS.onSurfaceSecondary} />
          </Pressable>

          <View style={styles.drawerFooterRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.footerLabel}>Sync</Text>
              <Text style={styles.footerSub}>{syncMode === "cloud" ? "Cloud (MongoDB)" : "Local (device)"}</Text>
            </View>
            <Switch
              value={syncMode === "cloud"}
              onValueChange={(v) => switchMode(v ? "cloud" : "local")}
              trackColor={{ true: COLORS.brand, false: COLORS.surfaceTertiary }}
              thumbColor={COLORS.onSurface}
              testID="sync-toggle"
            />
          </View>
        </View>
      </Animated.View>

      {/* Run bottom sheet */}
      <BottomSheetModal
        ref={runSheetRef}
        snapPoints={["45%", "85%"]}
        backgroundStyle={{ backgroundColor: COLORS.surfaceSecondary }}
        handleIndicatorStyle={{ backgroundColor: COLORS.borderStrong }}
        backdropComponent={renderBackdrop}
      >
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Console</Text>
          <Pressable
            onPress={() => {
              setRunOutput(null);
              setPreviewHtml(null);
            }}
            hitSlop={8}
            testID="clear-console-btn"
          >
            <Feather name="trash" size={16} color={COLORS.onSurfaceSecondary} />
          </Pressable>
        </View>
        {previewHtml ? (
          <View style={{ flex: 1, backgroundColor: "#ffffff" }} testID="html-preview">
            <WebView originWhitelist={["*"]} source={{ html: previewHtml }} style={{ flex: 1 }} />
          </View>
        ) : (
          <BottomSheetScrollView contentContainerStyle={styles.consoleBody}>
            {running ? (
              <Text style={styles.consoleMuted}>Executing…</Text>
            ) : runOutput ? (
              <>
                {runOutput.stdout ? <Text style={styles.consoleOut} testID="console-stdout">{runOutput.stdout}</Text> : null}
                {runOutput.stderr ? <Text style={styles.consoleErr} testID="console-stderr">{runOutput.stderr}</Text> : null}
                {!runOutput.stdout && !runOutput.stderr ? (
                  <Text style={styles.consoleMuted}>No output generated.</Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.consoleMuted}>Tap Run to execute the current file.</Text>
            )}
          </BottomSheetScrollView>
        )}
      </BottomSheetModal>

      {/* New project modal */}
      <PromptModal
        visible={showNewProject}
        title="New project"
        placeholder="Project name"
        value={newProjectName}
        onChange={setNewProjectName}
        onCancel={() => {
          setShowNewProject(false);
          setNewProjectName("");
        }}
        onConfirm={doCreateProject}
        confirmLabel="Create"
        testID="new-project-modal"
      />

      {/* New file modal */}
      <Modal
        visible={showNewFile}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNewFile(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowNewFile(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}} testID="new-file-modal">
            <Text style={styles.modalTitle}>New file</Text>
            <TextInput
              value={newFileName}
              onChangeText={setNewFileName}
              placeholder="e.g. main.py"
              placeholderTextColor={COLORS.onSurfaceSecondary}
              style={styles.modalInput}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              testID="new-file-name-input"
            />
            <Text style={styles.modalLabel}>Language</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm }}>
              {LANGS.map((l) => {
                const active = newFileLang === l.key;
                return (
                  <Pressable
                    key={l.key}
                    onPress={() => setNewFileLang(l.key)}
                    style={[styles.chip, active && styles.chipActive]}
                    testID={`lang-${l.key}`}
                  >
                    <Text style={[styles.chipLabel, active && { color: COLORS.brand }]}>{l.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setShowNewFile(false)} style={styles.secondaryBtn} testID="cancel-new-file">
                <Text style={styles.secondaryBtnLabel}>Cancel</Text>
              </Pressable>
              <Pressable onPress={doCreateFile} style={styles.primaryBtn} testID="confirm-new-file">
                <Text style={styles.primaryBtnLabel}>Create</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Bluetooth-keyboard info modal (shown when we can't deep-link directly, e.g. iOS or web) */}
      <Modal visible={showBtInfo} transparent animationType="fade" onRequestClose={() => setShowBtInfo(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowBtInfo(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}} testID="bt-info-modal">
            <Feather name="bluetooth" size={22} color={COLORS.brand} />
            <Text style={styles.modalTitle}>Pair a Bluetooth keyboard</Text>
            <Text style={styles.btInfoBody}>
              {Platform.OS === "ios"
                ? "iOS doesn't allow apps to open Bluetooth settings directly. Please open the Settings app and go to Bluetooth to pair your keyboard. Once paired, it will work everywhere in Syntax automatically."
                : Platform.OS === "web"
                ? "Bluetooth keyboard pairing is only available on physical iOS / Android devices. On desktop, pair via your OS Bluetooth panel."
                : "We couldn't open your Bluetooth settings automatically. Open your phone's Settings app and go to Bluetooth to pair your keyboard."}
            </Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setShowBtInfo(false)} style={styles.primaryBtn} testID="bt-info-ok-btn">
                <Text style={styles.primaryBtnLabel}>Got it</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Shortcuts cheat-sheet (⌘/) */}
      <Modal
        visible={showShortcuts}
        transparent
        animationType="fade"
        onRequestClose={() => setShowShortcuts(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowShortcuts(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}} testID="shortcuts-modal">
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.sm }}>
              <Feather name="command" size={22} color={COLORS.brand} />
              <Text style={styles.modalTitle}>Keyboard shortcuts</Text>
            </View>
            <View style={{ gap: SPACING.sm }}>
              {SHORTCUTS.map((s) => (
                <View key={s.combo} style={styles.shortcutRow}>
                  <Text style={styles.shortcutLabel}>{s.label}</Text>
                  <View style={styles.shortcutKeys}>
                    {s.combo.split("+").map((k, i) => (
                      <View key={i} style={styles.kbdKey}>
                        <Text style={styles.kbdKeyLabel}>{k.trim()}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
            <Text style={styles.shortcutHint}>Tip: On Windows / Linux, use Ctrl instead of ⌘.</Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setShowShortcuts(false)} style={styles.primaryBtn} testID="close-shortcuts-btn">
                <Text style={styles.primaryBtnLabel}>Close</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Quick file switcher (⌘P) */}
      <Modal
        visible={showQuickFile}
        transparent
        animationType="fade"
        onRequestClose={() => setShowQuickFile(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowQuickFile(false)}>
          <Pressable style={styles.quickFileCard} onPress={() => {}} testID="quick-file-modal">
            <View style={styles.quickFileHeader}>
              <Feather name="search" size={16} color={COLORS.onSurfaceSecondary} />
              <TextInput
                value={quickFileQuery}
                onChangeText={setQuickFileQuery}
                placeholder="Files, content, or snippets…"
                placeholderTextColor={COLORS.onSurfaceSecondary}
                style={styles.quickFileInput}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                testID="quick-file-input"
                onKeyPress={(e) => {
                  const k = (e.nativeEvent as { key?: string }).key ?? "";
                  if (k === "ArrowDown") {
                    setQuickFileIndex((i) => Math.min(i + 1, Math.max(quickResults.length - 1, 0)));
                  } else if (k === "ArrowUp") {
                    setQuickFileIndex((i) => Math.max(i - 1, 0));
                  } else if (k === "Enter" || k === "Return") {
                    const pick = quickResults[quickFileIndex];
                    if (pick) {
                      void openQuickResult(pick);
                    }
                  }
                }}
              />
              <Text style={styles.quickFileCount}>{quickResults.length}</Text>
            </View>
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              {quickResults.length === 0 ? (
                <Text style={styles.emptyMuted}>No matches</Text>
              ) : (
                quickResults.map((r, i) => {
                  const isCurrent = i === quickFileIndex;
                  const key = r.kind === "file"
                    ? `f-${r.file.id}`
                    : r.kind === "line"
                    ? `l-${r.file.id}-${r.line}`
                    : `s-${r.snippet.id}`;
                  const tid = r.kind === "file"
                    ? `quick-file-row-${r.file.id}`
                    : r.kind === "line"
                    ? `quick-line-row-${r.file.id}-${r.line}`
                    : `quick-snippet-row-${r.snippet.id}`;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => openQuickResult(r)}
                      style={[styles.quickFileRow, isCurrent && styles.quickFileRowActive]}
                      testID={tid}
                    >
                      <View style={styles.quickKindBadge}>
                        <Text style={styles.quickKindLabel}>
                          {r.kind === "file" ? "FILE" : r.kind === "line" ? "LINE" : "SNIP"}
                        </Text>
                      </View>
                      {r.kind === "file" ? (
                        <>
                          <Text
                            style={[styles.quickFileName, isCurrent && { color: COLORS.brand }]}
                            numberOfLines={1}
                          >
                            {r.file.name}
                          </Text>
                          <Text style={styles.quickFileLang}>{r.file.language}</Text>
                        </>
                      ) : r.kind === "line" ? (
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.quickLinePath} numberOfLines={1}>
                            <Text style={[isCurrent && { color: COLORS.brand }]}>{r.file.name}</Text>
                            <Text style={styles.quickLinePathDim}>:{r.line}</Text>
                          </Text>
                          <Text style={styles.quickLineSnippet} numberOfLines={1}>
                            {r.text.trim().slice(0, 80)}
                          </Text>
                        </View>
                      ) : (
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text
                            style={[styles.quickFileName, isCurrent && { color: COLORS.brand }]}
                            numberOfLines={1}
                          >
                            {r.snippet.title}
                          </Text>
                          <Text style={styles.quickLineSnippet} numberOfLines={1}>
                            by {r.snippet.author} · {r.snippet.language}
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Language picker modal (change lang of active file) */}
      <Modal visible={showLangMenu} transparent animationType="fade" onRequestClose={() => setShowLangMenu(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowLangMenu(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}} testID="lang-menu">
            <Text style={styles.modalTitle}>Language</Text>
            {LANGS.map((l) => {
              const active = lang === l.key;
              return (
                <Pressable
                  key={l.key}
                  onPress={() => changeLanguage(l.key)}
                  style={[styles.langRow, active && { backgroundColor: COLORS.brandTertiary }]}
                  testID={`change-lang-${l.key}`}
                >
                  <Text style={[styles.langRowText, active && { color: COLORS.brand }]}>{l.label}</Text>
                  {active ? <Feather name="check" size={16} color={COLORS.brand} /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function PromptModal(props: {
  visible: boolean;
  title: string;
  placeholder: string;
  value: string;
  onChange: (s: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  testID?: string;
}) {
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onCancel}>
      <Pressable style={styles.modalBackdrop} onPress={props.onCancel}>
        <Pressable style={styles.modalCard} onPress={() => {}} testID={props.testID}>
          <Text style={styles.modalTitle}>{props.title}</Text>
          <TextInput
            value={props.value}
            onChangeText={props.onChange}
            placeholder={props.placeholder}
            placeholderTextColor={COLORS.onSurfaceSecondary}
            style={styles.modalInput}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            testID="prompt-input"
          />
          <View style={styles.modalActions}>
            <Pressable onPress={props.onCancel} style={styles.secondaryBtn} testID="prompt-cancel">
              <Text style={styles.secondaryBtnLabel}>Cancel</Text>
            </Pressable>
            <Pressable onPress={props.onConfirm} style={styles.primaryBtn} testID="prompt-confirm">
              <Text style={styles.primaryBtnLabel}>{props.confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
  },
  iconBtn: {
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  filenameWrap: { flex: 1, alignItems: "center" },
  filenameSubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginTop: 1,
  },
  hwBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    backgroundColor: COLORS.brandTertiary,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.brand,
  },
  hwBadgeLabel: {
    color: COLORS.brand,
    fontSize: 9,
    fontFamily: FONT.mono,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  savedToast: {
    position: "absolute",
    top: SPACING.md,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.brand,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 20,
  },
  savedToastLabel: { color: COLORS.onBrand, fontWeight: "700", fontSize: TEXT.sm },

  shortcutRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  shortcutLabel: {
    color: COLORS.onSurface,
    fontSize: TEXT.base,
  },
  shortcutKeys: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
  },
  kbdKey: {
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceTertiary,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
  },
  kbdKeyLabel: {
    color: COLORS.onSurface,
    fontFamily: FONT.mono,
    fontSize: TEXT.sm - 1,
    fontWeight: "600",
  },
  shortcutHint: {
    color: COLORS.onSurfaceSecondary,
    fontSize: TEXT.sm,
    fontStyle: "italic",
  },

  quickFileCard: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  quickFileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  quickFileInput: {
    flex: 1,
    color: COLORS.onSurface,
    fontSize: TEXT.base,
    padding: 0,
  },
  quickFileCount: {
    color: COLORS.onSurfaceSecondary,
    fontFamily: FONT.mono,
    fontSize: TEXT.sm - 1,
  },
  quickFileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  quickFileRowActive: {
    backgroundColor: COLORS.brandTertiary,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.brand,
  },
  quickFileName: {
    flex: 1,
    color: COLORS.onSurface,
    fontFamily: FONT.mono,
    fontSize: TEXT.sm,
  },
  quickFileLang: {
    color: COLORS.onSurfaceSecondary,
    fontFamily: FONT.mono,
    fontSize: TEXT.sm - 2,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  quickKindBadge: {
    width: 40,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceTertiary,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
  },
  quickKindLabel: {
    color: COLORS.onSurfaceSecondary,
    fontFamily: FONT.mono,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
  },
  quickLinePath: {
    fontFamily: FONT.mono,
    fontSize: TEXT.sm,
    color: COLORS.onSurface,
  },
  quickLinePathDim: {
    color: COLORS.onSurfaceSecondary,
  },
  quickLineSnippet: {
    fontFamily: FONT.mono,
    fontSize: TEXT.sm - 1,
    color: COLORS.onSurfaceSecondary,
  },
  filename: {
    color: COLORS.onSurface,
    fontFamily: FONT.mono,
    fontSize: TEXT.base,
  },
  langLabel: {
    color: COLORS.onSurfaceSecondary,
    fontSize: TEXT.sm - 1,
  },
  runBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    backgroundColor: COLORS.brand,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
  },
  runBtnLabel: { color: COLORS.onBrand, fontWeight: "700", fontSize: TEXT.sm },

  findBar: {
    backgroundColor: COLORS.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    gap: SPACING.xs,
  },
  findRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
  },
  findInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    color: COLORS.onSurface,
    fontFamily: FONT.mono,
    fontSize: TEXT.sm,
  },
  findCount: {
    color: COLORS.onSurfaceSecondary,
    fontFamily: FONT.mono,
    fontSize: TEXT.sm - 1,
    minWidth: 40,
    textAlign: "right",
  },
  findMiniBtn: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceTertiary,
  },
  findMiniBtnActive: {
    backgroundColor: COLORS.brandTertiary,
  },
  findMiniLabel: { color: COLORS.onSurface, fontFamily: FONT.mono, fontSize: TEXT.sm },
  findIconBtn: {
    width: 28,
    height: 28,
    borderRadius: RADIUS.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceTertiary,
  },
  findActionBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceTertiary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  findActionLabel: { color: COLORS.onSurface, fontSize: TEXT.sm, fontWeight: "600" },

  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.md },
  emptyTitle: { color: COLORS.onSurface, fontSize: TEXT.lg, fontWeight: "600" },
  emptySub: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.base, textAlign: "center" },
  emptyMuted: {
    color: COLORS.onSurfaceSecondary,
    fontSize: TEXT.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },

  editorScroll: { flex: 1, backgroundColor: COLORS.surface },
  editorRow: { flexDirection: "row", minHeight: "100%" },
  gutter: {
    width: GUTTER_WIDTH,
    backgroundColor: COLORS.surfaceSecondary,
    paddingTop: SPACING.sm,
    paddingHorizontal: SPACING.xs,
    alignItems: "flex-end",
  },
  gutterNum: {
    color: COLORS.onSurfaceSecondary,
    fontFamily: FONT.mono,
    fontSize: EDITOR_FONT_SIZE - 1,
    lineHeight: EDITOR_LINE_HEIGHT,
  },
  editArea: {
    flex: 1,
    paddingTop: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    position: "relative",
  },
  highlightLayer: {
    position: "absolute",
    top: SPACING.sm,
    left: SPACING.sm,
    right: SPACING.sm,
    pointerEvents: "none",
  },
  codeLine: {
    fontFamily: FONT.mono,
    fontSize: EDITOR_FONT_SIZE,
    lineHeight: EDITOR_LINE_HEIGHT,
    color: PALETTE.text,
  },
  input: {
    fontFamily: FONT.mono,
    fontSize: EDITOR_FONT_SIZE,
    lineHeight: EDITOR_LINE_HEIGHT,
    color: "transparent",
    padding: 0,
    margin: 0,
    minHeight: 400,
  },

  symbolStripWrap: {
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    backgroundColor: COLORS.surfaceSecondary,
  },
  explainPillWrap: {
    alignItems: "center",
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  explainPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.brand,
  },
  explainPillLabel: { color: COLORS.onBrand, fontWeight: "700", fontSize: TEXT.sm },
  symbolStripContent: {
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    alignItems: "center",
  },
  symbolChip: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  symbolText: { color: COLORS.onSurface, fontFamily: FONT.mono, fontSize: TEXT.base },

  drawerBackdrop: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  drawer: {
    position: "absolute",
    top: 0, bottom: 0, left: 0,
    backgroundColor: COLORS.surfaceSecondary,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
    paddingHorizontal: SPACING.md,
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.md,
  },
  drawerTitle: { color: COLORS.brand, fontSize: TEXT.lg, fontWeight: "700", letterSpacing: 0.5 },
  drawerSection: { marginTop: SPACING.md },
  drawerSectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.sm,
  },
  drawerSectionTitle: {
    color: COLORS.onSurfaceSecondary,
    fontSize: TEXT.sm,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
  },
  ghostBtnLabel: { color: COLORS.brand, fontSize: TEXT.sm, fontWeight: "700" },
  projectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingVertical: 2,
  },
  projectItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm,
  },
  projectItemActive: {
    backgroundColor: COLORS.brandTertiary,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.brand,
  },
  projectName: { color: COLORS.onSurface, fontSize: TEXT.base, flex: 1 },
  fileItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm,
  },
  fileItemActive: {
    backgroundColor: COLORS.brandTertiary,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.brand,
  },
  fileName: { color: COLORS.onSurface, fontSize: TEXT.sm, fontFamily: FONT.mono, flex: 1 },
  drawerFooter: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.md,
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  drawerFooterRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  btBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.brandTertiary,
    borderWidth: 1,
    borderColor: COLORS.brand,
  },
  btInfoBody: {
    color: COLORS.onSurfaceSecondary,
    fontSize: TEXT.base,
    lineHeight: 22,
  },
  footerLabel: { color: COLORS.onSurface, fontWeight: "700", fontSize: TEXT.base },
  footerSub: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm },

  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sheetTitle: { color: COLORS.onSurface, fontWeight: "700", fontSize: TEXT.base, letterSpacing: 1, textTransform: "uppercase" },
  consoleBody: { padding: SPACING.lg, gap: SPACING.sm },
  consoleOut: { color: COLORS.onSurface, fontFamily: FONT.mono, fontSize: TEXT.sm, lineHeight: 18 },
  consoleErr: { color: COLORS.error, fontFamily: FONT.mono, fontSize: TEXT.sm, lineHeight: 18 },
  consoleMuted: { color: COLORS.onSurfaceSecondary, fontFamily: FONT.mono, fontSize: TEXT.sm },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.lg,
  },
  modalCard: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.md,
  },
  modalTitle: { color: COLORS.onSurface, fontSize: TEXT.lg, fontWeight: "700" },
  modalLabel: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm, marginTop: SPACING.sm },
  modalInput: {
    backgroundColor: COLORS.surface,
    color: COLORS.onSurface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontFamily: FONT.mono,
    fontSize: TEXT.base,
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: SPACING.sm, marginTop: SPACING.sm },
  primaryBtn: {
    backgroundColor: COLORS.brand,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  primaryBtnLabel: { color: COLORS.onBrand, fontWeight: "700", fontSize: TEXT.base },
  secondaryBtn: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceTertiary,
  },
  secondaryBtnLabel: { color: COLORS.onSurface, fontWeight: "600", fontSize: TEXT.base },

  chip: {
    paddingHorizontal: SPACING.md,
    height: 36,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
    flexShrink: 0,
  },
  chipActive: {
    backgroundColor: COLORS.brandTertiary,
    borderColor: COLORS.brand,
  },
  chipLabel: { color: COLORS.onSurface, fontSize: TEXT.sm, fontWeight: "600" },

  langRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
  },
  langRowText: { color: COLORS.onSurface, fontSize: TEXT.base },
});
