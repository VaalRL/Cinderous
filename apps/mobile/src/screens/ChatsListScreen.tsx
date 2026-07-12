// 行動端聊天清單（ADR-0085）：登入後的主畫面，參考 LINE/Signal——聯絡人＋群組合成單一清單、
// 預設依最近互動排序，每列＝頭像＋名稱＋最後訊息預覽＋時間＋未讀徽章，點擊開啟對話。
// 色彩吃 @cinder/theme（與桌面同 SSOT）。清單資料由呼叫端以 chat-list.ts 的 chatList() 排好傳入。
import { useMemo } from "react";
import { type Locale, type MessageKey, translate } from "@cinder/i18n";
import { resolveTheme, STATUS_COLORS, type Theme, type ThemeTokens } from "@cinder/theme";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native-web";
import { type ChatListEntry, chatTimeLabel } from "../chat-list.js";

/** 頭像底色：由 id 決定性挑一個柔和色（LINE/Signal 風格的彩色圓）。 */
const AVATAR_COLORS = ["#5b8def", "#e0698f", "#3aaf9f", "#e0913a", "#8a6ee0", "#4aa96c"];
function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}
function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function makeStyles(tk: ThemeTokens) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: tk.panel },
    header: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      backgroundColor: tk.surface2,
      borderBottomWidth: 1,
      borderBottomColor: tk.border,
    },
    headerTitle: { fontSize: 20, fontWeight: "700", color: tk.ink },
    list: { flex: 1 },
    empty: { padding: 28, textAlign: "center", color: tk.muted, fontSize: 13, lineHeight: 20 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: tk.border },
    avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
    avatarText: { color: "#ffffff", fontWeight: "700", fontSize: 18 },
    statusDot: { position: "absolute", right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: tk.panel },
    main: { flex: 1, minWidth: 0, gap: 3 },
    topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    name: { flex: 1, fontSize: 15, fontWeight: "600", color: tk.ink },
    time: { fontSize: 11, color: tk.muted },
    botRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    preview: { flex: 1, fontSize: 13, color: tk.muted },
    badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: tk.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
    badgeText: { color: "#ffffff", fontSize: 11, fontWeight: "700" },
  });
}

export function ChatsListScreen({
  entries,
  onOpen,
  now = Date.now(),
  locale = "zh-Hant",
  theme = "light",
  accent = null,
  accent2 = null,
}: {
  /** 已依最近互動排好的聊天清單（chat-list.ts 的 chatList()）。 */
  entries: ChatListEntry[];
  /** 點擊某列開啟對話（傳 id＝聯絡人 pubkey 或群組 id）。 */
  onOpen: (id: string) => void;
  now?: number;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
  accent2?: string | null;
}): JSX.Element {
  const styles = useMemo(() => makeStyles(resolveTheme({ theme, accent, accent2 })), [theme, accent, accent2]);
  const t = (k: MessageKey): string => translate(locale, k);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("mobileChats_title")}</Text>
      </View>
      {entries.length === 0 ? (
        <Text style={styles.empty}>{t("mobileChats_empty")}</Text>
      ) : (
        <ScrollView style={styles.list}>
          {entries.map((e) => (
            <Pressable key={e.id} style={styles.row} accessibilityRole="button" onPress={() => onOpen(e.id)}>
              <View style={[styles.avatar, { backgroundColor: avatarColor(e.id) }]}>
                <Text style={styles.avatarText}>{e.isGroup ? "#" : initial(e.name)}</Text>
                {!e.isGroup && e.status ? (
                  <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[e.status] }]} />
                ) : null}
              </View>
              <View style={styles.main}>
                <View style={styles.topRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {e.name}
                  </Text>
                  <Text style={styles.time}>{chatTimeLabel(e.lastAt, now)}</Text>
                </View>
                <View style={styles.botRow}>
                  <Text style={styles.preview} numberOfLines={1}>
                    {e.lastOutgoing && e.lastText ? t("mobileChats_you") : ""}
                    {e.lastText}
                  </Text>
                  {e.unread > 0 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{e.unread}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
