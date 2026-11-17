// @vitest-environment jsdom
//
// 🔴 實機發現（2026-11-17）：通話中才開視訊時，畫面元素是**後來才掛上**的（<audio> 換成 <video>、
// 自我預覽新出現），但串流物件沒換——以前 `srcObject` 只在串流物件變動時才設，新元素就一直是 null。

import { describe, expect, it } from "vitest";
import type { CallMedia } from "@cinderous/core";
import { CallScreen } from "./CallScreen.js";
import { mount } from "../test/jsdom-mount.js";

const local = { getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream;
const remote = { getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream;

const view = (mine: CallMedia, theirs: CallMedia): JSX.Element => (
  <CallScreen
    peerName="Amy"
    state="active"
    media="audio"
    localMedia={mine}
    remoteMedia={theirs}
    canChangeMedia
    onMediaChange={() => {}}
    facing={null}
    canFlipCamera={false}
    onFlipCamera={() => {}}
    localStream={local}
    remoteStream={remote}
    quality="medium"
    onQualityChange={() => {}}
    onAccept={() => {}}
    onReject={() => {}}
    onHangup={() => {}}
    locale="zh-Hant"
  />
);

const sources = (root: HTMLElement): unknown[] =>
  [...root.querySelectorAll("video,audio")].map((el) => (el as HTMLMediaElement).srcObject);

describe("行動端通話：後掛上的媒體元素也要接上串流（實機發現 2026-11-17）", () => {
  it("🔴 對方中途開視訊 → 新的 <video> 接上遠端串流", () => {
    const m = mount(view("audio", "audio"));
    m.rerender(view("audio", "video"));
    const videos = [...m.container.querySelectorAll("video")].map((el) => el.srcObject);
    expect(videos).toContain(remote);
  });

  it("🔴 我中途開視訊 → 自我預覽接上本地串流", () => {
    const m = mount(view("audio", "audio"));
    m.rerender(view("video", "audio"));
    expect(sources(m.container)).toContain(local);
  });
});
