import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import type { Group, Self } from "../backend/types.js";
import { ContactListWindow } from "./ContactListWindow.js";

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
