import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text } from "react-native";
import type { Language } from "@/src/lib/api";
import { LANGS } from "@/src/lib/language";
import { COLORS, RADIUS, SPACING, TEXT } from "@/src/theme";
import { Sheet } from "./Sheet";

export function LangMenu({
  visible,
  current,
  onSelect,
  onClose,
}: {
  visible: boolean;
  current: Language;
  onSelect: (l: Language) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} testID="lang-menu">
      <Text style={styles.title}>Language</Text>
      {LANGS.map((l) => {
        const active = current === l.key;
        return (
          <Pressable
            key={l.key}
            onPress={() => onSelect(l.key)}
            style={[styles.row, active && { backgroundColor: COLORS.brandTertiary }]}
            testID={`change-lang-${l.key}`}
          >
            <Text style={[styles.rowText, active && { color: COLORS.brand }]}>{l.label}</Text>
            {active ? <Feather name="check" size={16} color={COLORS.brand} /> : null}
          </Pressable>
        );
      })}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { color: COLORS.onSurface, fontSize: TEXT.lg, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
  },
  rowText: { color: COLORS.onSurface, fontSize: TEXT.base },
});
