// 通話媒體平台縫（ADR-0101）：**唯一**碰媒體元素的地方。
//
// ⚠ 為什麼這裡必須有縫（與 ADR-0096 的 SVG 不同）：
//   `react-native-svg` **有 web 實作**，所以那次能整包換掉、雙端共用同一元件。
//   但 `react-native-webrtc` **沒有 web 實作**——web 本來就直接用瀏覽器原生 WebRTC。
//   也就是說 web / native 的分歧是**本質性的**，連真正的 Expo app 也得分兩條路徑。
//   把它關在這一個檔裡是正確架構，不是權宜之計。
//
// 目前（react-native-web）：瀏覽器原生 WebRTC（全域 RTCPeerConnection/getUserMedia）＋ <video>/<audio>。
// 移植真 RN：新增 `call-media.native.tsx`（Metro 會**自動優先**挑 `.native`，匯入路徑不必改），
//   內部改用 `react-native-webrtc` 的 `RTCView`，並在 app 進入點呼叫其 `registerGlobals()`
//   以提供 RTCPeerConnection/getUserMedia。本檔匯出的介面（StreamView/hasCallSupport）保持不變。

import { useEffect, useRef } from "react";

/** 此平台是否具備通話能力（缺 WebRTC 全域就不顯示通話入口）。 */
export function hasCallSupport(): boolean {
  return (
    typeof RTCPeerConnection !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/**
 * 顯示一條媒體串流。`audioOnly` 時只掛音訊（不佔版面）。
 * `muted` 用於本地預覽（避免自己的聲音回授）。
 */
export function StreamView({
  stream,
  audioOnly = false,
  muted = false,
  mirror = false,
  width,
  height,
}: {
  stream: MediaStream | null;
  audioOnly?: boolean;
  muted?: boolean;
  mirror?: boolean;
  width?: number | string;
  height?: number | string;
}): JSX.Element {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  if (audioOnly) {
    // 純語音：仍需一個播放槽，但不佔版面。
    return <audio ref={ref} autoPlay muted={muted} style={{ display: "none" }} />;
  }
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      style={{
        width: width ?? "100%",
        height: height ?? "100%",
        objectFit: "cover",
        backgroundColor: "#000",
        ...(mirror ? { transform: "scaleX(-1)" } : {}),
      }}
    />
  );
}
