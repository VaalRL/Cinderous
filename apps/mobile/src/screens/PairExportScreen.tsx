// 行動端配對搬家——**送出端**（ADR-0118 / 0072 D4a）。
//
// 過去行動端只能**匯入**（新機端）：換手機時，舊手機沒有任何路可以把資料搬出去，
// 只剩「明文匯出 nsec 再貼到新機」——而那正是 ADR-0117 想避免的行為
//（使用者把私鑰貼進記事本／雲端筆記）。
//
// 流程（與桌面同一套）：
//   1. 產生一次性載荷（帶會合 relay ＋ 一次性 AES 金鑰）→ 顯示給新機貼上
//   2. 新機連上 → 雙方顯示 **SAS**（短驗證碼）
//   3. **使用者比對兩邊 SAS 相符才確認** → 才送出全量捆包
//
// SAS 是這個流程的**安全核心**：沒有它，中間人可以冒充新機把你的整包資料（含 nsec）騙走。
// 所以「確認」必須是**使用者的明確動作**，不能自動通過。

import { type Locale, type MessageKey, translate } from "@cinderous/i18n";
import { resolveTheme, type Theme, type ThemeTokens } from "@cinderous/theme";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native-web";

/** 配對階段（與桌面 `PairPhase` 同形）。 */
export type PairPhase =
  | { kind: "idle" }
  | { kind: "offer"; code: string; expiresAt: number }
  | { kind: "sas"; sas: string }
  | { kind: "sending" }
  | { kind: "done" }
  | { kind: "error"; message: string };

export function PairExportScreen({
  phase,
  onStart,
  onConfirmSas,
  onCancel,
  onBack,
  locale = "zh-Hant",
  theme = "light",
  accent = null,
  accent2 = null,
}: {
  phase: PairPhase;
  /** 開始配對（產生載荷並等待新機）。 */
  onStart: () => void;
  /** 使用者對 SAS 的裁示：`true`＝相符、送出捆包；`false`＝不符、中止。 */
  onConfirmSas: (ok: boolean) => void;
  onCancel: () => void;
  onBack: () => void;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
  accent2?: string | null;
}): JSX.Element {
  const tk = useMemo(() => resolveTheme({ theme, accent, accent2 }), [theme, accent, accent2]);
  const styles = useMemo(() => makeStyles(tk), [tk]);
  const t = (k: MessageKey): string => translate(locale, k);
  const [copied, setCopied] = useState(false);

  const copy = (code: string): void => {
    try {
      void navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      /* 剪貼簿不可用 → 使用者仍可手動選取 */
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.back} accessibilityRole="button" onPress={onBack}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.headTitle}>{t("pairExport_title")}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {phase.kind === "idle" ? (
          <>
            <Text style={styles.hint}>{t("pairExport_hint")}</Text>
            <Pressable style={styles.primary} accessibilityRole="button" testID="pair-start" onPress={onStart}>
              <Text style={styles.primaryText}>{t("pairExport_start")}</Text>
            </Pressable>
          </>
        ) : null}

        {phase.kind === "offer" ? (
          <>
            <Text style={styles.hint}>{t("pairExport_offerHint")}</Text>
            <Text style={styles.code} selectable testID="pair-code">
              {phase.code}
            </Text>
            <Pressable style={styles.secondary} accessibilityRole="button" onPress={() => copy(phase.code)}>
              <Text style={styles.secondaryText}>{copied ? t("copied") : t("copy")}</Text>
            </Pressable>
            <Text style={styles.waiting}>{t("pairExport_waiting")}</Text>
          </>
        ) : null}

        {/* SAS：**安全核心**。兩邊碼不同＝有人在中間，必須拒絕。 */}
        {phase.kind === "sas" ? (
          <>
            <Text style={styles.sasLabel}>{t("pair_sasLabel")}</Text>
            <Text style={styles.sas} testID="pair-sas">
              {phase.sas}
            </Text>
            <Text style={styles.warn}>{t("pairExport_sasWarn")}</Text>
            <Pressable
              style={styles.primary}
              accessibilityRole="button"
              testID="pair-sas-ok"
              onPress={() => onConfirmSas(true)}
            >
              <Text style={styles.primaryText}>{t("pairExport_sasMatch")}</Text>
            </Pressable>
            <Pressable
              style={styles.danger}
              accessibilityRole="button"
              testID="pair-sas-no"
              onPress={() => onConfirmSas(false)}
            >
              <Text style={styles.dangerText}>{t("pairExport_sasMismatch")}</Text>
            </Pressable>
          </>
        ) : null}

        {phase.kind === "sending" ? <Text style={styles.waiting}>{t("pairExport_sending")}</Text> : null}
        {phase.kind === "done" ? <Text style={styles.done}>{t("pairExport_done")}</Text> : null}
        {phase.kind === "error" ? <Text style={styles.error}>{phase.message}</Text> : null}

        {phase.kind !== "idle" && phase.kind !== "sas" ? (
          <Pressable style={styles.secondary} accessibilityRole="button" onPress={onCancel}>
            <Text style={styles.secondaryText}>{t("pairExport_reset")}</Text>
          </Pressable>
        ) : null}
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
    back: { paddingHorizontal: 8 },
    backText: { fontSize: 24, color: tk.accent, lineHeight: 24 },
    headTitle: { fontSize: 15, fontWeight: "600", color: tk.ink, marginLeft: 4 },
    body: { padding: 16, gap: 12 },
    hint: { fontSize: 13, color: tk.muted, lineHeight: 19 },
    code: {
      fontSize: 12,
      color: tk.ink,
      backgroundColor: tk.field,
      borderWidth: 1,
      borderColor: tk.border,
      borderRadius: 8,
      padding: 10,
    },
    waiting: { fontSize: 13, color: tk.muted, textAlign: "center" },
    sasLabel: { fontSize: 13, color: tk.muted },
    sas: { fontSize: 30, fontWeight: "700", color: tk.accent, textAlign: "center", letterSpacing: 4 },
    warn: { fontSize: 12, color: "#b45309", lineHeight: 18 },
    done: { fontSize: 15, color: tk.accent, fontWeight: "700", textAlign: "center" },
    error: { fontSize: 13, color: "#e5484d" },
    primary: { backgroundColor: tk.accent, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
    primaryText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
    secondary: { borderWidth: 1, borderColor: tk.border, borderRadius: 8, paddingVertical: 8, alignItems: "center" },
    secondaryText: { color: tk.ink, fontSize: 13 },
    danger: { borderWidth: 1, borderColor: "#e5484d", borderRadius: 8, paddingVertical: 8, alignItems: "center" },
    dangerText: { color: "#e5484d", fontSize: 13, fontWeight: "600" },
  });
}
