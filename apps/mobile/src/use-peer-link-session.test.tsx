// @vitest-environment jsdom
// 與各聯絡人的 P2P 直連這一簇（ADR-0213／0344）。
//
// 重點在「同一條連線會收到多次 connected=true」——engine 先發 unknown、測出來再補一則
// （ADR-0344）。兩個 state 必須各自去重，否則每則都會牽動重繪。

import { act } from "react";
import { describe, expect, it } from "vitest";
import { usePeerLinkSession, type PeerLinkSession } from "./use-peer-link-session.js";
import { mount } from "./test/jsdom-mount.js";

const A = "a".repeat(64);
const B = "b".repeat(64);

/** 掛起 hook，回傳一個永遠指向最新值的讀取器。 */
function harness(): { read: () => PeerLinkSession } {
  let latest: PeerLinkSession | undefined;
  function Probe(): null {
    latest = usePeerLinkSession();
    return null;
  }
  mount(<Probe />);
  return { read: () => latest! };
}

describe("usePeerLinkSession（ADR-0213／0344）", () => {
  it("初始為空", () => {
    const { read } = harness();
    expect(read().connected.size).toBe(0);
    expect(read().paths).toEqual({});
  });

  it("連上先報 unknown，測出來再補 relay", () => {
    const { read } = harness();
    act(() => read().handlers.onPeerConnection!(A, true, "unknown"));
    expect(read().connected.has(A)).toBe(true);
    expect(read().paths[A]).toBe("unknown");

    act(() => read().handlers.onPeerConnection!(A, true, "relay"));
    expect(read().connected.has(A)).toBe(true);
    expect(read().paths[A]).toBe("relay");
  });

  it("斷線移除該聯絡人，且**不留過期的路徑判定**", () => {
    const { read } = harness();
    act(() => read().handlers.onPeerConnection!(A, true, "relay"));
    act(() => read().handlers.onPeerConnection!(A, false));
    expect(read().connected.has(A)).toBe(false);
    expect(A in read().paths).toBe(false);
  });

  it("未帶 path 的連線視為 unknown（相容只送兩個參數的呼叫端）", () => {
    const { read } = harness();
    act(() => read().handlers.onPeerConnection!(A, true));
    expect(read().paths[A]).toBe("unknown");
  });

  it("重複同值不換物件參照（避免每則事件都牽動重繪）", () => {
    const { read } = harness();
    act(() => read().handlers.onPeerConnection!(A, true, "direct"));
    const connected = read().connected;
    const paths = read().paths;
    act(() => read().handlers.onPeerConnection!(A, true, "direct"));
    expect(read().connected).toBe(connected);
    expect(read().paths).toBe(paths);
  });

  it("路徑改變只換 paths，connected 參照不動（兩個 state 各自去重）", () => {
    const { read } = harness();
    act(() => read().handlers.onPeerConnection!(A, true, "relay"));
    const connected = read().connected;
    act(() => read().handlers.onPeerConnection!(A, true, "direct"));
    expect(read().connected).toBe(connected); // 仍是同一組人
    expect(read().paths[A]).toBe("direct");
  });

  it("多位聯絡人互不干擾", () => {
    const { read } = harness();
    act(() => read().handlers.onPeerConnection!(A, true, "relay"));
    act(() => read().handlers.onPeerConnection!(B, true, "direct"));
    act(() => read().handlers.onPeerConnection!(A, false));
    expect(read().connected.has(B)).toBe(true);
    expect(read().paths).toEqual({ [B]: "direct" });
  });

  it("對未連線者報斷線＝no-op（不新增空項）", () => {
    const { read } = harness();
    const paths = read().paths;
    act(() => read().handlers.onPeerConnection!(A, false));
    expect(read().paths).toBe(paths);
  });
});
