// 行動端通話畫面（ADR-0101）：全螢幕覆蓋——來電（接聽/拒接）、撥出中、通話中（靜音/掛斷）。
// 媒體元素一律經 native/call-media 的平台縫，本檔不直接碰 DOM（見該檔說明）。
// 媒體全程 P2P（ADR-0025/0026），不經中繼。

import { useEffect, useState } from "react";
import type { CallMedia, CallState, CameraFacing, VideoQuality } from "@cinderous/core";
import { VIDEO_QUALITIES, flipFacing, shouldMirror } from "@cinderous/core";
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
  localMedia,
  remoteMedia,
  canChangeMedia,
  onMediaChange,
  facing,
  canFlipCamera,
  onFlipCamera,
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
  /**
   * 我／對方各自在送什麼（ADR-0338）。**兩者獨立**——「我送視訊、他只送語音」
   * 是合法狀態，版面要照實呈現。
   */
  localMedia: CallMedia;
  remoteMedia: CallMedia;
  /** 這通能不能改型態（ADR-0338 §4）；false＝不顯示入口（舊版對端）。 */
  canChangeMedia: boolean;
  /** 改**我**這一方的型態。不會讓對方開鏡頭。 */
  onMediaChange: (m: CallMedia) => void;
  /**
   * 目前鏡頭的**實際**朝向（ADR-0339）；`null`＝裝置不回報 ⇒ 當作前鏡頭。
   * ⚠ 這是實際取得的，不是我們要求的——`facingMode` 是偏好不是保證。
   */
  facing: CameraFacing | null;
  /** 這台有沒有第二個鏡頭可翻（ADR-0339）；false＝不顯示按鈕。 */
  canFlipCamera: boolean;
  /** 翻面。**手機是翻面，桌面是選裝置**——刻意是兩個不同的東西。 */
  onFlipCamera: (next: CameraFacing) => void;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
}): JSX.Element {
  const tk = resolveTheme({ theme, accent });
  const styles = makeStyles(tk);
  const t = (k: MessageKey): string => translate(locale, k);
  const isVideo = media === "video";
  // ADR-0338：畫質與關鏡頭只在**我**送視訊時有意義；遠端版面看的是對方那一方。
  const iSendVideo = localMedia === "video";
  const theySendVideo = remoteMedia === "video";

  const [muted, setMuted] = useState(false);
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
      {theySendVideo ? (
        <View style={styles.remoteWrap}>
          <StreamView stream={remoteStream} />
        </View>
      ) : (
        <View style={styles.audioWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{peerName.slice(0, 1)}</Text>
          </View>
          {/* 對方只送語音時仍需播放槽（不佔版面）。 */}
          <StreamView stream={remoteStream} audioOnly />
        </View>
      )}

      {/* ADR-0338：我沒開視訊就不該有自我預覽——否則看起來像我在送畫面。靜音以免回授。 */}
      {iSendVideo && localStream ? (
        <View style={styles.localWrap}>
          {/*
            🔴 ADR-0339 §4：鏡像**不能寫死**。前鏡頭該鏡像（照鏡子的直覺），
            後鏡頭不該——鏡像等於把字反過來給自己看。
            ⚠ 只鏡像自我預覽；送出去的畫面從來不該鏡像（對方看到的字必須是正的）。
          */}
          <StreamView stream={localStream} muted mirror={shouldMirror(facing)} />
        </View>
      ) : null}

      <View style={styles.info}>
        <Text style={styles.name}>{peerName}</Text>
        <Text style={styles.state}>{sub}</Text>
        {/* ADR-0338：不留一塊沒有解釋的黑畫面——對方只送語音就明說。 */}
        {state === "active" && isVideo && !theySendVideo ? (
          <Text style={styles.state} testID="call-remote-audio-only">
            {t("call_remoteAudioOnly")}
          </Text>
        ) : null}
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
            {/*
              ADR-0340：關鏡頭與降級合併成這一顆。閘門**只擋「開啟」方向**——
              🔴 關掉自己的鏡頭永遠不該被擋住。
            */}
            {iSendVideo || canChangeMedia ? (
              <Pressable
                style={[styles.btn, styles.neutral]}
                accessibilityRole="button"
                aria-label={t(iSendVideo ? "call_toAudio" : "call_toVideo")}
                testID="call-media-toggle"
                onPress={() => onMediaChange(iSendVideo ? "audio" : "video")}
              >
                <Text style={styles.btnText}>{iSendVideo ? "📵" : "📷"}</Text>
              </Pressable>
            ) : null}
            {iSendVideo ? (
              <>
                {/* ADR-0339：只有一個鏡頭就不顯示——寧可少一個按鈕，也不要一個按了沒反應的。 */}
                {canFlipCamera ? (
                  <Pressable
                    style={[styles.btn, styles.neutral]}
                    accessibilityRole="button"
                    aria-label={t("call_flipCamera")}
                    testID="call-flip-camera"
                    onPress={() => onFlipCamera(flipFacing(facing ?? "user"))}
                  >
                    <Text style={styles.btnText}>🔄</Text>
                  </Pressable>
                ) : null}
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
