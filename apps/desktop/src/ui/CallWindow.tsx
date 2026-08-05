import type { CallMedia, CallState, VideoQuality } from "@cinderous/core";
import { VIDEO_QUALITIES } from "@cinderous/core";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n.js";
import { avatarColor, initial } from "./util.js";

export interface CallWindowProps {
  peerName: string;
  peerKey: string;
  state: CallState;
  media: CallMedia | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onAccept: () => void;
  onReject: () => void;
  onHangup: () => void;
  /**
   * 我／對方各自在送什麼（ADR-0338）。**兩者獨立**——「我送視訊、他只送語音」
   * 是合法狀態，版面必須照實呈現而不是假裝對稱。
   */
  localMedia: CallMedia;
  remoteMedia: CallMedia;
  /** 這通能不能改型態（ADR-0338 §4）；false＝不顯示入口（舊版對端）。 */
  canChangeMedia: boolean;
  /** 改**我**這一方的型態。不會讓對方開鏡頭。 */
  onMediaChange: (m: CallMedia) => void;
  /** 目前視訊畫質檔位（ADR-0337）。 */
  quality: VideoQuality;
  /**
   * 改畫質。**必須往上回報**——`setParameters` 需要 `RTCRtpSender`，只有 engine 拿得到；
   * UI 手上只有 `MediaStream`。（關鏡頭則相反，UI 自己動軌道就夠，見下方 `toggleCamera`。）
   */
  onQualityChange: (q: VideoQuality) => void;
}

/** 畫質檔位的 i18n 鍵（順序即由省到清晰）。 */
const QUALITY_KEY = {
  low: "call_quality_low",
  medium: "call_quality_medium",
  high: "call_quality_high",
} as const;

/** 把 MediaStream 綁到 media 元素的 srcObject。 */
function useStream<T extends HTMLMediaElement>(stream: MediaStream | null) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return ref;
}

function elapsedLabel(sinceMs: number | null): string {
  if (sinceMs == null) return "";
  const s = Math.floor((Date.now() - sinceMs) / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function CallWindow(props: CallWindowProps): JSX.Element {
  const { t } = useI18n();
  const { state, media, peerName, peerKey } = props;
  const isVideo = media === "video";
  // ADR-0338：畫質與關鏡頭只在**我**送視訊時才有意義；遠端版面看的是對方那一方。
  const iSendVideo = props.localMedia === "video";
  const theySendVideo = props.remoteMedia === "video";
  const remoteVideoRef = useStream<HTMLVideoElement>(props.remoteStream);
  const localVideoRef = useStream<HTMLVideoElement>(props.localStream);
  const remoteAudioRef = useStream<HTMLAudioElement>(props.remoteStream);

  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [activeSince, setActiveSince] = useState<number | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (state === "active" && activeSince == null) setActiveSince(Date.now());
  }, [state, activeSince]);

  useEffect(() => {
    if (state !== "active") return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  const toggleMute = () => {
    const s = props.localStream;
    if (!s) return;
    const next = !muted;
    for (const track of s.getAudioTracks()) track.enabled = !next;
    setMuted(next);
  };

  /**
   * 關鏡頭（ADR-0337 §3）：與靜音完全對稱，只是換成視訊軌——所以走同一條路，不新增後端方法。
   *
   * ⚠ `enabled = false` 的語意是**送黑畫面**，不是停止傳送、也不是關閉相機：
   * 軌道仍開著、相機指示燈可能仍亮。文案因此用「停止視訊」而非「關閉相機」。
   */
  const toggleCamera = () => {
    const s = props.localStream;
    if (!s) return;
    const next = !cameraOff;
    for (const track of s.getVideoTracks()) track.enabled = !next;
    setCameraOff(next);
  };

  const statusText =
    state === "incoming"
      ? t("call_incoming")
      : state === "outgoing"
        ? t("call_outgoing")
        : state === "connecting"
          ? t("call_connecting")
          : state === "active"
            ? elapsedLabel(activeSince) || t("call_active")
            : "";

  return (
    <div className="callwin" role="dialog" aria-modal="true" data-testid="call-window" data-state={state}>
      <div className="callwin__box win">
        <div className="win__title">
          <span>{isVideo ? t("call_video") : t("call_audio")}</span>
          <span className="spacer" />
        </div>

        <div className="callwin__stage">
          {theySendVideo && state === "active" ? (
            <video className="callwin__remote" ref={remoteVideoRef} autoPlay playsInline data-testid="call-remote-video" />
          ) : (
            <div className="callwin__avatar" style={{ background: avatarColor(peerKey) }}>{initial(peerName)}</div>
          )}
          {/* ADR-0338：我沒開視訊就不該有自我預覽——否則看起來像我在送畫面。 */}
          {iSendVideo && state === "active" ? (
            <video className="callwin__local" ref={localVideoRef} autoPlay playsInline muted />
          ) : null}
          {/* 語音（或視訊尚未 active）以隱藏 audio 播放遠端聲音 */}
          {!isVideo || state !== "active" ? (
            <audio ref={remoteAudioRef} autoPlay data-testid="call-remote-audio" />
          ) : null}
        </div>

        <div className="callwin__info">
          <b>{peerName}</b>
          {/* ADR-0338：不留一塊沒有解釋的黑畫面——對方只送語音就明說。 */}
          {state === "active" && isVideo && !theySendVideo ? (
            <div className="callwin__status" data-testid="call-remote-audio-only">
              {t("call_remoteAudioOnly")}
            </div>
          ) : null}
          <div className="callwin__status" data-testid="call-status">{statusText}</div>
        </div>

        <div className="callwin__controls">
          {state === "incoming" ? (
            <>
              <button className="callbtn callbtn--accept" onClick={props.onAccept} data-testid="call-accept">
                {t("call_accept")}
              </button>
              <button className="callbtn callbtn--hangup" onClick={props.onReject} data-testid="call-reject">
                {t("call_reject")}
              </button>
            </>
          ) : (
            <>
              {state === "active" ? (
                <button className="callbtn" onClick={toggleMute} aria-pressed={muted} data-testid="call-mute">
                  {muted ? t("call_unmute") : t("call_mute")}
                </button>
              ) : null}
              {state === "active" && props.canChangeMedia ? (
                <button
                  className="callbtn"
                  onClick={() => props.onMediaChange(iSendVideo ? "audio" : "video")}
                  data-testid="call-media-toggle"
                >
                  {iSendVideo ? t("call_toAudio") : t("call_toVideo")}
                </button>
              ) : null}
              {state === "active" && iSendVideo ? (
                <>
                  <button className="callbtn" onClick={toggleCamera} aria-pressed={cameraOff} data-testid="call-camera">
                    {cameraOff ? t("call_camera_on") : t("call_camera_off")}
                  </button>
                  {/* 畫質問題只有通話中才察覺得到——所以選擇器在這裡，不是埋在設定頁（ADR-0337 §2）。 */}
                  <label className="callwin__quality">
                    <span>{t("call_quality")}</span>
                    <select
                      value={props.quality}
                      onChange={(e) => props.onQualityChange(e.target.value as VideoQuality)}
                      data-testid="call-quality"
                    >
                      {VIDEO_QUALITIES.map((q) => (
                        <option key={q} value={q}>
                          {t(QUALITY_KEY[q])}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              <button className="callbtn callbtn--hangup" onClick={props.onHangup} data-testid="call-hangup">
                {t("call_hangup")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
