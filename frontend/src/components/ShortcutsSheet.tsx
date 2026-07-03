import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS, FONT, RADIUS, SPACING, TEXT } from "@/src/theme";
import { Sheet } from "./Sheet";

const SHORTCUTS: { label: string; combo: string }[] = [
  { label: "Find in file", combo: "\u2318 + F" },
  { label: "Save", combo: "\u2318 + S" },
  { label: "Run", combo: "\u2318 + Enter" },
  { label: "AI assistant", combo: "\u2318 + K" },
  { label: "Quick file switcher", combo: "\u2318 + P" },
  { label: "Command palette", combo: "\u21e7 + \u2318 + P" },
  { label: "Shortcuts sheet", combo: "\u2318 + /" },
  { label: "Close overlay", combo: "Esc" },
];

export function ShortcutsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} testID="shortcuts-modal">
      <View style={styles.head}>
        <Feather name="command" size={22} color={COLORS.brand} />
        <Text style={styles.title}>Keyboard shortcuts</Text>
      </View>
      <View style={{ gap: SPACING.sm }}>
        {SHORTCUTS.map((s) => (
          <View key={s.combo} style={styles.row}>
            <Text style={styles.rowLabel}>{s.label}</Text>
            <View style={styles.keys}>
              {s.combo.split("+").map((k, i) => (
                <View key={i} style={styles.key}>
                  <Text style={styles.keyLabel}>{k.trim()}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.hint}>Tip: On Windows / Linux, use Ctrl instead of ⌘.</Text>
      <Pressable onPress={onClose} style={styles.primaryBtn} testID="close-shortcuts-btn">
        <Text style={styles.primaryBtnLabel}>Close</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  title: { color: COLORS.onSurface, fontSize: TEXT.lg, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  rowLabel: { color: COLORS.onSurface, fontSize: TEXT.base },
  keys: { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  key: {
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceTertiary,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
  },
  keyLabel: { color: COLORS.onSurface, fontFamily: FONT.mono, fontSize: TEXT.sm - 1, fontWeight: "600" },
  hint: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm, fontStyle: "italic" },
  primaryBtn: {
    backgroundColor: COLORS.brand,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: "center",
  },
  primaryBtnLabel: { color: COLORS.onBrand, fontWeight: "700", fontSize: TEXT.base },
});
