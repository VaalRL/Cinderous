// 行動端底部分頁列（ADR-0087）：聊天／聯絡人／設定，參考 LINE/Signal。
// 作用中分頁＝主色、其餘＝灰；聊天分頁帶未讀總數徽章。對話為 push 全螢幕（不在此列）。
import { useMemo } from "react";
import { type Locale, type MessageKey, translate } from "@cinderous/i18n";
import { resolveTheme, type Theme, type ThemeTokens } from "@cinderous/theme";
import { Pressable, StyleSheet, Text, View } from "react-native-web";

export type Tab = "chats" | "contacts" | "settings";

const TABS: { key: Tab; icon: string; label: MessageKey }[] = [
  { key: "chats", icon: "💬", label: "mobileTab_chats" },
  { key: "contacts", icon: "👤", label: "mobileTab_contacts" },
  { key: "settings", icon: "⚙️", label: "mobileTab_settings" },
];

function makeStyles(tk: ThemeTokens) {
  return StyleSheet.create({
    bar: {
      flexDirection: "row",
      backgroundColor: tk.surface2,
      borderTopWidth: 1,
      borderTopColor: tk.border,
      paddingBottom: 4,
    },
    tab: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 7, gap: 2 },
    icon: { fontSize: 20 },
    label: { fontSize: 11, fontWeight: "600" },
    badge: {
      position: "absolute",
      top: 2,
      right: "50%",
      marginRight: -22,
      minWidth: 17,
      height: 17,
      borderRadius: 9,
      backgroundColor: "#e5484d",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 4,
    },
    badgeText: { color: "#ffffff", fontSize: 10, fontWeight: "700" },
  });
}

export function BottomTabs({
  active,
  onSelect,
  unreadTotal = 0,
  locale = "zh-Hant",
  theme = "light",
  accent = null,
  accent2 = null,
}: {
  active: Tab;
  onSelect: (tab: Tab) => void;
  /** 聊天分頁的未讀總數（>0 顯示紅色徽章）。 */
  unreadTotal?: number;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
  accent2?: string | null;
}): JSX.Element {
  const tk = useMemo(() => resolveTheme({ theme, accent, accent2 }), [theme, accent, accent2]);
  const styles = useMemo(() => makeStyles(tk), [tk]);
  const t = (k: MessageKey): string => translate(locale, k);

  return (
    <View style={styles.bar}>
      {TABS.map((x) => {
        const on = x.key === active;
        const color = on ? tk.accent : tk.muted;
        return (
          <Pressable
            key={x.key}
            style={styles.tab}
            accessibilityRole="button"
            aria-label={t(x.label)}
            onPress={() => onSelect(x.key)}
          >
            <Text style={[styles.icon, { opacity: on ? 1 : 0.6 }]}>{x.icon}</Text>
            <Text style={[styles.label, { color }]}>{t(x.label)}</Text>
            {x.key === "chats" && unreadTotal > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadTotal > 99 ? "99+" : unreadTotal}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
