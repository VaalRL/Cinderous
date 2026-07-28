// 對話內搜尋純邏輯（ADR-0256）。
import { describe, expect, it } from "vitest";
import { appendAssetManifest } from "@cinderous/core";
import type { ChatMessage } from "@cinderous/engine";
import { searchChannel, stepHit } from "./msg-search.js";

const msg = (id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, text, outgoing: false, at: 1, ...extra }) as ChatMessage;

describe("searchChannel（ADR-0256）", () => {
  const channel = [msg("a", "午餐吃什麼"), msg("b", "晚餐約週五"), msg("c", "OK 週五見")];

  it("大小寫不敏感、依時間序回傳命中索引", () => {
    expect(searchChannel(channel, "週五")).toEqual([
      { id: "b", index: 1 },
      { id: "c", index: 2 },
    ]);
    expect(searchChannel(channel, "ok")).toEqual([{ id: "c", index: 2 }]);
  });

  it("空查詢/純空白＝無命中；查無＝空陣列", () => {
    expect(searchChannel(channel, "")).toEqual([]);
    expect(searchChannel(channel, "   ")).toEqual([]);
    expect(searchChannel(channel, "沒有這個詞")).toEqual([]);
  });

  it("已收回/已過期不參與（畫面顯示的是占位文字）", () => {
    expect(searchChannel(channel, "週五", { unsent: new Set(["b"]) })).toEqual([{ id: "c", index: 2 }]);
    expect(searchChannel(channel, "週五", { expired: new Set(["b", "c"]) })).toEqual([]);
  });

  it("檔案訊息比對檔名；行內資產 manifest 不被搜到（只搜可見文字）", () => {
    const withFile = [msg("f", "", { file: { name: "報價單.pdf", mime: "application/pdf", size: 1 } as NonNullable<ChatMessage["file"]> })];
    expect(searchChannel(withFile, "報價")).toEqual([{ id: "f", index: 0 }]);
    expect(searchChannel(withFile, "pdf")).toEqual([{ id: "f", index: 0 }]);
    // manifest（nb-assets:v1 尾行）內的 label/SVG 不可命中——只搜剝離後的可見文字（ADR-0220）
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#ffd84d"/></svg>';
    const withAsset = [msg("m", appendAssetManifest("哈囉 :party:", { party: { label: "獨特標籤詞", svg } }))];
    expect(searchChannel(withAsset, "哈囉").length).toBe(1);
    expect(searchChannel(withAsset, "獨特標籤詞")).toEqual([]); // manifest 內容不參與
    expect(searchChannel(withAsset, "ffd84d")).toEqual([]); // SVG 內容不參與
  });
});

describe("stepHit（環繞巡覽）", () => {
  it("往舊/往新環繞；total=0 回 0", () => {
    expect(stepHit(0, 3, -1)).toBe(2); // 最舊再往舊 → 繞到最新
    expect(stepHit(2, 3, 1)).toBe(0);
    expect(stepHit(1, 3, -1)).toBe(0);
    expect(stepHit(0, 0, 1)).toBe(0);
  });
});
