// @vitest-environment jsdom
// 「我自己」簇（ADR-0331 第 5 簇）。
import { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { useSelfSession, type SelfSeed, type SelfSession } from "./use-self-session.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function hook(): { get: () => SelfSession } {
  let latest: SelfSession;
  function Probe(): null {
    latest = useSelfSession();
    return null;
  }
  const el = document.createElement("div");
  act(() => createRoot(el).render(<Probe />));
  return { get: () => latest };
}

const seed = (over: Partial<SelfSeed> = {}): SelfSeed => ({
  pubkey: "pk_a",
  name: "阿夜",
  npub: "npub1a",
  nsec: "nsec1a",
  ...over,
});

describe("「我自己」簇（ADR-0331）", () => {
  it("切身分：身分本體整組換掉", () => {
    const h = hook();
    act(() => h.get().reset(seed()));
    expect(h.get().name).toBe("阿夜");
    act(() => h.get().reset(seed({ pubkey: "pk_b", name: "小北", npub: "npub1b", nsec: "nsec1b" })));
    expect(h.get().pubkey).toBe("pk_b");
    expect(h.get().nsec).toBe("nsec1b");
  });

  it("本機記住的上次手動狀態隨身分帶入（ADR-0164）；沒有就用預設", () => {
    const h = hook();
    act(() => h.get().reset(seed({ status: "busy", statusMessage: "開會中" })));
    expect(h.get().status).toBe("busy");
    expect(h.get().statusMessage).toBe("開會中");
    act(() => h.get().reset(seed()));
    expect(h.get().status).toBe("online");
    expect(h.get().statusMessage).toBe("");
  });

  it("🔴 隱身每次登入統一重設；接管離職身分以 forceInvisible 覆寫（ADR-0180）", () => {
    const h = hook();
    act(() => h.get().setInvisible(true));
    act(() => h.get().reset(seed()));
    expect(h.get().invisible).toBe(false); // 不沿用上一個身分的隱身
    act(() => h.get().reset(seed({ invisible: true })));
    expect(h.get().invisible).toBe(true); // 接管＝建構即隱身
  });

  it("「正在聽」純易失，不跨身分（ADR-0142）", () => {
    const h = hook();
    act(() => h.get().setNowPlaying("某首歌"));
    act(() => h.get().reset(seed()));
    expect(h.get().nowPlaying).toBe("");
  });

  it("🔴 切身分＝重連：連線狀態回到「連線中」，不沿用上個身分的 online", () => {
    const h = hook();
    act(() => h.get().setConnection("online"));
    expect(h.get().connection).toBe("online");
    act(() => h.get().reset(seed()));
    expect(h.get().connection).toBe("connecting");
  });

  it("改名只動名稱，其餘不變（ADR-0138）", () => {
    const h = hook();
    act(() => h.get().reset(seed()));
    act(() => h.get().setName("夜"));
    expect(h.get().name).toBe("夜");
    expect(h.get().pubkey).toBe("pk_a");
    expect(h.get().nsec).toBe("nsec1a");
  });
});
