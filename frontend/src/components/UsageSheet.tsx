import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { api, type UsageSnapshot } from "@/src/lib/api";
import { getTier, setTier, tierLabel, type Tier } from "@/src/lib/tier-store";
import {
  canSendAiMessage,
  getAiMessagesUsedThisMonth,
  TIER_LIMITS,
} from "@/src/lib/usage-tiers";
import { COLORS, FONT, RADIUS, SPACING, TEXT } from "@/src/theme";

export function UsageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [tier, setTierState] = useState<Tier>("free");
  const [server, setServer] = useState<UsageSnapshot | null>(null);
  const [aiUsed, setAiUsed] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const t = await getTier();
      setTierState(t);
      setAiUsed(await getAiMessagesUsedThisMonth());
      try {
        setServer(await api.getUsage());
      } catch {
        setServer(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);

  const toggleDevTier = async () => {
    const next: Tier = tier === "free" ? "pro" : "free";
    await setTier(next);
    await refresh();
  };

  const aiLimit = TIER_LIMITS[tier].aiMessagesPerMonth;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Plan & usage</Text>
          <Pressable onPress={onClose} hitSlop={8} testID="usage-close">
            <Feather name="x" size={22} color={COLORS.onSurfaceSecondary} />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={COLORS.brand} style={{ margin: SPACING.xl }} />
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.planBadge}>
              <Text style={styles.planName}>{tierLabel(tier)} plan</Text>
              <Text style={styles.planHint}>
                {tier === "free"
                  ? "Free tier — enough to learn and experiment. Pro unlocks cloud sync, semantic search, and higher limits."
                  : "Pro tier (dev toggle) — full limits enabled for testing."}
              </Text>
            </View>

            <UsageRow
              label="AI messages (this month)"
              used={aiUsed}
              limit={aiLimit}
              hint="Counted on this device. Web uses Puter; mobile uses your OpenRouter key."
            />
            {server ? (
              <>
                <UsageRow
                  label="Code runs (today, server)"
                  used={server.runs.used}
                  limit={server.runs.limit}
                  hint="Resets at midnight UTC."
                />
                <UsageRow
                  label="Snippet publishes (this month)"
                  used={server.snippet_publishes.used}
                  limit={server.snippet_publishes.limit}
                  hint="Resets on the 1st UTC."
                />
              </>
            ) : (
              <Text style={styles.offline}>Connect to the API to see run and publish quotas.</Text>
            )}

            <View style={styles.featureList}>
              <Feature ok={TIER_LIMITS[tier].cloudSync} text="Cloud project sync" />
              <Feature ok={TIER_LIMITS[tier].semanticSnippetSearch} text="Semantic snippet search (Pro)" />
            </View>

            <Pressable style={styles.devToggle} onPress={toggleDevTier} testID="usage-tier-toggle">
              <Text style={styles.devToggleText}>
                Dev: switch to {tier === "free" ? "Pro" : "Free"} (until billing is wired)
              </Text>
            </Pressable>

            <Text style={styles.footerNote}>
              Paid upgrades via App Store / Stripe are planned. Limits protect server costs — AI usage is billed to
              each user&apos;s Puter or OpenRouter account.
            </Text>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function UsageRow({
  label,
  used,
  limit,
  hint,
}: {
  label: string;
  used: number;
  limit: number;
  hint: string;
}) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const atLimit = used >= limit;
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={[styles.rowCount, atLimit && { color: COLORS.error }]}>
          {used}/{limit}
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }, atLimit && { backgroundColor: COLORS.error }]} />
      </View>
      <Text style={styles.rowHint}>{hint}</Text>
    </View>
  );
}

function Feature({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={styles.featureRow}>
      <Feather name={ok ? "check-circle" : "lock"} size={14} color={ok ? COLORS.success : COLORS.onSurfaceSecondary} />
      <Text style={[styles.featureText, !ok && { color: COLORS.onSurfaceSecondary }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxHeight: "85%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  title: { color: COLORS.onSurface, fontSize: TEXT.lg, fontWeight: "700" },
  body: { padding: SPACING.lg, gap: SPACING.md },
  planBadge: {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  planName: { color: COLORS.brand, fontWeight: "700", fontSize: TEXT.base, textTransform: "uppercase", letterSpacing: 1 },
  planHint: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm, marginTop: SPACING.xs, lineHeight: 20 },
  row: { gap: SPACING.xs },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLabel: { color: COLORS.onSurface, fontSize: TEXT.sm, fontWeight: "600" },
  rowCount: { color: COLORS.brand, fontFamily: FONT.mono, fontSize: TEXT.sm },
  barTrack: {
    height: 6,
    backgroundColor: COLORS.surfaceTertiary,
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: { height: 6, backgroundColor: COLORS.brand, borderRadius: 3 },
  rowHint: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm - 1 },
  offline: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm, fontStyle: "italic" },
  featureList: { gap: SPACING.sm, marginTop: SPACING.sm },
  featureRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  featureText: { color: COLORS.onSurface, fontSize: TEXT.sm },
  devToggle: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
  },
  devToggleText: { color: COLORS.brand, fontSize: TEXT.sm, fontWeight: "600" },
  footerNote: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm - 1, lineHeight: 18, marginTop: SPACING.sm },
});
