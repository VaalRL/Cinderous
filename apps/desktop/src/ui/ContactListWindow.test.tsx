import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import type { Contact, Group, Self, Status } from "@cinder/engine";
import { ContactListWindow, groupByStatus, shortId } from "./ContactListWindow.js";

const self: Self = { pubkey: "aa", name: "我", status: "online", statusMessage: "" };
const groups: Group[] = [{ id: "g1", name: "工作群", admin: "aa", members: ["aa", "bb"] }];

const render = (extra: Record<string, unknown>) =>
  renderToStaticMarkup(
    <I18nProvider>
      <ThemeProvider>
      <ContactListWindow
        self={self}
        contacts={[]}
        onOpen={() => {}}
        onStatus={() => {}}
        onStatusMessage={() => {}}
        groups={groups}
        onCreateGroup={() => {}}
        onOpenGroup={() => {}}
        {...extra}
      />
      </ThemeProvider>
    </I18nProvider>,
  );

describe("ContactListWindow 群組標籤 UI（ADR-0040）", () => {
  it("渲染群組既有標籤為 chip、附加標籤鈕", () => {
    const html = render({
      groupLabels: { g1: ["家人", "重要"] },
      onAddGroupLabel: () => {},
      onRemoveGroupLabel: () => {},
    });
    expect(html).toContain("家人");
    expect(html).toContain("重要");
    expect(html).toContain('data-testid="add-label"');
  });

  it("有標籤選項時渲染過濾列（含『全部』）", () => {
    const html = render({ labelOptions: ["家人"], onFilterLabel: () => {} });
    expect(html).toContain('data-testid="label-filter"');
    expect(html).toMatch(/全部|All/);
  });

  it("提供置頂 handler 時渲染置頂鈕；置頂群組顯示圖示", () => {
    const html = render({ groupPinned: { g1: true }, onToggleGroupPin: () => {} });
    expect(html).toContain('data-testid="pin-group"');
    expect(html).toContain("pin-ic");
  });

  it("未提供標籤相關 props 時不渲染過濾列與附加鈕", () => {
    const html = render({});
    expect(html).not.toContain('data-testid="label-filter"');
    expect(html).not.toContain('data-testid="add-label"');
  });
});

describe("ContactListWindow — 狀態分區 + 頂部狀態 + 分享（MSN 風）", () => {
  const mk = (name: string, status: Status): Contact => ({ pubkey: name, name, status, statusMessage: "", nowPlaying: "" });
  const longId = "npub1qqqqqqqqqqqqqqqqqqqqqqqqqqwxyz@wss://r";

  it("groupByStatus：分區順序 線上→離開→忙碌→離線，每區依名稱、跳過空區", () => {
    const secs = groupByStatus([mk("Zoe", "busy"), mk("Amy", "online"), mk("Bob", "online"), mk("Cara", "away")]);
    expect(secs.map((s) => s.status)).toEqual(["online", "away", "busy"]); // 無 offline → 跳過
    expect(secs[0]!.contacts.map((c) => c.name)).toEqual(["Amy", "Bob"]);
  });

  it("groupByStatus 不改動輸入陣列", () => {
    const input = [mk("B", "busy"), mk("A", "online")];
    groupByStatus(input);
    expect(input.map((c) => c.name)).toEqual(["B", "A"]);
  });

  it("shortId：長 npub 中間省略、帶 @relay 只取 npub 段、短字串原樣", () => {
    expect(shortId(longId)).toContain("…");
    expect(shortId(longId)).not.toContain("@");
    expect(shortId("short")).toBe("short");
  });

  it("頂部狀態選單渲染目前狀態圓點（.dot online）", () => {
    expect(render({})).toContain("dot online");
  });

  it("狀態分區渲染：online 區早於 busy 區", () => {
    const html = render({ contacts: [mk("Zed", "busy"), mk("Ann", "online")] });
    expect(html.indexOf("Ann")).toBeLessThan(html.indexOf("Zed"));
  });

  it("精簡單行清單：聯絡人列以狀態圓點開頭、不再渲染頭像光暈（UI 改善）", () => {
    const html = render({ contacts: [mk("Zed", "busy")] });
    expect(html).toContain("contact--compact"); // 精簡列
    expect(html).toContain("dot busy"); // 前導狀態圓點
    expect(html).not.toContain("ring-busy"); // 聯絡人頭像光暈已移除（self 為 online、不會有 ring-busy）
  });

  it("精簡單行：狀態訊息移入 title、不再佔用第二行", () => {
    const c: Contact = { pubkey: "x", name: "Amy", status: "online", statusMessage: "在忙", nowPlaying: "" };
    const html = render({ contacts: [c] });
    expect(html).toContain('title="在忙"'); // 次要狀態改以 title 呈現
  });

  it("分享列顯示縮短 ID + 複製鈕（提供 onAddContact 時）", () => {
    const html = render({ onAddContact: () => {}, selfNpub: longId });
    expect(html).toContain('data-testid="copy-id"');
    expect(html).toContain("…");
  });
});
