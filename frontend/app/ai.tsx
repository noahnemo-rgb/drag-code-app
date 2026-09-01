import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AiSettingsModal } from "@/src/components/AiSettingsModal";
import { getAiProviderInfo, streamAiChat } from "@/src/lib/ai-chat";
import { appendChatTurn, clearChatHistory, loadChatHistory } from "@/src/lib/chat-storage";
import { loadEditorContext, type EditorContext } from "@/src/lib/editor-context";
import { getTier } from "@/src/lib/tier-store";
import { canSendAiMessage, incrementAiMessageCount } from "@/src/lib/usage-tiers";
import { highlightLine } from "@/src/lib/highlight";
import type { Language } from "@/src/lib/api";
import { COLORS, FONT, RADIUS, SPACING, TEXT } from "@/src/theme";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
}

const SESSION_KEY = "syntax.chat.session_id";

export default function AiScreen() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [editorCtx, setEditorCtx] = useState<EditorContext | undefined>(undefined);
  const [providerLabel, setProviderLabel] = useState<string>("");
  const [providerReady, setProviderReady] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const listRef = useRef<FlatList<Msg>>(null);

  const refreshProvider = useCallback(async () => {
    const info = await getAiProviderInfo();
    setProviderLabel(info.label);
    setProviderReady(info.configured);
  }, []);

  useEffect(() => {
    (async () => {
      let sid = await AsyncStorage.getItem(SESSION_KEY);
      if (!sid) {
        sid = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await AsyncStorage.setItem(SESSION_KEY, sid);
      }
      setSessionId(sid);
      setEditorCtx(await loadEditorContext());
      await refreshProvider();
      const history = await loadChatHistory(sid);
      setMessages(
        history.map((h) => ({
          id: h.id,
          role: h.role,
          content: h.content,
        })),
      );
      const pending = await AsyncStorage.getItem("syntax.pending_prompt");
      if (pending) {
        await AsyncStorage.removeItem("syntax.pending_prompt");
        void sendPrompt(sid, pending);
      }
    })();
  }, [refreshProvider]);

  const sendPrompt = async (sid: string, text: string) => {
    const t = text.trim();
    if (!t || !sid) return;
    const tier = await getTier();
    const aiQuota = await canSendAiMessage(tier);
    if (!aiQuota.ok) {
      Alert.alert(
        "AI message limit reached",
        `You've used ${aiQuota.used}/${aiQuota.limit} AI messages this month on the ${tier} plan. Open Plan & usage in the file drawer to see limits or try Pro (dev toggle).`,
      );
      return;
    }
    if (!providerReady && Platform.OS !== "web") {
      setShowSettings(true);
      return;
    }
    const userMsg: Msg = { id: `u-${Date.now()}`, role: "user", content: t };
    const aiMsg: Msg = { id: `a-${Date.now()}`, role: "assistant", content: "", pending: true };
    setMessages((m) => [...m, userMsg, aiMsg]);
    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 30);
    try {
      const ctx = (await loadEditorContext()) ?? editorCtx;
      if (ctx) setEditorCtx(ctx);
      const history = messages
        .filter((m) => !m.pending && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content }));
      const assistantText = await streamAiChat({
        message: t,
        history,
        context: ctx ? { code: ctx.code, language: ctx.language } : undefined,
        onChunk: (chunk) => {
          setMessages((m) =>
            m.map((msg) => (msg.id === aiMsg.id ? { ...msg, content: msg.content + chunk } : msg)),
          );
          listRef.current?.scrollToEnd({ animated: false });
        },
      });
      setMessages((m) => m.map((msg) => (msg.id === aiMsg.id ? { ...msg, pending: false } : msg)));
      await appendChatTurn(sid, t, assistantText);
      await incrementAiMessageCount();
      await refreshProvider();
    } catch (e: unknown) {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === aiMsg.id ? { ...msg, content: `[Error: ${String(e)}]`, pending: false } : msg,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    if (!sessionId) return;
    const t = input.trim();
    if (!t) return;
    setInput("");
    await sendPrompt(sessionId, t);
  };

  const clear = async () => {
    if (!sessionId) return;
    await clearChatHistory(sessionId);
    setMessages([]);
  };

  const copy = async (text: string) => {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const insertIntoEditor = async (text: string) => {
    await AsyncStorage.setItem("syntax.pending_insert", text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const applyFixToEditor = async (text: string) => {
    await AsyncStorage.setItem("syntax.pending_replace", text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const providerHint =
    Platform.OS === "web"
      ? "Powered by Puter — sign in when prompted; usage is on your Puter account."
      : providerReady
        ? providerLabel
        : "Add your OpenRouter key in settings to enable AI.";

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={8}>
          <Feather name="arrow-left" size={22} color={COLORS.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>AI Assistant</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {providerLabel || (Platform.OS === "web" ? "Puter" : "OpenRouter BYOK")}
          </Text>
          {editorCtx ? (
            <Text style={styles.contextHint} numberOfLines={1} testID="ai-context-hint">
              Using {editorCtx.name || "current file"} ({editorCtx.language})
            </Text>
          ) : null}
        </View>
        <Pressable onPress={() => setShowSettings(true)} style={styles.iconBtn} testID="ai-settings-btn" hitSlop={8}>
          <Feather name="settings" size={18} color={COLORS.onSurfaceSecondary} />
        </Pressable>
        <Pressable onPress={clear} style={styles.iconBtn} testID="clear-chat-btn" hitSlop={8}>
          <Feather name="trash-2" size={18} color={COLORS.onSurfaceSecondary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Feather name="cpu" size={28} color={COLORS.brand} />
            </View>
            <Text style={styles.emptyTitle}>How can I help with your code today?</Text>
            <Text style={styles.emptySub}>{providerHint}</Text>
            {!providerReady && Platform.OS !== "web" ? (
              <Pressable style={styles.setupBtn} onPress={() => setShowSettings(true)} testID="ai-open-settings-cta">
                <Text style={styles.setupBtnText}>Open AI settings</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <MessageBubble msg={item} onCopy={copy} onInsert={insertIntoEditor} onApplyFix={applyFixToEditor} />
            )}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            testID="chat-list"
          />
        )}

        <View style={styles.inputBar}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask Syntax…"
            placeholderTextColor={COLORS.onSurfaceSecondary}
            style={styles.input}
            multiline
            editable={!sending}
            testID="chat-input"
          />
          <Pressable
            onPress={send}
            style={[styles.sendBtn, (!input.trim() || sending) && { opacity: 0.5 }]}
            disabled={!input.trim() || sending}
            testID="chat-send-btn"
          >
            {sending ? (
              <ActivityIndicator size="small" color={COLORS.onBrand} />
            ) : (
              <Feather name="send" size={16} color={COLORS.onBrand} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <AiSettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        onSaved={() => void refreshProvider()}
      />
    </SafeAreaView>
  );
}

function MessageBubble({
  msg,
  onCopy,
  onInsert,
  onApplyFix,
}: {
  msg: Msg;
  onCopy: (text: string) => void;
  onInsert: (text: string) => void;
  onApplyFix: (text: string) => void;
}) {
  const isUser = msg.role === "user";
  const parts = parseContent(msg.content);
  const firstCodeIdx = !isUser ? parts.findIndex((p) => p.kind === "code") : -1;
  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
        {parts.map((p, i) =>
          p.kind === "code" ? (
            <View key={i} style={styles.codeBlock}>
              <View style={styles.codeBlockHeader}>
                <Text style={styles.codeBlockLang}>{p.lang || "code"}</Text>
                <View style={styles.codeActions}>
                  {i === firstCodeIdx ? (
                    <Pressable
                      onPress={() => onApplyFix(p.text)}
                      hitSlop={6}
                      style={styles.applyFixBtn}
                      testID="apply-fix-btn"
                    >
                      <Feather name="zap" size={12} color={COLORS.onBrand} />
                      <Text style={styles.applyFixLabel}>Apply Fix</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => onInsert(p.text)}
                    hitSlop={6}
                    style={styles.copyBtn}
                    testID="insert-code-btn"
                  >
                    <Feather name="corner-down-left" size={12} color={COLORS.brand} />
                    <Text style={[styles.copyLabel, { color: COLORS.brand }]}>Insert</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onCopy(p.text)}
                    hitSlop={6}
                    style={styles.copyBtn}
                    testID="copy-code-btn"
                  >
                    <Feather name="copy" size={12} color={COLORS.onSurfaceSecondary} />
                    <Text style={styles.copyLabel}>Copy</Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.codeContent}>{renderHighlightedCode(p.text, p.lang)}</View>
            </View>
          ) : (
            <Text key={i} style={[styles.text, isUser && { color: COLORS.onSurface }]}>
              {p.text}
            </Text>
          ),
        )}
        {msg.pending && msg.content.length === 0 ? (
          <ActivityIndicator color={COLORS.brand} style={{ marginTop: SPACING.xs }} />
        ) : null}
      </View>
    </View>
  );
}

interface Part {
  kind: "text" | "code";
  text: string;
  lang?: string;
}

const LANG_ALIASES: Record<string, Language> = {
  js: "javascript",
  javascript: "javascript",
  ts: "typescript",
  typescript: "typescript",
  py: "python",
  python: "python",
  html: "html",
  htm: "html",
  css: "css",
};

function resolveLang(raw: string | undefined): Language {
  if (!raw) return "javascript";
  return LANG_ALIASES[raw.toLowerCase()] ?? "javascript";
}

function renderHighlightedCode(code: string, rawLang: string | undefined): React.ReactNode[] {
  const lang = resolveLang(rawLang);
  const lines = code.split("\n");
  return lines.map((line, i) => (
    <Text key={i} style={styles.codeText}>
      {highlightLine(line, lang).map((span, j) => (
        <Text key={j} style={{ color: span.color }}>
          {span.text}
        </Text>
      ))}
      {i < lines.length - 1 ? "\n" : ""}
    </Text>
  ));
}

function parseContent(text: string): Part[] {
  const parts: Part[] = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push({ kind: "text", text: text.slice(lastIndex, m.index) });
    parts.push({ kind: "code", text: m[2], lang: m[1] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push({ kind: "text", text: text.slice(lastIndex) });
  if (parts.length === 0) parts.push({ kind: "text", text: "" });
  return parts;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
  },
  iconBtn: { padding: SPACING.sm, borderRadius: RADIUS.md },
  title: { color: COLORS.onSurface, fontSize: TEXT.lg, fontWeight: "700" },
  subtitle: { color: COLORS.brand, fontSize: TEXT.sm, letterSpacing: 1, textTransform: "uppercase" },
  contextHint: {
    color: COLORS.onSurfaceSecondary,
    fontSize: TEXT.sm - 1,
    fontFamily: FONT.mono,
    marginTop: 2,
  },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.md },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.brandTertiary,
    borderWidth: 1,
    borderColor: COLORS.brand,
  },
  emptyTitle: { color: COLORS.onSurface, fontSize: TEXT.lg, fontWeight: "600", textAlign: "center" },
  emptySub: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.base, textAlign: "center" },
  setupBtn: {
    marginTop: SPACING.sm,
    backgroundColor: COLORS.brand,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  setupBtnText: { color: COLORS.onBrand, fontWeight: "700" },

  list: { padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xl },
  bubbleRow: { flexDirection: "row", marginBottom: SPACING.md },
  bubbleRowLeft: { justifyContent: "flex-start" },
  bubbleRowRight: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "88%",
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
  },
  userBubble: {
    backgroundColor: COLORS.surfaceTertiary,
  },
  aiBubble: {
    backgroundColor: COLORS.surfaceSecondary,
    borderTopWidth: 2,
    borderTopColor: COLORS.brand,
  },
  text: { color: COLORS.onSurface, fontSize: TEXT.base, lineHeight: 22 },
  codeBlock: {
    marginVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  codeBlockHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.surfaceTertiary,
  },
  codeBlockLang: {
    color: COLORS.brand,
    fontSize: TEXT.sm - 1,
    fontFamily: FONT.mono,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 4, padding: 4 },
  applyFixBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.brand,
  },
  applyFixLabel: { color: COLORS.onBrand, fontSize: TEXT.sm - 1, fontWeight: "700" },
  codeActions: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  copyLabel: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm - 1 },
  codeText: {
    color: COLORS.onSurface,
    fontFamily: FONT.mono,
    fontSize: TEXT.sm,
    lineHeight: 18,
  },
  codeContent: {
    padding: SPACING.sm,
  },

  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    padding: SPACING.md,
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.onSurface,
    fontFamily: FONT.mono,
    fontSize: TEXT.base,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.brand,
    alignItems: "center",
    justifyContent: "center",
  },
});
