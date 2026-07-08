import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import type { Contact, Group, Self, Status } from "../backend/types.js";
import { ContactListWindow, sortByStatus } from "./ContactListWindow.js";

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

describe("ContactListWindow — 依上線狀態排序 + 頂部狀態（MSN 風）", () => {
  const mk = (name: string, status: Status): Contact => ({ pubkey: name, name, status, statusMessage: "", nowPlaying: "" });

  it("sortByStatus：線上→離開→忙碌→離線，同狀態依名稱", () => {
    const sorted = sortByStatus([mk("Zoe", "busy"), mk("Amy", "online"), mk("Bob", "online"), mk("Cara", "away")]);
    expect(sorted.map((c) => c.name)).toEqual(["Amy", "Bob", "Cara", "Zoe"]);
  });

  it("sortByStatus 不改動輸入陣列", () => {
    const input = [mk("B", "busy"), mk("A", "online")];
    sortByStatus(input);
    expect(input.map((c) => c.name)).toEqual(["B", "A"]);
  });

  it("頂部渲染自己的狀態圓點（.dot online）", () => {
    expect(render({})).toContain("dot online");
  });

  it("線上清單依狀態排序渲染：online 早於 busy", () => {
    const html = render({ contacts: [mk("Zed", "busy"), mk("Ann", "online")] });
    expect(html.indexOf("Ann")).toBeLessThan(html.indexOf("Zed"));
  });
});
