// 行動端登入 A（ADR-0081）：nsec 匯入。貼上桌面「設定 → 身分備份」的 nsec 即以同帳號登入。
// 純 UI（RN 元件）：金鑰解碼/驗證在 ../auth（重用 @cinder/core）；色彩吃 @cinder/theme（與桌面同源）。
// 私鑰只在本機解碼、絕不外流；輸入以 secureTextEntry 遮罩，並即時預覽導出的 npub 供確認。
import { useMemo, useState } from "react";
import { type OrgInvite, parseOrgInvite } from "@cinder/core";
import { type Locale, type MessageKey, translate } from "@cinder/i18n";
import { resolveTheme, STATUS_COLORS, type Theme, type ThemeTokens } from "@cinder/theme";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native-web";
import { identityFromSecret, looksLikeBackupCode, type MobileIdentity, npubFromNsec } from "../auth.js";

function makeStyles(tk: ThemeTokens) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: tk.bgB, alignItems: "center", justifyContent: "center", padding: 20 },
    card: {
      width: "100%",
      maxWidth: 420,
      backgroundColor: tk.panel,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: tk.border,
      padding: 20,
      gap: 8,
    },
    title: { fontSize: 20, fontWeight: "700", color: tk.ink },
    hint: { fontSize: 11, color: tk.muted, lineHeight: 16 },
    label: { fontSize: 12, fontWeight: "600", color: tk.muted, marginTop: 6 },
    input: {
      borderWidth: 1,
      borderColor: tk.border,
      borderRadius: 8,
      backgroundColor: tk.field,
      color: tk.ink,
      paddingVertical: 8,
      paddingHorizontal: 10,
      fontSize: 14,
    },
    npub: { fontSize: 11, color: tk.accent },
    error: { fontSize: 12, color: STATUS_COLORS.busy },
    button: { backgroundColor: tk.accent, borderRadius: 8, paddingVertical: 10, alignItems: "center", marginTop: 8 },
    buttonText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
    link: { color: tk.accent, fontSize: 13, textAlign: "center", marginTop: 4 },
  });
}

