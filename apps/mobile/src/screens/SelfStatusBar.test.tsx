// 聊天清單頂部的「我」狀態列（ADR-0278）。
//
// 行動端過去把上線狀態與自訂狀態文字**只放在設定分頁**；這裡把它提到聊天頁頂部（比照桌面
// `DeckSidebar` 的 me 列）。互動在 renderToStaticMarkup 下不會執行，故此處鎖的是
// **渲染契約**：該出現的控制項在不在、以及狀態點會不會說謊。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STATUS_COLORS } from "@cinderous/theme";
import { ChatsListScreen } from "./ChatsListScreen.js";
import { SelfStatusBar } from "./SelfStatusBar.js";

/**
 * react-native-web 把顏色輸出成 `rgba(r,g,b,1.00)` 而非 hex，故斷言前先換算。
 * 從 `STATUS_COLORS` 換算而不是寫死字面值——調色盤改了測試要跟著動，才抓得到不一致。
 */
function rnw(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},1.00)`;
}

const base = {
  name: "小明",
  status: "online" as const,
  onStatus: () => {},
  statusMessage: "在忙",
  onStatusMessage: () => {},
};

describe("SelfStatusBar（ADR-0278）", () => {
  it("渲染名稱、三個狀態鈕與自訂狀態文字欄", () => {
    const html = renderToStaticMarkup(<SelfStatusBar {...base} locale="zh-Hant" />);
    expect(html).toContain("小明");
    expect(html).toContain('data-testid="status-online"');
    expect(html).toContain('data-testid="status-away"');
    expect(html).toContain('data-testid="status-busy"');
    expect(html).toContain('data-testid="self-status-message"');
    expect(html).toContain("在忙"); // 目前的自訂文字帶進輸入框
  });

  it("狀態點用對應顏色（線上＝綠）", () => {
    const html = renderToStaticMarkup(<SelfStatusBar {...base} status="busy" />);
    expect(html).toContain(rnw(STATUS_COLORS.busy));
  });

  it("🔴 隱身時狀態點畫成離線——否則畫面說「線上」但其實沒人看得到你（UI 說謊）", () => {
    const html = renderToStaticMarkup(<SelfStatusBar {...base} status="online" invisible locale="zh-Hant" />);
    expect(html).toContain(rnw(STATUS_COLORS.offline));
    expect(html).not.toContain(rnw(STATUS_COLORS.online));
  });

  it("無頭像 → 顯示名稱首字（大寫）", () => {
    const html = renderToStaticMarkup(<SelfStatusBar {...base} name="alice" />);
    expect(html).toContain(">A<");
  });
});

describe("ChatsListScreen 接上狀態列（ADR-0278）", () => {
  const listBase = { entries: [], onOpen: () => {} };

  it("提供 self → 聊天頁頂部出現狀態列", () => {
    const html = renderToStaticMarkup(<ChatsListScreen {...listBase} self={base} locale="zh-Hant" />);
    expect(html).toContain('data-testid="self-status-bar"');
    expect(html).toContain('data-testid="self-status-message"');
  });

  it("未提供 self（示範後端無 presence 可廣播）→ 不顯示狀態列", () => {
    const html = renderToStaticMarkup(<ChatsListScreen {...listBase} locale="zh-Hant" />);
    expect(html).not.toContain('data-testid="self-status-bar"');
  });
});
