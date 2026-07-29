// 對話畫面的版面契約（ADR-0287）。
//
// 起因是實機回報：「對話開啟後仍然有左右超過螢幕寬度的問題，要往右滑才能看到送出按鈕。」
//
// 算給後人看：輸入列最多擠 5 顆圖示（📎📷🗄😊⏱ 各約 34px＝170）＋間距（6×8＝48）
// ＋內距（16）＋送出鈕（約 60）＋輸入框。而輸入框是 HTML `<input>`，**有約 173px 的
// 內建寬度且 `min-width: auto` 讓它拒絕收縮** → 合計約 467px，超過 360–412px 的手機。
//
// react-native-web 把版面樣式編成 class（`r-flexWrap-…`），hash 是它的內部實作。
// 所以這裡用**探針元素**取得同一個樣式對應的 class 再比對——不綁死 hash，
// RNW 升版也不會假性失敗。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StyleSheet, View } from "react-native-web";
import { ConversationScreen } from "./ConversationScreen.js";

/** 取「某個樣式」在 RNW 下對應的 class 名（探針法）。 */
function classFor(style: Record<string, unknown>): string {
  const probe = StyleSheet.create({ x: style });
  const html = renderToStaticMarkup(<View style={probe.x} />);
  const m = /class="([^"]*)"/.exec(html);
  const cls = (m?.[1] ?? "").split(/\s+/).find((c) => c.startsWith("r-"));
  if (!cls) throw new Error(`探針取不到 class：${JSON.stringify(style)}`);
  return cls;
}

const base = {
  name: "小明",
  messages: [],
  draft: "",
  onDraftChange: () => {},
  onSend: () => {},
  onBack: () => {},
};

const render = (extra: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(<ConversationScreen {...base} locale="zh-Hant" {...extra} />);

/**
 * 取某個 testID 元素的 class 清單。**斷言必須指名道姓**——`flexWrap: "wrap"` 在這個畫面
 * 另有 6 處使用（貼圖格、附件分頁、日期 chip…），掃整份 HTML 會誤判成通過。
 */
function classesOf(html: string, testId: string): string {
  const i = html.indexOf(`data-testid="${testId}"`);
  if (i < 0) return "";
  const tagStart = html.lastIndexOf("<", i);
  return /class="([^"]*)"/.exec(html.slice(tagStart, i))?.[1] ?? "";
}

describe("輸入列不得橫向溢出（ADR-0287）", () => {
  it("🔴 輸入列可折行——單列塞不下 5 顆圖示＋輸入框＋送出鈕", () => {
    expect(classesOf(render(), "composer")).toContain(classFor({ flexWrap: "wrap" }));
  });

  it("🔴 輸入框有明確最小寬度——`<input>` 的 min-width:auto 會拒絕收縮，那正是溢出的真兇", () => {
    expect(classesOf(render(), "composer-input")).toContain(classFor({ minWidth: 160 }));
  });

  it("🔴 送出鈕永不收縮——被擠掉的話這個畫面就沒有主要動作了", () => {
    expect(classesOf(render(), "composer-send")).toContain(classFor({ flexShrink: 0 }));
  });

  it("圖示齊聚時（檔案／相機／儲存槽／限時）仍維持上述三項", () => {
    const html = render({ onSendFile: () => {}, onSendPhoto: () => {}, onDepositSlot: () => {} });
    expect(classesOf(html, "composer")).toContain(classFor({ flexWrap: "wrap" }));
    expect(classesOf(html, "composer-input")).toContain(classFor({ minWidth: 160 }));
    expect(classesOf(html, "composer-send")).toContain(classFor({ flexShrink: 0 }));
    // 五顆圖示都在（折行後仍可見，不是被藏起來）
    expect(html).toContain('data-testid="send-photo"');
    expect(html).toContain('data-testid="deposit-slot"');
    expect(html).toContain('data-testid="sticker-btn"');
    expect(html).toContain('data-testid="burn-toggle"');
  });
});