export function NsecSignInScreen({
  onSignIn,
  onJoinOrg,
  nameTaken,
  onUsePairing,
  onBack,
  canRemember,
  locale = "zh-Hant",
  theme = "light",
  accent = null,
  accent2 = null,
}: {
  /**
   * 登入成功：回傳同帳號身分（同一把 sk）。`password` 非空＝使用者要「記住我」
   * → 呼叫端以 Argon2id 包裹 nsec 落地（ADR-0117）。
   */
  onSignIn: (identity: MobileIdentity, password?: string) => void;
  /**
   * 邀請碼入職（ADR-0156／0176）：把邀請碼貼進顯示名稱欄即偵測 → 轉為「加入組織」（生成全新
   * 企業成員身分）。未提供＝不顯示入職（如新增身分時）。
   */
  onJoinOrg?: (invite: OrgInvite, name: string, password?: string) => void;
  /**
   * ADR-0146：本機是否已有同名（可見）身分（排除同一把金鑰的重複匯入）。命中則擋下並提示改名，
   * 維持名稱唯一。未提供＝不檢查（初次登入無既有身分）。
   */
  nameTaken?: (name: string, pubkey: string) => boolean;
  /** 是否提供「記住我」（需本地密碼）。未提供＝不顯示。 */
  canRemember?: boolean;
  /** 切換到配對匯入（B）；未提供＝不顯示入口。 */
  onUsePairing?: () => void;
  /** 返回（新增身分模式，ADR-0138）；未提供＝不顯示（初次登入沒有返回）。 */
  onBack?: () => void;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
  accent2?: string | null;
}): JSX.Element {
  const tk = useMemo(() => resolveTheme({ theme, accent, accent2 }), [theme, accent, accent2]);
  const styles = useMemo(() => makeStyles(tk), [tk]);
  const [name, setName] = useState("");
  const [nsec, setNsec] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  /** 「記住我」的本地密碼（ADR-0117）。空＝不記住（nsec 只留在記憶體，重開要重貼）。 */
  const [password, setPassword] = useState("");
  /** 備份密碼（ADR-0070／0135）：貼的是備份碼時才需要，用來解開 NIP-49 信封。 */
  const [backupPw, setBackupPw] = useState("");
  const [joinName, setJoinName] = useState(""); // 入職時的顯示名稱（同事看到的）
  const T = (k: MessageKey): string => translate(locale, k);
  const isBackup = looksLikeBackupCode(nsec); // 貼的是備份碼？→ 顯示備份密碼欄
  const npub = isBackup ? null : npubFromNsec(nsec); // 備份碼未解密前導不出 npub
  // 入職邀請（ADR-0156／0176）：把邀請碼貼進顯示名稱欄 → 轉「加入組織」（生成全新企業成員身分）。
  const invite = onJoinOrg ? parseOrgInvite(name) : null;
  const joinTaken = !!invite && joinName.trim().length > 0 && !!nameTaken?.(joinName.trim(), "");
  const submitJoin = (): void => {
    if (!invite || !joinName.trim() || joinTaken) return;
    setError(null);
    onJoinOrg?.(invite, joinName.trim(), password || undefined);
  };
  let relayHost = "";
  try {
    if (invite) relayHost = new URL(invite.relayUrl).host;
  } catch {
    relayHost = invite?.relayUrl ?? "";
  }

  const submit = (): void => {
    const r = identityFromSecret(nsec, name, backupPw);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    // ADR-0146：本機名稱唯一——撞到另一個身分（非同一把金鑰）即擋，提示改名。
    if (nameTaken?.(r.identity.name, r.identity.pubkey)) {
      setError("mobileSignIn_nameTaken");
      return;
    }
    setError(null);
    // 密碼空＝不記住。**絕不無密碼記住**——那等於明文存 nsec（ADR-0112 紅線）。
    onSignIn(r.identity, password || undefined);
  };

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>{T("mobileSignIn_title")}</Text>
        <Text style={styles.hint}>{T("mobileSignIn_hint")}</Text>

        <Text style={styles.label}>{T("mobileSignIn_nameLabel")}</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} aria-label={T("mobileSignIn_nameLabel")} />
        {onJoinOrg && !invite ? <Text style={styles.hint}>{T("addId_invite")}</Text> : null}

        {invite ? (
          // 加入組織（ADR-0156／0176）：貼碼＝生成全新企業成員身分（不用現有 nsec）。
          <>
            <Text style={styles.hint}>{translate(locale, "signIn_joinHint", { host: relayHost })}</Text>
            <Text style={styles.label}>{T("signIn_joinName")}</Text>
            <TextInput
              style={styles.input}
              value={joinName}
              onChangeText={setJoinName}
              placeholder={T("signIn_joinName")}
              placeholderTextColor={tk.muted}
              autoCapitalize="none"
              autoCorrect={false}
              aria-label={T("signIn_joinName")}
              testID="join-name"
            />
            {invite.escrow ? (
              <Text style={styles.error} testID="join-escrow">
                {T("signIn_joinEscrow")}
              </Text>
            ) : null}
            {joinTaken ? <Text style={styles.error}>{T("mobileSignIn_nameTaken")}</Text> : null}
          </>
        ) : (
          <>
            <Text style={styles.label}>{T("rescue_secret")}</Text>
            <TextInput
              style={styles.input}
              value={nsec}
              onChangeText={setNsec}
              placeholder={T("mobileSignIn_nsecPlaceholder")}
              placeholderTextColor={tk.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              aria-label={T("rescue_secret")}
            />
          </>
        )}

        {/* 貼的是加密備份碼（ADR-0070）→ 需要備份密碼才解得開 NIP-49 信封。入職模式無 nsec 欄，不顯示。 */}
        {!invite && isBackup ? (
          <>
            <Text style={styles.label}>{T("rescue_backupPw")}</Text>
            <TextInput
              style={styles.input}
              value={backupPw}
              onChangeText={setBackupPw}
              placeholderTextColor={tk.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              aria-label={T("rescue_backupPw")}
              testID="backup-password"
            />
          </>
        ) : null}

        {/* 「記住我」（ADR-0117）：以 Argon2id 密碼包裹 nsec 落地。留空＝不記住。 */}
        {canRemember ? (
          <>
            <Text style={styles.label}>{T("remember_label")}</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder={T("remember_placeholder")}
              placeholderTextColor={tk.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              aria-label={T("remember_label")}
              testID="remember-password"
            />
            <Text style={styles.hint}>{T("remember_hint")}</Text>
          </>
        ) : null}

        {!invite && npub ? (
          <Text style={styles.npub}>
            {T("mobileSignIn_derived")}: {npub.slice(0, 20)}…
          </Text>
        ) : null}
        {error ? <Text style={styles.error}>{T(error)}</Text> : null}

        {invite ? (
          <Pressable style={styles.button} onPress={submitJoin} accessibilityRole="button" testID="join-org">
            <Text style={styles.buttonText}>{T("signIn_joinButton")}</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.button} onPress={submit} accessibilityRole="button">
            <Text style={styles.buttonText}>{T("mobileSignIn_button")}</Text>
          </Pressable>
        )}

        {onUsePairing ? (
          <Pressable onPress={onUsePairing} accessibilityRole="button">
            <Text style={styles.link}>{T("mobileSignIn_toPair")}</Text>
          </Pressable>
        ) : null}
        {onBack ? (
          <Pressable onPress={onBack} accessibilityRole="button" testID="signin-back">
            <Text style={styles.link}>{T("rescue_back")}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
