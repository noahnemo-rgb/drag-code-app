import { Feather } from "@expo/vector-icons";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Linking,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputSelectionChangeEventData,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { FileItem, Language, Project, Snippet } from "@/src/lib/api";
import { saveEditorContext } from "@/src/lib/editor-context";
import { highlightLine, PALETTE } from "@/src/lib/highlight";
import { store } from "@/src/lib/store";
import { settings, SyncMode } from "@/src/lib/storage";
import { fuzzyScore } from "@/src/lib/fuzzy";
import { LANGS, inferLang, starterFor } from "@/src/lib/language";
import { loadMru, pushMru, recencyBonus, sortByMru } from "@/src/lib/mru";
import { enqueueKeystroke } from "@/src/lib/episode-idb";
import { useEpisodeMode } from "@/src/lib/episode-store";
import { stripMarkdownFences } from "@/src/lib/paste";
import { BtInfoModal } from "@/src/components/BtInfoModal";
import { CommandPaletteModal, type PaletteCommand } from "@/src/components/CommandPaletteModal";
import { FileDrawer } from "@/src/components/FileDrawer";
import { LangMenu } from "@/src/components/LangMenu";
import { NewFileModal } from "@/src/components/NewFileModal";
import { PromptModal } from "@/src/components/PromptModal";
import { PushModal } from "@/src/components/PushModal";
import { githubPat, loadGitHubConfig, pushToGitHub } from "@/src/lib/push";
import { QuickFileSwitcherModal, type QuickResult } from "@/src/components/QuickFileSwitcherModal";
import { ShortcutsSheet } from "@/src/components/ShortcutsSheet";
import { useEditorShortcuts } from "@/src/hooks/use-editor-shortcuts";
import { COLORS, FONT, RADIUS, SPACING, TEXT } from "@/src/theme";

const EDITOR_FONT_SIZE = 13;
const EDITOR_LINE_HEIGHT = 20;
const GUTTER_WIDTH = 44;

