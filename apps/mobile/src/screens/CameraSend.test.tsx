// 行動端拍照直接傳（ADR-0274）：📷 鈕的條件渲染。實際開相機／清 EXIF 由平台縫負責
// （`native/files.ts` 的 takePhoto → sanitizeImage，ADR-0273），列實機驗收。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationScreen } from "./ConversationScreen.js";

const base = {
  name: "Bob",
  messages: [],
  onSend: () => {},
  onBack: () => {},
  locale: "zh-Hant" as const,
};

describe("拍照直接傳（ADR-0274）", () => {
  it("提供 onSendPhoto → 顯示 📷 鈕", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} onSendPhoto={() => {}} />);
    expect(html).toContain('data-testid="send-photo"');
    expect(html).toContain("拍照傳送"); // aria-label
  });

  it("未提供（示範模式／後端不支援送檔）→ 不顯示", () => {
    expect(renderToStaticMarkup(<ConversationScreen {...base} />)).not.toContain('data-testid="send-photo"');
  });

  it("與 📎 並存：兩顆各自獨立設閘", () => {
    const both = renderToStaticMarkup(
      <ConversationScreen {...base} onSendFile={() => {}} onSendPhoto={() => {}} />,
    );
    expect(both).toContain('data-testid="send-photo"');
    expect(both).toContain("📎");
    // 只有選檔、沒有相機（例如日後某平台不支援相機）
    const fileOnly = renderToStaticMarkup(<ConversationScreen {...base} onSendFile={() => {}} />);
    expect(fileOnly).toContain("📎");
    expect(fileOnly).not.toContain('data-testid="send-photo"');
  });
});
