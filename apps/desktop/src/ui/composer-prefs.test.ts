import { beforeEach, describe, expect, it } from "vitest";
import { enterToSendEnabled, setEnterToSendEnabled } from "./composer-prefs.js";

// node 測試環境沒有 localStorage：給最小 stub（同 url-hygiene.test.ts）
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

describe("enterToSend 偏好（ADR-0308）", () => {
  it("未設定時預設為送出", () => {
    expect(enterToSendEnabled()).toBe(true);
  });

  it("關閉後讀回 false、再開回 true", () => {
    setEnterToSendEnabled(false);
    expect(enterToSendEnabled()).toBe(false);
    setEnterToSendEnabled(true);
    expect(enterToSendEnabled()).toBe(true);
  });

  it("儲存值不可解讀時退回預設（不因壞資料變成換行）", () => {
    localStorage.setItem("nb.composer.enterToSend", "亂寫");
    expect(enterToSendEnabled()).toBe(true);
  });
});
