import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Contact, Group, Self } from "@cinderous/engine";
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

  it("有 active：Threads／Members／Media／便條／Info 分頁齊備，預設資訊分頁顯示名稱", () => {
    const html = render();
    expect(html).toContain('data-testid="aux-tab-threads"');
    expect(html).toContain('data-testid="aux-tab-members"');
    expect(html).toContain('data-testid="aux-tab-media"');
    expect(html).toContain('data-testid="aux-tab-note"'); // ADR-0182 便條分頁（計算是其功能之一）
    expect(html).toContain('data-testid="aux-tab-info"');
    expect(html).toContain("便條"); // 分頁標籤
    expect(html).toContain("Amy"); // 預設資訊分頁
  });
});

describe("右欄不洩漏已收回內容（審查修正，ADR-0234 後補）", () => {
  it("unsent／purged 訊息自衍生資料剔除：串回覆數歸零、分頁計數不含它們", () => {
    const convos = {
      p1: [
        { id: "root", outgoing: false, text: "根訊息", at: 1 },
        { id: "r1", outgoing: false, text: "串回覆", at: 2, replyTo: "root" },
      ],
    };
    const threadCount1 = '對話串<span class="daux__count">1</span>';
    // 未過濾：threads 分頁計數 1
    expect(render({ convos })).toContain(threadCount1);
    // 串回覆被無痕收回 → 回覆數歸零
    const purgedHtml = render({ convos, purged: new Set(["r1"]) });
    expect(purgedHtml).not.toContain(threadCount1);
    // 一般收回（佔位）同樣不列入右欄衍生資料
    const unsentHtml = render({ convos, unsent: new Set(["r1"]) });
    expect(unsentHtml).not.toContain(threadCount1);
  });
});

describe("右欄便條分頁（ADR-0182，計算為其功能之一）", () => {
  it("提供便條分頁入口；便條是獨立輸入框，不接管主對話框草稿", () => {
    const html = render();
    expect(html).toContain('data-testid="aux-tab-note"');
    // 預設分頁為 info，故便條面板此時不渲染（分頁切換為互動行為，計算求值由 core/calc.test 把關）。
    expect(html).not.toContain('data-testid="aux-note-input"');
    expect(html).not.toContain('data-testid="aux-tab-calc"'); // 舊「計算」分頁已改名為便條
  });
});
