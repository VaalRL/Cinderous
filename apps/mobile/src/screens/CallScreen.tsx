// 行動端通話畫面（ADR-0101）：全螢幕覆蓋——來電（接聽/拒接）、撥出中、通話中（靜音/掛斷）。
// 媒體元素一律經 native/call-media 的平台縫，本檔不直接碰 DOM（見該檔說明）。
// 媒體全程 P2P（ADR-0025/0026），不經中繼。

import { useEffect, useState } from "react";
import type { CallMedia, CallState, VideoQuality } from "@cinderous/core";
import { VIDEO_QUALITIES } from "@cinderous/core";
import { type Locale, type MessageKey, translate } from "@cinderous/i18n";
import { resolveTheme, type Theme, type ThemeTokens } from "@cinderous/theme";
import { Pressable, StyleSheet, Text, View } from "react-native-web";
import { StreamView } from "../native/call-media.js";

const STATE_KEY: Partial<Record<CallState, MessageKey>> = {
  incoming: "call_incoming",
  outgoing: "call_outgoing",
  connecting: "call_connecting",
  active: "call_active",
};

function makeStyles(tk: ThemeTokens) {
  return StyleSheet.create({
    root: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#0b0b0d", zIndex: 100 },
    remoteWrap: { flex: 1 },
    audioWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
    avatar: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: tk.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { fontSize: 36, fontWeight: "700", color: "#ffffff" },
    localWrap: { position: "absolute", top: 16, right: 16, width: 96, height: 128, borderRadius: 10, overflow: "hidden" },
    info: { position: "absolute", top: 24, left: 0, right: 0, alignItems: "center", gap: 4 },
    name: { fontSize: 20, fontWeight: "700", color: "#ffffff" },
    state: { fontSize: 13, color: "#ffffffb0" },
    bar: {
      position: "absolute",
      bottom: 36,
      left: 0,
      right: 0,
      flexDirection: "row",
      justifyContent: "center",
      gap: 20,
    },
    btn: { width: 62, height: 62, borderRadius: 31, alignItems: "center", justifyContent: "center" },
    accept: { backgroundColor: "#2f9e44" },
    hangup: { backgroundColor: "#e5484d" },
    neutral: { backgroundColor: "#ffffff28" },
    btnText: { fontSize: 24 },
    /** 畫質鍵放的是文字而非 emoji（「省流量」要看得懂），字級因此縮小。 */
    qualityText: { fontSize: 12, fontWeight: "600", color: "#ffffff", textAlign: "center" },
  });
}

