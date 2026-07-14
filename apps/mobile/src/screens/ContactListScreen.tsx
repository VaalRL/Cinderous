// Phase D 起手：行動端聯絡人清單。以 react-native-web 的 RN 元件撰寫（可在此環境瀏覽器渲染
// 與測試），重用 @cinder/core（npub 編碼）、@cinder/i18n（多語系）與 @cinder/theme（設計 token）。
// 原生打包/端上 LLM 待有工具鏈時（見 ROADMAP Phase D）。
//
// 設計對齊（ADR-0080）：色彩不再硬編碼，改吃 `@cinder/theme` 的 `resolveTheme`——與桌面版
// 同一份主色/副色/深淺主題推導，行動端與桌面共用視覺 SSOT。StyleSheet 依當前 token 動態產生。
// 註：目前直接 import "react-native-web"；日後上原生時可加 bundler 別名（react-native→web）
// 讓同一份原始碼跨 web/native。
import { useMemo, useState } from "react";
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
    secTitle: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2, fontSize: 11, fontWeight: "700", color: tk.muted },
    blockedName: { flex: 1, fontSize: 14, color: tk.muted },
    blockBtn: { marginLeft: "auto", borderWidth: 1, borderColor: tk.accent, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
    blockText: { fontSize: 11, color: tk.accent },
    // 訊息請求（ADR-0121）：警示色，因為它需要使用者做決定。
    reqSection: { fontSize: 11, fontWeight: "700", color: "#b45309", paddingHorizontal: 12, paddingTop: 10 },
    reqHint: { fontSize: 10, lineHeight: 15, color: tk.muted, paddingHorizontal: 12, paddingBottom: 6 },
    reqRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 5 },
    reqNameBox: { flex: 1, minWidth: 0 },
    reqOk: { backgroundColor: tk.accent, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
    reqOkText: { fontSize: 11, fontWeight: "700", color: "#ffffff" },
    reqNo: { borderWidth: 1, borderColor: tk.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
    reqNoText: { fontSize: 11, color: tk.muted },
  });
}

export function ContactListScreen({
  selfPubkey,
  selfName,
  contacts,
  onOpen,
  onBlock,
  blocked,
  onUnblock,
  requests = [],
  onAcceptRequest,
  onDeclineRequest,
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
  /** 封鎖某聯絡人（長按）。未提供則不顯示封鎖入口。 */
  onBlock?: (pubkey: string) => void;
  /** 已封鎖名單（可解除）。 */
  blocked?: { pubkey: string; name: string }[];
  /** 解除封鎖。 */
  onUnblock?: (pubkey: string) => void;
  /**
   * 訊息請求（ADR-0121）：陌生人傳訊息給你但你還沒接受。
   *
   * **他們不是聯絡人**——不跳通知、不能敲你、看不到你的上線狀態、也收不到已讀回條。
   */
  requests?: { pubkey: string; name: string }[];
  onAcceptRequest?: (pubkey: string) => void;
  /** 刪除請求（連同他傳來的訊息）；不封鎖，他還能再傳。 */
  onDeclineRequest?: (pubkey: string) => void;
  locale?: Locale;
  /** 深淺主題（與桌面共用，ADR-0080）。 */
  theme?: Theme;
  /** 自訂主色 hex；null＝內建預設（ADR-0064/0080）。 */
  accent?: string | null;
  /** 自訂副色 hex；null＝跟隨主色（ADR-0078/0080）。 */
  accent2?: string | null;
}): JSX.Element {
  /** 長按選中的聯絡人（顯示封鎖鈕）。 */
  const [picked, setPicked] = useState<string | null>(null);
  const t = (k: MessageKey): string => translate(locale, k);
  const styles = useMemo(() => makeStyles(resolveTheme({ theme, accent, accent2 })), [theme, accent, accent2]);
  return (
    <View style={styles.root}>
      <View style={styles.me}>
        <Text style={styles.meName}>{selfName}</Text>
        <Text style={styles.meNpub}>{shortNpub(npubEncode(selfPubkey))}</Text>
      </View>
      {/* 訊息請求（ADR-0121）：放在名冊**之前**——這是需要你裁示的東西，不該被埋在清單裡。 */}
      {requests.length > 0 ? (
        <View testID="requests">
          <Text style={styles.reqSection}>
            {t("request_section")}（{requests.length}）
          </Text>
          <Text style={styles.reqHint}>{t("request_hint")}</Text>
          {requests.map((r) => (
            <View key={r.pubkey} style={styles.reqRow}>
              <Pressable style={styles.reqNameBox} accessibilityRole="button" onPress={() => onOpen?.(r.pubkey)}>
                <Text style={styles.name}>{r.name}</Text>
              </Pressable>
              <Pressable
                style={styles.reqOk}
                accessibilityRole="button"
                testID={`request-accept-${r.pubkey}`}
                onPress={() => onAcceptRequest?.(r.pubkey)}
              >
                <Text style={styles.reqOkText}>{t("request_accept")}</Text>
              </Pressable>
              <Pressable
                style={styles.reqNo}
                accessibilityRole="button"
                testID={`request-decline-${r.pubkey}`}
                onPress={() => onDeclineRequest?.(r.pubkey)}
              >
                <Text style={styles.reqNoText}>{t("request_decline")}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {contacts.length === 0 ? (
        <Text style={styles.empty}>{translate(locale, "mobileContacts_empty")}</Text>
      ) : (
        groupByStatus(contacts).map((sec) => (
          <View key={sec.status}>
            <Text style={styles.section}>
              {translate(locale, STATUS_KEY[sec.status])}（{sec.contacts.length}）
            </Text>
            {sec.contacts.map((c) => (
              <Pressable
                key={c.pubkey}
                style={styles.row}
                accessibilityRole="button"
                onPress={() => onOpen?.(c.pubkey)}
                {...(onBlock ? { onLongPress: () => setPicked((p) => (p === c.pubkey ? null : c.pubkey)) } : {})}
              >
                <View style={[styles.dot, { backgroundColor: STATUS_COLORS[c.status] }]} />
                <Text style={styles.name}>{c.name}</Text>
                {/* 長按＝手機上的「右鍵選單」。封鎖會移出聯絡人並清掉該對話（含封存）。 */}
                {picked === c.pubkey && onBlock ? (
                  <Pressable
                    style={styles.blockBtn}
                    accessibilityRole="button"
                    testID={`block-${c.pubkey}`}
                    onPress={() => {
                      onBlock(c.pubkey);
                      setPicked(null);
                    }}
                  >
                    <Text style={styles.blockText}>{t("block")}</Text>
                  </Pressable>
                ) : null}
              </Pressable>
            ))}
          </View>
        ))
      )}
      {/* 已封鎖（可解除）。封鎖後不再收其訊息，且已移出聯絡人。 */}
      {blocked && blocked.length > 0 ? (
        <View>
          <Text style={styles.secTitle}>{t("blocked_title")}</Text>
          {blocked.map((b) => (
            <View key={b.pubkey} style={styles.row}>
              <Text style={styles.blockedName}>{b.name}</Text>
              {onUnblock ? (
                <Pressable
                  style={styles.blockBtn}
                  accessibilityRole="button"
                  testID={`unblock-${b.pubkey}`}
                  onPress={() => onUnblock(b.pubkey)}
                >
                  <Text style={styles.blockText}>{t("unblock")}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