const SYMBOLS = ["{", "}", "(", ")", "[", "]", "<", ">", ";", ":", "=", "+", "-", "*", "/", "\"", "'", "`", ",", ".", "!", "?", "&", "|", "#", "$", "@", "%"];

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
  const [renameTarget, setRenameTarget] = useState<null | { kind: "project" | "file"; id: string; name: string }>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showBtInfo, setShowBtInfo] = useState(false);
  const [savedToast, setSavedToast] = useState<boolean>(false);
  const [pasteToast, setPasteToast] = useState<boolean>(false);
  const prevContentLenRef = useRef<number>(0);
  const { enabled: episodeEnabled, toggle: episodeToggle } = useEpisodeMode();
  const episodeRef = useRef<boolean>(episodeEnabled);
  useEffect(() => { episodeRef.current = episodeEnabled; }, [episodeEnabled]);
  const [silentPushStatus, setSilentPushStatus] = useState<"ok" | "err" | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showPush, setShowPush] = useState(false);
  const [showQuickFile, setShowQuickFile] = useState(false);
  const [quickFileQuery, setQuickFileQuery] = useState("");
  const [quickFileIndex, setQuickFileIndex] = useState(0);
  const [snippetsCache, setSnippetsCache] = useState<Snippet[]>([]);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);

  const activeFile = useMemo(() => files.find((f) => f.id === activeFileId) ?? null, [files, activeFileId]);

  const quickResults = useMemo<QuickResult[]>(() => {
    const q = quickFileQuery.trim();
    // Empty query → show files sorted by recency (most-recently opened first)
    if (!q) {
      return sortByMru(files, recentFiles, (f) => f.id)
        .slice(0, 30)
        .map((file) => ({ kind: "file" as const, file, score: 0 }));
    }

    const results: QuickResult[] = [];

    // 1) File-name fuzzy matches + recency bonus
    for (const f of files) {
      const s = fuzzyScore(q, f.name);
      if (s >= 0) results.push({ kind: "file", file: f, score: s + 20 + recencyBonus(recentFiles, f.id) });
    }

    // 2) File-content substring matches (case-insensitive, per line)
    const needle = q.toLowerCase();
    for (const f of files) {
      if (!f.content) continue;
      const lines = f.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const idx = lines[i].toLowerCase().indexOf(needle);
        if (idx === -1) continue;
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
      const inDesc = s.description && s.description.toLowerCase().includes(needle);
      const inTags = s.tags?.some((t) => t.toLowerCase().includes(needle));
      if (inDesc || inTags) {
        results.push({ kind: "snippet", snippet: s, score: 12 });
      }
    }

    return results.sort((a, b) => {
      // Group by kind first (files > lines > snippets), then by score desc within each group.
      const rank = (k: QuickResult["kind"]) => (k === "file" ? 0 : k === "line" ? 1 : 2);
      const ra = rank(a.kind);
      const rb = rank(b.kind);
      if (ra !== rb) return ra - rb;
      return b.score - a.score;
    }).slice(0, 40);
  }, [files, snippetsCache, quickFileQuery, recentFiles]);

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

  // Load MRUs on mount
  useEffect(() => {
    (async () => {
      const [f, c] = await Promise.all([
        loadMru("syntax.recent_files"),
        loadMru("syntax.recent_commands"),
      ]);
      setRecentFiles(f);
      setRecentCommands(c);
    })();
  }, []);

  const bumpRecentFile = useCallback(async (id: string) => {
    const next = await pushMru("syntax.recent_files", id);
    setRecentFiles(next);
  }, []);

  const bumpRecentCommand = useCallback(async (id: string) => {
    const next = await pushMru("syntax.recent_commands", id);
    setRecentCommands(next);
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
    await bumpRecentFile(fileId);
    closeDrawer();
  }, [activeFile, content, savedContent, syncMode, files, bumpRecentFile]);

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

  // Keep AI assistant context in sync with the active buffer.
  useEffect(() => {
    if (!activeFile) {
      void saveEditorContext(null);
      return;
    }
    void saveEditorContext({
      code: content,
      language: activeFile.language,
      name: activeFile.name,
    });
  }, [activeFile, content]);

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

  // Editor onChange with automatic Markdown-fence stripping on paste. This lets
  // users paste code straight from AI chat (```python\n...\n```) and get just
  // the runnable body inserted into the file. In Episode Mode, every keystroke
  // is also enqueued to IndexedDB for zero-loss autosave.
  const handleCodeChange = useCallback((next: string) => {
    const prevLen = prevContentLenRef.current;
    let finalText = next;
    let stripped = false;
    if (next.length - prevLen > 5 && next.includes("```")) {
      const cleaned = stripMarkdownFences(next);
      if (cleaned !== next) {
        finalText = cleaned;
        stripped = true;
      }
    }
    prevContentLenRef.current = finalText.length;
    setContent(finalText);
    if (episodeRef.current && activeFileIdRef.current) {
      enqueueKeystroke(activeFileIdRef.current, finalText);
    }
    if (stripped && !episodeRef.current) {
      setPasteToast(true);
      setTimeout(() => setPasteToast(false), 1600);
      Haptics.selectionAsync();
    } else if (stripped) {
      Haptics.selectionAsync();
    }
  }, []);

  useEffect(() => {
    prevContentLenRef.current = content.length;
  }, [activeFileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When returning from AI screen or Snippets, apply any pending "insert at cursor" payload
  // after the file has finished loading (avoid the load overwriting our insertion).
  const pendingInsertRef = useRef<string | null>(null);
  const pendingReplaceRef = useRef<string | null>(null);
  const loadingRef = useRef<boolean>(true);
  const activeFileIdRef = useRef<string | null>(null);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  useEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);

  const tryApplyPending = useCallback(() => {
    if (loadingRef.current) return;
    if (!activeFileIdRef.current) return;
    // "Apply Fix" wins over "Insert at cursor" — it replaces the whole file.
    const replace = pendingReplaceRef.current;
    if (replace !== null) {
      pendingReplaceRef.current = null;
      prevContentLenRef.current = replace.length;
      setContent(replace);
      if (!episodeRef.current) {
        setPasteToast(true);
        setTimeout(() => setPasteToast(false), 1600);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    const pending = pendingInsertRef.current;
    if (!pending) return;
    pendingInsertRef.current = null;
    insertAtCursor(pending);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const pendingReplace = await AsyncStorage.getItem("syntax.pending_replace");
        if (!cancelled && pendingReplace) {
          await AsyncStorage.removeItem("syntax.pending_replace");
          // AI may still wrap the "corrected file" in a fence — strip defensively.
          pendingReplaceRef.current = stripMarkdownFences(pendingReplace);
        }
        const pending = await AsyncStorage.getItem("syntax.pending_insert");
        if (!cancelled && pending) {
          await AsyncStorage.removeItem("syntax.pending_insert");
          pendingInsertRef.current = pending;
        }
        // Fires immediately if the file is already loaded (returning from a pushed screen).
        tryApplyPending();
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
    await saveEditorContext({
      code: content,
      language: activeFile.language,
      name: activeFile.name,
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/ai");
  };

  // "Why?" — ships the last terminal output + current code to the AI as an
  // ELI5 debugging tutor. The response comes back with a fenced fix that the
  // user can one-tap "Apply" to replace their file with.
  const askAiAboutOutput = useCallback(async () => {
    if (!runOutput || !activeFile) return;
    const combined = [
      runOutput.stderr ? `STDERR:\n${runOutput.stderr}` : "",
      runOutput.stdout ? `STDOUT:\n${runOutput.stdout}` : "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);
    const prompt = [
      "You are a patient, beginner-friendly tutor. The user just ran the code below and got the terminal output that follows. Explain what went wrong (or what the output means) in plain, simple English, like you're talking to a total beginner. Then suggest the exact fix. Keep it concise.",
      "",
      `Language: ${activeFile.language}`,
      "",
      "--- CODE ---",
      "```" + activeFile.language,
      content.slice(0, 4000),
      "```",
      "",
      "--- TERMINAL OUTPUT ---",
      combined || "(empty output)",
      "",
      "Return your reply in this shape:",
      "1) One-sentence plain-English summary of the problem.",
      "2) The exact fix — as a single fenced code block containing the full corrected file. Do NOT include prose inside the code block.",
    ].join("\n");
    await AsyncStorage.setItem("syntax.pending_prompt", prompt);
    await saveEditorContext({
      code: content,
      language: activeFile.language,
      name: activeFile.name,
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Dismiss the console sheet so it doesn't linger over the AI screen on web.
    runSheetRef.current?.dismiss();
    router.push("/ai");
  }, [runOutput, activeFile, content, router]);

  // Silent GitHub push — used in Episode Mode so the header push icon never
  // pops the modal. Falls back to opening the modal if no saved config exists.
  const silentGithubPush = useCallback(async () => {
    if (!activeFile) return;
    try {
      const [pat, cfg] = await Promise.all([githubPat.get(), loadGitHubConfig()]);
      if (!pat || !cfg?.owner || !cfg?.repo || !cfg?.branch || !cfg?.path) {
        // No saved config — silently fall back to opening the modal so the user
        // can complete setup exactly once.
        setShowPush(true);
        return;
      }
      const filePath = cfg.path.endsWith("/") ? `${cfg.path}${activeFile.name}` : cfg.path;
      // pushToGitHub throws on any non-2xx — reaching this line = success.
      await pushToGitHub({
        pat,
        owner: cfg.owner,
        repo: cfg.repo,
        branch: cfg.branch,
        path: filePath,
        message: `Syntax IDE: update ${activeFile.name}`,
        content,
      });
      setSilentPushStatus("ok");
    } catch {
      setSilentPushStatus("err");
    }
    setTimeout(() => setSilentPushStatus(null), 2400);
  }, [activeFile, content]);

  const handleHeaderPush = useCallback(() => {
    if (episodeRef.current) {
      void silentGithubPush();
    } else {
      setShowPush(true);
    }
  }, [silentGithubPush]);

  // Enforce portrait lock while Episode Mode is on. Released on toggle-off / unmount.
  useEffect(() => {
    if (Platform.OS === "web") return; // Web browsers don't honor screen-orientation from JS.
    if (episodeEnabled) {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    } else {
      ScreenOrientation.unlockAsync().catch(() => {});
    }
    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, [episodeEnabled]);

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
      if (!episodeRef.current) {
        setSavedToast(true);
        setTimeout(() => setSavedToast(false), 1200);
      }
    },
    onRun: () => {
      void runCurrent();
    },
    onEscape: () => {
      if (showPush) setShowPush(false);
      else if (showCommandPalette) setShowCommandPalette(false);
      else if (showQuickFile) setShowQuickFile(false);
      else if (showShortcuts) setShowShortcuts(false);
      else if (findOpen) closeFind();
      else if (showLangMenu) setShowLangMenu(false);
      else if (showNewFile) setShowNewFile(false);
      else if (showNewProject) setShowNewProject(false);
      else if (renameTarget) {
        setRenameTarget(null);
        setRenameValue("");
      }
      else if (showBtInfo) setShowBtInfo(false);
    },
    onAi: () => {
      if (activeFile) {
        void saveEditorContext({
          code: content,
          language: activeFile.language,
          name: activeFile.name,
        });
      }
      router.push("/ai");
    },
    onShortcuts: () => setShowShortcuts(true),
    onQuickFile: () => {
      setQuickFileQuery("");
      setQuickFileIndex(0);
      setShowQuickFile(true);
    },
    onCommandPalette: () => {
      setCommandQuery("");
      setCommandIndex(0);
      setShowCommandPalette(true);
    },
  });

  // ---- Command palette actions ----

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [
      {
        id: "run",
        label: "Run current file",
        hint: "Execute the active file",
        shortcut: "⌘ Enter",
        disabled: !activeFile,
        run: () => void runCurrent(),
      },
      {
        id: "save",
        label: "Save current file",
        hint: "Flush edits + confirm",
        shortcut: "⌘ S",
        disabled: !activeFile,
        run: async () => {
          if (!activeFile) return;
          if (content !== savedContent) {
            await store.updateFile(syncMode, activeFile.id, { content });
            setSavedContent(content);
          }
          if (!episodeRef.current) {
            setSavedToast(true);
            setTimeout(() => setSavedToast(false), 1200);
          }
        },
      },
      {
        id: "find",
        label: "Find in file",
        hint: "Open Find & Replace",
        shortcut: "⌘ F",
        run: () => setFindOpen(true),
      },
      {
        id: "quickfile",
        label: "Quick file switcher",
        hint: "Files, content, snippets",
        shortcut: "⌘ P",
        run: () => {
          setQuickFileQuery("");
          setQuickFileIndex(0);
          setShowQuickFile(true);
        },
      },
      {
        id: "ai",
        label: "Open AI assistant",
        hint: "Chat with OpenRouter",
        shortcut: "⌘ K",
        run: () => {
          if (activeFile) {
            void saveEditorContext({
              code: content,
              language: activeFile.language,
              name: activeFile.name,
            });
          }
          router.push("/ai");
        },
      },
      {
        id: "push",
        label: "Push code…",
        hint: "GitHub / webhook / share",
        disabled: !activeFile,
        run: () => setShowPush(true),
      },
      {
        id: "snippets",
        label: "Open Snippets marketplace",
        hint: "Browse / publish snippets",
        run: () => router.push("/snippets"),
      },
      {
        id: "toggle-sync",
        label: syncMode === "cloud" ? "Switch to local storage" : "Switch to cloud storage",
        hint: `Currently: ${syncMode}`,
        run: () => switchMode(syncMode === "cloud" ? "local" : "cloud"),
      },
      {
        id: "new-file",
        label: "New file…",
        hint: "Create a file in the current project",
        disabled: !activeProjectId,
        run: () => setShowNewFile(true),
      },
      {
        id: "new-project",
        label: "New project…",
        hint: "Create a new project",
        run: () => setShowNewProject(true),
      },
      {
        id: "delete-file",
        label: "Delete current file",
        hint: activeFile ? `Remove ${activeFile.name}` : "No file open",
        disabled: !activeFile,
        run: async () => {
          if (activeFile) await doDeleteFile(activeFile.id);
        },
      },
      {
        id: "bt",
        label: "Connect Bluetooth keyboard",
        hint: "Open OS pairing screen",
        run: () => void openBluetoothSettings(),
      },
      {
        id: "shortcuts",
        label: "Show keyboard shortcuts",
        hint: "Cheat sheet",
        shortcut: "⌘ /",
        run: () => setShowShortcuts(true),
      },
      {
        id: "episode",
        label: episodeEnabled ? "Turn Episode Mode OFF" : "Turn Episode Mode ON",
        hint: "Dim UI, portrait lock, keystroke autosave",
        run: () => episodeToggle(),
      },
    ];
    return list;
  }, [
    activeFile,
    activeProjectId,
    content,
    savedContent,
    syncMode,
    episodeEnabled,
    // Handlers referenced above are stable within a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  const commandMatches = useMemo(() => {
    const q = commandQuery.trim();
    if (!q) return sortByMru(commands, recentCommands, (c) => c.id);
    return commands
      .map((c) => ({ c, s: fuzzyScore(q, `${c.label} ${c.hint}`) }))
      .filter((x) => x.s >= 0)
      .map((x) => ({ ...x, s: x.s + recencyBonus(recentCommands, x.c.id) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [commands, commandQuery, recentCommands]);

  useEffect(() => {
    setCommandIndex(0);
  }, [commandQuery]);

  const runCommand = async (c: PaletteCommand) => {
    if (c.disabled) return;
    setShowCommandPalette(false);
    Haptics.selectionAsync();
    void bumpRecentCommand(c.id);
    await c.run();
  };

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

  const beginRenameProject = (id: string) => {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    setRenameTarget({ kind: "project", id, name: p.name });
    setRenameValue(p.name);
  };

  const beginRenameFile = (id: string) => {
    const f = files.find((x) => x.id === id);
    if (!f) return;
    setRenameTarget({ kind: "file", id, name: f.name });
    setRenameValue(f.name);
  };

  const confirmRename = async () => {
    if (!renameTarget) return;
    const next = renameValue.trim();
    if (!next || next === renameTarget.name) {
      setRenameTarget(null);
      setRenameValue("");
      return;
    }
    if (renameTarget.kind === "project") {
      await store.renameProject(syncMode, renameTarget.id, next);
      setProjects((prev) => prev.map((p) => (p.id === renameTarget.id ? { ...p, name: next } : p)));
    } else {
      const lang = inferLang(next);
      const patch: { name: string; language?: Language } = { name: next };
      if (lang) patch.language = lang;
      await store.updateFile(syncMode, renameTarget.id, patch);
      setFiles((prev) =>
        prev
          .map((f) => (f.id === renameTarget.id ? { ...f, ...patch } : f))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    }
    setRenameTarget(null);
    setRenameValue("");
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
        <Pressable
          style={styles.filenameWrap}
          onPress={() => setShowLangMenu(true)}
          onLongPress={() => {
            setCommandQuery("");
            setCommandIndex(0);
            setShowCommandPalette(true);
          }}
          delayLongPress={350}
          testID="filename-lang-picker"
        >
          <Text style={styles.filename} numberOfLines={1} testID="active-filename">
            {activeFile?.name ?? "No file"}
          </Text>
          <View style={styles.filenameSubRow}>
            <Text style={styles.langLabel}>{LANGS.find((l) => l.key === lang)?.label ?? "—"}</Text>
            {episodeEnabled ? (
              <View style={styles.moonBadge} testID="episode-badge">
                <Feather name="moon" size={11} color={COLORS.brand} />
              </View>
            ) : null}
            {hwKeyboard ? (
              <View style={styles.hwBadge} testID="hw-keyboard-badge">
                <Text style={styles.hwBadgeLabel}>HW ⌘</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
        <View style={{ position: "relative" }}>
          <Pressable
            onPress={handleHeaderPush}
            disabled={!activeFile}
            style={[styles.iconBtn, !activeFile && { opacity: 0.4 }]}
            testID="open-push-btn"
            hitSlop={8}
          >
            <Feather name="upload-cloud" size={20} color={COLORS.onSurface} />
          </Pressable>
          {silentPushStatus ? (
            <View
              style={[
                styles.pushDot,
                { backgroundColor: silentPushStatus === "ok" ? COLORS.success ?? "#4ade80" : "#ef4444", pointerEvents: "none" as const },
              ]}
              testID={`push-dot-${silentPushStatus}`}
            />
          ) : null}
        </View>
        <Pressable onPress={() => router.push("/snippets")} style={styles.iconBtn} testID="open-snippets-btn" hitSlop={8}>
          <Feather name="package" size={20} color={COLORS.onSurface} />
        </Pressable>
        <Pressable onPress={() => setFindOpen((v) => !v)} style={styles.iconBtn} testID="toggle-find-btn" hitSlop={8}>
          <Feather name="search" size={20} color={findOpen ? COLORS.brand : COLORS.onSurface} />
        </Pressable>
        <Pressable
          onPress={() => {
            if (activeFile) {
              void saveEditorContext({
                code: content,
                language: activeFile.language,
                name: activeFile.name,
              });
            }
            router.push("/ai");
          }}
          style={styles.iconBtn}
          testID="open-ai-btn"
          hitSlop={8}
        >
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
                  onChangeText={handleCodeChange}
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

        {/* Paste toast (fires when Markdown fences were stripped on paste) */}
        {pasteToast ? (
          <View style={[styles.savedToast, { backgroundColor: COLORS.surfaceTertiary, borderWidth: 1, borderColor: COLORS.brand }]} pointerEvents="none" testID="paste-toast">
            <Feather name="scissors" size={14} color={COLORS.brand} />
            <Text style={[styles.savedToastLabel, { color: COLORS.brand }]}>Fences stripped</Text>
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

      {/* File drawer (projects + files + sync + BT) */}
      <FileDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        drawerX={drawerX}
        drawerWidth={drawerWidth}
        insetTop={insets.top}
        insetBottom={insets.bottom}
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={selectProject}
        onDeleteProject={doDeleteProject}
        onRenameProject={beginRenameProject}
        onNewProject={() => setShowNewProject(true)}
        files={files}
        activeFileId={activeFileId}
        onSelectFile={selectFile}
        onDeleteFile={doDeleteFile}
        onRenameFile={beginRenameFile}
        onNewFile={() => setShowNewFile(true)}
        syncMode={syncMode}
        onSyncModeChange={switchMode}
        onBluetooth={openBluetoothSettings}
      />

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
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.sm }}>
            {runOutput && (runOutput.stderr || runOutput.stdout) ? (
              <Pressable
                onPress={askAiAboutOutput}
                style={styles.whyBtn}
                hitSlop={6}
                testID="why-btn"
              >
                <Feather
                  name={runOutput.stderr ? "alert-triangle" : "help-circle"}
                  size={13}
                  color={COLORS.brand}
                />
                <Text style={styles.whyBtnLabel}>
                  {runOutput.stderr ? "Why?" : "Explain output"}
                </Text>
              </Pressable>
            ) : null}
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

      <PromptModal
        visible={!!renameTarget}
        title={renameTarget?.kind === "project" ? "Rename project" : "Rename file"}
        placeholder={renameTarget?.kind === "project" ? "Project name" : "filename.ext"}
        value={renameValue}
        onChange={setRenameValue}
        onCancel={() => {
          setRenameTarget(null);
          setRenameValue("");
        }}
        onConfirm={confirmRename}
        confirmLabel="Rename"
        testID="rename-modal"
      />

      {/* New file modal */}
      <NewFileModal
        visible={showNewFile}
        name={newFileName}
        onNameChange={setNewFileName}
        lang={newFileLang}
        onLangChange={setNewFileLang}
        onCancel={() => setShowNewFile(false)}
        onCreate={doCreateFile}
      />

      {/* Push modal (GitHub / webhook / share) */}
      <PushModal
        visible={showPush}
        filename={activeFile?.name ?? "file.txt"}
        language={activeFile?.language ?? "plaintext"}
        content={content}
        onClose={() => setShowPush(false)}
      />

      {/* Bluetooth-keyboard info modal */}
      <BtInfoModal visible={showBtInfo} onClose={() => setShowBtInfo(false)} />

      {/* Shortcuts cheat-sheet (⌘/) */}
      <ShortcutsSheet visible={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* Quick file switcher (⌘P) */}
      <QuickFileSwitcherModal
        visible={showQuickFile}
        onClose={() => setShowQuickFile(false)}
        query={quickFileQuery}
        onQueryChange={setQuickFileQuery}
        index={quickFileIndex}
        onIndexChange={setQuickFileIndex}
        results={quickResults}
        recentFileIds={recentFiles}
        onOpen={openQuickResult}
      />

      {/* Command palette (⇧⌘P) */}
      <CommandPaletteModal
        visible={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        query={commandQuery}
        onQueryChange={setCommandQuery}
        index={commandIndex}
        onIndexChange={setCommandIndex}
        matches={commandMatches}
        recentIds={recentCommands}
        onRun={runCommand}
      />

      {/* Language picker modal */}
      <LangMenu visible={showLangMenu} current={lang} onSelect={changeLanguage} onClose={() => setShowLangMenu(false)} />

      {/* Episode Mode dimming overlay — captures nothing, purely visual. */}
      {episodeEnabled ? (
        <View
          style={styles.episodeDim}
          testID="episode-overlay"
        />
      ) : null}
    </SafeAreaView>
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
  whyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.brandTertiary,
    borderWidth: 1,
    borderColor: COLORS.brand,
  },
  whyBtnLabel: { color: COLORS.brand, fontWeight: "700", fontSize: TEXT.sm - 1 },
  moonBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.brandTertiary,
    borderWidth: 1,
    borderColor: COLORS.brand,
  },
  pushDot: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  episodeDim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.18)",
    pointerEvents: "none",
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

  primaryBtn: {
    backgroundColor: COLORS.brand,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  primaryBtnLabel: { color: COLORS.onBrand, fontWeight: "700", fontSize: TEXT.base },

});
