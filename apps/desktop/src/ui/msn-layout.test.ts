// 佈局 CSS 回歸鎖：內嵌對話撐滿中欄的覆寫必須贏過後段的基礎規則。
//
// 事故記錄：`.convo--embed`／`.convo-dock--embed` 覆寫寫在檔案前段，與後段的
// `.convo { height: 460px }`／`.convo-dock { align-items: flex-start }` 同 specificity
// ——同分比源碼順序＝基礎贏，內嵌對話被釘在 460px、中欄下方露出一大塊背景
// （ADR-0079 Q3「填滿中欄」被反殺）。修法＝疊 class 提高 specificity；這裡鎖住選擇器
// 寫法，防止日後被「簡化」回單 class 而無聲回歸。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./msn.css", import.meta.url), "utf8");

describe("內嵌對話撐滿中欄（ADR-0079 Q3 回歸鎖）", () => {
  it("embed 覆寫必須用疊 class 選擇器（否則被後段基礎規則以源碼順序反殺）", () => {
    expect(css).toContain(".convo.convo--embed");
    expect(css).toContain(".convo-dock.convo-dock--embed");
    // 基礎規則仍在（鎖的前提）：若日後基礎改寫/搬動，此測試提醒重新檢視優先序。
    expect(css).toMatch(/\.convo \{[^}]*height: 460px/);
    expect(css).toMatch(/\.convo-dock \{[^}]*align-items: flex-start/);
  });
});

describe("右欄分頁樣式（ADR-0270 回歸鎖）", () => {
  const tabBlock = css.slice(css.indexOf(".daux__tab {"), css.indexOf(".daux__count"));
  const onBlock = css.slice(css.indexOf(".daux__tab.on {"), css.indexOf(".daux__tab.on {") + 80);
  it("固定高度＋不換行（切換分頁高度一致）", () => {
    expect(tabBlock).toMatch(/height: 34px/);
    expect(tabBlock).toContain("white-space: nowrap");
  });
  it("選中不用粗體、不用底線指示器（避免 reflow 跳高與 AI 風底線）", () => {
    expect(tabBlock).not.toContain("font-weight"); // 基礎與選中都不變字重
    expect(onBlock).not.toContain("font-weight");
    expect(onBlock).not.toContain("border-bottom"); // 選中改填底、非底線
    expect(onBlock).toContain("background: var(--surface2)"); // 填底標示
  });
});
