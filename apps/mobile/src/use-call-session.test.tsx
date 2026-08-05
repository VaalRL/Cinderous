// @vitest-environment jsdom
// 通話簇（ADR-0331）——抽成 hook 之後才測得到的東西：以前它散在 1800 行的元件裡。
import { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { useCallSession, type CallSession } from "./use-call-session.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 掛一個只用來取出 hook 回傳值的殼。 */
function hook(): { get: () => CallSession } {
  let latest: CallSession;
  function Probe(): null {
    latest = useCallSession();
    return null;
  }
  const el = document.createElement("div");
  act(() => createRoot(el).render(<Probe />));
  return { get: () => latest };
}

describe("通話簇（ADR-0331）", () => {
  it("初始是閒置", () => {
    const h = hook();
    expect(h.get().active).toBe(false);
    expect(h.get().peer).toBeNull();
  });

  it("來電（incoming）→ active，且記下對方", () => {
    const h = hook();
    act(() => h.get().handlers.onCallState?.("bob", "incoming", "audio"));
    expect(h.get().active).toBe(true);
    expect(h.get().peer).toBe("bob");
    expect(h.get().media).toBe("audio");
  });

  it("🔴 結束時必須連兩條串流一起放掉——只清狀態的話畫面沒了，麥克風/鏡頭燈還亮著", () => {
    const h = hook();
    const s = {} as MediaStream;
    act(() => {
      h.get().handlers.onCallState?.("bob", "active", "video");
      h.get().handlers.onCallLocalStream?.(s);
      h.get().handlers.onCallRemoteStream?.(s);
    });
    expect(h.get().localStream).toBe(s);

    act(() => h.get().handlers.onCallState?.("bob", "ended", "video"));
    expect(h.get().active).toBe(false);
    expect(h.get().peer).toBeNull();
    expect(h.get().localStream).toBeNull();
    expect(h.get().remoteStream).toBeNull();
  });

  it("`ended` 不算 active（通話結束的畫面由上層決定要不要留）", () => {
    const h = hook();
    act(() => h.get().handlers.onCallState?.("bob", "ended", "audio"));
    expect(h.get().active).toBe(false);
  });
});
