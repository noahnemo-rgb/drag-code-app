import { Feather } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { FileItem, Snippet } from "@/src/lib/api";
import { isRecent } from "@/src/lib/mru";
import { COLORS, FONT, RADIUS, SPACING, TEXT } from "@/src/theme";
import { HighlightedText } from "./HighlightedText";

export type QuickResult =
  | { kind: "file"; file: FileItem; score: number }
  | { kind: "line"; file: FileItem; line: number; text: string; score: number }
  | { kind: "snippet"; snippet: Snippet; score: number };

const sectionLabel = (k: QuickResult["kind"]) =>
  k === "file" ? "Files" : k === "line" ? "In-file matches" : "Snippets";

export function QuickFileSwitcherModal({
  visible,
  onClose,
  query,
  onQueryChange,
  index,
  onIndexChange,
  results,
  recentFileIds,
  onOpen,
}: {
  visible: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  index: number;
  onIndexChange: (updater: (i: number) => number) => void;
  results: QuickResult[];
  recentFileIds: string[];
  onOpen: (r: QuickResult) => void | Promise<void>;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}} testID="quick-file-modal">
          <View style={styles.header}>
            <Feather name="search" size={16} color={COLORS.onSurfaceSecondary} />
            <TextInput
              value={query}
              onChangeText={onQueryChange}
              placeholder="Files, content, or snippets…"
              placeholderTextColor={COLORS.onSurfaceSecondary}
              style={styles.input}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              testID="quick-file-input"
              onKeyPress={(e) => {
                const k = (e.nativeEvent as { key?: string }).key ?? "";
                if (k === "ArrowDown") {
                  onIndexChange((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
                } else if (k === "ArrowUp") {
                  onIndexChange((i) => Math.max(i - 1, 0));
                } else if (k === "Enter" || k === "Return") {
                  const pick = results[index];
                  if (pick) void onOpen(pick);
                }
              }}
            />
            <Text style={styles.count}>{results.length}</Text>
          </View>
          <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
            {results.length === 0 ? (
              <Text style={styles.emptyMuted}>No matches</Text>
            ) : (
              results.map((r, i) => {
                const isCurrent = i === index;
                const prevKind = i > 0 ? results[i - 1].kind : null;
                const showHeader = r.kind !== prevKind;
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
                const recent = r.kind === "file" && isRecent(recentFileIds, r.file.id);
                return (
                  <View key={key}>
                    {showHeader ? (
                      <View style={styles.sectionHeader} testID={`quick-section-${r.kind}`}>
                        <Text style={styles.sectionHeaderLabel}>{sectionLabel(r.kind)}</Text>
                      </View>
                    ) : null}
                    <Pressable
                      onPress={() => onOpen(r)}
                      style={[styles.row, isCurrent && styles.rowActive]}
                      testID={tid}
                    >
                      <View style={styles.kindBadge}>
                        <Text style={styles.kindLabel}>
                          {r.kind === "file" ? "FILE" : r.kind === "line" ? "LINE" : "SNIP"}
                        </Text>
                      </View>
                      {r.kind === "file" ? (
                        <>
                          <View style={{ flex: 1 }}>
                            <HighlightedText
                              text={r.file.name}
                              query={query}
                              style={[styles.name, isCurrent && { color: COLORS.brand }]}
                              hlColor={COLORS.brand}
                              numberOfLines={1}
                            />
                          </View>
                          {recent ? (
                            <View style={styles.recentBadge} testID={`quick-file-row-${r.file.id}-recent`}>
                              <Text style={styles.recentBadgeLabel}>RECENT</Text>
                            </View>
                          ) : null}
                          <Text style={styles.lang}>{r.file.language}</Text>
                        </>
                      ) : r.kind === "line" ? (
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.linePath} numberOfLines={1}>
                            <Text style={[isCurrent && { color: COLORS.brand }]}>{r.file.name}</Text>
                            <Text style={styles.linePathDim}>:{r.line}</Text>
                          </Text>
                          <HighlightedText
                            text={r.text.trim().slice(0, 80)}
                            query={query}
                            style={styles.lineSnippet}
                            hlColor={COLORS.brand}
                            numberOfLines={1}
                          />
                        </View>
                      ) : (
                        <View style={{ flex: 1, gap: 2 }}>
                          <HighlightedText
                            text={r.snippet.title}
                            query={query}
                            style={[styles.name, isCurrent && { color: COLORS.brand }]}
                            hlColor={COLORS.brand}
                            numberOfLines={1}
                          />
                          <Text style={styles.lineSnippet} numberOfLines={1}>
                            by {r.snippet.author} · {r.snippet.language}
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  </View>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.lg,
  },
  card: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  input: { flex: 1, color: COLORS.onSurface, fontSize: TEXT.base, padding: 0 },
  count: { color: COLORS.onSurfaceSecondary, fontFamily: FONT.mono, fontSize: TEXT.sm - 1 },
  emptyMuted: {
    color: COLORS.onSurfaceSecondary,
    fontSize: TEXT.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  rowActive: {
    backgroundColor: COLORS.brandTertiary,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.brand,
  },
  name: { flex: 1, color: COLORS.onSurface, fontFamily: FONT.mono, fontSize: TEXT.sm },
  lang: {
    color: COLORS.onSurfaceSecondary,
    fontFamily: FONT.mono,
    fontSize: TEXT.sm - 2,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  kindBadge: {
    width: 40,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceTertiary,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
  },
  kindLabel: {
    color: COLORS.onSurfaceSecondary,
    fontFamily: FONT.mono,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
  },
  linePath: { fontFamily: FONT.mono, fontSize: TEXT.sm, color: COLORS.onSurface },
  linePathDim: { color: COLORS.onSurfaceSecondary },
  lineSnippet: { fontFamily: FONT.mono, fontSize: TEXT.sm - 1, color: COLORS.onSurfaceSecondary },
  sectionHeader: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: 4,
  },
  sectionHeaderLabel: {
    color: COLORS.onSurfaceSecondary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  recentBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.brandTertiary,
    borderWidth: 1,
    borderColor: COLORS.brand,
  },
  recentBadgeLabel: {
    color: COLORS.brand,
    fontFamily: FONT.mono,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
  },
});
