// @vitest-environment jsdom
//
// 行動端視訊畫質三檔（ADR-0337）。
//
// ⚠ 原本這裡還有「關鏡頭」（`enabled=false`）的測試，已隨 ADR-0340 廢除該作法一併移除
// ——關鏡頭現在走降級，由 CallScreen.mediaChange.test.tsx 涵蓋。

import { describe, expect, it } from "vitest";
import type { VideoQuality } from "@cinderous/core";
import { CallScreen } from "./CallScreen.js";
import { mount, byTestId, click } from "../test/jsdom-mount.js";

/** byTestId 找不到會丟例外（那是它的設計）；測「不存在」時用這個。 */
const maybe = (root: HTMLElement, id: string): Element | null =>
  root.querySelector(`[data-testid="${id}"]`);

class Track {
  enabled = true;
  constructor(public kind: string) {}
}

function fakeStream(kinds: string[]): MediaStream {
  const tracks = kinds.map((k) => new Track(k));
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  } as unknown as MediaStream;
}

const view = (opts: {
  media: "audio" | "video";
  stream: MediaStream;
  quality?: VideoQuality;
  onQuality?: (q: VideoQuality) => void;
}): JSX.Element => (
  <CallScreen
    peerName="Amy"
    state="active"
    media={opts.media}
    localStream={opts.stream}
    remoteStream={opts.stream}
    quality={opts.quality ?? "medium"}
    onQualityChange={opts.onQuality ?? (() => {})}
    localMedia={opts.media}
    remoteMedia={opts.media}
    canChangeMedia={false}
    onMediaChange={() => {}}
    facing={null}
    canFlipCamera={false}
    onFlipCamera={() => {}}
    onAccept={() => {}}
    onReject={() => {}}
    onHangup={() => {}}
    locale="zh-Hant"
  />
);

describe("行動端視訊畫質（ADR-0337）", () => {
  it("語音通話不顯示畫質", () => {
    const m = mount(view({ media: "audio", stream: fakeStream(["audio"]) }));
    expect(maybe(m.container, "call-quality")).toBeNull();
  });

  it("視訊通話顯示畫質", () => {
    const m = mount(view({ media: "video", stream: fakeStream(["audio", "video"]) }));
    expect(maybe(m.container, "call-quality")).not.toBeNull();
  });

  it("🔴 改畫質往上回報，不是自己記著——engine 才拿得到 RTCRtpSender", () => {
    const seen: VideoQuality[] = [];
    const m = mount(
      view({ media: "video", stream: fakeStream(["audio", "video"]), onQuality: (q) => seen.push(q) }),
    );
    // 三檔輪替：按一下從 medium 前進到 high。
    click(byTestId(m.container, "call-quality"));
    expect(seen).toEqual(["high"]);
  });

  it("畫質輪替會繞回最省的一檔（手機上沒有空間放三顆按鈕）", () => {
    const seen: VideoQuality[] = [];
    const m = mount(
      view({ media: "video", stream: fakeStream(["audio", "video"]), quality: "high", onQuality: (q) => seen.push(q) }),
    );
    click(byTestId(m.container, "call-quality"));
    expect(seen).toEqual(["low"]);
  });
});
