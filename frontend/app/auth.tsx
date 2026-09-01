import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import { AuthUser, clearSession, getAuthUser, isLoggedIn } from "@/src/lib/auth";
import { COLORS, FONT, RADIUS, SPACING, TEXT } from "@/src/theme";

type Mode = "login" | "register";

export default function AuthScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    (async () => {
      if (await isLoggedIn()) {
        const u = await getAuthUser();
        setUser(u);
      }
      setBooting(false);
    })();
  }, []);

  const submit = async () => {
    setError(null);
    const e = email.trim().toLowerCase();
    if (!e.includes("@")) return setError("Enter a valid email.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    setBusy(true);
    try {
      const res =
        mode === "login"
          ? await api.login({ email: e, password })
          : await api.register({
              email: e,
              password,
              display_name: displayName.trim() || undefined,
            });
      setUser(res.user);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      setError(String(err));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await clearSession();
    setUser(null);
    Haptics.selectionAsync();
  };

  if (booting) {
    return (
      <SafeAreaView style={styles.root}>
        <ActivityIndicator color={COLORS.brand} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={8} testID="auth-back">
          <Feather name="arrow-left" size={22} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.brand}>Syntax</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.body}
      >
        {user ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Signed in</Text>
            <Text style={styles.sub}>
              {user.display_name}
              {"\n"}
              {user.email}
            </Text>
            <Pressable style={styles.primaryBtn} onPress={() => router.replace("/")} testID="auth-continue">
              <Text style={styles.primaryLabel}>Continue to editor</Text>
            </Pressable>
            <Pressable style={styles.ghostBtn} onPress={logout} testID="auth-logout">
              <Text style={styles.ghostLabel}>Sign out</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.heading}>{mode === "login" ? "Sign in" : "Create account"}</Text>
            <Text style={styles.sub}>
              Cloud projects, AI chat history, and snippet ownership use your Syntax account.
            </Text>

            {mode === "register" && (
              <TextInput
                style={styles.input}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Display name"
                placeholderTextColor={COLORS.onSurfaceSecondary}
                autoCapitalize="words"
                testID="auth-display-name"
              />
            )}
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={COLORS.onSurfaceSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
              testID="auth-email"
            />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Password (8+ characters)"
              placeholderTextColor={COLORS.onSurfaceSecondary}
              secureTextEntry
              testID="auth-password"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[styles.primaryBtn, busy && { opacity: 0.7 }]}
              onPress={submit}
              disabled={busy}
              testID="auth-submit"
            >
              {busy ? (
                <ActivityIndicator color={COLORS.onBrand} />
              ) : (
                <Text style={styles.primaryLabel}>{mode === "login" ? "Sign in" : "Register"}</Text>
              )}
            </Pressable>

            <Pressable
              style={styles.ghostBtn}
              onPress={() => {
                setMode(mode === "login" ? "register" : "login");
                setError(null);
              }}
              testID="auth-toggle-mode"
            >
              <Text style={styles.ghostLabel}>
                {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
              </Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    fontFamily: FONT.mono,
    fontSize: TEXT.xl,
    color: COLORS.brand,
    letterSpacing: 1,
  },
  body: { flex: 1, justifyContent: "center", padding: SPACING.xl },
  card: { gap: SPACING.md },
  heading: {
    fontFamily: FONT.mono,
    fontSize: TEXT.xxl,
    color: COLORS.onSurface,
  },
  sub: {
    color: COLORS.onSurfaceSecondary,
    fontSize: TEXT.base,
    lineHeight: 20,
    marginBottom: SPACING.sm,
  },
  input: {
    backgroundColor: COLORS.surfaceSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    color: COLORS.onSurface,
    fontFamily: FONT.mono,
    fontSize: TEXT.base,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  primaryBtn: {
    backgroundColor: COLORS.brand,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: "center",
    marginTop: SPACING.sm,
  },
  primaryLabel: {
    color: COLORS.onBrand,
    fontFamily: FONT.mono,
    fontSize: TEXT.base,
    fontWeight: "600",
  },
  ghostBtn: { paddingVertical: SPACING.md, alignItems: "center" },
  ghostLabel: { color: COLORS.brand, fontSize: TEXT.base },
  error: { color: COLORS.error, fontSize: TEXT.sm },
});
