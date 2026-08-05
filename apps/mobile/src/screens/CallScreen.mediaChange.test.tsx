// @vitest-environment jsdom
//
// 行動端通話中升降級（ADR-0338）。
//
// 🔴 核心是**非對稱**：媒體型態每方向獨立，「我送視訊、他只送語音」是合法狀態，
// 畫面必須照實呈現而不是假裝對稱。

import { describe, expect, it } from "vitest";
import type { CallMedia } from "@cinderous/core";
import { CallScreen } from "./CallScreen.js";
import { mount, byTestId, click } from "../test/jsdom-mount.js";

const maybe = (root: HTMLElement, id: string): Element | null =>
  root.querySelector(`[data-testid="${id}"]`);

const stream = {
  getTracks: () => [],
  getAudioTracks: () => [],
  getVideoTracks: () => [],
} as unknown as MediaStream;

const view = (opts: {
  local: CallMedia;
  remote: CallMedia;
  canChange?: boolean;
  onChange?: (m: CallMedia) => void;
}): JSX.Element => (
  <CallScreen
    peerName="Amy"
    state="active"
    media={opts.local === "video" || opts.remote === "video" ? "video" : "audio"}
    localMedia={opts.local}
    remoteMedia={opts.remote}
    canChangeMedia={opts.canChange ?? true}
    onMediaChange={opts.onChange ?? (() => {})}
    localStream={stream}
    remoteStream={stream}
    quality="medium"
    onQualityChange={() => {}}
    onAccept={() => {}}
    onReject={() => {}}
    onHangup={() => {}}
    locale="zh-Hant"
  />
);

describe("行動端通話中升降級（ADR-0338）", () => {
  it("純語音兩方：有升級入口", () => {
    const m = mount(view({ local: "audio", remote: "audio" }));
    expect(maybe(m.container, "call-media-toggle")).not.toBeNull();
  });

  it("升級往上回報 video", () => {
    const seen: CallMedia[] = [];
    const m = mount(view({ local: "audio", remote: "audio", onChange: (x) => seen.push(x) }));
    click(byTestId(m.container, "call-media-toggle"));
    expect(seen).toEqual(["video"]);
  });

  it("降級往上回報 audio", () => {
    const seen: CallMedia[] = [];
    const m = mount(view({ local: "video", remote: "video", onChange: (x) => seen.push(x) }));
    click(byTestId(m.container, "call-media-toggle"));
    expect(seen).toEqual(["audio"]);
  });

  it("🔴 按鈕反映的是**我**的方向——他開了我還沒開，按鈕仍是升級", () => {
    const seen: CallMedia[] = [];
    const m = mount(view({ local: "audio", remote: "video", onChange: (x) => seen.push(x) }));
    click(byTestId(m.container, "call-media-toggle"));
    expect(seen).toEqual(["video"]);
  });

  it("🔴 對端不支援 → 不顯示入口，而不是顯示按了沒反應的按鈕", () => {
    const m = mount(view({ local: "audio", remote: "audio", canChange: false }));
    expect(maybe(m.container, "call-media-toggle")).toBeNull();
  });

  it("🔴 對方只送語音時明說——不留一塊沒有解釋的黑畫面", () => {
    const m = mount(view({ local: "video", remote: "audio" }));
    expect(maybe(m.container, "call-remote-audio-only")).not.toBeNull();
  });

  it("對方送視訊時不再顯示該說明", () => {
    const m = mount(view({ local: "audio", remote: "video" }));
    expect(maybe(m.container, "call-remote-audio-only")).toBeNull();
  });

  it("🔴 畫質只在**我**送視訊時出現", () => {
    const mine = mount(view({ local: "video", remote: "audio" }));
    expect(maybe(mine.container, "call-quality")).not.toBeNull();

    // 只有對方在送視訊：我沒有畫面可調。
    const theirs = mount(view({ local: "audio", remote: "video" }));
    expect(maybe(theirs.container, "call-quality")).toBeNull();
  });

  it("🔴 ADR-0340：關掉自己的鏡頭**永遠**可用——不得被 canChangeMedia 閘門擋住", () => {
    const seen: CallMedia[] = [];
    const m = mount(view({ local: "video", remote: "video", canChange: false, onChange: (x) => seen.push(x) }));
    expect(maybe(m.container, "call-media-toggle"), "我正在送視訊時，關閉入口必須在").not.toBeNull();
    click(byTestId(m.container, "call-media-toggle"));
    expect(seen).toEqual(["audio"]);
  });

  it("ADR-0340：關鏡頭與降級合併——不再有獨立的關鏡頭鈕", () => {
    const m = mount(view({ local: "video", remote: "video" }));
    expect(maybe(m.container, "call-camera")).toBeNull();
  });
});
