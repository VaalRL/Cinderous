// @vitest-environment jsdom
//
// 視訊畫質三檔（ADR-0337）。
//
// ⚠ 原本這裡還有「關鏡頭」（`enabled=false` 送黑畫面）的測試，
// 已隨 ADR-0340 廢除該作法一併移除——關鏡頭現在走降級，由 mediaChange 測試涵蓋。

import { act } from "react";
import { describe, expect, it } from "vitest";
import type { VideoQuality } from "@cinderous/core";
import { I18nProvider } from "../i18n.js";
import { CallWindow } from "./CallWindow.js";
import { mount } from "../test/jsdom-mount.js";

/** 最小媒體軌替身：只需要 kind 與 enabled。 */
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
  // ADR-0338：型態每方向獨立；這一組測的是**對稱**情形（兩方同型態），
  // 非對稱的行為由 CallWindow.mediaChange.test.tsx 涵蓋。
  <I18nProvider locale="zh-Hant">
    <CallWindow
      peerName="Bob"
      peerKey={"bb".repeat(32)}
      state="active"
      media={opts.media}
      localMedia={opts.media}
      remoteMedia={opts.media}
      canChangeMedia={false}
      onMediaChange={() => {}}
      localStream={opts.stream}
      remoteStream={opts.stream}
      quality={opts.quality ?? "medium"}
      onQualityChange={opts.onQuality ?? (() => {})}
      onAccept={() => {}}
      onReject={() => {}}
      onHangup={() => {}}
    />
  </I18nProvider>
);

const click = (el: Element | null): void => {
  act(() => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("通話視窗視訊畫質（ADR-0337）", () => {
  it("語音通話不顯示畫質——它對語音沒有意義", () => {
    const { container } = mount(view({ media: "audio", stream: fakeStream(["audio"]) }));
    expect(container.querySelector('[data-testid="call-quality"]')).toBeNull();
    // 靜音仍在（語音通話本來就有）。
    expect(container.querySelector('[data-testid="call-mute"]')).not.toBeNull();
  });

  it("視訊通話顯示畫質", () => {
    const { container } = mount(view({ media: "video", stream: fakeStream(["audio", "video"]) }));
    expect(container.querySelector('[data-testid="call-quality"]')).not.toBeNull();
  });

  it("畫質選擇器列出三檔，且反映目前檔位", () => {
    const { container } = mount(
      view({ media: "video", stream: fakeStream(["audio", "video"]), quality: "low" }),
    );
    const sel = container.querySelector<HTMLSelectElement>('[data-testid="call-quality"]')!;
    expect([...sel.options].map((o) => o.value)).toEqual(["low", "medium", "high"]);
    expect(sel.value).toBe("low");
  });

  it("🔴 改畫質往上回報，不是自己記著——engine 才拿得到 RTCRtpSender", () => {
    const seen: VideoQuality[] = [];
    const { container } = mount(
      view({ media: "video", stream: fakeStream(["audio", "video"]), onQuality: (q) => seen.push(q) }),
    );
    const sel = container.querySelector<HTMLSelectElement>('[data-testid="call-quality"]')!;
    act(() => {
      sel.value = "high";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(seen).toEqual(["high"]);
  });
});
