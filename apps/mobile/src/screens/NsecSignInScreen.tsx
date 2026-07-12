// 行動端登入 A（ADR-0081）：nsec 匯入。貼上桌面「設定 → 身分備份」的 nsec 即以同帳號登入。
// 純 UI（RN 元件）：金鑰解碼/驗證在 ../auth（重用 @cinder/core）；色彩吃 @cinder/theme（與桌面同源）。
// 私鑰只在本機解碼、絕不外流；輸入以 secureTextEntry 遮罩，並即時預覽導出的 npub 供確認。
import { useMemo, useState } from "react";
import { type Locale, type MessageKey, translate } from "@cinder/i18n";
import { resolveTheme, STATUS_COLORS, type Theme, type ThemeTokens } from "@cinder/theme";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native-web";
import { identityFromNsec, type MobileIdentity, npubFromNsec } from "../auth.js";

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
  onUsePairing,
  locale = "zh-Hant",
  theme = "light",
  accent = null,
  accent2 = null,
}: {
  /** 登入成功：回傳同帳號身分（同一把 sk）。 */
  onSignIn: (identity: MobileIdentity) => void;
  /** 切換到配對匯入（B）；未提供＝不顯示入口。 */
  onUsePairing?: () => void;
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
  const T = (k: MessageKey): string => translate(locale, k);
  const npub = npubFromNsec(nsec);

  const submit = (): void => {
    const r = identityFromNsec(nsec, name);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    onSignIn(r.identity);
  };

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>{T("mobileSignIn_title")}</Text>
        <Text style={styles.hint}>{T("mobileSignIn_hint")}</Text>

        <Text style={styles.label}>{T("mobileSignIn_nameLabel")}</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} aria-label={T("mobileSignIn_nameLabel")} />

        <Text style={styles.label}>{T("mobileSignIn_nsecLabel")}</Text>
        <TextInput
          style={styles.input}
          value={nsec}
          onChangeText={setNsec}
          placeholder={T("mobileSignIn_nsecPlaceholder")}
          placeholderTextColor={tk.muted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          aria-label={T("mobileSignIn_nsecLabel")}
        />

        {npub ? (
          <Text style={styles.npub}>
            {T("mobileSignIn_derived")}: {npub.slice(0, 20)}…
          </Text>
        ) : null}
        {error ? <Text style={styles.error}>{T(error)}</Text> : null}

        <Pressable style={styles.button} onPress={submit} accessibilityRole="button">
          <Text style={styles.buttonText}>{T("mobileSignIn_button")}</Text>
        </Pressable>

        {onUsePairing ? (
          <Pressable onPress={onUsePairing} accessibilityRole="button">
            <Text style={styles.link}>{T("mobileSignIn_toPair")}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
