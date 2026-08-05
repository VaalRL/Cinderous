// @vitest-environment jsdom
// 身分層開關簇（ADR-0331 第 3 簇）。
import { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { useIdentitySettings, type IdentitySettings, type IdentitySettingsSeed } from "./use-identity-settings.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function hook(): { get: () => IdentitySettings } {
  let latest: IdentitySettings;
  function Probe(): null {
    latest = useIdentitySettings();
    return null;
  }
  const el = document.createElement("div");
  act(() => createRoot(el).render(<Probe />));
  return { get: () => latest };
}

const seed = (over: Partial<IdentitySettingsSeed> = {}): IdentitySettingsSeed => ({
  fsEnabled: false,
  fsFailures: { count: 0, lastAt: 0 },
  groupInviteAnyone: false,
  devices: [],
  cloudSync: "off",
  ...over,
});

describe("身分層開關簇（ADR-0331）", () => {
  it("預設全關（新身分的安全側預設）", () => {
    const h = hook();
    expect(h.get().fsEnabled).toBe(false);
    expect(h.get().cloudSync).toBe("off");
    expect(h.get().devices).toEqual([]);
  });

  it("🔴 切身分是**重讀**不是歸零——開過 FS 的身分切回來必須顯示已啟用", () => {
    const h = hook();
    act(() => h.get().reset(seed({ fsEnabled: true, cloudSync: "full" })));
    expect(h.get().fsEnabled).toBe(true);
    expect(h.get().cloudSync).toBe("full");

    act(() => h.get().reset(seed())); // 切到沒開過的身分
    expect(h.get().fsEnabled).toBe(false);
    expect(h.get().cloudSync).toBe("off");

    act(() => h.get().reset(seed({ fsEnabled: true, cloudSync: "full" }))); // 再切回來
    expect(h.get().fsEnabled).toBe(true);
    expect(h.get().cloudSync).toBe("full");
  });

  it("🔴 解封失敗計數不得跨身分——EK 屬於身分，計數也是（ADR-0316）", () => {
    const h = hook();
    act(() => h.get().setFsFailures({ count: 7, lastAt: 123 }));
    expect(h.get().fsFailures.count).toBe(7);
    act(() => h.get().reset(seed()));
    expect(h.get().fsFailures).toEqual({ count: 0, lastAt: 0 });
  });

  it("🔴 裝置清單不得跨身分——否則工作身分會看到個人身分的裝置（ADR-0321）", () => {
    const h = hook();
    act(() => h.get().setDevices([{ id: "aa", firstSeen: 1, source: "local" }]));
    expect(h.get().devices).toHaveLength(1);
    act(() => h.get().reset(seed()));
    expect(h.get().devices).toEqual([]);
  });

  it("入群邀請閘門隨身分重讀（ADR-0317：每個身分各自的隱私決定）", () => {
    const h = hook();
    act(() => h.get().reset(seed({ groupInviteAnyone: true })));
    expect(h.get().groupInviteAnyone).toBe(true);
    act(() => h.get().reset(seed({ groupInviteAnyone: false })));
    expect(h.get().groupInviteAnyone).toBe(false);
  });

  it("互動改動即時反映（設定頁切開關）", () => {
    const h = hook();
    act(() => h.get().setFsEnabled(true));
    expect(h.get().fsEnabled).toBe(true);
    act(() => h.get().setCloudSync("basic"));
    expect(h.get().cloudSync).toBe("basic");
  });
});
