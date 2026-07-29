// 自己的狀態列（ADR-0278）：聊天清單頂部的「我」區——頭像＋名稱＋上線狀態＋自訂狀態文字。
//
// 行動端過去把這些**只放在「設定」分頁**，等於每次想改狀態都要離開聊天、切分頁、往下捲。
// 桌面版一直是把它擺在聯絡人清單正上方（`DeckSidebar` 的 `dsb__me`），這裡就是那塊的行動版。
//
// 狀態切換鈕（`StatusSegments`）獨立匯出並由 `SettingsScreen` 共用——同一個控制項不做兩份。
import { useMemo } from "react";
import { type Locale, type MessageKey, translate } from "@cinderous/i18n";
import { resolveTheme, STATUS_COLORS, type Theme, type ThemeTokens } from "@cinderous/theme";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native-web";
import type { Status } from "@cinderous/engine";

/** 狀態鍵（與 MobileApp／SettingsScreen 同一組 i18n 鍵）。 */
const STATUS_KEY: Record<"online" | "away" | "busy", MessageKey> = {
  online: "status_online",
  away: "status_away",
  busy: "status_busy",
};

/** 可手動選的狀態。`offline`／隱身不在此列——前者由連線決定，後者是獨立開關（設定內）。 */
export const PICKABLE_STATUS = ["online", "away", "busy"] as const;

function segStyles(tk: ThemeTokens) {
  return StyleSheet.create({
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    seg: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1 },
    segText: { fontSize: 13, fontWeight: "600" },
  });
}

/**
 * 上線狀態三選一（線上／離開／忙碌）。抽出來給聊天列與設定共用——
 * 先前設定頁自己內嵌一份，再在聊天列複製一份就會變成兩套要各自維護。
 */
export function StatusSegments({
  value,
  onChange,
  locale = "zh-Hant",
  theme = "light",
  accent = null,
  accent2 = null,
}: {
  value: Status;
  onChange: (s: Status) => void;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
  accent2?: string | null;
}): JSX.Element {
  const tk = useMemo(() => resolveTheme({ theme, accent, accent2 }), [theme, accent, accent2]);
  const styles = useMemo(() => segStyles(tk), [tk]);
  return (
    <View style={styles.row}>
      {PICKABLE_STATUS.map((v) => {
        const on = value === v;
        return (
          <Pressable
            key={v}
            accessibilityRole="button"
            testID={`status-${v}`}
            style={[styles.seg, { borderColor: on ? tk.accent : tk.border, backgroundColor: on ? tk.accent : tk.field }]}
            onPress={() => onChange(v)}
          >
            <Text style={[styles.segText, { color: on ? "#ffffff" : tk.ink }]}>{translate(locale, STATUS_KEY[v])}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(tk: ThemeTokens) {
  return StyleSheet.create({
    root: { flexDirection: "row", gap: 12, alignItems: "flex-start", paddingBottom: 10 },
    avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: tk.accent },
    avatarImg: { width: 46, height: 46, borderRadius: 23 },
    avatarText: { color: "#ffffff", fontWeight: "700", fontSize: 18 },
    dot: { position: "absolute", right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: tk.surface2 },
    info: { flex: 1, minWidth: 0, gap: 6 },
    name: { fontSize: 16, fontWeight: "700", color: tk.ink },
    msgInput: {
      borderWidth: 1,
      borderColor: tk.border,
      borderRadius: 8,
      backgroundColor: tk.field,
      color: tk.ink,
      paddingVertical: 6,
      paddingHorizontal: 10,
      fontSize: 13,
    },
    invisibleHint: { fontSize: 11, color: tk.muted },
  });
}

export function SelfStatusBar({
  name,
  status,
  onStatus,
  statusMessage,
  onStatusMessage,
  avatar,
  invisible = false,
  locale = "zh-Hant",
  theme = "light",
  accent = null,
  accent2 = null,
}: {
  name: string;
  status: Status;
  onStatus: (s: Status) => void;
  statusMessage: string;
  onStatusMessage: (msg: string) => void;
  /** 廣播頭像（ADR-0154）；無則顯示名稱首字。 */
  avatar?: string | undefined;
  /**
   * 隱身中（ADR-0164）：對外一律顯示離線。此時狀態點畫成離線灰並加註說明——
   * 否則畫面會說「線上」而實際上沒人看得到你，那是 UI 在說謊。
   */
  invisible?: boolean;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
  accent2?: string | null;
}): JSX.Element {
  const tk = useMemo(() => resolveTheme({ theme, accent, accent2 }), [theme, accent, accent2]);
  const styles = useMemo(() => makeStyles(tk), [tk]);
  const t = (k: MessageKey): string => translate(locale, k);
  const dotColor = invisible ? STATUS_COLORS.offline : STATUS_COLORS[status];

  return (
    <View style={styles.root} testID="self-status-bar">
      <View style={styles.avatar}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={styles.avatarImg} accessibilityLabel={name} />
        ) : (
          <Text style={styles.avatarText}>{(name.trim()[0] ?? "?").toUpperCase()}</Text>
        )}
        <View style={[styles.dot, { backgroundColor: dotColor }]} testID="self-status-dot" />
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <StatusSegments value={status} onChange={onStatus} locale={locale} theme={theme} accent={accent} accent2={accent2} />
        {/* 自訂狀態文字（ADR-0142／0168／0171）：逐字更新本機，廣播由 MobileApp 以 ~600ms 節流合併
            ——不逐字打中繼，也不外送打到一半的文字。 */}
        <TextInput
          style={styles.msgInput}
          value={statusMessage}
          onChangeText={onStatusMessage}
          placeholder={t("personalMessage_placeholder")}
          placeholderTextColor={tk.muted}
          aria-label={t("personalMessage_placeholder")}
          testID="self-status-message"
        />
        {invisible ? <Text style={styles.invisibleHint}>{t("settings_invisible")}</Text> : null}
      </View>
    </View>
  );
}
