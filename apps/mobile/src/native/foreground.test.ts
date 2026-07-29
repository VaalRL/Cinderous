// 背景保活平台縫（ADR-0272/0274）：非原生環境的守門與偏好解析。
// 真正的前台服務行為（行程存活、背景收訊）只能實機驗收——這裡鎖的是
// 「不在原生殼時絕不假裝連線受保護」這條契約。
import { beforeEach, describe, expect, it } from "vitest";
import {
  FOREGROUND_KEY,
  foregroundEnabled,
  foregroundSupported,
  setForegroundEnabled,
  startForeground,
  stopForeground,
} from "./foreground.js";

type CapShape = { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> };
const setCap = (v: CapShape | undefined): void => {
  (globalThis as { Capacitor?: CapShape }).Capacitor = v as CapShape;
};

// node 測試環境無 localStorage：裝一個 Map-backed shim（偏好解析要真的讀寫得到）。
if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

beforeEach(() => {
  setCap(undefined);
  localStorage.clear();
});

describe("foregroundSupported（ADR-0274）", () => {
  it("非 Capacitor（瀏覽器預覽／桌面）＝不支援", () => {
    expect(foregroundSupported()).toBe(false);
  });
  it("Capacitor 但外掛不在（如 iOS 未實作）＝不支援", () => {
    setCap({ isNativePlatform: () => true, Plugins: {} });
    expect(foregroundSupported()).toBe(false);
  });
  it("原生殼＋外掛在＝支援", () => {
    setCap({ isNativePlatform: () => true, Plugins: { Foreground: {} } });
    expect(foregroundSupported()).toBe(true);
  });
});

describe("啟停守門", () => {
  it("🔴 不支援時 start 回 false——**不假裝連線受保護**", async () => {
    expect(await startForeground("t", "x")).toBe(false);
    await expect(stopForeground()).resolves.toBeUndefined(); // 且不丟例外
  });

  it("外掛啟動失敗（如 Android 12+ 背景啟動限制）→ 回 false", async () => {
    setCap({
      isNativePlatform: () => true,
      Plugins: { Foreground: { start: async () => Promise.reject(new Error("denied")), stop: async () => {} } },
    });
    expect(await startForeground("t", "x")).toBe(false);
  });

  it("成功啟動 → true，且文案由呼叫端帶入（i18n 不落原生層）", async () => {
    let got: { title: string; text: string } | null = null;
    setCap({
      isNativePlatform: () => true,
      Plugins: {
        Foreground: {
          start: async (o: { title: string; text: string }) => {
            got = o;
          },
          stop: async () => {},
        },
      },
    });
    expect(await startForeground("Cinderous", "保持連線中")).toBe(true);
    expect(got).toEqual({ title: "Cinderous", text: "保持連線中" });
  });
});

describe("偏好（裝置層、Android 預設開）", () => {
  it("不支援的環境恆 false（設定不顯示此開關）", () => {
    expect(foregroundEnabled()).toBe(false);
  });

  it("原生殼：未設＝開（ADR-0272 的 Android 預設路徑）；關閉後才記 0", () => {
    setCap({ isNativePlatform: () => true, Plugins: { Foreground: {} } });
    expect(foregroundEnabled()).toBe(true);
    setForegroundEnabled(false);
    expect(localStorage.getItem(FOREGROUND_KEY)).toBe("0");
    expect(foregroundEnabled()).toBe(false);
    setForegroundEnabled(true);
    expect(localStorage.getItem(FOREGROUND_KEY)).toBeNull(); // 回到「未設＝開」
    expect(foregroundEnabled()).toBe(true);
  });
});
