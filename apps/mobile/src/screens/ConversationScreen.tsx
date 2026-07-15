// 行動端對話畫面（ADR-0085）：從聊天清單點入的全螢幕對話，參考 LINE/Signal——
// 頂部返回列（‹ 返回＋名稱＋副標）、訊息氣泡（自己靠右主色、對方靠左淺底；群組顯示發送者名）、
// 底部輸入列（輸入框＋送出）。色彩吃 @cinder/theme。訊息與送出由呼叫端注入（接 ChatBackend）。
import { useMemo, useState } from "react";
import { calcPreview, groupReceiptMode, REACTION_EMOJIS } from "@cinder/core";
import type { CallMedia } from "@cinder/core";
import type { ChatMessage, MessageStatus } from "@cinder/engine";
import { type Locale, type MessageKey, translate } from "@cinder/i18n";
import { resolveTheme, type Theme, type ThemeTokens } from "@cinder/theme";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native-web";
import { MsgStatusIcon } from "./MsgStatusIcon.js";
import { downloadImageFromUrl, shareImageFromUrl } from "../native/share.js";

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
    headText: { flex: 1 },
    callBtn: { paddingHorizontal: 6, paddingVertical: 4 },
    callIcon: { fontSize: 18 },
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
    status: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2, marginRight: 4 },
    members: {
      backgroundColor: tk.panel,
      borderBottomWidth: 1,
      borderBottomColor: tk.border,
      paddingHorizontal: 12,
      paddingVertical: 6,
      gap: 2,
    },
    memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: 3 },
    memberName: { flex: 1, fontSize: 13, color: tk.ink },
    memberBtn: { borderWidth: 1, borderColor: tk.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
    memberBtnText: { fontSize: 11, color: tk.muted },
    leaveBtn: { alignSelf: "flex-start", marginTop: 4, borderColor: "#dc2626" },
    leaveText: { fontSize: 11, color: "#dc2626" },
    textGone: { fontStyle: "italic", opacity: 0.7 },
    reactions: { marginTop: 2, paddingHorizontal: 4 },
    reactionText: { fontSize: 13 },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 4,
      marginTop: 3,
      backgroundColor: tk.panel,
      borderWidth: 1,
      borderColor: tk.border,
      borderRadius: 999,
      paddingHorizontal: 6,
      paddingVertical: 3,
    },
    actBtn: { paddingHorizontal: 4, paddingVertical: 1 },
    actEmoji: { fontSize: 16 },
    actText: { fontSize: 12, color: tk.accent },
    readby: { fontSize: 10, color: tk.muted },
    // 算式預覽 chip（ADR-0097）
    calcchip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      alignSelf: "flex-start",
      marginHorizontal: 10,
      marginBottom: 4,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: tk.accent,
      backgroundColor: tk.field,
    },
    attach: { paddingHorizontal: 6, paddingVertical: 6 },
    attachText: { fontSize: 20 },
    fileMeta: { fontSize: 11, marginTop: 2 },
    thumb: { width: 180, height: 135, borderRadius: 8, marginBottom: 6, resizeMode: "cover" },
    calcchipEq: { fontSize: 12, color: tk.muted },
    calcchipVal: { fontSize: 13, fontWeight: "700", color: tk.accent },
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
  groupMembers,
  reactions,
  unsent,
  onReact,
  onUnsend,
  onSend,
  onSendFile,
  onStartCall,
  onNudge,
  onHistory,
  onLeaveGroup,
  onRemoveMember,
  isGroupAdmin,
  selfPubkey,
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
  /** 群組成員 pubkey（含自己）；提供即為群組，用來決定已讀呈現分級（ADR-0095）。 */
  groupMembers?: string[];
  /** 傳送檔案（ADR-0100）；未提供則不顯示 📎（如示範模式）。 */
  onSendFile?: () => void;
  /** 發起通話（ADR-0101）；未提供則不顯示通話鈕（示範模式／平台無 WebRTC）。 */
  onStartCall?: (media: CallMedia) => void;
  /** 敲一下（ADR-0114）：1:1 才有；過去行動端只能收、不能發。 */
  onNudge?: () => void;
  /** 開啟歷史紀錄（ADR-0111）；只有該對話真的有封存時才傳入。 */
  onHistory?: () => void;
  /** 每則訊息收到的 emoji 回應（NIP-25）：訊息 id → emoji 清單。 */
  reactions?: Record<string, string[]>;
  /** 已收回的訊息 id（NIP-09）：顯示為「（已收回）」，不得洩漏原文。 */
  unsent?: Set<string>;
  /** 對某訊息送出 emoji 回應；未提供則不顯示回應入口（如示範模式）。 */
  onReact?: (messageId: string, emoji: string) => void;
  /** 收回自己送出的訊息；未提供則不顯示收回入口。 */
  onUnsend?: (messageId: string) => void;
  /** 離開群組（ADR-0114）；未提供則不顯示。 */
  onLeaveGroup?: () => void;
  /**
   * 移除群組成員（**僅管理者**，ADR-0027）。群組無共用金鑰——移除成員＝下次扇出略過他，
   * 即時生效且免 rekey。
   */
  onRemoveMember?: (pubkey: string) => void;
  /** 自己是不是這個群的管理者（決定要不要顯示移除成員）。 */
  isGroupAdmin?: boolean;
  /** 自己的 pubkey（成員清單中不對自己顯示「移除」）。 */
  selfPubkey?: string;
  onSend: (text: string) => void;
  onBack: () => void;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
  accent2?: string | null;
}): JSX.Element {
  const tk = useMemo(() => resolveTheme({ theme, accent, accent2 }), [theme, accent, accent2]);
  const styles = useMemo(() => makeStyles(tk), [tk]);
  const t = (k: MessageKey, params?: Record<string, string | number>): string => translate(locale, k, params);
  /** 長按選中的訊息（顯示回應/收回列）。手機沒有 hover，長按是等價的入口。 */
  const [picked, setPicked] = useState<string | null>(null);
  /** 群組成員面板是否展開（ADR-0114）。 */
  const [membersOpen, setMembersOpen] = useState(false);
  // 狀態圖示配色（ADR-0095）：張開眼＝主色、失敗＝紅、其餘＝灰。
  const statusColor = (s: MessageStatus): string =>
    s === "read" ? tk.accent : s === "failed" ? "#dc2626" : tk.muted;

  /**
   * 群組已讀呈現（ADR-0095，與桌面同一套分級）：≤5 名單制（誰已讀）、6–10 計數制（已讀 M/N）、
   * >10 完全不記（回 null，不顯示）。僅自己送出的群訊有意義。
   */
  const groupReadOf = (m: ChatMessage): string | null => {
    if (!m.outgoing || !groupMembers) return null;
    const total = groupMembers.length - 1; // 其他成員數（不含自己）
    if (total <= 0) return null;
    const mode = groupReceiptMode(groupMembers.length);
    if (mode === "off") return null; // 大群不記
    const readers = Object.entries(m.receipts ?? {})
      .filter(([, v]) => v === "read")
      .map(([pk]) => pk);
    if (readers.length === 0) return null;
    return mode === "list"
      ? t("readBy_list", { names: readers.map((pk) => nameFor?.(pk) ?? `${pk.slice(0, 8)}…`).join("、") })
      : t("readBy_count", { count: readers.length, total });
  };
  /**
   * 檔案訊息的附註（ADR-0093 語意，與桌面一致）：
   * 已存路徑 → 顯示路徑；只有 metadata（位元組落在另一台）→ 提示；否則顯示大小。
   */
  const fileNote = (m: ChatMessage): string => {
    const f = m.file;
    if (!f) return "";
    const size = f.size < 1024 ? `${f.size} B` : f.size < 1048576 ? `${(f.size / 1024).toFixed(1)} KB` : `${(f.size / 1048576).toFixed(1)} MB`;
    if (f.savedPath) return `${t("file_saved")}：${f.savedPath}`;
    if (!m.outgoing && !f.url && f.sent < f.size) return `📍 ${t("file_onOtherDevice")}`;
    return size;
  };

  const [draft, setDraft] = useState("");
  // 算式預覽（ADR-0097）：純函式判定草稿是否為算式；不是就回 null（不顯示）。
  const calc = calcPreview(draft);

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
        <View style={styles.headText}>
          <Text style={styles.headTitle}>{name}</Text>
          {subtitle ? <Text style={styles.headSub}>{subtitle}</Text> : null}
        </View>
        {/* 敲一下（ADR-0114）：1:1 才有。 */}
        {onNudge && !groupMembers ? (
          <Pressable
            style={styles.callBtn}
            accessibilityRole="button"
            aria-label={t("convo_nudge")}
            testID="nudge"
            onPress={onNudge}
          >
            <Text style={styles.callIcon}>👋</Text>
          </Pressable>
        ) : null}
        {/* 群組管理（ADR-0114）：成員清單／離開群組。1:1 不顯示。 */}
        {groupMembers && (onLeaveGroup || onRemoveMember) ? (
          <Pressable
            style={styles.callBtn}
            accessibilityRole="button"
            aria-label={t("members_title")}
            testID="group-menu"
            onPress={() => setMembersOpen((v) => !v)}
          >
            <Text style={styles.callIcon}>👥</Text>
          </Pressable>
        ) : null}
        {/* 歷史紀錄（ADR-0111）：主畫面只讀熱區；更舊的訊息在封存裡，由此進入。 */}
        {onHistory ? (
          <Pressable
            style={styles.callBtn}
            accessibilityRole="button"
            aria-label={t("history_open")}
            onPress={onHistory}
            testID="open-history"
          >
            <Text style={styles.callIcon}>🗄</Text>
          </Pressable>
        ) : null}
        {/* 通話（ADR-0101）：媒體全程 P2P，不經中繼。群組暫不支援（1:1 才顯示）。 */}
        {onStartCall && !groupMembers ? (
          <>
            <Pressable
              style={styles.callBtn}
              accessibilityRole="button"
              aria-label={t("call_audio")}
              onPress={() => onStartCall("audio")}
            >
              <Text style={styles.callIcon}>📞</Text>
            </Pressable>
            <Pressable
              style={styles.callBtn}
              accessibilityRole="button"
              aria-label={t("call_video")}
              onPress={() => onStartCall("video")}
            >
              <Text style={styles.callIcon}>📹</Text>
            </Pressable>
          </>
        ) : null}
      </View>

      {/* 群組成員面板（ADR-0114）：管理者可移除成員；任何人都能離開。 */}
      {membersOpen && groupMembers ? (
        <View style={styles.members}>
          {groupMembers.map((pk) => (
            <View key={pk} style={styles.memberRow}>
              <Text style={styles.memberName}>{nameFor ? nameFor(pk) : `${pk.slice(0, 10)}…`}</Text>
              {isGroupAdmin && onRemoveMember && pk !== selfPubkey ? (
                <Pressable
                  style={styles.memberBtn}
                  accessibilityRole="button"
                  testID={`remove-${pk}`}
                  onPress={() => onRemoveMember(pk)}
                >
                  <Text style={styles.memberBtnText}>{t("group_remove")}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {onLeaveGroup ? (
            <Pressable
              style={[styles.memberBtn, styles.leaveBtn]}
              accessibilityRole="button"
              testID="leave-group"
              onPress={() => {
                onLeaveGroup();
                setMembersOpen(false);
              }}
            >
              <Text style={styles.leaveText}>{t("group_leave")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <ScrollView style={styles.list} contentContainerStyle={styles.listInner}>
        {messages.map((m) => {
          const gone = unsent?.has(m.id) ?? false; // 已收回（NIP-09）
          const emojis = reactions?.[m.id] ?? [];
          // 圖片可分享（ADR-0132）——收到的圖即使沒有回應/收回，也要能長按叫出分享。
          const canShareImg = !gone && !!m.file?.mime.startsWith("image/") && !!(m.file.url ?? m.file.thumb);
          const canAct = !gone && (onReact || (m.outgoing && onUnsend) || canShareImg);
          return (
          <View key={m.id} style={m.outgoing ? styles.rowMine : styles.rowTheir}>
            {!m.outgoing && nameFor && m.sender ? <Text style={styles.sender}>{nameFor(m.sender)}</Text> : null}
            {/* 長按＝手機上的「右鍵選單」：回應／收回。已收回的訊息不再提供任何操作。 */}
            <Pressable
              {...(canAct
                ? {
                    onLongPress: () => setPicked((p) => (p === m.id ? null : m.id)),
                    accessibilityRole: "button" as const,
                  }
                : {})}
              testID={`bubble-${m.id}`}
            >
              <View style={[styles.bubble, m.outgoing ? styles.bubbleMine : styles.bubbleTheir]}>
                {/* 圖片縮圖（ADR-0102）：跨 session 存活——重載後圖片仍是圖片，不會退化成檔名。 */}
                {!gone && m.file && (m.file.url ?? m.file.thumb) ? (
                  <Image
                    source={{ uri: m.file.url ?? m.file.thumb }}
                    style={styles.thumb}
                    accessibilityLabel={m.file.name}
                  />
                ) : null}
                <Text
                  style={[
                    m.outgoing ? styles.textMine : styles.textTheir,
                    gone ? styles.textGone : null,
                  ]}
                >
                  {/* 已收回：**絕不顯示原文**——收回的意義就在這裡。 */}
                  {gone ? t("msg_unsent") : m.file ? `📎 ${m.file.name}` : m.text}
                </Text>
                {!gone && m.file ? (
                  <Text style={[styles.fileMeta, { color: m.outgoing ? "#ffffffcc" : tk.muted }]}>
                    {fileNote(m)}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            {/* 收到的 emoji 回應（NIP-25）。 */}
            {!gone && emojis.length > 0 ? (
              <View style={styles.reactions}>
                <Text style={styles.reactionText}>{emojis.join(" ")}</Text>
              </View>
            ) : null}
            {/* 長按後的操作列。 */}
            {picked === m.id ? (
              <View style={styles.actions}>
                {onReact
                  ? REACTION_EMOJIS.map((e) => (
                      <Pressable
                        key={e}
                        style={styles.actBtn}
                        accessibilityRole="button"
                        onPress={() => {
                          onReact(m.id, e);
                          setPicked(null);
                        }}
                      >
                        <Text style={styles.actEmoji}>{e}</Text>
                      </Pressable>
                    ))
                  : null}
                {/* 分享（ADR-0132）：圖片訊息 → 原生分享選單（與其他手機 app 同體驗）；
                    不支援時退回下載，不讓按鈕變死路。 */}
                {m.file?.mime.startsWith("image/") && (m.file.url ?? m.file.thumb) ? (
                  <Pressable
                    style={styles.actBtn}
                    accessibilityRole="button"
                    testID={`share-${m.id}`}
                    onPress={() => {
                      const uri = m.file?.url ?? m.file?.thumb ?? "";
                      const name = m.file?.name ?? "image";
                      const mime = m.file?.mime ?? "image/*";
                      void shareImageFromUrl(uri, name, mime).then((ok) => {
                        if (!ok) downloadImageFromUrl(uri, name);
                      });
                      setPicked(null);
                    }}
                  >
                    <Text style={styles.actText}>{t("share_share")}</Text>
                  </Pressable>
                ) : null}
                {m.outgoing && onUnsend ? (
                  <Pressable
                    style={styles.actBtn}
                    accessibilityRole="button"
                    testID={`unsend-${m.id}`}
                    onPress={() => {
                      onUnsend(m.id);
                      setPicked(null);
                    }}
                  >
                    <Text style={styles.actText}>{t("msg_unsend")}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {/* 送出狀態（ADR-0095）：與桌面同一套——沙漏／閉眼／半開眼／張開眼（主色）／紅色重試。
                群組另依分級顯示「誰已讀」（≤5）或「已讀 M/N」（6–10）；大群不顯示。 */}
            {!gone && m.outgoing && (m.status || groupReadOf(m)) ? (
              <View style={styles.status}>
                {m.status ? (
                  <View aria-label={t(MSG_STATUS_KEY[m.status])}>
                    <MsgStatusIcon status={m.status} color={statusColor(m.status)} size={12} />
                  </View>
                ) : null}
                {groupReadOf(m) ? <Text style={styles.readby}>{groupReadOf(m)}</Text> : null}
              </View>
            ) : null}
          </View>
          );
        })}
      </ScrollView>

      {/* 算式即時預覽（ADR-0097）：純本地計算，草稿不外流；點一下把「= 答案」加到草稿。 */}
      {calc ? (
        <Pressable
          style={styles.calcchip}
          accessibilityRole="button"
          aria-label={t("calc_insertHint")}
          onPress={() => setDraft((prev) => `${prev.trimEnd()} = ${calc.result}`)}
        >
          <Text style={styles.calcchipEq}>=</Text>
          <Text style={styles.calcchipVal}>{calc.result}</Text>
        </Pressable>
      ) : null}

      <View style={styles.composer}>
        {/* 傳送檔案（ADR-0093/0100）：位元組走 P2P、metadata 走中繼。 */}
        {onSendFile ? (
          <Pressable style={styles.attach} accessibilityRole="button" aria-label={t("convo_attach")} onPress={onSendFile}>
            <Text style={styles.attachText}>📎</Text>
          </Pressable>
        ) : null}
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
