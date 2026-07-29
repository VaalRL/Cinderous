// 加好友面板（ADR-0280）：貼上 npub ／ 出示自己的 QR ／ 掃描對方的 QR。
//
// 先前行動端只有「貼上 npub」一條路，而自己的 npub 只是一行**不能點的文字**——
// 要把它交給朋友，得手動選取一串 63 字的 bech32。桌面版早有 QR 顯示（`qr.ts` 的註解
// 甚至寫明「掃描在行動端」），行動端一直沒補上。
//
// QR 產生共用 `@cinderous/core` 的 `qrSvg`（本批自桌面搬入 core，兩端同一份實作）。
// 掃描走 `native/qr-scan.ts` 的平台縫——**不支援就不顯示掃描鈕**，貼上那條永遠在。
import { useEffect, useMemo, useRef, useState } from "react";
import { formatContactInput, isContactInput, qrSvg } from "@cinderous/core";
import { type Locale, type MessageKey, translate } from "@cinderous/i18n";
import { resolveTheme, STATUS_COLORS, type Theme, type ThemeTokens } from "@cinderous/theme";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native-web";
import { copyText } from "../native/clipboard.js";
import { qrScanSupported, scanQr } from "../native/qr-scan.js";
import { ActionIcon } from "./ActionIcon.js";

function makeStyles(tk: ThemeTokens) {
  return StyleSheet.create({
    root: { marginTop: 10, gap: 8 },
    label: { fontSize: 11, color: tk.muted },
    row: { flexDirection: "row", gap: 8, alignItems: "center" },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: tk.border,
      borderRadius: 8,
      backgroundColor: tk.field,
      color: tk.ink,
      paddingVertical: 6,
      paddingHorizontal: 10,
      fontSize: 13,
    },
    submit: { backgroundColor: tk.accent, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
    submitText: { color: "#ffffff", fontWeight: "700", fontSize: 13 },
    ghost: { borderWidth: 1, borderColor: tk.accent, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: tk.field },
    ghostText: { color: tk.accent, fontWeight: "600", fontSize: 13 },
    /** 圖示鈕：與旁邊的「新增」鈕等高（padding 6+6＋內容 20 ≒ 32），維持同列基線齊平。 */
    iconBtn: {
      borderWidth: 1,
      borderColor: tk.accent,
      borderRadius: 8,
      backgroundColor: tk.field,
      paddingVertical: 6,
      paddingHorizontal: 8,
      alignItems: "center",
      justifyContent: "center",
    },
    npub: { flex: 1, fontSize: 11, color: tk.accent },
    qrWrap: { alignItems: "center", gap: 6, paddingVertical: 6 },
    qrImg: { width: 180, height: 180 },
    /** 掃描預覽：video 由原生 DOM 元素承載（RNW 沒有 <Video>），故用固定尺寸的容器包住。 */
    scanWrap: { alignItems: "center", gap: 6 },
    error: { fontSize: 12, color: STATUS_COLORS.busy },
  });
}

