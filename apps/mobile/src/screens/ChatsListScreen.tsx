// 行動端聊天清單（ADR-0085/0086）：登入後的主畫面，參考 LINE/Signal——聯絡人＋群組合成單一清單、
// 預設依最近互動排序，每列＝頭像＋名稱＋最後訊息預覽＋時間＋未讀徽章，點擊開啟對話。
// 真實 relay 模式（ADR-0086）：標題列「＋」展開加好友面板（貼 npub），並顯示自己的 npub 供分享。
// 色彩吃 @cinderous/theme。清單資料由呼叫端以 chat-list.ts 的 chatList() 排好傳入。
import { useMemo, useState } from "react";
import { type Locale, type MessageKey, translate } from "@cinderous/i18n";
import { resolveTheme, STATUS_COLORS, type Theme, type ThemeTokens } from "@cinderous/theme";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native-web";
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
    header: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: tk.surface2, borderBottomWidth: 1, borderBottomColor: tk.border },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    headerTitle: { fontSize: 20, fontWeight: "700", color: tk.ink },
    addBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: tk.accent },
    addBtnText: { color: "#ffffff", fontSize: 22, fontWeight: "700", lineHeight: 22 },
    addPanel: { marginTop: 10, gap: 6 },
    addLabel: { fontSize: 11, color: tk.muted },
    myNpub: { fontSize: 11, color: tk.accent },
    addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    addInput: { flex: 1, borderWidth: 1, borderColor: tk.border, borderRadius: 8, backgroundColor: tk.field, color: tk.ink, paddingVertical: 6, paddingHorizontal: 10, fontSize: 13 },
    addSubmit: { backgroundColor: tk.accent, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
    addSubmitText: { color: "#ffffff", fontWeight: "700", fontSize: 13 },
    list: { flex: 1 },
    empty: { padding: 28, textAlign: "center", color: tk.muted, fontSize: 13, lineHeight: 20 },
    memberWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
    chip: { borderWidth: 1, borderColor: tk.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    chipOn: { backgroundColor: tk.accent, borderColor: tk.accent },
    chipText: { fontSize: 12, color: tk.ink },
    chipTextOn: { color: "#ffffff" },
    submitOff: { opacity: 0.4 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: tk.border },
    avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
    avatarText: { color: "#ffffff", fontWeight: "700", fontSize: 18 },
    /** 廣播頭像圖（ADR-0154）：蓋滿色圓；狀態點為 absolute 不受影響。 */
    avatarImg: { width: 46, height: 46, borderRadius: 23 },
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
  onAddContact,
  onCreateGroup,
  contacts,
  selfNpub,
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
  /** 加好友（貼 npub）；未提供＝不顯示「＋」（如示範模式）。 */
  onAddContact?: (npub: string) => void;
  /**
   * 建立群組（ADR-0114）：名稱 ＋ 成員 pubkey。未提供＝不顯示建群入口。
   * 群組**無共用金鑰**（ADR-0027）：對每位成員各包一個 Gift Wrap 扇出，
   * 所以成員清單就是收件人清單——移除成員＝下次不扇給他，即時且免 rekey。
   */
  onCreateGroup?: (name: string, memberPubkeys: string[]) => void;
  /** 可選為群組成員的聯絡人（建群面板用）。 */
  contacts?: { pubkey: string; name: string }[];
  /** 自己的 npub（真實 relay 模式顯示於加好友面板供分享）。 */
  selfNpub?: string;
  now?: number;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
  accent2?: string | null;
}): JSX.Element {
  const tk = useMemo(() => resolveTheme({ theme, accent, accent2 }), [theme, accent, accent2]);
  const styles = useMemo(() => makeStyles(tk), [tk]);
  const t = (k: MessageKey): string => translate(locale, k);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const submitAdd = (): void => {
    const v = draft.trim();
    if (!v) return;
    onAddContact?.(v);
    setDraft("");
    setAddOpen(false);
  };

  // 建立群組（ADR-0114）。
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const toggleMember = (pubkey: string): void =>
    setPicked((p) => (p.includes(pubkey) ? p.filter((x) => x !== pubkey) : [...p, pubkey]));

  const submitGroup = (): void => {
    const name = groupName.trim();
    // 名稱可空（引擎會給預設名），但**至少要有一位成員**——空群沒有收件人，
    // 群訊會被 trackFanout 直接標成 failed（ADR-0095）。
    if (picked.length === 0) return;
    onCreateGroup?.(name, picked);
    setGroupName("");
    setPicked([]);
    setGroupOpen(false);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>{t("mobileChats_title")}</Text>
          {onCreateGroup && (contacts?.length ?? 0) > 0 ? (
            <Pressable
              style={styles.addBtn}
              accessibilityRole="button"
              aria-label={t("group_new")}
              testID="new-group"
              onPress={() => {
                setGroupOpen((v) => !v);
                setAddOpen(false);
              }}
            >
              <Text style={styles.addBtnText}>#</Text>
            </Pressable>
          ) : null}
          {onAddContact ? (
            <Pressable
              style={styles.addBtn}
              accessibilityRole="button"
              aria-label={t("mobileChats_add")}
              onPress={() => {
                setAddOpen((v) => !v);
                setGroupOpen(false);
              }}
            >
              <Text style={styles.addBtnText}>＋</Text>
            </Pressable>
          ) : null}
        </View>
        {addOpen && onAddContact ? (
          <View style={styles.addPanel}>
            {selfNpub ? (
              <>
                <Text style={styles.addLabel}>{t("mobileChats_myNpub")}</Text>
                <Text style={styles.myNpub} numberOfLines={1}>
                  {selfNpub}
                </Text>
              </>
            ) : null}
            <View style={styles.addRow}>
              <TextInput
                style={styles.addInput}
                value={draft}
                onChangeText={setDraft}
                placeholder={t("mobileChats_addPlaceholder")}
                placeholderTextColor={tk.muted}
                autoCapitalize="none"
                autoCorrect={false}
                aria-label={t("mobileChats_add")}
              />
              <Pressable style={styles.addSubmit} accessibilityRole="button" onPress={submitAdd}>
                <Text style={styles.addSubmitText}>{t("mobileChats_addBtn")}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {/* 建立群組（ADR-0114）：名稱 ＋ 從聯絡人挑成員。 */}
        {groupOpen && onCreateGroup ? (
          <View style={styles.addPanel}>
            <TextInput
              style={styles.addInput}
              value={groupName}
              onChangeText={setGroupName}
              placeholder={t("group_namePlaceholder")}
              placeholderTextColor={tk.muted}
              aria-label={t("group_name")}
            />
            <Text style={styles.addLabel}>{t("group_members")}</Text>
            <View style={styles.memberWrap}>
              {(contacts ?? []).map((c) => {
                const on = picked.includes(c.pubkey);
                return (
                  <Pressable
                    key={c.pubkey}
                    style={[styles.chip, on ? styles.chipOn : null]}
                    accessibilityRole="button"
                    testID={`member-${c.pubkey}`}
                    onPress={() => toggleMember(c.pubkey)}
                  >
                    <Text style={[styles.chipText, on ? styles.chipTextOn : null]}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              style={[styles.addSubmit, picked.length === 0 ? styles.submitOff : null]}
              accessibilityRole="button"
              disabled={picked.length === 0}
              testID="create-group"
              onPress={submitGroup}
            >
              <Text style={styles.addSubmitText}>{t("group_create")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {entries.length === 0 ? (
        <Text style={styles.empty}>{t("mobileChats_empty")}</Text>
      ) : (
        <ScrollView style={styles.list}>
          {entries.map((e) => (
            <Pressable key={e.id} style={styles.row} accessibilityRole="button" onPress={() => onOpen(e.id)}>
              <View style={[styles.avatar, { backgroundColor: avatarColor(e.id) }]}>
                {e.avatar ? (
                  <Image source={{ uri: e.avatar }} style={styles.avatarImg} accessibilityLabel={e.name} />
                ) : (
                  <Text style={styles.avatarText}>{e.isGroup ? "#" : initial(e.name)}</Text>
                )}
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
