import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, FileItem, Language, Snippet, SnippetUpdate } from "@/src/lib/api";
import { highlightLine } from "@/src/lib/highlight";
import { local, settings } from "@/src/lib/storage";
import { store } from "@/src/lib/store";
import { COLORS, FONT, RADIUS, SPACING, TEXT } from "@/src/theme";

const DEVICE_KEY = "syntax.device_id";
const AUTHOR_KEY = "syntax.author_name";

const LANGS: { key: Language; label: string }[] = [
  { key: "javascript", label: "JavaScript" },
  { key: "typescript", label: "TypeScript" },
  { key: "python", label: "Python" },
  { key: "html", label: "HTML" },
  { key: "css", label: "CSS" },
];

const uuid = (): string =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

export default function SnippetsScreen() {
  const router = useRouter();
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [langFilter, setLangFilter] = useState<Language | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [deviceId, setDeviceId] = useState<string>("");
  const [starred, setStarred] = useState<Record<string, boolean>>({});

  // Publish modal
  const [showPublish, setShowPublish] = useState(false);
  const [selected, setSelected] = useState<Snippet | null>(null);
  const [editing, setEditing] = useState<Snippet | null>(null);

  useEffect(() => {
    (async () => {
      let d = await AsyncStorage.getItem(DEVICE_KEY);
      if (!d) {
        d = uuid();
        await AsyncStorage.setItem(DEVICE_KEY, d);
      }
      setDeviceId(d);
      await refresh(langFilter, searchQuery, d);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hydrateStars = useCallback(async (list: Snippet[], did: string) => {
    if (!did || list.length === 0) {
      setStarred({});
      return;
    }
    const entries = await Promise.all(
      list.map(async (s) => {
        try {
          const r = await api.isStarred(s.id, did);
          return [s.id, r.starred] as const;
        } catch {
          return [s.id, false] as const;
        }
      }),
    );
    setStarred(Object.fromEntries(entries));
  }, []);

  const refresh = useCallback(
    async (lang: Language | null, q: string, did: string) => {
      setLoading(true);
      try {
        const list = await api.listSnippets({
          language: lang ?? undefined,
          q: q.trim() || undefined,
        });
        setSnippets(list);
        await hydrateStars(list, did);
      } finally {
        setLoading(false);
      }
    },
    [hydrateStars],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      if (!deviceId) return;
      void refresh(langFilter, searchQuery, deviceId);
    }, 300);
    return () => clearTimeout(t);
  }, [langFilter, searchQuery, refresh, deviceId]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh(langFilter, searchQuery, deviceId);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleStar = async (s: Snippet) => {
    if (!deviceId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const updated = await api.starSnippet(s.id, deviceId);
    setSnippets((prev) => prev.map((x) => (x.id === s.id ? updated : x)));
    // Server toggles; derive next starred state from previous hydrated map.
    setStarred((prev) => ({ ...prev, [s.id]: !prev[s.id] }));
    if (selected?.id === s.id) setSelected(updated);
  };

  const insertIntoEditor = async (s: Snippet) => {
    await AsyncStorage.setItem("syntax.pending_insert", s.code);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const visibleSnippets = useMemo(() => {
    if (scope === "mine" && deviceId) {
      return snippets.filter((s) => s.author_device === deviceId);
    }
    return snippets;
  }, [snippets, scope, deviceId]);

  const deleteMine = async (s: Snippet) => {
    if (!deviceId || s.author_device !== deviceId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await api.deleteSnippet(s.id, deviceId);
      setSnippets((prev) => prev.filter((x) => x.id !== s.id));
      if (selected?.id === s.id) setSelected(null);
    } catch {
      // Silent ignore; backend guards prevent unauthorized deletes.
    }
  };

  const filteredNote = useMemo(
    () => (langFilter ? LANGS.find((l) => l.key === langFilter)?.label ?? "" : "All"),
    [langFilter],
  );

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={8}>
          <Feather name="arrow-left" size={22} color={COLORS.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Snippets</Text>
          <Text style={styles.subtitle}>{filteredNote} • {visibleSnippets.length}</Text>
        </View>
        <Pressable onPress={() => setShowPublish(true)} style={styles.publishBtn} testID="open-publish-btn">
          <Feather name="upload" size={14} color={COLORS.onBrand} />
          <Text style={styles.publishBtnLabel}>Publish</Text>
        </Pressable>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <Feather name="search" size={14} color={COLORS.onSurfaceSecondary} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search title, description, tags…"
          placeholderTextColor={COLORS.onSurfaceSecondary}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          testID="snippet-search-input"
        />
        {searchQuery ? (
          <Pressable onPress={() => setSearchQuery("")} hitSlop={6} testID="clear-search-btn">
            <Feather name="x" size={14} color={COLORS.onSurfaceSecondary} />
          </Pressable>
        ) : null}
      </View>

      {/* All / Mine segmented control */}
      <View style={styles.segmentWrap}>
        <Pressable
          onPress={() => setScope("all")}
          style={[styles.segment, scope === "all" && styles.segmentActive]}
          testID="scope-all"
        >
          <Text style={[styles.segmentLabel, scope === "all" && { color: COLORS.brand }]}>All</Text>
        </Pressable>
        <Pressable
          onPress={() => setScope("mine")}
          style={[styles.segment, scope === "mine" && styles.segmentActive]}
          testID="scope-mine"
        >
          <Text style={[styles.segmentLabel, scope === "mine" && { color: COLORS.brand }]}>Mine</Text>
        </Pressable>
      </View>

      {/* Language filter chips — chrome, single horizontal scroller */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRowContent}
        style={styles.chipRow}
      >
        <FilterChip label="All" active={langFilter === null} onPress={() => setLangFilter(null)} testID="filter-all" />
        {LANGS.map((l) => (
          <FilterChip
            key={l.key}
            label={l.label}
            active={langFilter === l.key}
            onPress={() => setLangFilter(l.key)}
            testID={`filter-${l.key}`}
          />
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.brand} />
        </View>
      ) : visibleSnippets.length === 0 ? (
        <View style={styles.centerFill}>
          <Feather name={scope === "mine" ? "user" : "package"} size={40} color={COLORS.brand} />
          <Text style={styles.emptyTitle}>{scope === "mine" ? "You haven't published anything yet" : "No snippets yet"}</Text>
          <Text style={styles.emptySub}>{scope === "mine" ? "Publish a snippet to see it here." : "Be the first to publish one."}</Text>
          <Pressable onPress={() => setShowPublish(true)} style={styles.primaryBtn} testID="empty-publish-cta">
            <Text style={styles.primaryBtnLabel}>Publish a snippet</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={visibleSnippets}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />}
          renderItem={({ item }) => (
            <SnippetCard
              snippet={item}
              starred={!!starred[item.id]}
              isMine={!!deviceId && item.author_device === deviceId}
              onOpen={() => setSelected(item)}
              onStar={() => toggleStar(item)}
              onInsert={() => insertIntoEditor(item)}
              onDelete={() => deleteMine(item)}
            />
          )}
          testID="snippets-list"
        />
      )}

      {/* Publish modal */}
      <PublishModal
        visible={showPublish}
        deviceId={deviceId}
        onClose={() => setShowPublish(false)}
        onPublished={(s) => {
          setSnippets((prev) => [s, ...prev]);
          setShowPublish(false);
        }}
      />

      {/* Detail modal */}
      <SnippetDetailModal
        snippet={selected}
        starred={selected ? !!starred[selected.id] : false}
        isMine={!!selected && !!deviceId && selected.author_device === deviceId}
        onClose={() => setSelected(null)}
        onStar={() => selected && toggleStar(selected)}
        onInsert={() => selected && insertIntoEditor(selected)}
        onEdit={() => {
          if (selected) {
            setEditing(selected);
            setSelected(null);
          }
        }}
      />

      {/* Edit modal (only reachable for own snippets) */}
      <EditSnippetModal
        snippet={editing}
        deviceId={deviceId}
        onClose={() => setEditing(null)}
        onSaved={(updated) => {
          setSnippets((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
          setEditing(null);
        }}
      />
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]} testID={testID}>
      <Text style={[styles.chipLabel, active && { color: COLORS.brand }]}>{label}</Text>
    </Pressable>
  );
}

function SnippetCard({
  snippet,
  starred,
  isMine,
  onOpen,
  onStar,
  onInsert,
  onDelete,
}: {
  snippet: Snippet;
  starred: boolean;
  isMine: boolean;
  onOpen: () => void;
  onStar: () => void;
  onInsert: () => void;
  onDelete: () => void;
}) {
  const preview = snippet.code.split("\n").slice(0, 4);
  return (
    <Pressable style={styles.card} onPress={onOpen} testID={`snippet-${snippet.id}`}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{snippet.title}</Text>
          <Text style={styles.cardAuthor} numberOfLines={1}>
            by {snippet.author}{isMine ? " (you)" : ""}
          </Text>
        </View>
        <View style={styles.langBadge}>
          <Text style={styles.langBadgeLabel}>{snippet.language}</Text>
        </View>
        {isMine ? (
          <Pressable onPress={onDelete} hitSlop={6} style={styles.deleteBtn} testID={`delete-mine-${snippet.id}`}>
            <Feather name="trash-2" size={14} color={COLORS.error} />
          </Pressable>
        ) : null}
      </View>
      {snippet.description ? (
        <Text style={styles.cardDesc} numberOfLines={2}>{snippet.description}</Text>
      ) : null}
      <View style={styles.codePreview}>
        {preview.map((line, i) => (
          <Text key={i} style={styles.codePreviewLine} numberOfLines={1}>
            {highlightLine(line, snippet.language).map((s, j) => (
              <Text key={j} style={{ color: s.color }}>
                {s.text}
              </Text>
            ))}
          </Text>
        ))}
      </View>
      <View style={styles.cardFooter}>
        <Pressable onPress={onStar} style={styles.starBtn} testID={`star-${snippet.id}`} hitSlop={6}>
          <Feather name={starred ? "star" : "star"} size={14} color={starred ? COLORS.brand : COLORS.onSurfaceSecondary} />
          <Text style={[styles.starLabel, starred && { color: COLORS.brand }]}>{snippet.stars}</Text>
        </Pressable>
        {snippet.tags.length > 0 ? (
          <View style={styles.tagWrap}>
            {snippet.tags.slice(0, 3).map((t) => (
              <Text key={t} style={styles.tag}>#{t}</Text>
            ))}
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Pressable onPress={onInsert} style={styles.insertBtn} testID={`insert-${snippet.id}`}>
          <Feather name="corner-down-left" size={12} color={COLORS.brand} />
          <Text style={styles.insertLabel}>Insert</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function SnippetDetailModal({
  snippet,
  starred,
  isMine,
  onClose,
  onStar,
  onInsert,
  onEdit,
}: {
  snippet: Snippet | null;
  starred: boolean;
  isMine: boolean;
  onClose: () => void;
  onStar: () => void;
  onInsert: () => void;
  onEdit: () => void;
}) {
  const { height } = useWindowDimensions();
  if (!snippet) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.detailBackdrop, { height }]}>
        <View style={styles.detailSheet} testID="snippet-detail">
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{snippet.title}</Text>
            <Pressable onPress={onClose} hitSlop={8} testID="close-detail-btn">
              <Feather name="x" size={20} color={COLORS.onSurface} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
            <View style={styles.metaRow}>
              <View style={styles.langBadge}>
                <Text style={styles.langBadgeLabel}>{snippet.language}</Text>
              </View>
              <Text style={styles.metaAuthor}>by {snippet.author}</Text>
              <Pressable onPress={onStar} style={styles.starBtn} testID="detail-star-btn" hitSlop={6}>
                <Feather name="star" size={14} color={starred ? COLORS.brand : COLORS.onSurfaceSecondary} />
                <Text style={[styles.starLabel, starred && { color: COLORS.brand }]}>{snippet.stars}</Text>
              </Pressable>
            </View>
            {snippet.description ? <Text style={styles.detailDesc}>{snippet.description}</Text> : null}
            <View style={styles.detailCode}>
              {snippet.code.split("\n").map((line, i) => (
                <Text key={i} style={styles.detailCodeLine}>
                  {highlightLine(line, snippet.language).map((s, j) => (
                    <Text key={j} style={{ color: s.color }}>
                      {s.text}
                    </Text>
                  ))}
                </Text>
              ))}
            </View>
            {snippet.tags.length > 0 ? (
              <View style={styles.tagWrap}>
                {snippet.tags.map((t) => (
                  <Text key={t} style={styles.tag}>#{t}</Text>
                ))}
              </View>
            ) : null}
          </ScrollView>
          <View style={styles.detailFooter}>
            {isMine ? (
              <Pressable onPress={onEdit} style={[styles.secondaryFooterBtn, { marginBottom: SPACING.sm }]} testID="detail-edit-btn">
                <Feather name="edit-2" size={14} color={COLORS.brand} />
                <Text style={styles.secondaryFooterLabel}>Edit</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onInsert} style={styles.primaryBtn} testID="detail-insert-btn">
              <Text style={styles.primaryBtnLabel}>Insert at Cursor</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function PublishModal({
  visible,
  deviceId,
  onClose,
  onPublished,
}: {
  visible: boolean;
  deviceId: string;
  onClose: () => void;
  onPublished: (s: Snippet) => void;
}) {
  const { height } = useWindowDimensions();
  const [author, setAuthor] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [language, setLanguage] = useState<Language>("javascript");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      const savedName = await AsyncStorage.getItem(AUTHOR_KEY);
      if (savedName) setAuthor(savedName);
      if (!prefilled) {
        // Prefill from the currently active file (both modes checked, cloud takes precedence if selected)
        try {
          const mode = await settings.getSyncMode();
          const activeFileId = await settings.getActiveFile();
          if (activeFileId) {
            let f: FileItem | null = null;
            if (mode === "local") {
              const files = await local.listFiles((await settings.getActiveProject()) ?? "");
              f = files.find((x) => x.id === activeFileId) ?? null;
            } else {
              const activeProject = await settings.getActiveProject();
              if (activeProject) {
                const files = await store.listFiles("cloud", activeProject);
                f = files.find((x) => x.id === activeFileId) ?? null;
              }
            }
            if (f) {
              setLanguage(f.language);
              setCode(f.content);
              if (!title) setTitle(f.name);
            }
          }
        } catch {
          // ignore prefill errors
        }
        setPrefilled(true);
      }
    })();
  }, [visible, prefilled, title]);

  const submit = async () => {
    setError(null);
    if (!author.trim()) return setError("Author name is required.");
    if (!title.trim()) return setError("Title is required.");
    if (!code.trim()) return setError("Code cannot be empty.");
    setSubmitting(true);
    try {
      await AsyncStorage.setItem(AUTHOR_KEY, author.trim());
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const created = await api.createSnippet({
        author: author.trim(),
        author_device: deviceId,
        title: title.trim(),
        description: description.trim(),
        language,
        code,
        tags,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onPublished(created);
      // Reset fields
      setTitle("");
      setDescription("");
      setTagsText("");
      setCode("");
      setPrefilled(false);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.detailBackdrop, { height }]}
      >
        <View style={[styles.detailSheet, { maxHeight: "92%" }]} testID="publish-modal">
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Publish snippet</Text>
            <Pressable onPress={onClose} hitSlop={8} testID="close-publish-btn">
              <Feather name="x" size={20} color={COLORS.onSurface} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.formBody} keyboardShouldPersistTaps="handled">
            <FormField label="Author">
              <TextInput
                value={author}
                onChangeText={setAuthor}
                placeholder="Your display name"
                placeholderTextColor={COLORS.onSurfaceSecondary}
                style={styles.formInput}
                autoCapitalize="words"
                testID="publish-author"
              />
            </FormField>
            <FormField label="Title">
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Quick fetch helper"
                placeholderTextColor={COLORS.onSurfaceSecondary}
                style={styles.formInput}
                testID="publish-title"
              />
            </FormField>
            <FormField label="Description (optional)">
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="What does it do?"
                placeholderTextColor={COLORS.onSurfaceSecondary}
                style={[styles.formInput, { minHeight: 60 }]}
                multiline
                testID="publish-description"
              />
            </FormField>
            <FormField label="Language">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm }}>
                {LANGS.map((l) => (
                  <Pressable
                    key={l.key}
                    onPress={() => setLanguage(l.key)}
                    style={[styles.chip, language === l.key && styles.chipActive]}
                    testID={`publish-lang-${l.key}`}
                  >
                    <Text style={[styles.chipLabel, language === l.key && { color: COLORS.brand }]}>{l.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </FormField>
            <FormField label="Tags (comma separated)">
              <TextInput
                value={tagsText}
                onChangeText={setTagsText}
                placeholder="fetch, async, utility"
                placeholderTextColor={COLORS.onSurfaceSecondary}
                style={styles.formInput}
                autoCapitalize="none"
                testID="publish-tags"
              />
            </FormField>
            <FormField label="Code">
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="Paste the code you want to share…"
                placeholderTextColor={COLORS.onSurfaceSecondary}
                style={[styles.formInput, styles.formCode]}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                testID="publish-code"
              />
            </FormField>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>
          <View style={styles.detailFooter}>
            <Pressable
              onPress={submit}
              disabled={submitting}
              style={[styles.primaryBtn, submitting && { opacity: 0.5 }]}
              testID="submit-publish-btn"
            >
              {submitting ? (
                <ActivityIndicator size="small" color={COLORS.onBrand} />
              ) : (
                <Text style={styles.primaryBtnLabel}>Publish</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function EditSnippetModal({
  snippet,
  deviceId,
  onClose,
  onSaved,
}: {
  snippet: Snippet | null;
  deviceId: string;
  onClose: () => void;
  onSaved: (s: Snippet) => void;
}) {
  const { height } = useWindowDimensions();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [language, setLanguage] = useState<Language>("javascript");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!snippet) return;
    setTitle(snippet.title);
    setDescription(snippet.description ?? "");
    setTagsText((snippet.tags ?? []).join(", "));
    setLanguage(snippet.language);
    setCode(snippet.code);
    setError(null);
  }, [snippet]);

  if (!snippet) return null;

  const submit = async () => {
    setError(null);
    if (!title.trim()) return setError("Title is required.");
    if (!code.trim()) return setError("Code cannot be empty.");
    setSubmitting(true);
    try {
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const payload: SnippetUpdate = {
        device_id: deviceId,
        title: title.trim(),
        description: description.trim(),
        language,
        code,
        tags,
      };
      const updated = await api.updateSnippet(snippet.id, payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(updated);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.detailBackdrop, { height }]}
      >
        <View style={[styles.detailSheet, { maxHeight: "92%" }]} testID="edit-modal">
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Edit snippet</Text>
            <Pressable onPress={onClose} hitSlop={8} testID="close-edit-btn">
              <Feather name="x" size={20} color={COLORS.onSurface} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.formBody} keyboardShouldPersistTaps="handled">
            <FormField label="Title">
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Snippet title"
                placeholderTextColor={COLORS.onSurfaceSecondary}
                style={styles.formInput}
                testID="edit-title"
              />
            </FormField>
            <FormField label="Description">
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="What does it do?"
                placeholderTextColor={COLORS.onSurfaceSecondary}
                style={[styles.formInput, { minHeight: 60 }]}
                multiline
                testID="edit-description"
              />
            </FormField>
            <FormField label="Language">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm }}>
                {LANGS.map((l) => (
                  <Pressable
                    key={l.key}
                    onPress={() => setLanguage(l.key)}
                    style={[styles.chip, language === l.key && styles.chipActive]}
                    testID={`edit-lang-${l.key}`}
                  >
                    <Text style={[styles.chipLabel, language === l.key && { color: COLORS.brand }]}>{l.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </FormField>
            <FormField label="Tags (comma separated)">
              <TextInput
                value={tagsText}
                onChangeText={setTagsText}
                placeholder="fetch, async, utility"
                placeholderTextColor={COLORS.onSurfaceSecondary}
                style={styles.formInput}
                autoCapitalize="none"
                testID="edit-tags"
              />
            </FormField>
            <FormField label="Code">
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="Code…"
                placeholderTextColor={COLORS.onSurfaceSecondary}
                style={[styles.formInput, styles.formCode]}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                testID="edit-code"
              />
            </FormField>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>
          <View style={styles.detailFooter}>
            <Pressable
              onPress={submit}
              disabled={submitting}
              style={[styles.primaryBtn, submitting && { opacity: 0.5 }]}
              testID="save-edit-btn"
            >
              {submitting ? (
                <ActivityIndicator size="small" color={COLORS.onBrand} />
              ) : (
                <Text style={styles.primaryBtnLabel}>Save changes</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: SPACING.xs }}>
      <Text style={styles.formLabel}>{label}</Text>
      {children}
    </View>
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
  iconBtn: { padding: SPACING.sm, borderRadius: RADIUS.md },
  title: { color: COLORS.onSurface, fontSize: TEXT.lg, fontWeight: "700" },
  subtitle: { color: COLORS.brand, fontSize: TEXT.sm, letterSpacing: 1, textTransform: "uppercase" },
  publishBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    backgroundColor: COLORS.brand,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  publishBtnLabel: { color: COLORS.onBrand, fontWeight: "700", fontSize: TEXT.sm },

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchInput: {
    flex: 1,
    color: COLORS.onSurface,
    fontSize: TEXT.sm,
    padding: 0,
  },

  segmentWrap: {
    flexDirection: "row",
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    padding: 3,
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  segment: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: "center",
    borderRadius: RADIUS.sm,
  },
  segmentActive: {
    backgroundColor: COLORS.brandTertiary,
  },
  segmentLabel: {
    color: COLORS.onSurface,
    fontSize: TEXT.sm,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },

  deleteBtn: {
    padding: SPACING.xs,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  chipRow: {
    flexGrow: 0,
    height: 56,
  },
  chipRowContent: {
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    alignItems: "center",
  },
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

  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.md },
  emptyTitle: { color: COLORS.onSurface, fontSize: TEXT.lg, fontWeight: "600" },
  emptySub: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.base, textAlign: "center" },

  listContent: { padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xxl },
  card: {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  cardTitle: { color: COLORS.onSurface, fontSize: TEXT.base, fontWeight: "700" },
  cardAuthor: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm - 1 },
  cardDesc: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm, lineHeight: 18 },
  langBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    backgroundColor: COLORS.brandTertiary,
    borderRadius: RADIUS.sm,
  },
  langBadgeLabel: {
    color: COLORS.brand,
    fontSize: TEXT.sm - 2,
    fontFamily: FONT.mono,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  codePreview: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.sm,
    padding: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  codePreviewLine: {
    fontFamily: FONT.mono,
    fontSize: TEXT.sm - 1,
    color: COLORS.onSurface,
    lineHeight: 18,
  },
  cardFooter: { flexDirection: "row", alignItems: "center", gap: SPACING.md, marginTop: SPACING.xs },
  starBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  starLabel: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm - 1, fontFamily: FONT.mono },
  tagWrap: { flexDirection: "row", gap: SPACING.xs, flex: 1, flexWrap: "wrap" },
  tag: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm - 2, fontFamily: FONT.mono },
  insertBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.brandTertiary,
    borderWidth: 1,
    borderColor: COLORS.brand,
  },
  insertLabel: { color: COLORS.brand, fontSize: TEXT.sm - 1, fontWeight: "700" },

  detailBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "flex-end",
  },
  detailSheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.lg * 1.5,
    borderTopRightRadius: RADIUS.lg * 1.5,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxHeight: "85%",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sheetTitle: { color: COLORS.onSurface, fontSize: TEXT.lg, fontWeight: "700", flex: 1, marginRight: SPACING.sm },
  metaRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  metaAuthor: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm, flex: 1 },
  detailDesc: { color: COLORS.onSurface, fontSize: TEXT.base, lineHeight: 22 },
  detailCode: {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  detailCodeLine: {
    fontFamily: FONT.mono,
    fontSize: TEXT.sm,
    color: COLORS.onSurface,
    lineHeight: 20,
  },
  detailFooter: {
    padding: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  primaryBtn: {
    backgroundColor: COLORS.brand,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    alignItems: "center",
  },
  primaryBtnLabel: { color: COLORS.onBrand, fontWeight: "700", fontSize: TEXT.base },
  secondaryFooterBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.xs,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.brand,
    backgroundColor: COLORS.brandTertiary,
  },
  secondaryFooterLabel: { color: COLORS.brand, fontWeight: "700", fontSize: TEXT.base },

  formBody: { padding: SPACING.lg, gap: SPACING.md },
  formLabel: {
    color: COLORS.onSurfaceSecondary,
    fontSize: TEXT.sm,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  formInput: {
    backgroundColor: COLORS.surfaceSecondary,
    color: COLORS.onSurface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: TEXT.base,
  },
  formCode: {
    minHeight: 160,
    fontFamily: FONT.mono,
    fontSize: TEXT.sm,
    textAlignVertical: "top",
  },
  errorText: { color: COLORS.error, fontSize: TEXT.sm },
});
