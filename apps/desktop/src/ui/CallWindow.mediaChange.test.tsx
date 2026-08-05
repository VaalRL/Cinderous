// @vitest-environment jsdom
//
// 通話中語音↔視訊升降級的 UI（ADR-0338）。
//
// 🔴 這裡驗的核心是**非對稱**：媒體型態每方向獨立，
// 「我送視訊、他只送語音」是合法狀態，畫面必須照實呈現而不是假裝對稱。

import { act } from "react";
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

const view = (opts: {
  local: CallMedia;
  remote: CallMedia;
  canChange?: boolean;
  onChange?: (m: CallMedia) => void;
}): JSX.Element => (
  <I18nProvider locale="zh-Hant">
    <CallWindow
      peerName="Bob"
      peerKey={"bb".repeat(32)}
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
      onCameraChange={() => {}}
      onAccept={() => {}}
      onReject={() => {}}
      onHangup={() => {}}
    />
  </I18nProvider>
);

const q = (root: HTMLElement, id: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const click = (el: Element | null): void => {
  act(() => void el?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

describe("通話中升降級 UI（ADR-0338）", () => {
  it("純語音兩方：按鈕邀請我開視訊", () => {
    const { container } = mount(view({ local: "audio", remote: "audio" }));
    const btn = q(container, "call-media-toggle")!;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain("開啟我的視訊");
  });

  it("我已開視訊：按鈕變成關閉", () => {
    const { container } = mount(view({ local: "video", remote: "video" }));
    // ADR-0340 之後文案**可以說「關閉」**——它真的 stop() 相機、指示燈會滅。
    expect(q(container, "call-media-toggle")!.textContent).toContain("關閉我的視訊");
  });

  it("🔴 按鈕反映的是**我**的方向，不是對方的", () => {
    // 他開了視訊、我還沒 ⇒ 按鈕仍是「開啟我的視訊」。
    const { container } = mount(view({ local: "audio", remote: "video" }));
    expect(q(container, "call-media-toggle")!.textContent).toContain("開啟我的視訊");
  });

  it("升級往上回報 video，降級回報 audio", () => {
    const seen: CallMedia[] = [];
    const up = mount(view({ local: "audio", remote: "audio", onChange: (m) => seen.push(m) }));
    click(q(up.container, "call-media-toggle"));
    expect(seen).toEqual(["video"]);

    const down = mount(view({ local: "video", remote: "video", onChange: (m) => seen.push(m) }));
    click(q(down.container, "call-media-toggle"));
    expect(seen).toEqual(["video", "audio"]);
  });

  it("🔴 對端不支援（canChangeMedia=false）→ 不顯示入口，而不是顯示一顆按了沒反應的按鈕", () => {
    const { container } = mount(view({ local: "audio", remote: "audio", canChange: false }));
    expect(q(container, "call-media-toggle")).toBeNull();
  });

  it("🔴 對方只送語音時明說——不留一塊沒有解釋的黑畫面", () => {
    const { container } = mount(view({ local: "video", remote: "audio" }));
    expect(container.textContent).toContain("對方未開啟視訊");
    // 對方沒有視訊 ⇒ 不渲染遠端 video 元素。
    expect(q(container, "call-remote-video")).toBeNull();
  });

  it("對方送視訊時顯示遠端畫面，且不再顯示「未開啟視訊」", () => {
    const { container } = mount(view({ local: "audio", remote: "video" }));
    expect(q(container, "call-remote-video")).not.toBeNull();
    expect(container.textContent).not.toContain("對方未開啟視訊");
  });

  it("🔴 我沒開視訊就不該有自我預覽（否則像是我在送畫面）", () => {
    const { container } = mount(view({ local: "audio", remote: "video" }));
    expect(container.querySelector(".callwin__local")).toBeNull();
  });

  it("我開了視訊就有自我預覽", () => {
    const { container } = mount(view({ local: "video", remote: "audio" }));
    expect(container.querySelector(".callwin__local")).not.toBeNull();
  });

  it("畫質只在**我**送視訊時才有意義", () => {
    const mine = mount(view({ local: "video", remote: "audio" }));
    expect(q(mine.container, "call-quality")).not.toBeNull();

    // 只有對方在送視訊：我沒有畫面可調。
    const theirs = mount(view({ local: "audio", remote: "video" }));
    expect(q(theirs.container, "call-quality")).toBeNull();
  });

  it("🔴 ADR-0340：關掉自己的鏡頭**永遠**可用——不得被 canChangeMedia 閘門擋住", () => {
    // 否則會做出「視訊通話中關不掉自己鏡頭」的 UI，比原本的問題嚴重得多。
    const seen: CallMedia[] = [];
    const m = mount(view({ local: "video", remote: "video", canChange: false, onChange: (x) => seen.push(x) }));
    const btn = q(m.container, "call-media-toggle");
    expect(btn, "我正在送視訊時，關閉入口必須在").not.toBeNull();
    click(btn);
    expect(seen).toEqual(["audio"]);
  });

  it("ADR-0340：關鏡頭與降級合併——不再有獨立的關鏡頭鈕", () => {
    const m = mount(view({ local: "video", remote: "video" }));
    expect(q(m.container, "call-camera")).toBeNull();
  });
});
