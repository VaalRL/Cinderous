// Phase D 起手：行動端聯絡人清單。以 react-native-web 的 RN 元件撰寫（可在此環境瀏覽器渲染
// 與測試），重用 @cinder/core（npub 編碼）、@cinder/i18n（多語系）與 @cinder/theme（設計 token）。
// 原生打包/端上 LLM 待有工具鏈時（見 ROADMAP Phase D）。
//
// 設計對齊（ADR-0080）：色彩不再硬編碼，改吃 `@cinder/theme` 的 `resolveTheme`——與桌面版
// 同一份主色/副色/深淺主題推導，行動端與桌面共用視覺 SSOT。StyleSheet 依當前 token 動態產生。
// 註：目前直接 import "react-native-web"；日後上原生時可加 bundler 別名（react-native→web）
// 讓同一份原始碼跨 web/native。
import { useMemo } from "react";
import { npubEncode } from "@cinder/core";
import { type Locale, type MessageKey, translate } from "@cinder/i18n";
import { resolveTheme, STATUS_COLORS, type Theme, type ThemeTokens } from "@cinder/theme";
import { Pressable, StyleSheet, Text, View } from "react-native-web";

export type MobileStatus = "online" | "away" | "busy" | "offline";
export interface MobileContact {
  pubkey: string;
  name: string;
  status: MobileStatus;
}

const STATUS_SECTIONS: MobileStatus[] = ["online", "away", "busy", "offline"];
const STATUS_KEY: Record<MobileStatus, MessageKey> = {
  online: "status_online",
  away: "status_away",
  busy: "status_busy",
  offline: "status_offline",
};

/** 依上線狀態分區、每區依名稱排序；只回傳非空的區（與桌面版一致）。 */
export function groupByStatus(contacts: MobileContact[]): { status: MobileStatus; contacts: MobileContact[] }[] {
  return STATUS_SECTIONS.map((status) => ({
    status,
    contacts: contacts.filter((c) => c.status === status).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((sec) => sec.contacts.length > 0);
}

function shortNpub(npub: string): string {
  return npub.length > 18 ? `${npub.slice(0, 12)}…` : npub;
}

/** 依當前主題 token 產生樣式（色彩全部來自 @cinder/theme，與桌面同源）。 */
function makeStyles(tk: ThemeTokens) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: tk.panel },
    me: { padding: 12, backgroundColor: tk.surface2, borderBottomWidth: 1, borderBottomColor: tk.border },
    meName: { fontWeight: "700", fontSize: 16, color: tk.ink },
    meNpub: { fontSize: 11, color: tk.muted },
    section: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 2, fontSize: 11, fontWeight: "700", color: tk.accent },
    row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12 },
    dot: { width: 9, height: 9, borderRadius: 5 },
    name: { fontSize: 14, color: tk.ink },
    empty: { padding: 28, textAlign: "center", color: tk.muted, fontSize: 13, lineHeight: 20 },
  });
}

export function ContactListScreen({
  selfPubkey,
  selfName,
  contacts,
  onOpen,
  locale = "zh-Hant",
  theme = "light",
  accent = null,
  accent2 = null,
}: {
  selfPubkey: string;
  selfName: string;
  contacts: MobileContact[];
  /** 點某聯絡人開對話（傳 pubkey）；未提供＝不可點（純顯示）。 */
  onOpen?: (pubkey: string) => void;
  locale?: Locale;
  /** 深淺主題（與桌面共用，ADR-0080）。 */
  theme?: Theme;
  /** 自訂主色 hex；null＝內建預設（ADR-0064/0080）。 */
  accent?: string | null;
  /** 自訂副色 hex；null＝跟隨主色（ADR-0078/0080）。 */
  accent2?: string | null;
}): JSX.Element {
  const styles = useMemo(() => makeStyles(resolveTheme({ theme, accent, accent2 })), [theme, accent, accent2]);
  return (
    <View style={styles.root}>
      <View style={styles.me}>
        <Text style={styles.meName}>{selfName}</Text>
        <Text style={styles.meNpub}>{shortNpub(npubEncode(selfPubkey))}</Text>
      </View>
      {contacts.length === 0 ? (
        <Text style={styles.empty}>{translate(locale, "mobileContacts_empty")}</Text>
      ) : (
        groupByStatus(contacts).map((sec) => (
          <View key={sec.status}>
            <Text style={styles.section}>
              {translate(locale, STATUS_KEY[sec.status])}（{sec.contacts.length}）
            </Text>
            {sec.contacts.map((c) => (
              <Pressable key={c.pubkey} style={styles.row} accessibilityRole="button" onPress={() => onOpen?.(c.pubkey)}>
                <View style={[styles.dot, { backgroundColor: STATUS_COLORS[c.status] }]} />
                <Text style={styles.name}>{c.name}</Text>
              </Pressable>
            ))}
          </View>
        ))
      )}
    </View>
  );
}
