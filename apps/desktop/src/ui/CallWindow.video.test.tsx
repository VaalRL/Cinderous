// @vitest-environment jsdom
//
// 視訊控制項：關鏡頭與畫質三檔（ADR-0337）。
// 兩者都要走真實點擊——關鏡頭改的是 MediaTrack 的 `enabled`，SSR 測不到。

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
  <I18nProvider locale="zh-Hant">
    <CallWindow
      peerName="Bob"
      peerKey={"bb".repeat(32)}
      state="active"
      media={opts.media}
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

describe("通話視窗視訊控制項（ADR-0337）", () => {
  it("語音通話不顯示關鏡頭與畫質——那兩個對它沒有意義", () => {
    const { container } = mount(view({ media: "audio", stream: fakeStream(["audio"]) }));
    expect(container.querySelector('[data-testid="call-camera"]')).toBeNull();
    expect(container.querySelector('[data-testid="call-quality"]')).toBeNull();
    // 靜音仍在（語音通話本來就有）。
    expect(container.querySelector('[data-testid="call-mute"]')).not.toBeNull();
  });

  it("視訊通話顯示關鏡頭與畫質", () => {
    const { container } = mount(view({ media: "video", stream: fakeStream(["audio", "video"]) }));
    expect(container.querySelector('[data-testid="call-camera"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="call-quality"]')).not.toBeNull();
  });

  it("🔴 按關鏡頭只停視訊軌，音訊軌不受影響（不是連聲音一起關掉）", () => {
    const stream = fakeStream(["audio", "video"]);
    const { container } = mount(view({ media: "video", stream }));
    click(container.querySelector('[data-testid="call-camera"]'));
    expect(stream.getVideoTracks().every((t) => t.enabled)).toBe(false);
    expect(stream.getAudioTracks().every((t) => t.enabled)).toBe(true);
  });

  it("再按一次恢復視訊", () => {
    const stream = fakeStream(["audio", "video"]);
    const { container } = mount(view({ media: "video", stream }));
    const btn = container.querySelector('[data-testid="call-camera"]');
    click(btn);
    click(btn);
    expect(stream.getVideoTracks().every((t) => t.enabled)).toBe(true);
  });

  it("關鏡頭以 aria-pressed 表達狀態（螢幕閱讀器要知道現在是關著的）", () => {
    const { container } = mount(view({ media: "video", stream: fakeStream(["audio", "video"]) }));
    const btn = container.querySelector('[data-testid="call-camera"]')!;
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("靜音與關鏡頭互不干擾（各自只動自己那類軌道）", () => {
    const stream = fakeStream(["audio", "video"]);
    const { container } = mount(view({ media: "video", stream }));
    click(container.querySelector('[data-testid="call-mute"]'));
    expect(stream.getAudioTracks().every((t) => t.enabled)).toBe(false);
    expect(stream.getVideoTracks().every((t) => t.enabled)).toBe(true);
    click(container.querySelector('[data-testid="call-camera"]'));
    expect(stream.getAudioTracks().every((t) => t.enabled)).toBe(false);
    expect(stream.getVideoTracks().every((t) => t.enabled)).toBe(false);
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
