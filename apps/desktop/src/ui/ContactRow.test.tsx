import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { ContactRow, rowSecondary } from "./ContactRow.js";

describe("rowSecondary 情境切換副線（ADR-0214）", () => {
  it("有未讀 → 末則預覽優先（讓你看到待讀）", () => {
    expect(rowSecondary({ unread: 2, statusMessage: "在忙", nowPlaying: "歌", preview: "晚點傳你" }))
      .toEqual({ kind: "preview", text: "晚點傳你" });
  });

  it("有未讀但無預覽 → 退回 nowPlaying / 狀態", () => {
    expect(rowSecondary({ unread: 2, nowPlaying: "歌" })).toEqual({ kind: "nowplaying", text: "歌" });
    expect(rowSecondary({ unread: 2, statusMessage: "在忙" })).toEqual({ kind: "status", text: "在忙" });
  });

  it("無未讀 → 正在聽 > 狀態訊息", () => {
    expect(rowSecondary({ unread: 0, nowPlaying: "歌", statusMessage: "在忙", preview: "舊訊息" }))
      .toEqual({ kind: "nowplaying", text: "歌" });
    expect(rowSecondary({ unread: 0, statusMessage: "在忙", preview: "舊訊息" }))
      .toEqual({ kind: "status", text: "在忙" });
  });

  it("無未讀、無狀態、無正在聽 → 退回末則預覽（閒置仍有脈絡）", () => {
    expect(rowSecondary({ unread: 0, preview: "舊訊息" })).toEqual({ kind: "preview", text: "舊訊息" });
  });

  it("皆空 → none（留白）；空白字串視為無", () => {
    expect(rowSecondary({ unread: 0 })).toEqual({ kind: "none" });
    expect(rowSecondary({ unread: 0, statusMessage: "  ", nowPlaying: "", preview: "" })).toEqual({ kind: "none" });
  });
});

describe("ContactRow 統一列（ADR-0214）", () => {
  const render = (extra: Partial<Parameters<typeof ContactRow>[0]> = {}) =>
    renderToStaticMarkup(
      <I18nProvider locale="zh-Hant">
        <ContactRow id="p1" name="Amy" status="online" unread={0} hint="雙擊開對話" onOpen={() => {}} {...extra} />
      </I18nProvider>,
    );

  it("狀態訊息上列（不再只在 tooltip）", () => {
    const html = render({ statusMessage: "在開會" });
    expect(html).toContain('data-testid="contact-sec"');
    expect(html).toContain("在開會");
    expect(html).toContain('data-sec="status"');
  });

  it("有未讀 → 副線為末則預覽、右側未讀徽章", () => {
    const html = render({ unread: 3, statusMessage: "在開會", preview: "晚點傳你" });
    expect(html).toContain("晚點傳你");
    expect(html).not.toContain("在開會"); // 未讀時預覽優先
    expect(html).toContain("unread-badge");
  });

  it("正在聽 → ♪ 前綴", () => {
    const html = render({ nowPlaying: "Lo-fi" });
    expect(html).toContain('data-sec="nowplaying"');
    expect(html).toContain("♪");
    expect(html).toContain("Lo-fi");
  });

  it("操作鈕依提供的 handler 顯示（🧠僅有未讀、🚫🗑🏷）", () => {
    const html = render({ unread: 1, onSummarize: () => {}, onBlock: () => {}, onRemove: () => {}, onAddLabel: () => {} });
    expect(html).toContain('data-testid="summarize-btn"');
    expect(html).toContain('data-testid="contact-label-btn"');
    expect(html).toContain("🚫");
    expect(html).toContain("🗑");
  });

  it("無未讀時不顯示 🧠 摘要鈕", () => {
    expect(render({ unread: 0, onSummarize: () => {} })).not.toContain('data-testid="summarize-btn"');
  });

  it("企業頭銜顯示 chip--role", () => {
    const html = render({ title: "設計師" });
    expect(html).toContain('data-testid="contact-title-chip"');
    expect(html).toContain("設計師");
  });

  it("離線聯絡人帶 offline class", () => {
    expect(render({ status: "offline" })).toContain("offline");
  });
});
