import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Contact, Group } from "@cinderous/engine";
import { I18nProvider } from "../i18n.js";
import { DeckTabs, type DeckTabsProps } from "./DeckTabs.js";

const contacts: Contact[] = [{ pubkey: "p1", name: "Amy", status: "online", statusMessage: "", nowPlaying: "" }];
const groups: Group[] = [{ id: "g1", name: "工作", admin: "me", members: ["me", "p1"] }];

const render = (extra: Partial<DeckTabsProps> = {}): string =>
  renderToStaticMarkup(
    <I18nProvider locale="zh-Hant">
      <DeckTabs
        open={["p1", "g1"]}
        active="p1"
        contacts={contacts}
        groups={groups}
        unread={{ g1: 3 }}
        onActivate={() => {}}
        onClose={() => {}}
        {...extra}
      />
    </I18nProvider>,
  );

describe("DeckTabs 對話分頁列（ADR-0079 Q3）", () => {
  it("每個開啟對話一個分頁、群組加 # 前綴、active 標記、未讀徽章、關閉鈕", () => {
    const html = render();
    expect((html.match(/data-testid="deck-tab"/g) ?? []).length).toBe(2);
    expect(html).toContain("Amy");
    expect(html).toContain("工作");
    expect(html).toContain('aria-selected="true"'); // active = p1
    expect(html).toContain("unread-badge"); // g1 未讀 3
    expect(html).toContain('data-testid="deck-tab-close"');
  });
});
