import { Feather } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { isRecent } from "@/src/lib/mru";
import { COLORS, FONT, RADIUS, SPACING, TEXT } from "@/src/theme";
import { HighlightedText } from "./HighlightedText";

export type PaletteCommand = {
  id: string;
  label: string;
  hint: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
};

export function CommandPaletteModal({
  visible,
  onClose,
  query,
  onQueryChange,
  index,
  onIndexChange,
  matches,
  recentIds,
  onRun,
}: {
  visible: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  index: number;
  onIndexChange: (updater: (i: number) => number) => void;
  matches: PaletteCommand[];
  recentIds: string[];
  onRun: (c: PaletteCommand) => void | Promise<void>;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}} testID="command-palette-modal">
          <View style={styles.header}>
            <Feather name="terminal" size={16} color={COLORS.brand} />
            <TextInput
              value={query}
              onChangeText={onQueryChange}
              placeholder="Run command…"
              placeholderTextColor={COLORS.onSurfaceSecondary}
              style={styles.input}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              testID="command-palette-input"
              onKeyPress={(e) => {
                const k = (e.nativeEvent as { key?: string }).key ?? "";
                if (k === "ArrowDown") {
                  onIndexChange((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)));
                } else if (k === "ArrowUp") {
                  onIndexChange((i) => Math.max(i - 1, 0));
                } else if (k === "Enter" || k === "Return") {
                  const pick = matches[index];
                  if (pick) void onRun(pick);
                }
              }}
            />
            <Text style={styles.count}>{matches.length}</Text>
          </View>
          <ScrollView style={{ maxHeight: 400 }} keyboardShouldPersistTaps="handled">
            {matches.length === 0 ? (
              <Text style={styles.emptyMuted}>No commands</Text>
            ) : (
              matches.map((c, i) => {
                const isCurrent = i === index;
                const recent = isRecent(recentIds, c.id);
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => onRun(c)}
                    disabled={c.disabled}
                    style={[
                      styles.row,
                      isCurrent && styles.rowActive,
                      c.disabled && { opacity: 0.4 },
                    ]}
                    testID={`command-${c.id}`}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <HighlightedText
                        text={c.label}
                        query={query}
                        style={[styles.label, isCurrent && { color: COLORS.brand }]}
                        hlColor={COLORS.brand}
                        numberOfLines={1}
                      />
                      <Text style={styles.hint} numberOfLines={1}>{c.hint}</Text>
                    </View>
                    {recent ? (
                      <View style={styles.recentBadge} testID={`command-${c.id}-recent`}>
                        <Text style={styles.recentBadgeLabel}>RECENT</Text>
                      </View>
                    ) : null}
                    {c.shortcut ? (
                      <View style={styles.shortcut}>
                        <Text style={styles.shortcutLabel}>{c.shortcut}</Text>
                      </View>
                    ) : null}
                  </Pressable>
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
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  rowActive: {
    backgroundColor: COLORS.brandTertiary,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.brand,
  },
  label: { color: COLORS.onSurface, fontSize: TEXT.base, fontWeight: "600" },
  hint: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm - 1 },
  shortcut: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceTertiary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  shortcutLabel: {
    color: COLORS.onSurfaceSecondary,
    fontFamily: FONT.mono,
    fontSize: TEXT.sm - 1,
    fontWeight: "600",
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
