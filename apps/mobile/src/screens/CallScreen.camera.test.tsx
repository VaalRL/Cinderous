// @vitest-environment jsdom
//
// 行動端切換鏡頭與自我預覽鏡像（ADR-0339）。
//
// 🔴 鏡像是這份的重點：前鏡頭該鏡像、後鏡頭不該——後鏡頭鏡像等於把字反過來給自己看。
// 原本 `CallScreen.tsx` 是**寫死** `mirror`，換到後鏡頭就是錯的。

import { describe, expect, it } from "vitest";
import type { CameraFacing } from "@cinderous/core";
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
  facing?: CameraFacing | null;
  canFlip?: boolean;
  onFlip?: (f: CameraFacing) => void;
  local?: "audio" | "video";
}): JSX.Element => (
  <CallScreen
    peerName="Amy"
    state="active"
    media="video"
    localMedia={opts.local ?? "video"}
    remoteMedia="video"
    canChangeMedia
    onMediaChange={() => {}}
    facing={opts.facing ?? null}
    canFlipCamera={opts.canFlip ?? true}
    onFlipCamera={opts.onFlip ?? (() => {})}
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

/** 自我預覽那個 <video>（本地預覽是唯一會被鏡像的）。 */
const localPreview = (root: HTMLElement): HTMLElement | null => {
  const vids = [...root.querySelectorAll<HTMLElement>("video")];
  return vids.find((v) => (v as HTMLVideoElement).muted) ?? null;
};

describe("行動端切換鏡頭（ADR-0339）", () => {
  it("有第二個鏡頭時顯示翻面鈕", () => {
    const m = mount(view({ canFlip: true }));
    expect(maybe(m.container, "call-flip-camera")).not.toBeNull();
  });

  it("🔴 只有一個鏡頭就不顯示——寧可少一個按鈕，也不要一個按了沒反應的", () => {
    const m = mount(view({ canFlip: false }));
    expect(maybe(m.container, "call-flip-camera")).toBeNull();
  });

  it("沒在送視訊時不顯示翻面鈕（沒有畫面可翻）", () => {
    const m = mount(view({ local: "audio" }));
    expect(maybe(m.container, "call-flip-camera")).toBeNull();
  });

  it("從前鏡頭翻到後鏡頭", () => {
    const seen: CameraFacing[] = [];
    const m = mount(view({ facing: "user", onFlip: (f) => seen.push(f) }));
    click(byTestId(m.container, "call-flip-camera"));
    expect(seen).toEqual(["environment"]);
  });

  it("從後鏡頭翻回前鏡頭", () => {
    const seen: CameraFacing[] = [];
    const m = mount(view({ facing: "environment", onFlip: (f) => seen.push(f) }));
    click(byTestId(m.container, "call-flip-camera"));
    expect(seen).toEqual(["user"]);
  });

  it("朝向未知時當作前鏡頭，翻過去是後鏡頭", () => {
    const seen: CameraFacing[] = [];
    const m = mount(view({ facing: null, onFlip: (f) => seen.push(f) }));
    click(byTestId(m.container, "call-flip-camera"));
    expect(seen).toEqual(["environment"]);
  });

  it("🔴 前鏡頭：自我預覽鏡像（照鏡子的直覺）", () => {
    const m = mount(view({ facing: "user" }));
    expect(localPreview(m.container)?.style.transform).toContain("scaleX(-1)");
  });

  it("🔴 後鏡頭：自我預覽**不**鏡像——鏡像等於把字反過來給自己看", () => {
    const m = mount(view({ facing: "environment" }));
    expect(localPreview(m.container)?.style.transform ?? "").not.toContain("scaleX(-1)");
  });

  it("朝向未知（桌面 webcam 等）當作前鏡頭 ⇒ 鏡像", () => {
    const m = mount(view({ facing: null }));
    expect(localPreview(m.container)?.style.transform).toContain("scaleX(-1)");
  });

  it("🔴 只有自我預覽鏡像——遠端畫面永遠不鏡像（對方的字必須是正的）", () => {
    const m = mount(view({ facing: "user" }));
    const remote = [...m.container.querySelectorAll<HTMLElement>("video")].filter(
      (v) => !(v as HTMLVideoElement).muted,
    );
    expect(remote.length).toBeGreaterThan(0);
    for (const v of remote) expect(v.style.transform ?? "").not.toContain("scaleX(-1)");
  });
});
