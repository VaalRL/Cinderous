import type { CallMedia, CallState, CameraSelection, VideoQuality } from "@cinderous/core";
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
   * UI 手上只有 `MediaStream`。（靜音則相反，UI 自己動音軌就夠。）
   */
  onQualityChange: (q: VideoQuality) => void;
  /**
   * 換鏡頭（ADR-0339）。**桌面是選裝置，不是翻面**——內建／外接／擷取卡是一份清單，
   * 沒有前後可言。硬做成翻面會做出一個「轉了不知道轉到哪」的按鈕。
   */
  onCameraChange: (sel: CameraSelection) => void;
}

/**
 * 可用的視訊輸入裝置（ADR-0339）。
 *
 * ⚠ **標籤在取得相機權限前是空字串**（規格防指紋）⇒ 只有通話中（權限已給）才有
 * 有意義的名稱。因此這個清單只在通話視窗裡用，不放設定頁。
 */
function useCameras(active: boolean): MediaDeviceInfo[] {
  const [list, setList] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!active || !navigator.mediaDevices?.enumerateDevices) return;
    let alive = true;
    void navigator.mediaDevices
      .enumerateDevices()
      .then((all) => {
        if (alive) setList(all.filter((d) => d.kind === "videoinput"));
      })
      .catch(() => {
        /* 列舉失敗＝不顯示選擇器，不是錯誤 */
      });
    return () => void (alive = false);
  }, [active]);
  return list;
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
  const cameras = useCameras(state === "active" && iSendVideo);
  const remoteVideoRef = useStream<HTMLVideoElement>(props.remoteStream);
  const localVideoRef = useStream<HTMLVideoElement>(props.localStream);
  const remoteAudioRef = useStream<HTMLAudioElement>(props.remoteStream);

  const [muted, setMuted] = useState(false);
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
              {/*
                ADR-0340：關鏡頭與降級合併成這一顆。閘門**只擋「開啟」方向**——
                🔴 關掉自己的鏡頭永遠不該被擋住，否則會做出「視訊通話中關不掉自己鏡頭」的 UI。
              */}
              {state === "active" && (iSendVideo || props.canChangeMedia) ? (
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
                  {/* ADR-0339：只有一台鏡頭就不顯示——寧可少一個按鈕，也不要一個按了沒反應的。 */}
                  {cameras.length > 1 ? (
                    <label className="callwin__quality">
                      <span>{t("call_camera")}</span>
                      <select
                        onChange={(e) => props.onCameraChange({ deviceId: e.target.value })}
                        data-testid="call-camera-select"
                      >
                        {cameras.map((d, i) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {/* 權限已給時才有名稱；沒有就用序號，不留一個空白選項。 */}
                            {d.label || `${t("call_camera")} ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
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