/** 通話時長 mm:ss。 */
function elapsed(sinceMs: number | null, nowMs: number): string {
  if (sinceMs == null) return "";
  const s = Math.max(0, Math.floor((nowMs - sinceMs) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function CallScreen({
  peerName,
  state,
  media,
  localStream,
  remoteStream,
  onAccept,
  onReject,
  onHangup,
  quality,
  onQualityChange,
  locale = "zh-Hant",
  theme = "dark",
  accent = null,
}: {
  peerName: string;
  state: CallState;
  media: CallMedia | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onAccept: () => void;
  onReject: () => void;
  onHangup: () => void;
  /** 目前視訊畫質檔位（ADR-0337）。 */
  quality: VideoQuality;
  /** 改畫質。必須往上回報——`setParameters` 要 `RTCRtpSender`，只有 engine 拿得到。 */
  onQualityChange: (q: VideoQuality) => void;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
}): JSX.Element {
  const tk = resolveTheme({ theme, accent });
  const styles = makeStyles(tk);
  const t = (k: MessageKey): string => translate(locale, k);
  const isVideo = media === "video";

  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (state === "active" && since === null) setSince(Date.now());
  }, [state, since]);
  useEffect(() => {
    if (state !== "active") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state]);

  /** 靜音＝停用本地音軌（不是只調音量，對方是真的聽不到）。 */
  const toggleMute = (): void => {
    if (!localStream) return;
    const next = !muted;
    for (const track of localStream.getAudioTracks()) track.enabled = !next;
    setMuted(next);
  };

  /**
   * 關鏡頭（ADR-0337 §3）：與靜音對稱，只是換成視訊軌 ⇒ 走同一條路，不新增後端方法。
   *
   * ⚠ `enabled = false` 的語意是**送黑畫面**，不是關閉相機——軌道仍開著、
   * 指示燈可能仍亮。文案因此用「停止視訊」。
   */
  const toggleCamera = (): void => {
    if (!localStream) return;
    const next = !cameraOff;
    for (const track of localStream.getVideoTracks()) track.enabled = !next;
    setCameraOff(next);
  };

  /**
   * 畫質輪替：手機底部沒有空間放三顆按鈕，所以一顆按鈕循環 low→medium→high→low。
   * 按鈕上顯示的是**目前**檔位（不是「下一個」），與靜音鍵顯示目前狀態一致。
   */
  const cycleQuality = (): void => {
    const i = VIDEO_QUALITIES.indexOf(quality);
    onQualityChange(VIDEO_QUALITIES[(i + 1) % VIDEO_QUALITIES.length]!);
  };

  const stateLabel = STATE_KEY[state] ? t(STATE_KEY[state]!) : "";
  const sub = state === "active" ? `${stateLabel} · ${elapsed(since, now)}` : stateLabel;

  return (
    <View style={styles.root}>
      {isVideo ? (
        <View style={styles.remoteWrap}>
          <StreamView stream={remoteStream} />
        </View>
      ) : (
        <View style={styles.audioWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{peerName.slice(0, 1)}</Text>
          </View>
          {/* 純語音仍需播放槽（不佔版面）。 */}
          <StreamView stream={remoteStream} audioOnly />
        </View>
      )}

      {/* 本地預覽：靜音以免回授。 */}
      {isVideo && localStream ? (
        <View style={styles.localWrap}>
          <StreamView stream={localStream} muted mirror />
        </View>
      ) : null}

      <View style={styles.info}>
        <Text style={styles.name}>{peerName}</Text>
        <Text style={styles.state}>{sub}</Text>
      </View>

      <View style={styles.bar}>
        {state === "incoming" ? (
          <>
            <Pressable
              style={[styles.btn, styles.hangup]}
              accessibilityRole="button"
              aria-label={t("call_reject")}
              onPress={onReject}
            >
              <Text style={styles.btnText}>✕</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.accept]}
              accessibilityRole="button"
              aria-label={t("call_accept")}
              onPress={onAccept}
            >
              <Text style={styles.btnText}>✆</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              style={[styles.btn, styles.neutral]}
              accessibilityRole="button"
              aria-label={t(muted ? "call_unmute" : "call_mute")}
              testID="call-mute"
              onPress={toggleMute}
            >
              <Text style={styles.btnText}>{muted ? "🔇" : "🎤"}</Text>
            </Pressable>
            {isVideo ? (
              <>
                <Pressable
                  style={[styles.btn, styles.neutral]}
                  accessibilityRole="button"
                  aria-label={t(cameraOff ? "call_camera_on" : "call_camera_off")}
                  testID="call-camera"
                  onPress={toggleCamera}
                >
                  <Text style={styles.btnText}>{cameraOff ? "🚫" : "📹"}</Text>
                </Pressable>
                {/* 畫質問題只有通話中才察覺得到——所以按鈕在這裡，不是埋在設定頁（ADR-0337 §2）。 */}
                <Pressable
                  style={[styles.btn, styles.neutral]}
                  accessibilityRole="button"
                  aria-label={`${t("call_quality")}：${t(`call_quality_${quality}` as MessageKey)}`}
                  testID="call-quality"
                  onPress={cycleQuality}
                >
                  <Text style={styles.qualityText}>{t(`call_quality_${quality}` as MessageKey)}</Text>
                </Pressable>
              </>
            ) : null}
            <Pressable
              style={[styles.btn, styles.hangup]}
              accessibilityRole="button"
              aria-label={t("call_hangup")}
              onPress={onHangup}
            >
              <Text style={styles.btnText}>✆</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}
