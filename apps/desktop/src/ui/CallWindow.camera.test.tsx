// @vitest-environment jsdom
//
// 桌面選鏡頭（ADR-0339）。
//
// 🔴 桌面**不是翻面**——內建／外接／擷取卡是一份清單，沒有前後可言。
// 硬做成翻面會做出一個「轉了不知道會轉到哪」的按鈕。

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CameraSelection } from "@cinderous/core";
import { I18nProvider } from "../i18n.js";
import { CallWindow } from "./CallWindow.js";
import { mount } from "../test/jsdom-mount.js";

const stream = {
  getTracks: () => [],
  getAudioTracks: () => [],
  getVideoTracks: () => [],
} as unknown as MediaStream;

/** 樁：`enumerateDevices` 回傳的視訊輸入清單。 */
function stubDevices(list: Array<{ deviceId: string; label: string }>): void {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      enumerateDevices: async () => list.map((d) => ({ ...d, kind: "videoinput" })),
    },
  });
}

const view = (onCamera: (s: CameraSelection) => void = () => {}): JSX.Element => (
  <I18nProvider locale="zh-Hant">
    <CallWindow
      peerName="Bob"
      peerKey={"bb".repeat(32)}
      state="active"
      media="video"
      localMedia="video"
      remoteMedia="video"
      canChangeMedia
      onMediaChange={() => {}}
      localStream={stream}
      remoteStream={stream}
      quality="medium"
      onQualityChange={() => {}}
      onCameraChange={onCamera}
      onAccept={() => {}}
      onReject={() => {}}
      onHangup={() => {}}
    />
  </I18nProvider>
);

/** enumerateDevices 是非同步的：掛載後沖刷微任務讓清單就位。 */
const settle = async (m: { rerender(n: JSX.Element): void }): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};

describe("桌面選鏡頭（ADR-0339）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("兩台以上才顯示選擇器", async () => {
    stubDevices([
      { deviceId: "a", label: "內建鏡頭" },
      { deviceId: "b", label: "外接攝影機" },
    ]);
    const m = mount(view());
    await settle(m);
    expect(m.container.querySelector('[data-testid="call-camera-select"]')).not.toBeNull();
  });

  it("🔴 只有一台就不顯示——寧可少一個按鈕，也不要一個按了沒反應的", async () => {
    stubDevices([{ deviceId: "a", label: "內建鏡頭" }]);
    const m = mount(view());
    await settle(m);
    expect(m.container.querySelector('[data-testid="call-camera-select"]')).toBeNull();
  });

  it("列出每一台，用它的名稱", async () => {
    stubDevices([
      { deviceId: "a", label: "內建鏡頭" },
      { deviceId: "b", label: "外接攝影機" },
    ]);
    const m = mount(view());
    await settle(m);
    const sel = m.container.querySelector<HTMLSelectElement>('[data-testid="call-camera-select"]')!;
    expect([...sel.options].map((o) => o.value)).toEqual(["a", "b"]);
    expect([...sel.options].map((o) => o.textContent)).toEqual(["內建鏡頭", "外接攝影機"]);
  });

  it("🔴 沒有名稱（權限未給）時以序號代替，不留空白選項", async () => {
    // 規格：標籤在取得相機權限前是空字串（防指紋）。
    stubDevices([
      { deviceId: "a", label: "" },
      { deviceId: "b", label: "" },
    ]);
    const m = mount(view());
    await settle(m);
    const sel = m.container.querySelector<HTMLSelectElement>('[data-testid="call-camera-select"]')!;
    const texts = [...sel.options].map((o) => o.textContent);
    expect(texts.every((x) => (x ?? "").trim().length > 0)).toBe(true);
  });

  it("選了就往上回報 deviceId", async () => {
    stubDevices([
      { deviceId: "a", label: "內建鏡頭" },
      { deviceId: "b", label: "外接攝影機" },
    ]);
    const seen: CameraSelection[] = [];
    const m = mount(view((s) => seen.push(s)));
    await settle(m);
    const sel = m.container.querySelector<HTMLSelectElement>('[data-testid="call-camera-select"]')!;
    act(() => {
      sel.value = "b";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // 桌面回報的是 deviceId，**不是** facingMode——那是手機的概念。
    expect(seen).toEqual([{ deviceId: "b" }]);
  });

  it("列舉失敗不得炸掉通話視窗（只是不顯示選擇器）", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: { enumerateDevices: async () => { throw new Error("boom"); } },
    });
    const m = mount(view());
    await settle(m);
    expect(m.container.querySelector('[data-testid="call-window"]')).not.toBeNull();
    expect(m.container.querySelector('[data-testid="call-camera-select"]')).toBeNull();
  });
});
