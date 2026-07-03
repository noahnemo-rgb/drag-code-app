import { Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import type { Language } from "@/src/lib/api";
import { LANGS } from "@/src/lib/language";
import { COLORS, FONT, RADIUS, SPACING, TEXT } from "@/src/theme";
import { Sheet } from "./Sheet";

export function NewFileModal({
  visible,
  name,
  onNameChange,
  lang,
  onLangChange,
  onCancel,
  onCreate,
}: {
  visible: boolean;
  name: string;
  onNameChange: (s: string) => void;
  lang: Language;
  onLangChange: (l: Language) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onCancel} testID="new-file-modal">
      <Text style={styles.title}>New file</Text>
      <TextInput
        value={name}
        onChangeText={onNameChange}
        placeholder="e.g. main.py"
        placeholderTextColor={COLORS.onSurfaceSecondary}
        style={styles.input}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        testID="new-file-name-input"
      />
      <Text style={styles.label}>Language</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm }}>
        {LANGS.map((l) => {
          const active = lang === l.key;
          return (
            <Pressable
              key={l.key}
              onPress={() => onLangChange(l.key)}
              style={[styles.chip, active && styles.chipActive]}
              testID={`lang-${l.key}`}
            >
              <Text style={[styles.chipLabel, active && { color: COLORS.brand }]}>{l.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable onPress={onCancel} style={styles.secondaryBtn} testID="cancel-new-file">
        <Text style={styles.secondaryBtnLabel}>Cancel</Text>
      </Pressable>
      <Pressable onPress={onCreate} style={styles.primaryBtn} testID="confirm-new-file">
        <Text style={styles.primaryBtnLabel}>Create</Text>
      </Pressable>
    </Sheet>
  );
}

// Note: two action rows stack vertically inside <Sheet /> (gap: SPACING.md).
// If we want them side-by-side later, add a <View style={row}> wrapper.

const styles = StyleSheet.create({
  title: { color: COLORS.onSurface, fontSize: TEXT.lg, fontWeight: "700" },
  input: {
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
  label: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm, marginTop: SPACING.sm },
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
  chipActive: { backgroundColor: COLORS.brandTertiary, borderColor: COLORS.brand },
  chipLabel: { color: COLORS.onSurface, fontSize: TEXT.sm, fontWeight: "600" },
  primaryBtn: {
    backgroundColor: COLORS.brand,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: "center",
  },
  primaryBtnLabel: { color: COLORS.onBrand, fontWeight: "700", fontSize: TEXT.base },
  secondaryBtn: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceTertiary,
    alignItems: "center",
  },
  secondaryBtnLabel: { color: COLORS.onSurface, fontWeight: "600", fontSize: TEXT.base },
});
