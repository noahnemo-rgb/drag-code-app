import { Feather } from "@expo/vector-icons";
import { Platform, Pressable, StyleSheet, Text } from "react-native";
import { COLORS, RADIUS, SPACING, TEXT } from "@/src/theme";
import { Sheet } from "./Sheet";

export function BtInfoModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const body =
    Platform.OS === "ios"
      ? "iOS doesn't allow apps to open Bluetooth settings directly. Please open the Settings app and go to Bluetooth to pair your keyboard. Once paired, it will work everywhere in Syntax automatically."
      : Platform.OS === "web"
      ? "Bluetooth keyboard pairing is only available on physical iOS / Android devices. On desktop, pair via your OS Bluetooth panel."
      : "We couldn't open your Bluetooth settings automatically. Open your phone's Settings app and go to Bluetooth to pair your keyboard.";

  return (
    <Sheet visible={visible} onClose={onClose} testID="bt-info-modal">
      <Feather name="bluetooth" size={22} color={COLORS.brand} />
      <Text style={styles.title}>Pair a Bluetooth keyboard</Text>
      <Text style={styles.body}>{body}</Text>
      <Pressable onPress={onClose} style={styles.primaryBtn} testID="bt-info-ok-btn">
        <Text style={styles.primaryBtnLabel}>Got it</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { color: COLORS.onSurface, fontSize: TEXT.lg, fontWeight: "700" },
  body: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.base, lineHeight: 22 },
  primaryBtn: {
    backgroundColor: COLORS.brand,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: "center",
  },
  primaryBtnLabel: { color: COLORS.onBrand, fontWeight: "700", fontSize: TEXT.base },
});
