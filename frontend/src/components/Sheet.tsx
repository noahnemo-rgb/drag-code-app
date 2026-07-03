// A reusable centered modal used by prompt / info / small dialogs across the app.
// Owns the shared backdrop + card styling so individual screens don't duplicate it.
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { COLORS, RADIUS, SPACING } from "@/src/theme";

export function Sheet({
  visible,
  onClose,
  testID,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  testID?: string;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}} testID={testID}>
          <View>{children}</View>
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
    maxWidth: 400,
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.md,
  },
});
