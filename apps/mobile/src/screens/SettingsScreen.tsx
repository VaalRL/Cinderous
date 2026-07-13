// 行動端設定分頁（ADR-0087）：身分備份（npub/nsec）、外觀（主題/主色/語言）、中繼站、登出。
// 主題/主色/語言由 MobileApp 掌管、經 callback 即時切換；色彩吃 @cinder/theme。
import { useMemo, useState } from "react";
import { type Locale, type MessageKey, translate } from "@cinder/i18n";
import { resolveTheme, type Theme, type ThemeTokens } from "@cinder/theme";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native-web";

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
  });
}

export function SettingsScreen({
  selfName,
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
  retention,
  onRetention,
  onExport,
  onLogout,
}: {
  selfName: string;
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
  /** 每對話保留上限（ADR-0094）；0＝無上限。未提供則不顯示。 */
  retention?: number;
  onRetention?: (n: number) => void;
  /** 導出全部紀錄（ADR-0094）。 */
  onExport?: () => void;
  onLogout: () => void;
}): JSX.Element {
  const tk = useMemo(() => resolveTheme({ theme, accent }), [theme, accent]);
  const styles = useMemo(() => makeStyles(tk), [tk]);
  const t = (k: MessageKey): string => translate(locale, k);
  const [showNsec, setShowNsec] = useState(false);

  const seg = (on: boolean) => [styles.seg, { borderColor: on ? tk.accent : tk.border, backgroundColor: on ? tk.accent : tk.field }];
  const segTxt = (on: boolean) => [styles.segText, { color: on ? "#ffffff" : tk.ink }];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("mobileTab_settings")}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {/* 身分備份 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("settings_identityBackup")}</Text>
          <Text style={styles.value}>{selfName}</Text>
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

        {/* 外觀 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("mobileSettings_appearance")}</Text>
          <Text style={styles.label}>{t("mobileSettings_theme")}</Text>
          <View style={styles.rowSeg}>
            <Pressable style={seg(theme === "light")} accessibilityRole="button" onPress={() => onTheme("light")}>
              <Text style={segTxt(theme === "light")}>{t("mobileSettings_light")}</Text>
            </Pressable>
            <Pressable style={seg(theme === "dark")} accessibilityRole="button" onPress={() => onTheme("dark")}>
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
            <Pressable style={seg(locale === "zh-Hant")} accessibilityRole="button" onPress={() => onLocale("zh-Hant")}>
              <Text style={segTxt(locale === "zh-Hant")}>繁中</Text>
            </Pressable>
            <Pressable style={seg(locale === "en")} accessibilityRole="button" onPress={() => onLocale("en")}>
              <Text style={segTxt(locale === "en")}>EN</Text>
            </Pressable>
          </View>
        </View>

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

        <Pressable style={styles.logout} accessibilityRole="button" onPress={onLogout}>
          <Text style={styles.logoutText}>{t("mobileSettings_logout")}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
