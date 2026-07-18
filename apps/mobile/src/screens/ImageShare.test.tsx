// 行動端圖片分享入口（ADR-0132）：分享鈕在長按選單裡（手機沒有 hover，長按＝右鍵）。
// 長按的觸發（responder＋timer）在 SSR 測不到，但**「圖片訊息即使沒有回應/收回也要能被長按」**
// 這條新邏輯（canAct 納入 canShareImg）看得到——它決定氣泡有沒有 role="button" 的可操作性。
// 分享行為本身（navigator.share／退回下載）已在 native/share.test.ts 驗過。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@cinderous/engine";
import { ConversationScreen } from "./ConversationScreen.js";

const base = {
  name: "Bob",
  onSend: () => {},
  onBack: () => {},
  locale: "zh-Hant" as const,
};

const imageMsg: ChatMessage = {
  id: "img1",
  outgoing: false,
  text: "",
  at: 1,
  file: { id: "f1", name: "cat.png", mime: "image/png", size: 3, sent: 3, incoming: true, thumb: "data:image/png;base64,AA" },
};

const textMsg: ChatMessage = { id: "txt1", outgoing: false, text: "hi", at: 1 };

/** 抓某 testID 氣泡那顆元素的整段開標籤，用來看它有沒有 role="button"。 */
function bubbleTag(html: string, id: string): string {
  const at = html.indexOf(`data-testid="bubble-${id}"`);
  if (at < 0) return "";
  const start = html.lastIndexOf("<", at);
  return html.slice(start, html.indexOf(">", at) + 1);
}

describe("行動端圖片分享入口（ADR-0132）", () => {
  it("收到的圖片訊息——即使沒有 onReact／onUnsend——氣泡仍可長按（role=button）", () => {
    // 沒有 onReact、沒有 onUnsend：唯一讓它可操作的就是「它是可分享的圖片」。
    const html = renderToStaticMarkup(<ConversationScreen {...base} messages={[imageMsg]} />);
    expect(bubbleTag(html, "img1")).toContain('role="button"');
  });

  // 註：自 ADR-0136 起「任何未收回訊息都可長按（至少能回覆）」，故 role=button 不再等於「可分享」
  // ——分享按鈕的專屬性改由長按選單裡的 share-<id> testID 表達（需互動，見 Reply/Mention 的取捨）。
  it("純文字訊息仍可長按（ADR-0136 起：至少能回覆）", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} messages={[textMsg]} />);
    expect(bubbleTag(html, "txt1")).toContain('role="button"');
  });

  it("已收回的訊息完全不可長按（收回後不得有任何操作——含分享、回覆）", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} messages={[imageMsg]} unsent={new Set(["img1"])} />,
    );
    expect(bubbleTag(html, "img1")).not.toContain('role="button"');
  });
});
