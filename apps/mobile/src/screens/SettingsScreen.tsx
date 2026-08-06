// 行動端設定分頁（ADR-0087）：身分備份（npub/nsec）、外觀（主題/主色/語言）、中繼站、登出。
// 主題/主色/語言由 MobileApp 掌管、經 callback 即時切換；色彩吃 @cinderous/theme。
import { useMemo, useState } from "react";
import type { CloudSyncMode, Status } from "@cinderous/engine";
import { type Locale, type MessageKey, type TranslateParams, translate } from "@cinderous/i18n";
import { resolveTheme, type Theme, type ThemeTokens } from "@cinderous/theme";
import { policyNotices, VIDEO_QUALITIES, type OrgPolicy, type VideoQuality } from "@cinderous/core";

/** 上線狀態的 i18n 鍵（與桌面同一組）。 */
const STATUS_KEY: Record<"online" | "away" | "busy", MessageKey> = {
  online: "status_online",
  away: "status_away",
  busy: "status_busy",
};
/** 公司儲存槽佇列狀態的 i18n 鍵（ADR-0177／0180）。 */
const SLOT_STATUS_KEY: Record<"pending" | "sending" | "done" | "failed", MessageKey> = {
  pending: "slot_pending",
  sending: "slot_sending",
  done: "slot_done",
  failed: "slot_failed",
};
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native-web";
import { avatarFromUrl, pickAvatarImage } from "../native/avatar.js";
import { copyText } from "../native/clipboard.js";
import { isNativeShell } from "../native/platform.js";
import { StatusSegments } from "./SelfStatusBar.js";

const ACCENTS: { label: string; hex: string | null }[] = [
  { label: "預設", hex: null },
  { label: "森綠", hex: "#2f9e44" },
  { label: "葡萄紫", hex: "#7c4dff" },
  { label: "櫻桃", hex: "#e5498f" },
  { label: "琥珀", hex: "#e2632b" },
];

function makeStyles(tk: ThemeTokens) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: tk.bgB },
    header: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: tk.surface2, borderBottomWidth: 1, borderBottomColor: tk.border },
    headerTitle: { fontSize: 20, fontWeight: "700", color: tk.ink },
    body: { padding: 14, gap: 16 },
    section: { backgroundColor: tk.panel, borderRadius: 12, borderWidth: 1, borderColor: tk.border, padding: 14, gap: 10 },
    sectionTitle: { fontSize: 12, fontWeight: "700", color: tk.accent },
    label: { fontSize: 12, color: tk.muted },
    value: { fontSize: 13, color: tk.ink },
    npub: { fontSize: 11, color: tk.ink },
    nsec: { fontSize: 11, color: "#e5484d" },
    warn: { fontSize: 11, color: "#e5484d" },
    rowSeg: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    seg: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1 },
    segText: { fontSize: 13, fontWeight: "600" },
    swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2 },
    reveal: { alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: tk.border, backgroundColor: tk.field },
    revealText: { fontSize: 13, color: tk.accent, fontWeight: "600" },
    logout: { backgroundColor: "#e5484d", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
    logoutText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
    dangerTitle: { color: "#c0392b" },
    dangerText: { color: "#c0392b", fontWeight: "700", fontSize: 15, paddingVertical: 10 },
    deviceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    // 改密碼／備份碼（ADR-0135/0070）。
    pwInput: {
      borderWidth: 1,
      borderColor: tk.border,
      borderRadius: 8,
      backgroundColor: tk.field,
      color: tk.ink,
      paddingVertical: 8,
      paddingHorizontal: 10,
      fontSize: 14,
    },
    code: { fontSize: 11, color: tk.ink, backgroundColor: tk.field, borderRadius: 8, padding: 10 },
    okMsg: { fontSize: 12, color: "#2f9e44" },
    identityRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
    // 頭像（ADR-0154）：預覽圓＋更換/從網址/移除。
    avatarRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    avatarPreview: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: tk.field, borderWidth: 1, borderColor: tk.border },
    avatarImg: { width: 56, height: 56, borderRadius: 28 },
    avatarInitial: { fontSize: 22, fontWeight: "700", color: tk.muted },
  });
}

