// 行動端對話背景 UI（ADR-0134）：背景入口鈕、挑選面板、預設漸層套用到訊息區。
// 純資料/CSS 產生在 @cinder/theme 有測；這裡驗行動端接線（SSR 可斷言 testID 與 inline style）。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BG_PRESETS, presetCss } from "@cinder/theme";
import { ConversationScreen } from "./ConversationScreen.js";

const base = {
  name: "Bob",
  messages: [],
  onSend: () => {},
  onBack: () => {},
  locale: "zh-Hant" as const,
};

describe("行動端對話背景（ADR-0134）", () => {
  it("提供 onSetChatBg → 顯示背景入口鈕", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} onSetChatBg={() => {}} />);
    expect(html).toContain('data-testid="chatbg-btn"');
  });

  it("未提供 onSetChatBg（示範模式）→ 不顯示入口，也沒有面板", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} />);
    expect(html).not.toContain('data-testid="chatbg-btn"');
    expect(html).not.toContain('data-testid="chatbg-panel"');
  });

  it("已設 preset 背景 → 訊息區套上該漸層（backgroundImage inline style）", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} onSetChatBg={() => {}} chatBg={{ type: "preset", value: "sky" }} />,
    );
    // react-native-web 會把 backgroundImage 原樣送進 inline style。
    expect(html).toContain(presetCss("sky")!);
  });

  it("未設背景 → 訊息區不帶背景漸層", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} onSetChatBg={() => {}} />);
    expect(html).not.toContain("linear-gradient");
  });

  it("預設清單非空且每個都有 CSS（面板會逐一渲染）", () => {
    expect(BG_PRESETS.length).toBeGreaterThan(0);
    for (const p of BG_PRESETS) expect(presetCss(p.id)).toBe(p.css);
  });
});