export function AddContactPanel({
  onAdd,
  selfNpub,
  selfName,
  locale = "zh-Hant",
  theme = "light",
  accent = null,
  accent2 = null,
}: {
  onAdd: (npub: string) => void;
  /** 自己的 npub（供出示 QR 與複製）；未提供＝只顯示貼上欄。 */
  selfNpub?: string | undefined;
  /**
   * 自己的顯示名稱（ADR-0284）：**只編進 QR**，讓當面掃碼的人立刻看到名字，
   * 而不是等對方接受請求（ADR-0121 在那之前不回送個人檔）。
   * 複製出去的純文字不帶——那可能被貼到公開場合。
   */
  selfName?: string | undefined;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
  accent2?: string | null;
}): JSX.Element {
  const tk = useMemo(() => resolveTheme({ theme, accent, accent2 }), [theme, accent, accent2]);
  const styles = useMemo(() => makeStyles(tk), [tk]);
  const t = (k: MessageKey): string => translate(locale, k);
  const [draft, setDraft] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 自己的 QR：npub 短、內容固定，直接算 SVG data URI（無需快取以外的處理）。
  const qrUri = useMemo(() => {
    if (!selfNpub) return null;
    // ADR-0284：QR 帶名字（當面交換，對方本來就自願亮名）；複製的純文字則不帶。
    const payload = formatContactInput(selfNpub, selfName);
    return `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg(payload, { cell: 4 }))}`;
  }, [selfNpub, selfName]);

  // 卸載時務必中止掃描——否則相機會繼續開著（指示燈亮），是嚴重的隱私觀感問題。
  useEffect(() => () => abortRef.current?.abort(), []);

  const submit = (v: string): void => {
    const npub = v.trim();
    if (!npub) return;
    onAdd(npub);
    setDraft("");
  };

  const startScan = async (): Promise<void> => {
    setError(null);
    setScanning(true);
    const ac = new AbortController();
    abortRef.current = ac;
    // 等一輪 render，video 元素才掛得上。
    await new Promise((r) => setTimeout(r, 0));
    const el = videoRef.current;
    if (!el) {
      setScanning(false);
      setError("qr_scanFailed");
      return;
    }
    const r = await scanQr(el, ac.signal);
    setScanning(false);
    abortRef.current = null;
    if (!r.ok) {
      if (r.reason === "failed") setError("qr_scanFailed");
      return; // cancelled＝使用者自己關掉，不報錯
    }
    // 掃到的可能是任何東西——網址、Wi-Fi 設定、別人的名片。不驗就把垃圾送進 addContact。
    // ADR-0281：用 core 的 `isContactInput`，與後端 `addContact` **同一條**切分規則——
    // 先前這裡只認裸 npub，掃桌面版產出的 `npub@wss://…` QR 會被誤判成「不是 npub」。
    if (!isContactInput(r.text)) {
      setError("qr_scanNotNpub");
      return;
    }
    submit(r.text);
  };

  const stopScan = (): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setScanning(false);
  };

  const copy = async (): Promise<void> => {
    if (!selfNpub) return;
    const ok = await copyText(selfNpub);
    setCopied(ok);
  };

  return (
    <View style={styles.root} testID="add-contact-panel">
      {selfNpub ? (
        <>
          <Text style={styles.label}>{t("mobileChats_myNpub")}</Text>
          <View style={styles.row}>
            <Text style={styles.npub} numberOfLines={1}>
              {selfNpub}
            </Text>
            <Pressable style={styles.ghost} accessibilityRole="button" testID="copy-npub" onPress={() => void copy()}>
              <Text style={styles.ghostText}>{copied ? t("copied") : t("copy")}</Text>
            </Pressable>
            <Pressable style={styles.ghost} accessibilityRole="button" testID="toggle-qr" onPress={() => setShowQr((v) => !v)}>
              <Text style={styles.ghostText}>{t("qr_show")}</Text>
            </Pressable>
          </View>
          {showQr && qrUri ? (
            <View style={styles.qrWrap} testID="self-qr">
              <Image source={{ uri: qrUri }} style={styles.qrImg} accessibilityLabel={t("qr_alt")} />
              <Text style={styles.label}>{t("qr_hint")}</Text>
            </View>
          ) : null}
        </>
      ) : null}

      {/* 掃描進行中：預覽必須看得到（盲掃體驗極差）。 */}
      {scanning ? (
        <View style={styles.scanWrap} testID="qr-scanning">
          {/* RNW 無 <Video>；用原生 DOM 元素承載預覽。 */}
          <video ref={videoRef} playsInline muted style={{ width: 220, height: 220, objectFit: "cover", borderRadius: 8 }} />
          <Text style={styles.label}>{t("qr_scanHint")}</Text>
          <Pressable style={styles.ghost} accessibilityRole="button" testID="scan-cancel" onPress={stopScan}>
            <Text style={styles.ghostText}>{t("dialog_cancel")}</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{t(error)}</Text> : null}

      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={t("mobileChats_addPlaceholder")}
          placeholderTextColor={tk.muted}
          autoCapitalize="none"
          autoCorrect={false}
          aria-label={t("mobileChats_add")}
        />
        {/* 掃描＝「另一種輸入方式」，故與貼上欄同列（ADR-0282）。圖示鈕：文字標籤佔掉輸入欄
            的寬度，而取景框圖示已是通用語彙。不支援的環境（無 BarcodeDetector／無相機）
            整顆不顯示——貼上那條永遠可用。 */}
        {qrScanSupported() && !scanning ? (
          <Pressable
            style={styles.iconBtn}
            accessibilityRole="button"
            testID="scan-qr"
            aria-label={t("qr_scan")}
            onPress={() => void startScan()}
          >
            <ActionIcon name="scanQr" color={tk.accent} size={20} />
          </Pressable>
        ) : null}
        <Pressable style={styles.submit} accessibilityRole="button" testID="add-submit" onPress={() => submit(draft)}>
          <Text style={styles.submitText}>{t("mobileChats_addBtn")}</Text>
        </Pressable>
      </View>
    </View>
  );
}
