import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Contact, Group, Self } from "@cinder/engine";
import { I18nProvider } from "../i18n.js";
import { DeckRight, type DeckRightProps } from "./DeckRight.js";

const self: Self = { pubkey: "me", name: "我", status: "online", statusMessage: "" };
const contacts: Contact[] = [{ pubkey: "p1", name: "Amy", status: "online", statusMessage: "在忙", nowPlaying: "" }];
const groups: Group[] = [{ id: "g1", name: "工作", admin: "me", members: ["me", "p1"] }];

const render = (extra: Partial<DeckRightProps> = {}): string =>
  renderToStaticMarkup(
    <I18nProvider locale="zh-Hant">
      <DeckRight activeId="p1" self={self} contacts={contacts} groups={groups} convos={{}} {...extra} />
    </I18nProvider>,
  );

describe("DeckRight 右側輔助區（ADR-0079 Q4）", () => {
  it("無 active 對話：顯示提示、不渲染分頁", () => {
    const html = render({ activeId: null });
    expect(html).not.toContain('data-testid="aux-tab-info"');
    expect(html).toContain("開啟一個對話"); // aux_pickChat
  });

  it("有 active：Threads／Members／Media／計算／Info 分頁齊備，預設資訊分頁顯示名稱", () => {
    const html = render();
    expect(html).toContain('data-testid="aux-tab-threads"');
    expect(html).toContain('data-testid="aux-tab-members"');
    expect(html).toContain('data-testid="aux-tab-media"');
    expect(html).toContain('data-testid="aux-tab-calc"'); // ADR-0097 計算機分頁
    expect(html).toContain('data-testid="aux-tab-info"');
    expect(html).toContain("Amy"); // 預設資訊分頁
  });
});

describe("右欄計算機分頁（ADR-0097）", () => {
  it("提供計算分頁入口；計算機是獨立輸入框，不接管主對話框草稿", () => {
    const html = render();
    expect(html).toContain('data-testid="aux-tab-calc"');
    // 預設分頁為 info，故計算面板此時不渲染（分頁切換為互動行為，求值邏輯由 core/calc.test 把關）。
    expect(html).not.toContain('data-testid="aux-calc-input"');
  });
});
