import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Group, Self } from "@cinderous/engine";
import { I18nProvider } from "../i18n.js";
import { DeckSidebar, type DeckSidebarProps } from "./DeckSidebar.js";

const self: Self = { pubkey: "me", name: "我", status: "online", statusMessage: "" };
const groups: Group[] = [{ id: "g1", name: "工作", admin: "me", members: ["me", "p1"] }];

const render = (extra: Partial<DeckSidebarProps> = {}): string =>
  renderToStaticMarkup(
    <I18nProvider locale="zh-Hant">
      <DeckSidebar
        self={self}
        contacts={[{ pubkey: "p1", name: "Amy", status: "online", statusMessage: "", nowPlaying: "" }]}
        groups={groups}
        convos={{ p1: [{ id: "1", outgoing: false, text: "晚餐約週五", at: 100 }] }}
        prefs={{}}
        unread={{}}
        onOpen={() => {}}
        onStatus={() => {}}
        onStatusMessage={() => {}}
        onAddLabel={() => {}}
        onRemoveLabel={() => {}}
        labelOptions={[]}
        activeLabel={undefined}
        onFilterLabel={() => {}}
        {...extra}
      />
    </I18nProvider>,
  );

describe("DeckSidebar 三欄左側欄（ADR-0079 Q2）", () => {
  it("渲染搜尋框、聯絡人＋群組混合列與最後訊息預覽", () => {
    const html = render();
    expect(html).toContain('data-testid="sidebar-search"');
    expect(html).toContain('data-testid="sidebar-list"');
    expect(html).toContain("Amy"); // 聯絡人
    expect(html).toContain("工作"); // 群組
    expect(html).toContain("晚餐約週五"); // 最後訊息預覽
  });

  it("有標籤選項時渲染標籤篩選列（含『全部』）", () => {
    const html = render({ labelOptions: ["家人"] });
    expect(html).toContain('data-testid="sidebar-labelfilter"');
    expect(html).toContain("家人");
    expect(html).toMatch(/全部/);
  });

  it("可自訂狀態文字（ADR-0142）：頭像列有個人訊息輸入區；不再有設定齒輪（已移到上方 nav bar）", () => {
    const html = render();
    expect(html).toContain("me__msg"); // 個人狀態文字輸入（過去三欄版缺這個）
    expect(html).not.toContain("⚙"); // 設定齒輪已移出側欄
  });

  it("提供 onNowPlaying → 顯示『正在聽』輸入", () => {
    const html = render({ onNowPlaying: () => {} });
    expect(html).toContain("me__np");
  });

  it("自己的頭像可編輯（ADR-0154 補入口）：渲染 avatar-wrap＋可點擊角色與換圖提示", () => {
    const html = render({ onSelfAvatar: () => true });
    expect(html).toContain("avatar-wrap"); // EditableAvatar 外殼（過去是純顯示 <Avatar>）
    expect(html).toContain("avatar--edit");
    expect(html).toContain('data-testid="avatar-file"');
  });
});

describe("企業頭銜 chip（ADR-0158）", () => {
  it("聯絡人帶 title → 列上顯示 chip--role（與私標區隔、不可移除）", () => {
    const html = render({
      contacts: [{ pubkey: "p1", name: "Amy", status: "online", statusMessage: "", nowPlaying: "", title: "設計師" }],
    });
    expect(html).toContain('data-testid="sidebar-title-chip"');
    expect(html).toContain("chip--role");
    expect(html).toContain("設計師");
  });
});
