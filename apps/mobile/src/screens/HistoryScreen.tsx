// 行動端歷史紀錄（ADR-0111）：讀**封存**的舊訊息。
//
// 對話畫面只讀熱區（最近 5,000 則）——這是為了把熱路徑成本結構性地綁住。更舊的訊息在封存裡
// （OPFS 分塊），由這個畫面**分頁**讀出，一次只載入一塊。
//
// 它是**非同步**的，而對話畫面是同步的——這正是冷熱分離的重點：非同步只存在於這裡。
//
// 補這個畫面之前，行動端的封存是「寫得進去、讀不出來」——資料沒遺失，但使用者看不到。

import { type MessageArchive, nextOlderChunk, prependChunk, type StoredMessage } from "@cinderous/engine";
import { type Locale, type MessageKey, translate } from "@cinderous/i18n";
import { resolveTheme, type Theme, type ThemeTokens } from "@cinderous/theme";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native-web";

/** 決定性時間字串（本地時區）。 */
function fmtTime(atMs: number): string {
  const d = new Date(atMs);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function HistoryScreen({
  name,
  convo,
  archive,
  selfLabel,
  nameFor,
  onBack,
  locale = "zh-Hant",
  theme = "light",
  accent = null,
  accent2 = null,
}: {
  name: string;
  convo: string;
  archive: MessageArchive;
  selfLabel: string;
  /** 群訊顯示發送者名（傳 pubkey → 名稱）；未提供則用對話名。 */
  nameFor?: (pubkey: string) => string;
  onBack: () => void;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
  accent2?: string | null;
}): JSX.Element {
  const tk = useMemo(() => resolveTheme({ theme, accent, accent2 }), [theme, accent, accent2]);
  const styles = useMemo(() => makeStyles(tk), [tk]);
  const t = (k: MessageKey): string => translate(locale, k);

  const [total, setTotal] = useState<number | null>(null);
  /** 已載入的最舊塊號；`-1`＝還沒載入任何塊。 */
  const [loadedFrom, setLoadedFrom] = useState(-1);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [busy, setBusy] = useState(false);

  const loadOlder = useCallback(async () => {
    if (busy || total === null) return;
    const next = nextOlderChunk(total, loadedFrom); // 由新到舊（分頁邏輯在 engine，與桌面共用）
    if (next === null) return;
    setBusy(true);
    try {
      const chunk = await archive.loadChunk(convo, next);
      setMessages((prev) => prependChunk(prev, chunk)); // 以 id 去重（ADR-0111）
      setLoadedFrom(next);
    } finally {
      setBusy(false);
    }
  }, [archive, busy, convo, loadedFrom, total]);

  useEffect(() => {
    let cancelled = false;
    void archive.chunkCount(convo).then((n) => {
      if (!cancelled) setTotal(n);
    });
    return () => {
      cancelled = true;
    };
  }, [archive, convo]);

  // 取得塊數後自動載入最新的一塊。
  useEffect(() => {
    if (total !== null && total > 0 && loadedFrom === -1) void loadOlder();
  }, [total, loadedFrom, loadOlder]);

  const hasMore = total !== null && loadedFrom > 0;
  const whoOf = (m: StoredMessage): string =>
    m.outgoing ? selfLabel : m.sender && nameFor ? nameFor(m.sender) : name;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.back} accessibilityRole="button" aria-label={t("mobileConvo_back")} onPress={onBack}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headText}>
          <Text style={styles.headTitle}>{t("history_title")}</Text>
          <Text style={styles.headSub}>{name}</Text>
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyInner}>
        {total === 0 ? <Text style={styles.empty}>{t("history_empty")}</Text> : null}
        {hasMore ? (
          <Pressable
            style={styles.more}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void loadOlder()}
            testID="history-older"
          >
            <Text style={styles.moreText}>{busy ? t("history_loading") : t("history_older")}</Text>
          </Pressable>
        ) : null}
        {messages.map((m) => (
          <View key={m.id} style={[styles.msg, m.outgoing ? styles.msgOut : null]}>
            <Text style={styles.meta}>
              {fmtTime(m.at)} · {whoOf(m)}
            </Text>
            <Text style={styles.text}>{m.file ? `📎 ${m.file.name}` : m.text}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(tk: ThemeTokens) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: tk.bgB },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 8,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: tk.border,
      backgroundColor: tk.panel,
    },
    back: { paddingHorizontal: 8, paddingVertical: 2 },
    backText: { fontSize: 24, color: tk.accent, lineHeight: 24 },
    headText: { flex: 1, marginLeft: 4 },
    headTitle: { fontSize: 15, fontWeight: "600", color: tk.ink },
    headSub: { fontSize: 11, color: tk.muted, marginTop: 1 },
    body: { flex: 1 },
    bodyInner: { padding: 10, gap: 6 },
    empty: { fontSize: 13, color: tk.muted, textAlign: "center", marginTop: 16 },
    more: {
      alignSelf: "center",
      borderWidth: 1,
      borderColor: tk.accent,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 4,
      marginBottom: 4,
    },
    moreText: { fontSize: 12, color: tk.accent },
    msg: { backgroundColor: tk.panel, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, gap: 1 },
    msgOut: { backgroundColor: tk.surface2 },
    meta: { fontSize: 10, color: tk.muted },
    text: { fontSize: 13, color: tk.ink },
  });
}
