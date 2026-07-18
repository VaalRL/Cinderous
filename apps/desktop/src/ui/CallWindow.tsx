import type { CallMedia, CallState } from "@cinderous/core";
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
}

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
          {isVideo && state === "active" ? (
            <>
              <video className="callwin__remote" ref={remoteVideoRef} autoPlay playsInline data-testid="call-remote-video" />
              <video className="callwin__local" ref={localVideoRef} autoPlay playsInline muted />
            </>
          ) : (
            <div className="callwin__avatar" style={{ background: avatarColor(peerKey) }}>{initial(peerName)}</div>
          )}
          {/* 語音（或視訊尚未 active）以隱藏 audio 播放遠端聲音 */}
          {!isVideo || state !== "active" ? (
            <audio ref={remoteAudioRef} autoPlay data-testid="call-remote-audio" />
          ) : null}
        </div>

        <div className="callwin__info">
          <b>{peerName}</b>
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
