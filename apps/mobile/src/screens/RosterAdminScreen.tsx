// 行動端組織名冊管理（ADR-0178，企業主端）：建立/更新公司名冊——組織名、成員（npub 名稱／行）、
// 公司設定（歡迎詞、上下班時間、保留天數）、入職邀請碼（可複製、可設公司帳號託管）。
// 與桌面 RosterAdminModal（App.tsx）同一份 onPublish 契約；發布＝管理者簽章 replaceable 名冊。
// 落盤（企業主收儲存槽）仍限桌面（原生 FS）——本畫面只做名冊/邀請/設定，不涉檔案落盤。
import { useMemo, useState } from "react";
import { makeOrgInvite, npubDecode, npubEncode } from "@cinderous/core";
import type { OrgMember, OrgPolicy, OrgRosterDoc } from "@cinderous/engine";
import { type Locale, type MessageKey, translate } from "@cinderous/i18n";
import { resolveTheme, type Theme, type ThemeTokens } from "@cinderous/theme";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native-web";
import { copyText } from "../native/clipboard.js";

function makeStyles(tk: ThemeTokens) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: tk.bgB },
    header: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: tk.surface2, borderBottomWidth: 1, borderBottomColor: tk.border, flexDirection: "row", alignItems: "center" },
    headerTitle: { fontSize: 18, fontWeight: "700", color: tk.ink, flex: 1 },
    back: { paddingHorizontal: 8, paddingVertical: 4 },
    backText: { fontSize: 24, color: tk.accent },
    body: { padding: 14, gap: 14 },
    section: { backgroundColor: tk.panel, borderRadius: 12, borderWidth: 1, borderColor: tk.border, padding: 14, gap: 8 },
    label: { fontSize: 12, fontWeight: "700", color: tk.accent },
    hint: { fontSize: 11, color: tk.muted, lineHeight: 16 },
    input: { borderWidth: 1, borderColor: tk.border, borderRadius: 8, backgroundColor: tk.field, color: tk.ink, paddingVertical: 8, paddingHorizontal: 10, fontSize: 14 },
    area: { minHeight: 110, textAlignVertical: "top" },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    invite: { fontSize: 11, color: tk.ink, borderWidth: 1, borderColor: tk.border, borderRadius: 8, backgroundColor: tk.field, padding: 8 },
    button: { backgroundColor: tk.accent, borderRadius: 8, paddingVertical: 11, alignItems: "center" },
    buttonText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
    copyBtn: { borderWidth: 1, borderColor: tk.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    copyText: { fontSize: 12, color: tk.accent },
    error: { fontSize: 12, color: "#e5484d" },
    ok: { fontSize: 12, color: tk.accent },
  });
}

