// 底部分頁列徽章（ADR-0087／0286）。
//
// 這支測試起因於一個追問：「APK 版本可以正常接收到邀請嗎？」——收得到，也確實顯示在
// 聯絡人分頁，但**分頁列只有聊天分頁有徽章**。停在聊天分頁的人永遠不會發現有好友請求；
// 而在對方接受之前 ADR-0121 不回送個人檔，於是雙方名字都停在 `npub1abc…`。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BottomTabs } from "./BottomTabs.js";

const render = (extra: Partial<Parameters<typeof BottomTabs>[0]> = {}): string =>
  renderToStaticMarkup(<BottomTabs active="chats" onSelect={() => {}} locale="zh-Hant" {...extra} />);

describe("BottomTabs 徽章（ADR-0286）", () => {
  it("🔴 有待處理的好友請求 → **聯絡人分頁**出現徽章", () => {
    const html = render({ requestCount: 2 });
    expect(html).toContain('data-testid="tab-badge-contacts"');
    expect(html).toContain(">2<");
  });

  it("沒有請求 → 聯絡人分頁無徽章（不佔位、不誤導）", () => {
    expect(render()).not.toContain('data-testid="tab-badge-contacts"');
    expect(render({ requestCount: 0 })).not.toContain('data-testid="tab-badge-contacts"');
  });

  it("未讀徽章仍只掛聊天分頁——兩種計數不互相污染", () => {
    const html = render({ unreadTotal: 3, requestCount: 0 });
    expect(html).toContain('data-testid="tab-badge-chats"');
    expect(html).not.toContain('data-testid="tab-badge-contacts"');
  });

  it("兩種徽章可同時出現，各報各的數", () => {
    const html = render({ unreadTotal: 5, requestCount: 1 });
    expect(html).toContain('data-testid="tab-badge-chats"');
    expect(html).toContain('data-testid="tab-badge-contacts"');
    expect(html).toContain(">5<");
    expect(html).toContain(">1<");
  });

  it("超過 99 顯示 99+（徽章不被撐爆）", () => {
    expect(render({ requestCount: 150 })).toContain("99+");
  });

  it("設定分頁永遠沒有徽章", () => {
    expect(render({ unreadTotal: 9, requestCount: 9 })).not.toContain('data-testid="tab-badge-settings"');
  });
});
