// 行動端貼圖（ADR-0137）：收到的貼圖渲染成圖（非原始標記字串）＋挑選入口。
// 貼圖的格式/解析/內建資料/SVG 驗證全在 @cinder/core（已測）；這裡驗行動端接線（SSR 可斷言）。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatCustomSticker, formatSticker } from "@cinder/core";
import type { ChatMessage } from "@cinder/engine";
import { ConversationScreen } from "./ConversationScreen.js";

const base = {
  name: "Bob",
  onSend: () => {},
  onBack: () => {},
  locale: "zh-Hant" as const,
};

const msg = (id: string, text: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  outgoing: false,
  text,
  at: 1,
  ...over,
});

describe("行動端貼圖渲染（ADR-0137）", () => {
  it("收到內建貼圖 → 渲染成圖，不顯示原始標記字串", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} messages={[msg("s1", formatSticker("buddy", "cat"))]} />,
    );
    expect(html).toContain('data-testid="sticker-s1"');
    expect(html).not.toContain("nb-sticker:v1"); // 不得洩漏原始標記
  });

  it("未知的內建貼圖（包/ID 不存在）→ 不當貼圖（回退為文字）", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} messages={[msg("s2", formatSticker("nope", "zzz"))]} />,
    );
    expect(html).not.toContain('data-testid="sticker-s2"');
  });

  it("收到合法自製貼圖（v2）→ 渲染成圖", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} messages={[msg("s3", formatCustomSticker({ label: "圈", svg }))]} />,
    );
    expect(html).toContain('data-testid="sticker-s3"');
  });

  it("🔴 惡意自製貼圖（含 <script>）→ 驗證不過，不渲染成貼圖（縱深防禦）", () => {
    const evil = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} messages={[msg("s4", formatCustomSticker({ label: "x", svg: evil }))]} />,
    );
    expect(html).not.toContain('data-testid="sticker-s4"');
  });

  it("已收回的貼圖訊息 → 不渲染貼圖（顯示為已收回）", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} messages={[msg("s5", formatSticker("buddy", "cat"))]} unsent={new Set(["s5"])} />,
    );
    expect(html).not.toContain('data-testid="sticker-s5"');
  });

  it("純文字訊息 → 不渲染成貼圖", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} messages={[msg("t1", "早安")]} />);
    expect(html).not.toContain('data-testid="sticker-t1"');
    expect(html).toContain("早安");
  });
});

describe("行動端貼圖挑選入口（ADR-0137）", () => {
  it("composer 有貼圖鈕；面板預設不展開", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} messages={[]} />);
    expect(html).toContain('data-testid="sticker-btn"');
    expect(html).not.toContain('data-testid="sticker-panel"');
  });
});
