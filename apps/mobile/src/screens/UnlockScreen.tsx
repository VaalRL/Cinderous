// 行動端解鎖畫面（ADR-0117）：以本地密碼解開「記住的身分」。
//
// 行動端**從不明文儲存 nsec**（ADR-0112 的紅線），所以「記住我」只能是
// 「以 Argon2id 密碼包裹 nsec」。這裡是解開它的入口。
//
// 忘記密碼＝**沒有救援**：密碼是唯一的 KEK 來源，我們沒有第二道包裹（桌面的 ADR-0073 救援
// 靠的是 nsec 本身，而這裡的前提正是「使用者手上只有密碼」）。所以提供「改用 nsec 登入」
// 這條路——重貼 nsec 即可，記住的資料不會遺失（同一個 pubkey ＝ 同一個 namespace）。

import { type Locale, type MessageKey, translate } from "@cinderous/i18n";
import { resolveTheme, type Theme, type ThemeTokens } from "@cinderous/theme";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native-web";

export function UnlockScreen({
  name,
  onUnlock,
  onUseNsec,
  onForget,
  locale = "zh-Hant",
  theme = "light",
  accent = null,
  accent2 = null,
}: {
  /** 記住的身分顯示名。 */
  name: string;
  /** 驗密碼；回 false＝密碼錯誤（不區分「錯密碼」與「遭竄改」）。 */
  onUnlock: (password: string) => boolean;
  /** 改用 nsec 登入（忘記密碼時的出路——沒有救援）。 */
  onUseNsec: () => void;
  /** 忘記這個身分（清掉記住的密文）。 */
  onForget: () => void;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
  accent2?: string | null;
}): JSX.Element {
  const tk = useMemo(() => resolveTheme({ theme, accent, accent2 }), [theme, accent, accent2]);
  const styles = useMemo(() => makeStyles(tk), [tk]);
  const t = (k: MessageKey): string => translate(locale, k);

  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  const submit = (): void => {
    if (!password) return;
    if (onUnlock(password)) return;
    setError(true);
    setPassword("");
  };

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>{t("unlock_title")}</Text>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.hint}>{t("unlock_hint")}</Text>

        <TextInput
          style={styles.input}
          value={password}
          onChangeText={(v: string) => {
            setPassword(v);
            setError(false);
          }}
          placeholder={t("unlock_password")}
          placeholderTextColor={tk.muted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          aria-label={t("unlock_password")}
          testID="unlock-password"
        />
        {error ? <Text style={styles.error}>{t("unlock_error")}</Text> : null}

        <Pressable style={styles.submit} accessibilityRole="button" testID="unlock-submit" onPress={submit}>
          <Text style={styles.submitText}>{t("unlock_button")}</Text>
        </Pressable>

        {/* 忘記密碼沒有救援（密碼是唯一的 KEK 來源）→ 給一條「改用 nsec」的出路。 */}
        <Pressable accessibilityRole="button" testID="unlock-use-nsec" onPress={onUseNsec}>
          <Text style={styles.link}>{t("unlock_forgot")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" testID="unlock-forget" onPress={onForget}>
          <Text style={styles.forget}>{t("remember_forget")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(tk: ThemeTokens) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: tk.bgB, justifyContent: "center", padding: 20 },
    card: { backgroundColor: tk.panel, borderRadius: 14, padding: 20, gap: 10 },
    title: { fontSize: 18, fontWeight: "700", color: tk.ink },
    name: { fontSize: 15, color: tk.accent, fontWeight: "600" },
    hint: { fontSize: 12, color: tk.muted, lineHeight: 18 },
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
    error: { fontSize: 12, color: "#e5484d" },
    submit: { backgroundColor: tk.accent, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
    submitText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
    link: { fontSize: 12, color: tk.accent, textAlign: "center", marginTop: 2 },
    forget: { fontSize: 11, color: tk.muted, textAlign: "center" },
  });
}
