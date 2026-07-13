// 行動端對話畫面（ADR-0085）：從聊天清單點入的全螢幕對話，參考 LINE/Signal——
// 頂部返回列（‹ 返回＋名稱＋副標）、訊息氣泡（自己靠右主色、對方靠左淺底；群組顯示發送者名）、
// 底部輸入列（輸入框＋送出）。色彩吃 @cinder/theme。訊息與送出由呼叫端注入（接 ChatBackend）。
import { useMemo, useState } from "react";
import type { ChatMessage, MessageStatus } from "@cinder/engine";
import { type Locale, type MessageKey, translate } from "@cinder/i18n";
import { resolveTheme, type Theme, type ThemeTokens } from "@cinder/theme";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native-web";
import { MsgStatusIcon } from "./MsgStatusIcon.js";

/** 送出狀態的 i18n 標籤（ADR-0058／0095）；與桌面同鍵。 */
const MSG_STATUS_KEY: Record<MessageStatus, MessageKey> = {
  sending: "msgStatus_sending",
  failed: "msgStatus_failed",
  sent: "msgStatus_sent",
  delivered: "msgStatus_delivered",
  read: "msgStatus_read",
};

function makeStyles(tk: ThemeTokens) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: tk.bgB },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 10,
      backgroundColor: tk.surface2,
      borderBottomWidth: 1,
      borderBottomColor: tk.border,
    },
    back: { paddingHorizontal: 6, paddingVertical: 2 },
    backText: { fontSize: 26, color: tk.accent, lineHeight: 26 },
    headTitle: { fontSize: 16, fontWeight: "700", color: tk.ink },
    headSub: { fontSize: 11, color: tk.muted },
    list: { flex: 1 },
    listInner: { padding: 12, gap: 8 },
    rowMine: { alignItems: "flex-end" },
    rowTheir: { alignItems: "flex-start" },
    sender: { fontSize: 11, color: tk.muted, marginBottom: 2, marginLeft: 6 },
    bubble: { maxWidth: "78%", borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12 },
    bubbleMine: { backgroundColor: tk.accent },
    bubbleTheir: { backgroundColor: tk.panel, borderWidth: 1, borderColor: tk.border },
    textMine: { color: "#ffffff", fontSize: 14 },
    textTheir: { color: tk.ink, fontSize: 14 },
    status: { marginTop: 2, marginRight: 4 },
    composer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 8,
      backgroundColor: tk.surface2,
      borderTopWidth: 1,
      borderTopColor: tk.border,
    },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: tk.border,
      borderRadius: 20,
      backgroundColor: tk.field,
      color: tk.ink,
      paddingVertical: 8,
      paddingHorizontal: 14,
      fontSize: 14,
    },
    send: { backgroundColor: tk.accent, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 },
    sendText: { color: "#ffffff", fontWeight: "700", fontSize: 14 },
  });
}

export function ConversationScreen({
  name,
  subtitle,
  messages,
  nameFor,
  onSend,
  onBack,
  locale = "zh-Hant",
  theme = "light",
  accent = null,
  accent2 = null,
}: {
  name: string;
  /** 副標：聯絡人狀態或群組成員數（由呼叫端組好）。 */
  subtitle?: string;
  messages: ChatMessage[];
  /** 群組訊息顯示發送者名（傳 pubkey → 名稱）；未提供則不顯示。 */
  nameFor?: (pubkey: string) => string;
  onSend: (text: string) => void;
  onBack: () => void;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
  accent2?: string | null;
}): JSX.Element {
  const tk = useMemo(() => resolveTheme({ theme, accent, accent2 }), [theme, accent, accent2]);
  const styles = useMemo(() => makeStyles(tk), [tk]);
  const t = (k: MessageKey): string => translate(locale, k);
  // 狀態圖示配色（ADR-0095）：張開眼＝主色、失敗＝紅、其餘＝灰。
  const statusColor = (s: MessageStatus): string =>
    s === "read" ? tk.accent : s === "failed" ? "#dc2626" : tk.muted;
  const [draft, setDraft] = useState("");

  const submit = (): void => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.back} accessibilityRole="button" aria-label={t("mobileConvo_back")} onPress={onBack}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View>
          <Text style={styles.headTitle}>{name}</Text>
          {subtitle ? <Text style={styles.headSub}>{subtitle}</Text> : null}
        </View>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listInner}>
        {messages.map((m) => (
          <View key={m.id} style={m.outgoing ? styles.rowMine : styles.rowTheir}>
            {!m.outgoing && nameFor && m.sender ? <Text style={styles.sender}>{nameFor(m.sender)}</Text> : null}
            <View style={[styles.bubble, m.outgoing ? styles.bubbleMine : styles.bubbleTheir]}>
              <Text style={m.outgoing ? styles.textMine : styles.textTheir}>
                {m.file ? `📎 ${m.file.name}` : m.text}
              </Text>
            </View>
            {/* 送出狀態（ADR-0095）：與桌面同一套——沙漏／閉眼／半開眼／張開眼（主色）／紅色重試。 */}
            {m.outgoing && m.status ? (
              <View style={styles.status} aria-label={t(MSG_STATUS_KEY[m.status])}>
                <MsgStatusIcon status={m.status} color={statusColor(m.status)} size={12} />
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={t("mobileConvo_input")}
          aria-label={t("mobileConvo_input")}
        />
        <Pressable style={styles.send} accessibilityRole="button" onPress={submit}>
          <Text style={styles.sendText}>{t("mobileConvo_send")}</Text>
        </Pressable>
      </View>
    </View>
  );
}
