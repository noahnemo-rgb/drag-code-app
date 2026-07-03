import { Feather } from "@expo/vector-icons";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { FileItem, Project } from "@/src/lib/api";
import { useEpisodeMode } from "@/src/lib/episode-store";
import type { SyncMode } from "@/src/lib/storage";
import { COLORS, FONT, RADIUS, SPACING, TEXT } from "@/src/theme";

export function FileDrawer({
  open,
  onClose,
  drawerX,
  drawerWidth,
  insetTop,
  insetBottom,
  projects,
  activeProjectId,
  onSelectProject,
  onDeleteProject,
  onNewProject,
  files,
  activeFileId,
  onSelectFile,
  onDeleteFile,
  onNewFile,
  syncMode,
  onSyncModeChange,
  onBluetooth,
}: {
  open: boolean;
  onClose: () => void;
  drawerX: Animated.Value;
  drawerWidth: number;
  insetTop: number;
  insetBottom: number;
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onNewProject: () => void;
  files: FileItem[];
  activeFileId: string | null;
  onSelectFile: (id: string) => void;
  onDeleteFile: (id: string) => void;
  onNewFile: () => void;
  syncMode: SyncMode;
  onSyncModeChange: (m: SyncMode) => void;
  onBluetooth: () => void;
}) {
  const { enabled: episodeEnabled, toggle: toggleEpisode } = useEpisodeMode();
  return (
    <>
      {open ? (
        <Pressable style={styles.backdrop} onPress={onClose} testID="drawer-backdrop" />
      ) : null}
      <Animated.View
        style={[
          styles.drawer,
          {
            width: drawerWidth,
            transform: [{ translateX: drawerX }],
            paddingTop: insetTop + SPACING.md,
            paddingBottom: insetBottom + SPACING.md,
          },
        ]}
        testID="file-explorer"
      >
        <View style={styles.header}>
          <Text style={styles.brand}>Syntax IDE</Text>
          <Pressable onPress={onClose} style={styles.iconBtn} testID="close-drawer-btn">
            <Feather name="x" size={20} color={COLORS.onSurface} />
          </Pressable>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: SPACING.lg }}>
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Projects</Text>
              <Pressable onPress={onNewProject} style={styles.ghostBtn} testID="new-project-btn">
                <Feather name="plus" size={14} color={COLORS.brand} />
                <Text style={styles.ghostBtnLabel}>New</Text>
              </Pressable>
            </View>
            {projects.map((p) => {
              const isActive = p.id === activeProjectId;
              return (
                <View key={p.id} style={styles.projectRow}>
                  <Pressable
                    onPress={() => onSelectProject(p.id)}
                    style={[styles.projectItem, isActive && styles.projectItemActive]}
                    testID={`project-${p.id}`}
                  >
                    <Feather name="folder" size={14} color={isActive ? COLORS.brand : COLORS.onSurfaceSecondary} />
                    <Text style={[styles.projectName, isActive && { color: COLORS.brand }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => onDeleteProject(p.id)} hitSlop={8} testID={`delete-project-${p.id}`}>
                    <Feather name="trash-2" size={14} color={COLORS.onSurfaceSecondary} />
                  </Pressable>
                </View>
              );
            })}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Files</Text>
              <Pressable
                onPress={onNewFile}
                style={[styles.ghostBtn, !activeProjectId && { opacity: 0.4 }]}
                disabled={!activeProjectId}
                testID="new-file-btn"
              >
                <Feather name="plus" size={14} color={COLORS.brand} />
                <Text style={styles.ghostBtnLabel}>New</Text>
              </Pressable>
            </View>
            {files.length === 0 ? (
              <Text style={styles.emptyMuted}>No files in this project.</Text>
            ) : (
              files.map((f) => {
                const isActive = f.id === activeFileId;
                return (
                  <Pressable
                    key={f.id}
                    onPress={() => onSelectFile(f.id)}
                    style={[styles.fileItem, isActive && styles.fileItemActive]}
                    testID={`file-${f.id}`}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: SPACING.sm }}>
                      <Feather name="file" size={13} color={isActive ? COLORS.brand : COLORS.onSurfaceSecondary} />
                      <Text style={[styles.fileName, isActive && { color: COLORS.brand }]} numberOfLines={1}>
                        {f.name}
                      </Text>
                    </View>
                    <Pressable onPress={() => onDeleteFile(f.id)} hitSlop={8} testID={`delete-file-${f.id}`}>
                      <Feather name="trash-2" size={13} color={COLORS.onSurfaceSecondary} />
                    </Pressable>
                  </Pressable>
                );
              })
            )}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable onPress={onBluetooth} style={styles.btBtn} testID="connect-bt-keyboard-btn">
            <Feather name="bluetooth" size={16} color={COLORS.brand} />
            <View style={{ flex: 1 }}>
              <Text style={styles.footerLabel}>Bluetooth keyboard</Text>
              <Text style={styles.footerSub} numberOfLines={1}>
                {Platform.OS === "android"
                  ? "Open system Bluetooth settings"
                  : Platform.OS === "ios"
                  ? "Open Settings to pair"
                  : "Mobile only"}
              </Text>
            </View>
            <Feather name="external-link" size={14} color={COLORS.onSurfaceSecondary} />
          </Pressable>

          <Pressable
            onPress={toggleEpisode}
            style={[styles.episodeBtn, episodeEnabled && styles.episodeBtnActive]}
            testID="episode-toggle"
          >
            <View style={[styles.episodeIcon, episodeEnabled && { borderColor: COLORS.brand }]}>
              <Feather name="moon" size={13} color={episodeEnabled ? COLORS.brand : COLORS.onSurfaceSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.footerLabel}>Episode Mode</Text>
              <Text style={styles.footerSub} numberOfLines={1}>
                {episodeEnabled ? "Dim · portrait · keystroke autosave" : "For vertigo / bedridden use"}
              </Text>
            </View>
            <Switch
              value={episodeEnabled}
              onValueChange={toggleEpisode}
              trackColor={{ true: COLORS.brand, false: COLORS.surfaceTertiary }}
              thumbColor={COLORS.onSurface}
              testID="episode-switch"
            />
          </Pressable>

          <View style={styles.footerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.footerLabel}>Sync</Text>
              <Text style={styles.footerSub}>{syncMode === "cloud" ? "Cloud (MongoDB)" : "Local (device)"}</Text>
            </View>
            <Switch
              value={syncMode === "cloud"}
              onValueChange={(v) => onSyncModeChange(v ? "cloud" : "local")}
              trackColor={{ true: COLORS.brand, false: COLORS.surfaceTertiary }}
              thumbColor={COLORS.onSurface}
              testID="sync-toggle"
            />
          </View>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  drawer: {
    position: "absolute",
    top: 0, bottom: 0, left: 0,
    backgroundColor: COLORS.surfaceSecondary,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
    paddingHorizontal: SPACING.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.md,
  },
  brand: { color: COLORS.brand, fontSize: TEXT.lg, fontWeight: "700", letterSpacing: 0.5 },
  iconBtn: { padding: SPACING.sm, borderRadius: RADIUS.md },
  section: { marginTop: SPACING.md },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    color: COLORS.onSurfaceSecondary,
    fontSize: TEXT.sm,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
  },
  ghostBtnLabel: { color: COLORS.brand, fontSize: TEXT.sm, fontWeight: "700" },
  projectRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, paddingVertical: 2 },
  projectItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm,
  },
  projectItemActive: { backgroundColor: COLORS.brandTertiary, borderLeftWidth: 2, borderLeftColor: COLORS.brand },
  projectName: { color: COLORS.onSurface, fontSize: TEXT.base, flex: 1 },
  fileItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm,
  },
  fileItemActive: { backgroundColor: COLORS.brandTertiary, borderLeftWidth: 2, borderLeftColor: COLORS.brand },
  fileName: { color: COLORS.onSurface, fontSize: TEXT.sm, fontFamily: FONT.mono, flex: 1 },
  emptyMuted: {
    color: COLORS.onSurfaceSecondary,
    fontSize: TEXT.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.md,
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  footerRow: { flexDirection: "row", alignItems: "center" },
  btBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.brandTertiary,
    borderWidth: 1,
    borderColor: COLORS.brand,
  },
  footerLabel: { color: COLORS.onSurface, fontWeight: "700", fontSize: TEXT.base },
  footerSub: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm },
  episodeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  episodeBtnActive: { borderColor: COLORS.brand, backgroundColor: COLORS.brandTertiary },
  episodeIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
});
