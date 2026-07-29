// 執行環境判斷（ADR-0279）：偵測邏輯從 foreground.ts 抽出共用，這裡鎖住它的語意。
import { afterEach, describe, expect, it } from "vitest";
import { capacitor, isNativeShell } from "./platform.js";

type CapShape = { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> };
function setCap(v: CapShape | undefined): void {
  if (v === undefined) delete (globalThis as { Capacitor?: CapShape }).Capacitor;
  else (globalThis as { Capacitor?: CapShape }).Capacitor = v;
}
afterEach(() => setCap(undefined));

describe("isNativeShell", () => {
  it("無 Capacitor 全域（瀏覽器預覽／桌面）＝false", () => {
    setCap(undefined);
    expect(isNativeShell()).toBe(false);
    expect(capacitor()).toBeUndefined();
  });

  it("Capacitor 在但 isNativePlatform 回 false（web 模式）＝false", () => {
    setCap({ isNativePlatform: () => false });
    expect(isNativeShell()).toBe(false);
  });

  it("Capacitor 原生殼＝true", () => {
    setCap({ isNativePlatform: () => true });
    expect(isNativeShell()).toBe(true);
  });

  it("形狀殘缺（有 Capacitor 但無 isNativePlatform）不丟例外，回 false", () => {
    setCap({});
    expect(isNativeShell()).toBe(false);
  });
});
