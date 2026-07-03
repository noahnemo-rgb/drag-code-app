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

import { FileItem, Language, Project } from "@/src/lib/api";
import { highlightLine, PALETTE } from "@/src/lib/highlight";
import { store } from "@/src/lib/store";
import { settings, SyncMode } from "@/src/lib/storage";
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

  const activeFile = useMemo(() => files.find((f) => f.id === activeFileId) ?? null, [files, activeFileId]);

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

  // When returning from AI screen, apply any pending "insert at cursor" payload.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const pending = await AsyncStorage.getItem("syntax.pending_insert");
        if (!cancelled && pending) {
          await AsyncStorage.removeItem("syntax.pending_insert");
          insertAtCursor(pending);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

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
          <Text style={styles.langLabel}>{LANGS.find((l) => l.key === lang)?.label ?? "—"}</Text>
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
                    selectionRef.current = e.nativeEvent.selection;
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
  filename: {
    color: COLORS.onSurface,
    fontFamily: FONT.mono,
    fontSize: TEXT.base,
  },
  langLabel: {
    color: COLORS.onSurfaceSecondary,
    fontSize: TEXT.sm - 1,
    marginTop: 1,
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
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.md,
    marginTop: SPACING.md,
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
