/**
 * @vitest-environment jsdom
 *
 * UI 尺寸（ADR-0253）：瀏覽器路徑（CSS zoom）與偏好解析。jsdom 無 Tauri → isTauri()=false，
 * 正好走 CSS zoom 分支；Tauri 的 setZoom 路徑由實機驗收（原生 API 無法在測試環境模擬出價值）。
 */
import { beforeEach, describe, expect, it } from "vitest";
// 側效 import：安裝 localStorage shim（jsdom 環境未穩定暴露全域、node 實驗性 localStorage 會干擾——
// 見 jsdom-mount.ts 的說明；effect 類測試同一招）。
import "./test/jsdom-mount.js";
import { applyUiScale, cssZoomFactor, getUiScale, setUiScale, UI_SCALE_STEPS } from "./ui-scale.js";

beforeEach(() => {
  localStorage.clear();
  (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = "";
});

describe("UI 尺寸（ADR-0253）", () => {
  it("檔位契約：含 1（預設）、由小到大、90%–150%", () => {
    expect(UI_SCALE_STEPS).toContain(1);
    expect([...UI_SCALE_STEPS].sort((a, b) => a - b)).toEqual([...UI_SCALE_STEPS]);
    expect(UI_SCALE_STEPS[0]).toBe(0.9);
    expect(UI_SCALE_STEPS[UI_SCALE_STEPS.length - 1]).toBe(1.5);
  });

  it("getUiScale：未設/非法＝1；只認合法檔位", () => {
    expect(getUiScale()).toBe(1);
    localStorage.setItem("nb.uiScale", "1.15");
    expect(getUiScale()).toBe(1.15);
    localStorage.setItem("nb.uiScale", "3.7"); // 非檔位
    expect(getUiScale()).toBe(1);
    localStorage.setItem("nb.uiScale", "bogus");
    expect(getUiScale()).toBe(1);
  });

  it("瀏覽器路徑：套用＝根元素 CSS zoom；1＝清掉屬性完全無痕", async () => {
    await applyUiScale(1.3);
    expect((document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom).toBe("1.3");
    await applyUiScale(1);
    expect((document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom).toBe("");
  });

  it("setUiScale：落地＋套用；非法值回退 1", async () => {
    await setUiScale(1.5);
    expect(localStorage.getItem("nb.uiScale")).toBe("1.5");
    expect(getUiScale()).toBe(1.5);
    await setUiScale(999); // 非檔位 → 1（並清鍵）
    expect(localStorage.getItem("nb.uiScale")).toBeNull();
    expect(getUiScale()).toBe(1);
  });

  it("cssZoomFactor：瀏覽器＝目前檔位（拖曳數學校正用）", async () => {
    await setUiScale(1.3);
    expect(cssZoomFactor()).toBe(1.3);
    await setUiScale(1);
    expect(cssZoomFactor()).toBe(1);
  });
});
