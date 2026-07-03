import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { COLORS, FONT, RADIUS, SPACING, TEXT } from "@/src/theme";
import { Sheet } from "./Sheet";

export function PromptModal({
  visible,
  title,
  placeholder,
  value,
  onChange,
  onCancel,
  onConfirm,
  confirmLabel,
  testID,
}: {
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
    <Sheet visible={visible} onClose={onCancel} testID={testID}>
      <Text style={styles.title}>{title}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.onSurfaceSecondary}
        style={styles.input}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        testID="prompt-input"
      />
      <View style={styles.actions}>
        <Pressable onPress={onCancel} style={styles.secondaryBtn} testID="prompt-cancel">
          <Text style={styles.secondaryBtnLabel}>Cancel</Text>
        </Pressable>
        <Pressable onPress={onConfirm} style={styles.primaryBtn} testID="prompt-confirm">
          <Text style={styles.primaryBtnLabel}>{confirmLabel}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

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
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: SPACING.sm, marginTop: SPACING.sm },
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
});