export function RosterAdminScreen({
  selfNpub,
  onPublish,
  onBack,
  invite,
  initial,
  offboarded,
  onTakeover,
  onDeleteEscrow,
  locale = "zh-Hant",
  theme = "light",
  accent = null,
  accent2 = null,
}: {
  selfNpub: string;
  /** 發布名冊（與桌面同契約）：回傳 relay allowlist 用的 pubkey 清單。 */
  onPublish: (
    org: string,
    members: OrgMember[],
    policy?: OrgPolicy,
    profile?: { welcome?: string; workHours?: { start: string; end: string } },
  ) => string[];
  onBack: () => void;
  /** 邀請碼組件（ADR-0156）：企業主 pubkey＋核准權杖＋公司座；缺則不顯示邀請區。 */
  invite?: { relayUrl: string; adminPubkey: string; token: string };
  /** 現行名冊（ADR-0157）：預填，修一項不必重打整份。 */
  initial?: OrgRosterDoc | null;
  /**
   * 離職接管（ADR-0163／0179）：已離職且託管中的員工（只帶 pubkey＋name，**不帶 nsec**——
   * 私鑰留在 App 層加密儲存，不進 UI 元件）。未提供/空＝不顯示接管區。
   */
  offboarded?: { pubkey: string; name: string }[];
  onTakeover?: (pubkey: string) => void;
  onDeleteEscrow?: (pubkey: string) => void;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
  accent2?: string | null;
}): JSX.Element {
  const tk = useMemo(() => resolveTheme({ theme, accent, accent2 }), [theme, accent, accent2]);
  const styles = useMemo(() => makeStyles(tk), [tk]);
  const t = (k: MessageKey): string => translate(locale, k);

  const [org, setOrg] = useState(initial?.org ?? "");
  const [members, setMembers] = useState(() =>
    initial
      ? initial.members.filter((m) => !m.supersededBy).map((m) => `${npubEncode(m.pubkey)} ${m.name}`).join("\n")
      : selfNpub
        ? `${selfNpub} 管理者`
        : "",
  );
  const [welcome, setWelcome] = useState(initial?.welcome ?? "");
  const [workStart, setWorkStart] = useState(initial?.workHours?.start ?? "");
  const [workEnd, setWorkEnd] = useState(initial?.workHours?.end ?? "");
  const [ttlDays, setTtlDays] = useState(initial?.policy?.messageTtlDays !== undefined ? String(initial.policy.messageTtlDays) : "");
  const [escrow, setEscrow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  const inviteCode = invite ? makeOrgInvite({ ...invite, ...(escrow ? { escrow: true } : {}) }) : undefined;

  const publish = (): void => {
    setError(null);
    setPublished(false);
    const list: OrgMember[] = [];
    for (const line of members.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      const [np, ...rest] = s.split(/\s+/);
      try {
        list.push({ pubkey: npubDecode((np ?? "").trim()), name: rest.join(" ") || "成員" });
      } catch {
        setError(`${t("roster_parseError")}${s}`);
        return;
      }
    }
    if (list.length === 0) {
      setError(t("roster_needMember"));
      return;
    }
    const ttl = parseInt(ttlDays.trim(), 10);
    const policy: OrgPolicy = { ...(Number.isInteger(ttl) && ttl >= 1 && ttl <= 365 ? { messageTtlDays: ttl } : {}) };
    // 公司設定（ADR-0157）：兩端皆填且不等才帶班表。
    const profile = {
      ...(welcome.trim() ? { welcome: welcome.trim() } : {}),
      ...(workStart && workEnd && workStart !== workEnd ? { workHours: { start: workStart, end: workEnd } } : {}),
    };
    try {
      onPublish(
        org.trim() || "組織",
        list,
        Object.keys(policy).length > 0 ? policy : undefined,
        Object.keys(profile).length > 0 ? profile : undefined,
      );
      setPublished(true);
    } catch {
      setError(t("roster_publishFailed"));
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.back} accessibilityRole="button" aria-label={t("mobileConvo_back")} onPress={onBack}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{t("settings_orgRoster")}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {inviteCode ? (
          <View style={styles.section}>
            <Text style={styles.label}>{t("roster_inviteLabel")}</Text>
            <Text style={styles.hint}>{t("roster_inviteHint")}</Text>
            <Text style={styles.invite} testID="roster-invite" selectable>
              {inviteCode}
            </Text>
            <View style={styles.row}>
              <Pressable
                style={styles.copyBtn}
                accessibilityRole="button"
                testID="roster-invite-copy"
                onPress={() => {
                  void copyText(inviteCode);
                  setCopied(true);
                }}
              >
                <Text style={styles.copyText}>{copied ? t("contact_copied") : t("roster_inviteCopy")}</Text>
              </Pressable>
            </View>
            <Pressable
              style={styles.row}
              accessibilityRole="button"
              testID="roster-escrow"
              onPress={() => {
                setEscrow((v) => !v);
                setCopied(false);
              }}
            >
              <Text style={styles.copyText}>{escrow ? "☑" : "☐"}</Text>
              <Text style={styles.hint}>{t("roster_escrow")}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.label}>{t("roster_orgName")}</Text>
          <TextInput style={styles.input} value={org} onChangeText={setOrg} placeholder={t("roster_orgName")} placeholderTextColor={tk.muted} aria-label={t("roster_orgName")} testID="roster-org" />
          <Text style={styles.label}>{t("roster_membersLabel")}</Text>
          <Text style={styles.hint}>{t("roster_membersHint")}</Text>
          <TextInput style={[styles.input, styles.area]} value={members} onChangeText={setMembers} multiline aria-label={t("roster_membersLabel")} testID="roster-members" />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>{t("roster_welcomeLabel")}</Text>
          <TextInput style={[styles.input, styles.area]} value={welcome} onChangeText={setWelcome} multiline aria-label={t("roster_welcomeLabel")} testID="roster-welcome" />
          <Text style={styles.label}>{t("roster_workHoursLabel")}</Text>
          <View style={styles.row}>
            <TextInput style={[styles.input, { flex: 1 }]} value={workStart} onChangeText={setWorkStart} placeholder="09:00" placeholderTextColor={tk.muted} aria-label="start" testID="roster-work-start" />
            <Text style={styles.hint}>–</Text>
            <TextInput style={[styles.input, { flex: 1 }]} value={workEnd} onChangeText={setWorkEnd} placeholder="18:00" placeholderTextColor={tk.muted} aria-label="end" testID="roster-work-end" />
          </View>
          <Text style={styles.label}>{t("roster_ttlLabel")}</Text>
          <TextInput style={styles.input} value={ttlDays} onChangeText={setTtlDays} placeholder="7" placeholderTextColor={tk.muted} aria-label={t("roster_ttlLabel")} testID="roster-ttl" />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {published ? <Text style={styles.ok} testID="roster-published">{t("roster_published")}</Text> : null}
        <Pressable style={styles.button} accessibilityRole="button" testID="roster-publish" onPress={publish}>
          <Text style={styles.buttonText}>{t("roster_publish")}</Text>
        </Pressable>

        {/* 離職接管（ADR-0163／0179）：離職＝已從名冊移除但託管中的員工；接管＝以其金鑰查看歷史；或刪除託管。 */}
        {offboarded && offboarded.length > 0 && onTakeover ? (
          <View style={styles.section}>
            <Text style={styles.label}>{t("settings_offboard")}</Text>
            <Text style={styles.hint}>{t("settings_offboardHint")}</Text>
            {offboarded.map((e) => (
              <View key={e.pubkey} style={styles.row}>
                <Text style={[styles.hint, { flex: 1 }]}>離職·{e.name}</Text>
                <Pressable style={styles.copyBtn} accessibilityRole="button" testID={`takeover-${e.pubkey}`} onPress={() => onTakeover(e.pubkey)}>
                  <Text style={styles.copyText}>{t("offboard_takeover")}</Text>
                </Pressable>
                {onDeleteEscrow ? (
                  <Pressable style={styles.copyBtn} accessibilityRole="button" testID={`delete-escrow-${e.pubkey}`} onPress={() => onDeleteEscrow(e.pubkey)}>
                    <Text style={[styles.copyText, { color: "#e5484d" }]}>{t("offboard_delete")}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {/* 公司儲存槽（ADR-0177／0179）：收檔落盤僅桌面（手機無檔案系統）——文字提示，讓企業主知道去哪收檔。 */}
        <View style={styles.section}>
          <Text style={styles.label}>{t("settings_slot")}</Text>
          <Text style={styles.hint} testID="vault-desktop-only">{t("settings_vaultDesktopOnly")}</Text>
        </View>
      </ScrollView>
    </View>
  );
}