export function SettingsScreen({
  selfName,
  onRename,
  selfNpub,
  selfNsec,
  relayUrl,
  theme,
  onTheme,
  locale,
  onLocale,
  accent,
  onAccent,
  invisible,
  onInvisible,
  status,
  onStatus,
  statusMessage,
  onStatusMessage,
  nowPlaying,
  onNowPlaying,
  title,
  onSetTitle,
  onOpenRoster,
  orgPolicy,
  slotQueue,
  onSlotRetry,
  onSlotRemove,
  notify,
  onNotify,
  notifyHidePreview,
  foreground,
  onForeground,
  onNotifyHidePreview,
  onPairExport,
  retention,
  onRetention,
  onExport,
  readReceipts,
  allowPublicTurn,
  onAllowPublicTurn,
  videoQuality,
  onVideoQuality,
  onReadReceipts,
  groupInviteFromAnyone,
  onGroupInvite,
  devices,
  revocation,
  selfDevicePk,
  deviceKeyTier,
  deviceKeyEverPlaintext,
  onRemoveDevice,
  onForgetDevice,
  fs,
  cloudSync,
  onCloudSync,
  identities,
  onSwitchIdentity,
  onAddIdentity,
  onChangePassword,
  onMakeBackupCode,
  selfAvatar,
  onAvatar,
  onLogout,
  onRemoveIdentity,
  onWipeDevice,
}: {
  selfName: string;
  /** 更改顯示名稱（ADR-0144）：落地本機並廣播給聯絡人。未提供則不顯示改名欄。回 false＝撞本機同名（ADR-0146）。 */
  onRename?: (name: string) => boolean;
  selfNpub: string;
  selfNsec: string;
  relayUrl: string | null;
  theme: Theme;
  onTheme: (t: Theme) => void;
  locale: Locale;
  onLocale: (l: Locale) => void;
  accent: string | null;
  onAccent: (hex: string | null) => void;
  /** 隱身（ADR-0088）：停止一切在線廣播。 */
  invisible: boolean;
  onInvisible: (v: boolean) => void;
  /** 上線狀態（ADR-0114）：online/away/busy。未提供則不顯示（示範模式）。 */
  status?: Status;
  onStatus?: (s: Status) => void;
  /** 自訂狀態文字（ADR-0142／0168）：隨心跳廣播、本機記住。與 onStatus 同時提供才顯示。 */
  statusMessage?: string;
  onStatusMessage?: (msg: string) => void;
  /** 正在聽（ADR-0142／0168）：隨心跳廣播、易失不落地。與 onStatus 同時提供才顯示。 */
  nowPlaying?: string;
  onNowPlaying?: (text: string) => void;
  /** 企業自報頭銜（ADR-0158／0170）：≤24 字，變更即廣播給這個身分的所有聯絡人。未提供則不顯示。 */
  title?: string;
  onSetTitle?: (title: string) => void;
  /** 組織名冊管理入口（ADR-0178，企業主）：未提供則不顯示（非企業主）。 */
  onOpenRoster?: () => void;
  /**
   * 企業政策（ADR-0312）：條列「公司政策做了什麼」。
   * 未提供或全空＝整段不顯示（一般個人身分看不到這一區）。
   */
  orgPolicy?: OrgPolicy;
  /** 公司儲存槽佇列（ADR-0177／0180，員工端）：待傳/已送/失敗項；未提供/空則不顯示。 */
  slotQueue?: { id: string; name: string; status: "pending" | "sending" | "done" | "failed" }[];
  onSlotRetry?: () => void;
  onSlotRemove?: (id: string) => void;
  /** 通知（ADR-0116）。未提供則不顯示（示範模式）。 */
  notify?: boolean;
  onNotify?: (v: boolean) => void;
  /** 隱藏預覽：通知只說「有新訊息」，不把明文推到鎖定畫面。 */
  notifyHidePreview?: boolean;
  /** ADR-0272/0274：背景保持連線（前台服務）；未提供＝非原生殼，不顯示。 */
  foreground?: boolean;
  onForeground?: (on: boolean) => void;
  onNotifyHidePreview?: (v: boolean) => void;
  /** 搬到新裝置（ADR-0118）：把整台的資料（含私鑰）P2P 搬走。未提供則不顯示。 */
  onPairExport?: () => void;
  /** 每對話保留上限（ADR-0094）；0＝無上限。未提供則不顯示。 */
  retention?: number;
  onRetention?: (n: number) => void;
  /** 導出全部紀錄（ADR-0094）。 */
  onExport?: () => void;
  /** 已讀回條（ADR-0058）：opt-in＋互惠；關閉則不送、也不顯示對方已讀。 */
  readReceipts?: boolean;
  /** 公共 TURN 保底（ADR-0336 §4）：預設開；關掉＝限制網路下可能打不通。 */
  allowPublicTurn?: boolean;
  onAllowPublicTurn?: (on: boolean) => void;
  /** 視訊通話畫質預設（ADR-0337）：通話中可在通話畫面即時改，這裡設下一通的起點。 */
  videoQuality?: VideoQuality;
  onVideoQuality?: (q: VideoQuality) => void;
  onReadReceipts?: (v: boolean) => void;
  /** 入群邀請閘門（ADR-0317）：true＝任何人可邀；false（預設）＝只有聯絡人。 */
  groupInviteFromAnyone?: boolean;
  onGroupInvite?: (v: boolean) => void;
  /** 觀測到的裝置（ADR-0321）：提供才顯示「我的裝置」。 */
  devices?: { id: string; firstSeen: number; source: string; inDirectory?: boolean; revoked?: boolean; stale?: boolean }[];
  /** 移除某台裝置（ADR-0322 S3／ADR-0323 補上行動端入口）。未提供＝不顯示移除鈕。 */
  onRemoveDevice?: (id: string) => void;
  /** 忘掉一筆觀測（ADR-0324）：只清本機紀錄，不撤銷任何東西。 */
  onForgetDevice?: (id: string) => void;
  /** 撤銷三態（ADR-0322 S2）。⚠ 行動端 v1 只呈現狀態，移除入口留桌面（需二次確認對話框）。 */
  revocation?: { state: "unknown" | "dual-track" | "active"; devices?: string[] };
  /**
   * 本機裝置代碼（ADR-0322 S5）：在**桌面**（已在清單上的裝置）貼上即可授權這一台。
   * ⚠ 行動端 v1 只顯示自己的代碼、不提供授權入口——授權需要二次確認對話框，桌面才有統一入口。
   */
  selfDevicePk?: string;
  /** 本機裝置金鑰的保護等級（ADR-0297 §6 紅線：必須如實顯示）。 */
  deviceKeyTier?: "keystore" | "encrypted" | "plaintext" | "ephemeral";
  /** 裝置金鑰曾經明文落盤過（ADR-0323）。 */
  deviceKeyEverPlaintext?: boolean;
  /**
   * 前向保密（ADR-0245／0306 D1）：**實驗性、預設關**。未提供則不顯示整個區塊。
   * ⚠ 區塊內的「尚未經外部審計」揭露是 ADR-0306 D1 的**驗收條件**，不是提示文字——
   * 拿掉它，這條路就退回成 ADR-0306 §3 說的遮羞布。
   */
  fs?: {
    enabled: boolean;
    onEnable: () => void;
    onRotate: () => void;
    onDisable?: () => void;
    /** 本裝置解不開的訊息數與最後時間（ADR-0316）；`count` 為 0 時不顯示。 */
    undecryptable?: { count: number; lastAt: number };
  };
  /** 加密雲端備份（ADR-0071）：off／basic（不含訊息）／full（含訊息）。 */
  cloudSync?: CloudSyncMode;
  onCloudSync?: (mode: CloudSyncMode) => void;
  /** 身分清單（多身分，ADR-0138）：切換器顯示；未提供或僅 1 個時不顯示切換器。 */
  identities?: { pubkey: string; name: string; active: boolean }[];
  /** 切換到某身分（ADR-0138）。 */
  onSwitchIdentity?: (pubkey: string) => void;
  /** 新增身分（ADR-0138）。 */
  onAddIdentity?: () => void;
  /** 改本地密碼（ADR-0135）：回 false＝舊密碼錯。僅在有「記住的身分」時提供。 */
  onChangePassword?: (oldPassword: string, newPassword: string) => boolean;
  /** 產生加密備份碼（ADR-0070）：以備份密碼包裹 nsec＋relay，回單一字串。僅在有 relay 時提供。 */
  onMakeBackupCode?: (password: string) => string;
  /** 自己目前的廣播頭像（ADR-0154）；未設＝生成色圓。 */
  selfAvatar?: string;
  /** 設定/移除廣播頭像（ADR-0154）；回 false＝引擎拒收。未提供則不顯示頭像區（示範模式）。 */
  onAvatar?: (uri: string | undefined) => boolean;
  onLogout: () => void;
  /** 移除此身分（ADR-0202，破壞性）。 */
  onRemoveIdentity?: () => void;
  /** 清空裝置（ADR-0202，破壞性、不可逆）。 */
  onWipeDevice?: () => void;
}): JSX.Element {
  const tk = useMemo(() => resolveTheme({ theme, accent }), [theme, accent]);
  const styles = useMemo(() => makeStyles(tk), [tk]);
  // 帶 params 的鍵（如 ADR-0312 的「保留 {days} 天」）需要內插，故轉發第三個參數。
  const t = (k: MessageKey, params?: TranslateParams): string => translate(locale, k, params);
  const [showNsec, setShowNsec] = useState(false);
  // 更改顯示名稱（ADR-0144）。
  const [nameDraft, setNameDraft] = useState(selfName);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameTakenErr, setNameTakenErr] = useState(false); // ADR-0146：撞本機同名
  const nameDirty = nameDraft.trim().length > 0 && nameDraft.trim() !== selfName;
  const applyRename = (): void => {
    if (!onRename || !nameDirty) return;
    // onRename 回 false＝名稱已被本機另一身分佔用（ADR-0146）→ 顯示重名提示，不視為成功。
    if (onRename(nameDraft.trim())) {
      setNameSaved(true);
      setNameTakenErr(false);
    } else {
      setNameTakenErr(true);
      setNameSaved(false);
    }
  };
  // 改密碼表單（ADR-0135）。
  const [pwOld, setPwOld] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwNew2, setPwNew2] = useState("");
  const [pwMsg, setPwMsg] = useState<"" | "ok" | "err">("");
  // 備份碼表單（ADR-0070）。
  const [bkPw, setBkPw] = useState("");
  const [bkPw2, setBkPw2] = useState("");
  const [bkCode, setBkCode] = useState("");
  const [bkCopied, setBkCopied] = useState(false);
  // 正在聽（ADR-0168）：草稿本地暫存，離開輸入框（送出/失焦）才廣播——不想把打到一半的
  // 歌名一個字一個字廣播出去。狀態文字則照桌面即時（每次改動就更新，引擎自會節流心跳）。
  const [npDraft, setNpDraft] = useState(nowPlaying ?? "");
  // 企業自報頭銜（ADR-0170）：草稿＋套用鈕（廣播是有代價的動作＝全量重播個人檔，不逐字送）。
  const [titleDraft, setTitleDraft] = useState(title ?? "");
  const [titleSaved, setTitleSaved] = useState(false);
  const titleDirty = titleDraft.trim() !== (title ?? "").trim();
  const applyTitle = (): void => {
    onSetTitle?.(titleDraft.trim()); // 空＝移除
    setTitleSaved(true);
  };

  // 公司政策條列（ADR-0312）：清單與順序來自 core（與桌面同一份），這裡只接文案。
  const policyRows = policyNotices(orgPolicy).map((n) => ({
    id: n.id,
    kind: n.kind,
    text:
      n.id === "files"
        ? t("orgPolicy_files")
        : n.id === "calls"
          ? t("orgPolicy_calls")
          : n.id === "stickers"
            ? t("orgPolicy_stickers")
            : n.id === "cloudBackup"
              ? t("orgPolicy_cloudBackup")
              : n.id === "forceTurn"
                ? t("orgPolicy_forceTurn")
                : n.id === "ttlDays"
                  ? t("orgPolicy_ttlDays", { days: String(n.value ?? "") })
                  : t("orgPolicy_relayFilesMb", { mb: String(n.value ?? "") }),
  }));
  const policyDisabled = policyRows.filter((r) => r.kind === "disabled");
  const policyRules = policyRows.filter((r) => r.kind === "rule");

  const changePassword = (): void => {
    if (!onChangePassword || !pwOld || !pwNew || pwNew !== pwNew2) {
      setPwMsg("err");
      return;
    }
    const ok = onChangePassword(pwOld, pwNew);
    setPwMsg(ok ? "ok" : "err");
    if (ok) {
      setPwOld("");
      setPwNew("");
      setPwNew2("");
    }
  };
  const makeBackup = (): void => {
    if (!onMakeBackupCode || !bkPw || bkPw !== bkPw2) return;
    setBkCode(onMakeBackupCode(bkPw));
    setBkCopied(false);
  };
  // 頭像（ADR-0154）：本畫面持有顯示狀態（初值來自後端），成功套用後更新。
  const [avatar, setAvatar] = useState<string | undefined>(selfAvatar);
  const [avatarUrlOpen, setAvatarUrlOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarErr, setAvatarErr] = useState(false);
  const applyAvatar = (uri: string | undefined): void => {
    if (!onAvatar) return;
    if (onAvatar(uri)) {
      setAvatar(uri);
      setAvatarErr(false);
      setAvatarUrlOpen(false);
      setAvatarUrl("");
    } else {
      setAvatarErr(true);
    }
  };
  const pickAvatar = (): void => {
    void pickAvatarImage().then((uri) => {
      if (uri) applyAvatar(uri);
    });
  };
  const applyAvatarUrl = (): void => {
    const url = avatarUrl.trim();
    if (!url) return;
    // ADR-0154：由自己的裝置抓一次 → 縮圖 → 內嵌廣播；網址不會傳給任何聯絡人。
    void avatarFromUrl(url).then((uri) => {
      if (uri) applyAvatar(uri);
      else setAvatarErr(true);
    });
  };

  const seg = (on: boolean) => [styles.seg, { borderColor: on ? tk.accent : tk.border, backgroundColor: on ? tk.accent : tk.field }];
  const segTxt = (on: boolean) => [styles.segText, { color: on ? "#ffffff" : tk.ink }];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("mobileTab_settings")}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {/* 多身分切換（ADR-0138）：列出各身分，點非作用中者切換；可新增。示範模式無此區。 */}
        {onAddIdentity ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("identities_title")}</Text>
            {(identities ?? []).map((id) => (
              <Pressable
                key={id.pubkey}
                accessibilityRole="button"
                testID={`identity-${id.pubkey}`}
                disabled={id.active}
                onPress={() => onSwitchIdentity?.(id.pubkey)}
                style={styles.identityRow}
              >
                <Text style={[styles.value, id.active ? { color: tk.accent, fontWeight: "700" } : null]} numberOfLines={1}>
                  {id.name}
                </Text>
                {id.active ? <Text style={styles.label}>{t("identities_active")}</Text> : null}
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              testID="identity-add"
              onPress={onAddIdentity}
              style={[styles.seg, { alignSelf: "flex-start", borderColor: tk.accent, backgroundColor: tk.field }]}
            >
              <Text style={[styles.segText, { color: tk.accent }]}>＋ {t("identities_add")}</Text>
            </Pressable>
          </View>
        ) : null}

        {/* 頭像（ADR-0154）：預覽＋更換/從網址/移除；設定即加密廣播給聯絡人。 */}
        {onAvatar ? (
          <View style={styles.section} testID="avatar-section">
            <Text style={styles.sectionTitle}>{t("avatar_change")}</Text>
            <View style={styles.avatarRow}>
              <View style={styles.avatarPreview}>
                {avatar ? (
                  <Image source={{ uri: avatar }} style={styles.avatarImg} accessibilityLabel={selfName} />
                ) : (
                  <Text style={styles.avatarInitial}>{(selfName.trim()[0] ?? "?").toUpperCase()}</Text>
                )}
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.label}>{t("avatar_syncHint")}</Text>
                <View style={styles.rowSeg}>
                  <Pressable accessibilityRole="button" testID="avatar-pick" onPress={pickAvatar} style={[styles.seg, { borderColor: tk.accent, backgroundColor: tk.field }]}>
                    <Text style={[styles.segText, { color: tk.accent }]}>{t("avatar_change")}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" testID="avatar-url-toggle" onPress={() => setAvatarUrlOpen((v) => !v)} style={[styles.seg, { borderColor: tk.border, backgroundColor: tk.field }]}>
                    <Text style={[styles.segText, { color: tk.ink }]}>{t("avatar_fromUrl")}</Text>
                  </Pressable>
                  {avatar ? (
                    <Pressable accessibilityRole="button" testID="avatar-remove" onPress={() => applyAvatar(undefined)} style={[styles.seg, { borderColor: tk.border, backgroundColor: tk.field }]}>
                      <Text style={[styles.segText, { color: "#e5484d" }]}>{t("avatar_remove")}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
            {avatarUrlOpen ? (
              <View style={styles.rowSeg}>
                <TextInput
                  style={[styles.pwInput, { flex: 1 }]}
                  value={avatarUrl}
                  onChangeText={(v: string) => {
                    setAvatarUrl(v);
                    setAvatarErr(false);
                  }}
                  placeholder={t("avatar_urlPrompt")}
                  placeholderTextColor={tk.muted}
                  aria-label={t("avatar_urlPrompt")}
                  testID="avatar-url-input"
                />
                <Pressable accessibilityRole="button" testID="avatar-url-apply" onPress={applyAvatarUrl} style={[styles.seg, { borderColor: tk.accent, backgroundColor: tk.field }]}>
                  <Text style={[styles.segText, { color: tk.accent }]}>{t("settings_nameApply")}</Text>
                </Pressable>
              </View>
            ) : null}
            {avatarErr ? (
              <Text style={styles.warn} testID="avatar-error">{t("avatar_urlError")}</Text>
            ) : null}
          </View>
        ) : null}

        {/* 身分備份 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("settings_identityBackup")}</Text>
          {/* 更改顯示名稱（ADR-0144）：輸入新名 → 落地本機＋廣播給聯絡人。 */}
          {onRename ? (
            <>
              <Text style={styles.label}>{t("settings_displayName")}</Text>
              <View style={styles.rowSeg}>
                <TextInput
                  style={[styles.pwInput, { flex: 1 }]}
                  value={nameDraft}
                  onChangeText={(v: string) => {
                    setNameDraft(v);
                    setNameSaved(false);
                    setNameTakenErr(false);
                  }}
                  placeholder={t("settings_displayName")}
                  placeholderTextColor={tk.muted}
                  aria-label={t("settings_displayName")}
                  testID="rename-input"
                />
                <Pressable
                  accessibilityRole="button"
                  testID="rename-apply"
                  disabled={!nameDirty}
                  onPress={applyRename}
                  style={[styles.seg, { borderColor: nameDirty ? tk.accent : tk.border, backgroundColor: tk.field, opacity: nameDirty ? 1 : 0.5 }]}
                >
                  <Text style={[styles.segText, { color: tk.accent }]}>{t("settings_nameApply")}</Text>
                </Pressable>
              </View>
              {nameTakenErr ? (
                <Text style={styles.warn} testID="rename-taken">{t("settings_nameTaken")}</Text>
              ) : nameSaved ? (
                <Text style={styles.okMsg} testID="rename-ok">{t("settings_nameUpdated")}</Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.value}>{selfName}</Text>
          )}
          {selfNpub ? <Text style={styles.npub} numberOfLines={1}>{selfNpub}</Text> : null}
          {showNsec ? (
            <>
              <Text style={styles.warn}>{t("settings_identityWarning")}</Text>
              <Text style={styles.nsec}>{selfNsec}</Text>
            </>
          ) : null}
          <Pressable style={styles.reveal} accessibilityRole="button" onPress={() => setShowNsec((v) => !v)}>
            <Text style={styles.revealText}>{showNsec ? t("settings_hideKey") : t("settings_revealKey")}</Text>
          </Pressable>
        </View>

        {/* 加密備份碼（ADR-0070）：密碼加密的 nsec＋relay，換裝置時「貼備份碼＋密碼」即可還原。 */}
        {onMakeBackupCode ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings_backupCode")}</Text>
            <Text style={styles.label}>{t("settings_backupCodeHint")}</Text>
            <TextInput
              style={styles.pwInput}
              value={bkPw}
              onChangeText={setBkPw}
              placeholder={t("settings_backupCodePw")}
              placeholderTextColor={tk.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              aria-label={t("settings_backupCodePw")}
              testID="backup-pw"
            />
            <TextInput
              style={styles.pwInput}
              value={bkPw2}
              onChangeText={setBkPw2}
              placeholder={t("settings_backupCodePw2")}
              placeholderTextColor={tk.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              aria-label={t("settings_backupCodePw2")}
              testID="backup-pw2"
            />
            <Pressable
              accessibilityRole="button"
              testID="backup-make"
              onPress={makeBackup}
              style={[styles.seg, { alignSelf: "flex-start", borderColor: tk.accent, backgroundColor: tk.field }]}
            >
              <Text style={[styles.segText, { color: tk.accent }]}>{t("settings_backupCodeMake")}</Text>
            </Pressable>
            {bkCode ? (
              <>
                <Text style={styles.code} selectable testID="backup-code">
                  {bkCode}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  testID="backup-copy"
                  onPress={() => void copyText(bkCode).then((ok) => setBkCopied(ok))}
                  style={[styles.seg, { alignSelf: "flex-start", borderColor: tk.border, backgroundColor: tk.field }]}
                >
                  <Text style={[styles.segText, { color: tk.ink }]}>
                    {bkCopied ? t("share_copied") : t("backup_copy")}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}

        {/* 改本地密碼（ADR-0135）：舊密碼解開、新密碼重新包裹。僅在已「記住身分」時出現。 */}
        {onChangePassword ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings_passwordChange")}</Text>
            <TextInput
              style={styles.pwInput}
              value={pwOld}
              onChangeText={(v: string) => {
                setPwOld(v);
                setPwMsg("");
              }}
              placeholder={t("settings_passwordOld")}
              placeholderTextColor={tk.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              aria-label={t("settings_passwordOld")}
              testID="pw-old"
            />
            <TextInput
              style={styles.pwInput}
              value={pwNew}
              onChangeText={setPwNew}
              placeholder={t("settings_passwordNew")}
              placeholderTextColor={tk.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              aria-label={t("settings_passwordNew")}
              testID="pw-new"
            />
            <TextInput
              style={styles.pwInput}
              value={pwNew2}
              onChangeText={setPwNew2}
              placeholder={t("settings_passwordRepeat")}
              placeholderTextColor={tk.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              aria-label={t("settings_passwordRepeat")}
              testID="pw-new2"
            />
            {pwMsg === "err" ? <Text style={styles.warn}>{t("settings_passwordError")}</Text> : null}
            {pwMsg === "ok" ? <Text style={styles.okMsg}>{t("mobilePassword_changed")}</Text> : null}
            <Pressable
              accessibilityRole="button"
              testID="pw-change"
              onPress={changePassword}
              style={[styles.seg, { alignSelf: "flex-start", borderColor: tk.accent, backgroundColor: tk.field }]}
            >
              <Text style={[styles.segText, { color: tk.accent }]}>{t("settings_passwordApply")}</Text>
            </Pressable>
          </View>
        ) : null}

        {/* 外觀 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("mobileSettings_appearance")}</Text>
          <Text style={styles.label}>{t("mobileSettings_theme")}</Text>
          <View style={styles.rowSeg}>
            <Pressable
              style={seg(theme === "light")}
              accessibilityRole="button"
              testID="theme-light"
              onPress={() => onTheme("light")}
            >
              <Text style={segTxt(theme === "light")}>{t("mobileSettings_light")}</Text>
            </Pressable>
            <Pressable
              style={seg(theme === "dark")}
              accessibilityRole="button"
              testID="theme-dark"
              onPress={() => onTheme("dark")}
            >
              <Text style={segTxt(theme === "dark")}>{t("mobileSettings_dark")}</Text>
            </Pressable>
          </View>
          <Text style={styles.label}>{t("mobileSettings_accent")}</Text>
          <View style={styles.rowSeg}>
            {ACCENTS.map((a) => {
              const on = (a.hex ?? null) === (accent ?? null);
              return (
                <Pressable
                  key={a.label}
                  accessibilityRole="button"
                  aria-label={a.label}
                  onPress={() => onAccent(a.hex)}
                  style={[styles.swatch, { backgroundColor: a.hex ?? "#2f6cd6", borderColor: on ? tk.ink : tk.border }]}
                />
              );
            })}
          </View>
          <Text style={styles.label}>{t("mobileSettings_language")}</Text>
          <View style={styles.rowSeg}>
            <Pressable
              style={seg(locale === "zh-Hant")}
              accessibilityRole="button"
              testID="locale-zh"
              onPress={() => onLocale("zh-Hant")}
            >
              <Text style={segTxt(locale === "zh-Hant")}>繁中</Text>
            </Pressable>
            <Pressable
              style={seg(locale === "en")}
              accessibilityRole="button"
              testID="locale-en"
              onPress={() => onLocale("en")}
            >
              <Text style={segTxt(locale === "en")}>EN</Text>
            </Pressable>
          </View>
        </View>

        {/* 上線狀態（ADR-0114）：與桌面同一組。隱身（見下）優先於此——隱身時完全不廣播。 */}
        {/* status 與 onStatus 恆成對傳入（MobileApp 同一個 spread）；一起判斷讓型別也講清楚這件事。 */}
        {onStatus && status ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings_status")}</Text>
            {/* ADR-0278：與聊天清單頂部的狀態列共用同一個控制項——同一個開關不做兩份。 */}
            <StatusSegments value={status} onChange={onStatus} locale={locale} theme={theme} accent={accent} />
            {/* 自訂狀態文字（ADR-0142／0168／0171）：逐字更新本機（即時記住），廣播於 MobileApp
                以 ~600ms 節流合併（引擎 setStatus 本身是同步廣播、catch-up 依賴，故在 UI 層合併，
                不逐字打中繼/P2P、也不外送打到一半的文字）。 */}
            {onStatusMessage ? (
              <TextInput
                style={styles.pwInput}
                value={statusMessage ?? ""}
                onChangeText={onStatusMessage}
                placeholder={t("personalMessage_placeholder")}
                placeholderTextColor={tk.muted}
                aria-label={t("personalMessage_placeholder")}
                testID="status-message"
              />
            ) : null}
            {/* 正在聽（ADR-0142／0168）：離開輸入框才廣播（onEndEditing/失焦）；空＝不分享。 */}
            {onNowPlaying ? (
              <TextInput
                style={styles.pwInput}
                value={npDraft}
                onChangeText={setNpDraft}
                onBlur={() => onNowPlaying(npDraft.trim())}
                placeholder={t("nowPlaying_placeholder")}
                placeholderTextColor={tk.muted}
                aria-label={t("nowPlaying_placeholder")}
                testID="now-playing"
              />
            ) : null}
          </View>
        ) : null}

        {/* 企業自報頭銜（ADR-0158／0170）：草稿＋套用鈕；廣播＝全量重播個人檔給聯絡人。 */}
        {onSetTitle ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings_orgTitle")}</Text>
            <Text style={styles.label}>{t("settings_orgTitleHint")}</Text>
            <View style={styles.rowSeg}>
              <TextInput
                style={[styles.pwInput, { flex: 1 }]}
                value={titleDraft}
                onChangeText={(v: string) => {
                  setTitleDraft(v);
                  setTitleSaved(false);
                }}
                placeholder={t("settings_orgTitle")}
                placeholderTextColor={tk.muted}
                aria-label={t("settings_orgTitle")}
                testID="org-title"
              />
              <Pressable
                accessibilityRole="button"
                testID="org-title-apply"
                disabled={!titleDirty}
                onPress={applyTitle}
                style={[styles.seg, { borderColor: titleDirty ? tk.accent : tk.border, backgroundColor: tk.field, opacity: titleDirty ? 1 : 0.5 }]}
              >
                <Text style={[styles.segText, { color: tk.accent }]}>{t("settings_nameApply")}</Text>
              </Pressable>
            </View>
            {titleSaved ? (
              <Text style={styles.okMsg} testID="org-title-ok">{t("settings_orgTitleUpdated")}</Text>
            ) : null}
          </View>
        ) : null}

        {/* 公司政策（ADR-0312）：條列「公司政策做了什麼」——沒有這一段，政策只表現為按鈕消失。
            清單與順序來自 core 的 policyNotices，與桌面同一份。 */}
        {policyRows.length > 0 ? (
          <View style={styles.section} testID="org-policy">
            <Text style={styles.sectionTitle}>{t("orgPolicy_title")}</Text>
            {policyDisabled.length > 0 ? (
              <>
                <Text style={styles.label}>{t("orgPolicy_disabledHead")}</Text>
                {policyDisabled.map((row) => (
                  <Text key={row.id} style={styles.value} testID={`org-policy-${row.id}`}>
                    ・{row.text}
                  </Text>
                ))}
              </>
            ) : null}
            {policyRules.length > 0 ? (
              <>
                <Text style={styles.label}>{t("orgPolicy_rulesHead")}</Text>
                {policyRules.map((row) => (
                  <Text key={row.id} style={styles.value} testID={`org-policy-${row.id}`}>
                    ・{row.text}
                  </Text>
                ))}
              </>
            ) : null}
            <Text style={styles.label}>{t("orgPolicy_hint")}</Text>
          </View>
        ) : null}

        {/* 組織名冊管理（ADR-0178，企業主）：發布名冊、複製邀請碼、公司設定。 */}
        {onOpenRoster ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings_orgRoster")}</Text>
            <Pressable accessibilityRole="button" testID="open-roster" onPress={onOpenRoster} style={[styles.seg, { borderColor: tk.accent, backgroundColor: tk.field }]}>
              <Text style={[styles.segText, { color: tk.accent }]}>{t("settings_orgRoster")}</Text>
            </Pressable>
          </View>
        ) : null}

        {/* 公司儲存槽佇列（ADR-0177／0180，員工端）：狀態＋移除；有失敗才顯示「重試」。 */}
        {slotQueue && slotQueue.length > 0 ? (
          <View style={styles.section} testID="slot-queue">
            <Text style={styles.sectionTitle}>{t("settings_slot")}</Text>
            {slotQueue.map((item) => (
              <View key={item.id} style={styles.rowSeg}>
                <Text style={[styles.value, { flex: 1 }]} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.label}>{t(SLOT_STATUS_KEY[item.status])}</Text>
                {onSlotRemove ? (
                  <Pressable accessibilityRole="button" testID={`slot-remove-${item.id}`} onPress={() => onSlotRemove(item.id)}>
                    <Text style={[styles.segText, { color: "#e5484d" }]}>{t("slot_remove")}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            {onSlotRetry && slotQueue.some((i) => i.status === "failed") ? (
              <Pressable accessibilityRole="button" testID="slot-retry" onPress={onSlotRetry} style={[styles.seg, { borderColor: tk.accent, backgroundColor: tk.field }]}>
                <Text style={[styles.segText, { color: tk.accent }]}>{t("slot_retry")}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* 搬到新裝置（ADR-0118）：全程 P2P 加密，不經中繼儲存。 */}
        {onPairExport ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("pairExport_title")}</Text>
            <Text style={styles.label}>{t("pairExport_hint")}</Text>
            <Pressable
              accessibilityRole="button"
              testID="pair-export"
              onPress={onPairExport}
              style={[styles.seg, { alignSelf: "flex-start", borderColor: tk.accent, backgroundColor: tk.field }]}
            >
              <Text style={[styles.segText, { color: tk.accent }]}>{t("pairExport_start")}</Text>
            </Pressable>
          </View>
        ) : null}

        {/* 通知（ADR-0116）：預設關；開啟時才向瀏覽器要權限（必須在使用者手勢裡）。 */}
        {onNotify ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings_notifications")}</Text>
            <Pressable
              accessibilityRole="button"
              testID="notify-toggle"
              onPress={() => onNotify(!notify)}
              style={[
                styles.seg,
                { alignSelf: "flex-start", borderColor: notify ? tk.accent : tk.border, backgroundColor: notify ? tk.accent : tk.field },
              ]}
            >
              <Text style={[styles.segText, { color: notify ? "#ffffff" : tk.ink }]}>
                {t("settings_notifications")}
                {notify ? " ✓" : ""}
              </Text>
            </Pressable>
            {/* 通知會出現在鎖定畫面／通知中心——那是裝置的「非加密表面」。 */}
            {notify && onNotifyHidePreview ? (
              <>
                <Text style={styles.label}>{t("settings_notifyHidePreview")}</Text>
                <Pressable
                  accessibilityRole="button"
                  testID="notify-hide-toggle"
                  onPress={() => onNotifyHidePreview(!notifyHidePreview)}
                  style={[
                    styles.seg,
                    {
                      alignSelf: "flex-start",
                      borderColor: notifyHidePreview ? tk.accent : tk.border,
                      backgroundColor: notifyHidePreview ? tk.accent : tk.field,
                    },
                  ]}
                >
                  <Text style={[styles.segText, { color: notifyHidePreview ? "#ffffff" : tk.ink }]}>
                    {t("settings_notifyHidePreview")}
                    {notifyHidePreview ? " ✓" : ""}
                  </Text>
                </Pressable>
              </>
            ) : null}
            {/* 背景保持連線（ADR-0272/0274）：僅原生殼（Capacitor）顯示；瀏覽器預覽無此能力。 */}
            {onForeground ? (
              <>
                <Text style={styles.label}>{t("settings_foregroundHint")}</Text>
                <Pressable
                  accessibilityRole="button"
                  testID="foreground-toggle"
                  onPress={() => onForeground(!foreground)}
                  style={[
                    styles.seg,
                    {
                      alignSelf: "flex-start",
                      borderColor: foreground ? tk.accent : tk.border,
                      backgroundColor: foreground ? tk.accent : tk.field,
                    },
                  ]}
                >
                  <Text style={[styles.segText, { color: foreground ? "#ffffff" : tk.ink }]}>
                    {t("settings_foreground")}
                    {foreground ? " ✓" : ""}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}

        {/* 隱私：隱身 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("settings_invisible")}</Text>
          <Text style={styles.label}>{t("settings_invisibleHint")}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => onInvisible(!invisible)}
            style={[styles.seg, { alignSelf: "flex-start", borderColor: invisible ? tk.accent : tk.border, backgroundColor: invisible ? tk.accent : tk.field }]}
          >
            <Text style={[styles.segText, { color: invisible ? "#ffffff" : tk.ink }]}>
              {t("settings_invisible")}
              {invisible ? " ✓" : ""}
            </Text>
          </Pressable>
        </View>

        {/*
          前向保密（ADR-0245／0306 D1）：實驗性、預設關。
          版面刻意與桌面 SettingsPanel 同構——說明 → **常駐揭露** → 按鈕，
          使用者不可能在按下去之前沒讀到那句揭露；且啟用後它不消失。
        */}
        {fs ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("fs_title")}</Text>
            <Text style={styles.label}>{t("fs_hint")}</Text>
            <Text
              testID="fs-unaudited"
              style={[styles.label, { color: "#c0392b" }]}
            >
              {t("fs_unaudited")}
            </Text>
            {fs.enabled ? (
              <>
                <Text style={styles.label}>✅ {t("fs_enabled")}</Text>
                {/* ADR-0313：保護來自自動輪替；手動鈕是「我現在就被入侵了」用的。 */}
                <Text style={styles.label} testID="fs-auto-rotate">{t("fs_autoRotate")}</Text>
                <Pressable
                  accessibilityRole="button"
                  testID="fs-rotate"
                  onPress={fs.onRotate}
                  style={[styles.seg, { alignSelf: "flex-start", borderColor: tk.border, backgroundColor: tk.field }]}
                >
                  <Text style={[styles.segText, { color: tk.ink }]}>{t("fs_rotate")}</Text>
                </Pressable>
                {/* ADR-0316：解不開不再是「什麼都沒發生」；只在 >0 時出現。 */}
                {fs.undecryptable && fs.undecryptable.count > 0 ? (
                  <Text testID="fs-undecryptable" style={[styles.label, { color: "#c0392b" }]}>
                    {t("fs_undecryptable", {
                      count: String(fs.undecryptable.count),
                      when: new Date(fs.undecryptable.lastAt).toLocaleString(),
                    })}
                  </Text>
                ) : null}
                {/* ADR-0314：啟用確認說了「可以隨時關閉」，這裡把那句話變成真的。 */}
                {fs.onDisable ? (
                  <Pressable
                    accessibilityRole="button"
                    testID="fs-disable"
                    onPress={fs.onDisable}
                    style={[styles.seg, { alignSelf: "flex-start", borderColor: tk.border, backgroundColor: tk.field }]}
                  >
                    <Text style={[styles.segText, { color: tk.ink }]}>{t("fs_disable")}</Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                testID="fs-enable"
                onPress={fs.onEnable}
                style={[styles.seg, { alignSelf: "flex-start", borderColor: tk.border, backgroundColor: tk.field }]}
              >
                <Text style={[styles.segText, { color: tk.ink }]}>{t("fs_enable")}</Text>
              </Pressable>
            )}
          </View>
        ) : null}

        {/* 我的裝置（ADR-0321 E-lite）：今天使用者根本看不到自己有幾台裝置。
            🔴 下方那句限制揭露是**驗收條件**——這份清單看不到純被動讀取的裝置，
            拿掉它，使用者會把「只有一台」讀成「沒有人在偷看」。 */}
        {devices && devices.length > 0 ? (
          <View style={styles.section} testID="devices">
            <Text style={styles.sectionTitle}>{t("devices_title")}</Text>
            {devices.map((d) => (
              <View key={d.id} style={styles.deviceRow}>
                <Text style={[styles.value, { flexShrink: 1 }]} testID={`device-${d.source}`}>
                  ・{d.id.slice(0, 8)}
                  {d.source === "local" ? `（${t("devices_thisOne")}）` : ""} ·{" "}
                  {d.source === "local"
                    ? t("devices_source_local")
                    : d.source === "pairing"
                      ? t("devices_source_pairing")
                      : t("devices_source_snapshot")}
                  {d.inDirectory === false ? ` ${t("devices_notInDirectory")}` : ""}
                  {d.revoked ? `（${t("devices_revoked")}）` : ""}
                  {/* ADR-0324：久未出現＝已被排除在撤銷判定之外，會影響行為，所以要說。 */}
                  {d.stale ? ` ${t("devices_stale")}` : ""}
                </Text>
                {/* ADR-0323：移除入口只給「不是這台、且尚未移除」的裝置
                    ——移除自己只會把這台鎖在門外（引擎也會拒絕）。 */}
                {onRemoveDevice && d.source !== "local" && !d.revoked && d.inDirectory !== false ? (
                  <Pressable
                    accessibilityRole="button"
                    testID={`device-remove-${d.id}`}
                    onPress={() => onRemoveDevice(d.id)}
                  >
                    <Text style={styles.dangerText}>{t("devices_remove")}</Text>
                  </Pressable>
                ) : null}
                {/* ADR-0324：不在目錄內的沒有目錄項，撤銷按下去會靜默什麼都不做
                    ⇒ 改給「從清單移除」，且文案明說那不撤銷任何東西。 */}
                {onForgetDevice && d.source !== "local" && d.inDirectory === false ? (
                  <Pressable
                    accessibilityRole="button"
                    testID={`device-forget-${d.id}`}
                    onPress={() => onForgetDevice(d.id)}
                  >
                    <Text style={styles.label}>{t("devices_forget")}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            {/* ADR-0297 §6 紅線：**設定頁必須如實顯示本機在哪一級**。 */}
            {deviceKeyTier ? (
              <>
                <Text style={styles.sectionTitle}>{t("devices_tierTitle")}</Text>
                <Text
                  testID={`key-tier-${deviceKeyTier}`}
                  style={[
                    styles.label,
                    deviceKeyTier === "plaintext" || deviceKeyTier === "ephemeral" ? { color: "#c0392b" } : null,
                  ]}
                >
                  {deviceKeyTier === "plaintext"
                    ? t("devices_tierPlaintext")
                    : deviceKeyTier === "ephemeral"
                      ? t("devices_tierEphemeral")
                      : deviceKeyTier === "encrypted"
                        ? t("devices_tierEncrypted")
                        : t("devices_tierKeystore")}
                </Text>
                {/* ADR-0323：遷移進金鑰庫的舊金鑰曾經明文躺過——刪副本收不回已被拿走的東西。 */}
                {deviceKeyTier === "keystore" && deviceKeyEverPlaintext ? (
                  <Text testID="key-tier-was-plain" style={[styles.label, { color: "#c0392b" }]}>
                    {t("devices_tierWasPlain")}
                  </Text>
                ) : null}
              </>
            ) : null}
            {/* ADR-0322 S5：這台的代碼——在桌面（已授權的裝置）上貼上即可把這台加入清單。 */}
            {selfDevicePk ? (
              <>
                <Text style={styles.sectionTitle}>{t("devices_myCode")}</Text>
                <Text style={styles.npub} testID="my-device-code">{selfDevicePk}</Text>
                <Text style={styles.label}>{t("devices_myCodeHint")}</Text>
              </>
            ) : null}
            {/* ADR-0322 S2：撤銷三態。雙軌期間必須明說「移除還不會生效」。 */}
            {revocation ? (
              <Text
                testID={`revocation-${revocation.state}`}
                style={[styles.label, revocation.state === "dual-track" ? { color: "#c0392b" } : null]}
              >
                {revocation.state === "unknown"
                  ? t("devices_revUnknown")
                  : revocation.state === "dual-track"
                    ? t("devices_revDualTrack", {
                        ids: (revocation.devices ?? []).map((i) => i.slice(0, 8)).join("、"),
                      })
                    : t("devices_revActive")}
              </Text>
            ) : null}
            <Text style={[styles.label, { color: "#c0392b" }]} testID="devices-limit">
              {t("devices_limit")}
            </Text>
          </View>
        ) : null}

        {/* 入群邀請的同意閘門（ADR-0317）：預設只有聯絡人可以把你加進群組。 */}
        {onGroupInvite ? (
          <View style={styles.section} testID="group-invite-setting">
            <Text style={styles.sectionTitle}>{t("settings_groupInvite")}</Text>
            <Text style={styles.label}>{t("settings_groupInviteHint")}</Text>
            <Pressable
              accessibilityRole="button"
              testID="group-invite-anyone"
              onPress={() => onGroupInvite(!groupInviteFromAnyone)}
              style={[
                styles.seg,
                {
                  alignSelf: "flex-start",
                  borderColor: groupInviteFromAnyone ? tk.accent : tk.border,
                  backgroundColor: groupInviteFromAnyone ? tk.accent : tk.field,
                },
              ]}
            >
              <Text style={[styles.segText, { color: groupInviteFromAnyone ? "#ffffff" : tk.ink }]}>
                {t("settings_groupInvite")}
                {groupInviteFromAnyone ? " ✓" : ""}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* 已讀回條（ADR-0058）：互惠——關閉則不送也不顯示對方已讀 */}
        {onReadReceipts ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings_readReceipts")}</Text>
            <Text style={styles.label}>{t("settings_readReceiptsHint")}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => onReadReceipts(!readReceipts)}
              style={[
                styles.seg,
                {
                  alignSelf: "flex-start",
                  borderColor: readReceipts ? tk.accent : tk.border,
                  backgroundColor: readReceipts ? tk.accent : tk.field,
                },
              ]}
            >
              <Text style={[styles.segText, { color: readReceipts ? "#ffffff" : tk.ink }]}>
                {t("settings_readReceipts")}
                {readReceipts ? " ✓" : ""}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* 通話中繼保底（ADR-0336 §4）：預設開；文案必須說出取捨且不得暗示關掉＝匿名 */}
        {onAllowPublicTurn ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings_publicTurn")}</Text>
            <Text style={styles.label}>{t("settings_publicTurnHint")}</Text>
            <Pressable
              accessibilityRole="button"
              testID="allow-public-turn"
              onPress={() => onAllowPublicTurn(!allowPublicTurn)}
              style={[
                styles.seg,
                {
                  alignSelf: "flex-start",
                  borderColor: allowPublicTurn ? tk.accent : tk.border,
                  backgroundColor: allowPublicTurn ? tk.accent : tk.field,
                },
              ]}
            >
              <Text style={[styles.segText, { color: allowPublicTurn ? "#ffffff" : tk.ink }]}>
                {t("settings_publicTurn")}
                {allowPublicTurn ? " ✓" : ""}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* 視訊通話畫質（ADR-0337）：預設 medium；通話中可即時改，這裡是下一通的起點 */}
        {onVideoQuality && videoQuality ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings_videoQuality")}</Text>
            <Text style={styles.label}>{t("settings_videoQualityHint")}</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {VIDEO_QUALITIES.map((q) => (
                <Pressable
                  key={q}
                  accessibilityRole="button"
                  testID={`video-quality-${q}`}
                  onPress={() => onVideoQuality(q)}
                  style={[
                    styles.seg,
                    {
                      borderColor: videoQuality === q ? tk.accent : tk.border,
                      backgroundColor: videoQuality === q ? tk.accent : tk.field,
                    },
                  ]}
                >
                  <Text style={[styles.segText, { color: videoQuality === q ? "#ffffff" : tk.ink }]}>
                    {t(`call_quality_${q}` as MessageKey)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* 加密雲端備份（ADR-0071）：密文上中繼，換機可還原 */}
        {onCloudSync ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings_cloud")}</Text>
            <Text style={styles.label}>{t("settings_cloudHint")}</Text>
            {/* ADR-0279：系統備份已關閉。使用者若不知道，換新機會發現「什麼都沒了」——
                所以在這裡（唯一談備份的區塊）明說，並指向我們自己的兩條搬移路徑。
                只在原生殼顯示：瀏覽器預覽沒有 Android 系統備份這回事。 */}
            {isNativeShell() ? (
              <Text style={styles.label} testID="no-system-backup">
                {t("settings_noSystemBackup")}
              </Text>
            ) : null}
            <View style={[styles.rowSeg, { flexWrap: "wrap" }]}>
              {(["off", "basic", "full"] as CloudSyncMode[]).map((m) => (
                <Pressable key={m} style={seg(cloudSync === m)} accessibilityRole="button" onPress={() => onCloudSync(m)}>
                  <Text style={segTxt(cloudSync === m)}>
                    {m === "off"
                      ? t("settings_cloudOff")
                      : m === "basic"
                        ? t("settings_cloudBasic")
                        : t("settings_cloudFull")}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* 訊息保留上限（ADR-0094） */}
        {onRetention ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings_retention")}</Text>
            <Text style={styles.label}>{t("settings_retentionHint")}</Text>
            <View style={[styles.rowSeg, { flexWrap: "wrap" }]}>
              {[0, 1000, 5000, 10000].map((n) => (
                <Pressable key={n} style={seg(retention === n)} accessibilityRole="button" onPress={() => onRetention(n)}>
                  <Text style={segTxt(retention === n)}>{n === 0 ? t("retention_unlimited") : String(n)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* 明文紀錄導出（ADR-0094） */}
        {onExport ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings_export")}</Text>
            <Text style={styles.label}>{t("export_warning")}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={onExport}
              style={[styles.seg, { alignSelf: "flex-start", borderColor: tk.border, backgroundColor: tk.field }]}
            >
              <Text style={[styles.segText, { color: tk.ink }]}>{t("export_run")}</Text>
            </Pressable>
          </View>
        ) : null}

        {/* 中繼站 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("mobileSettings_relay")}</Text>
          <Text style={styles.value} numberOfLines={1}>{relayUrl ?? t("mobileSettings_relayDemo")}</Text>
        </View>

        <Pressable style={styles.logout} accessibilityRole="button" testID="logout" onPress={onLogout}>
          <Text style={styles.logoutText}>{t("mobileSettings_logout")}</Text>
        </Pressable>

        {/* 危險區域（ADR-0202）：破壞性、不可逆。 */}
        {onRemoveIdentity || onWipeDevice ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, styles.dangerTitle]}>{t("settings_dangerZone")}</Text>
            {onRemoveIdentity ? (
              <Pressable accessibilityRole="button" onPress={onRemoveIdentity}>
                <Text style={styles.dangerText}>{t("settings_removeIdentity")}</Text>
              </Pressable>
            ) : null}
            {onWipeDevice ? (
              <Pressable accessibilityRole="button" onPress={onWipeDevice}>
                <Text style={styles.dangerText}>{t("wipe_device")}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
