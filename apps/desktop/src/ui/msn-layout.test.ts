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
