// @vitest-environment jsdom
//
// 🔴 實機發現（2026-11-17）：通話中才開視訊時，自我預覽與對方畫面是**後來才掛上**的 <video>，
// 但串流物件沒換——以前 `srcObject` 只在串流物件變動時才設，新掛上的元素就一直是 null（黑框）。

import { describe, expect, it } from "vitest";
import type { CallMedia } from "@cinderous/core";
import { I18nProvider } from "../i18n.js";
import { CallWindow } from "./CallWindow.js";
import { mount } from "../test/jsdom-mount.js";

const stream = {
  getTracks: () => [],
  getAudioTracks: () => [],
  getVideoTracks: () => [],
} as unknown as MediaStream;

const view = (local: CallMedia, remote: CallMedia): JSX.Element => (
  <I18nProvider locale="zh-Hant">
    <CallWindow
      peerName="Bob"
      peerKey={"bb".repeat(32)}
      state="active"
      media="audio"
      localMedia={local}
      remoteMedia={remote}
      canChangeMedia
      onMediaChange={() => {}}
      localStream={stream}
      remoteStream={stream}
      quality="medium"
      onQualityChange={() => {}}
      onCameraChange={() => {}}
      onAccept={() => {}}
      onReject={() => {}}
      onHangup={() => {}}
    />
  </I18nProvider>
);

const srcOf = (el: Element | null): unknown => (el as HTMLMediaElement | null)?.srcObject;

describe("通話視窗：後掛上的 <video> 也要接上串流（實機發現 2026-11-17）", () => {
  it("🔴 我中途開視訊 → 自我預覽接上本地串流", () => {
    const m = mount(view("audio", "audio"));
    m.rerender(view("video", "audio"));
    expect(srcOf(m.container.querySelector(".callwin__local"))).toBe(stream);
  });

  it("🔴 對方中途開視訊 → 對方畫面接上遠端串流", () => {
    const m = mount(view("audio", "audio"));
    m.rerender(view("audio", "video"));
    expect(srcOf(m.container.querySelector('[data-testid="call-remote-video"]'))).toBe(stream);
  });
});
