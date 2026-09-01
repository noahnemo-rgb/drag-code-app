import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { DEFAULT_OPENROUTER_MODEL, openRouterKey, openRouterModel } from "@/src/lib/ai-keys";
import { getAiProviderInfo, signInAiProvider } from "@/src/lib/ai-chat";
import { COLORS, FONT, RADIUS, SPACING, TEXT } from "@/src/theme";

export function AiSettingsModal({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { height } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [providerLabel, setProviderLabel] = useState("");
  const [providerDesc, setProviderDesc] = useState("");
  const [providerReady, setProviderReady] = useState(false);

  const [apiKey, setApiKey] = useState("");
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [model, setModel] = useState(DEFAULT_OPENROUTER_MODEL);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      setLoading(true);
      setStatus(null);
      try {
        const info = await getAiProviderInfo();
        setProviderLabel(info.label);
        setProviderDesc(info.description);
        setProviderReady(info.configured);
        if (!isWeb) {
          const [savedKey, savedModel] = await Promise.all([openRouterKey.get(), openRouterModel.get()]);
          if (savedKey) setApiKey(savedKey);
          setKeyLoaded(!!savedKey);
          setModel(savedModel);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [visible, isWeb]);

  const saveNativeKey = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const trimmed = apiKey.trim();
      if (!trimmed) {
        setStatus({ ok: false, text: "Paste your OpenRouter API key first." });
        return;
      }
      await openRouterKey.set(trimmed);
      await openRouterModel.set(model.trim() || DEFAULT_OPENROUTER_MODEL);
      setKeyLoaded(true);
      setProviderReady(true);
      setStatus({ ok: true, text: "OpenRouter key saved on this device." });
      onSaved?.();
    } catch (e) {
      setStatus({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const clearNativeKey = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await openRouterKey.clear();
      setApiKey("");
      setKeyLoaded(false);
      setProviderReady(false);
      setStatus({ ok: true, text: "OpenRouter key removed." });
      onSaved?.();
    } finally {
      setBusy(false);
    }
  };

  const signInPuter = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await signInAiProvider();
      const info = await getAiProviderInfo();
      setProviderLabel(info.label);
      setProviderDesc(info.description);
      setProviderReady(info.configured);
      setStatus({ ok: true, text: "Signed in to Puter." });
      onSaved?.();
    } catch (e) {
      setStatus({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetWrap}>
        <View style={[styles.sheet, { maxHeight: height * 0.88 }]}>
          <View style={styles.header}>
            <Text style={styles.title}>AI settings</Text>
            <Pressable onPress={onClose} hitSlop={8} testID="ai-settings-close">
              <Feather name="x" size={22} color={COLORS.onSurfaceSecondary} />
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator color={COLORS.brand} style={{ marginVertical: SPACING.xl }} />
          ) : (
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <View style={styles.infoBox}>
                <Text style={styles.infoTitle}>{providerLabel}</Text>
                <Text style={styles.infoText}>{providerDesc}</Text>
                <Text style={[styles.infoText, { marginTop: SPACING.sm }]}>
                  {providerReady ? "Ready to chat." : "Setup required before sending messages."}
                </Text>
              </View>

              {isWeb ? (
                <>
                  <Text style={styles.sectionLabel}>Web — Puter sign-in</Text>
                  <Text style={styles.help}>
                    AI on web uses Puter.js. You may be asked to sign in to your Puter account the first time you send a
                    message. Usage is billed to your Puter account, not the app developer.
                  </Text>
                  <Pressable
                    style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
                    onPress={signInPuter}
                    disabled={busy}
                    testID="ai-puter-signin-btn"
                  >
                    <Text style={styles.primaryBtnText}>{busy ? "Working…" : "Sign in to Puter"}</Text>
                  </Pressable>
                  <Pressable onPress={() => Linking.openURL("https://puter.com")} style={styles.linkBtn}>
                    <Text style={styles.linkText}>Open puter.com</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.sectionLabel}>Mobile — your OpenRouter key</Text>
                  <Text style={styles.help}>
                    Your API key is stored in the device keychain and sent only to OpenRouter from this app — never to
                    our backend.
                  </Text>
                  <Text style={styles.fieldLabel}>OpenRouter API key</Text>
                  <TextInput
                    value={apiKey}
                    onChangeText={setApiKey}
                    placeholder="sk-or-…"
                    placeholderTextColor={COLORS.onSurfaceSecondary}
                    secureTextEntry={keyLoaded && apiKey.length > 8}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                    testID="ai-openrouter-key"
                  />
                  <Text style={styles.fieldLabel}>Model slug</Text>
                  <TextInput
                    value={model}
                    onChangeText={setModel}
                    placeholder={DEFAULT_OPENROUTER_MODEL}
                    placeholderTextColor={COLORS.onSurfaceSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                    testID="ai-openrouter-model"
                  />
                  <Pressable
                    style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
                    onPress={saveNativeKey}
                    disabled={busy}
                    testID="ai-save-key-btn"
                  >
                    <Text style={styles.primaryBtnText}>{busy ? "Saving…" : "Save key"}</Text>
                  </Pressable>
                  {keyLoaded ? (
                    <Pressable onPress={clearNativeKey} disabled={busy} style={styles.linkBtn}>
                      <Text style={[styles.linkText, { color: COLORS.error }]}>Remove saved key</Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => Linking.openURL("https://openrouter.ai/keys")} style={styles.linkBtn}>
                    <Text style={styles.linkText}>Get a key at openrouter.ai/keys</Text>
                  </Pressable>
                </>
              )}

              {status ? (
                <Text style={[styles.status, { color: status.ok ? COLORS.success : COLORS.error }]}>{status.text}</Text>
              ) : null}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheetWrap: { justifyContent: "flex-end" },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingBottom: SPACING.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  title: { color: COLORS.onSurface, fontSize: TEXT.lg, fontWeight: "700" },
  body: { padding: SPACING.lg, gap: SPACING.sm },
  infoBox: {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  infoTitle: { color: COLORS.brand, fontSize: TEXT.sm, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  infoText: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm, lineHeight: 20, marginTop: SPACING.xs },
  sectionLabel: { color: COLORS.onSurface, fontSize: TEXT.base, fontWeight: "600", marginTop: SPACING.sm },
  help: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm, lineHeight: 20 },
  fieldLabel: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm, marginTop: SPACING.sm },
  input: {
    backgroundColor: COLORS.surfaceSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.onSurface,
    fontFamily: FONT.mono,
    fontSize: TEXT.sm,
  },
  primaryBtn: {
    backgroundColor: COLORS.brand,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: "center",
    marginTop: SPACING.md,
  },
  primaryBtnText: { color: COLORS.onBrand, fontWeight: "700", fontSize: TEXT.base },
  linkBtn: { paddingVertical: SPACING.sm, alignItems: "center" },
  linkText: { color: COLORS.brand, fontSize: TEXT.sm },
  status: { fontSize: TEXT.sm, marginTop: SPACING.md, textAlign: "center" },
});
