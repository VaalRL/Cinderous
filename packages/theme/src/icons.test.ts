// 圖示幾何（ADR-0095 狀態圖示／ADR-0282 動作圖示）：跨前端 SSOT，只驗**契約**——
// 各 App 直接把這些字串餵進 SVG path，格式壞掉會是畫面上一個看不出原因的空白。
import { describe, expect, it } from "vitest";
import { ACTION_ICONS, MSG_STATUS_ICONS } from "./icons.js";

const all = [...Object.entries(MSG_STATUS_ICONS), ...Object.entries(ACTION_ICONS)];

describe("圖示幾何契約", () => {
  it.each(all)("%s：viewBox 合法、至少一條路徑、線寬為正", (_name, icon) => {
    expect(icon.viewBox).toMatch(/^0 0 \d+ \d+$/);
    expect(icon.strokes.length).toBeGreaterThan(0);
    expect(icon.strokeWidth).toBeGreaterThan(0);
  });

  it.each(all)("%s：路徑以移動指令起頭（M/m），否則 SVG 畫不出來", (_name, icon) => {
    for (const d of icon.strokes) expect(d.trim()).toMatch(/^[Mm]/);
  });

  it("scanQr：四個取景角＋掃描線＝5 條路徑（ADR-0282）", () => {
    expect(ACTION_ICONS.scanQr.strokes).toHaveLength(5);
  });
});
