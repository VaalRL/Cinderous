import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import type { Contact, Group, Self, Status } from "@cinderous/engine";
import { ContactListWindow, groupByStatus, shortId } from "./ContactListWindow.js";

const self: Self = { pubkey: "aa", name: "我", status: "online", statusMessage: "" };
const groups: Group[] = [{ id: "g1", name: "工作群", admin: "aa", members: ["aa", "bb"] }];

const render = (extra: Record<string, unknown>) =>
  renderToStaticMarkup(
    // locale 釘死 zh-Hant：斷言用繁中字串，否則 CI（無 navigator.language → 預設英文）會不符。
    <I18nProvider locale="zh-Hant">
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

  it("統一列（ADR-0214）：聯絡人列以狀態圓點開頭、不再渲染頭像光暈", () => {
    const html = render({ contacts: [mk("Zed", "busy")] });
    expect(html).toContain("contact--row"); // 與三欄版共用的統一列
    expect(html).toContain("dot busy"); // 前導狀態圓點
    expect(html).not.toContain("ring-busy"); // 聯絡人頭像光暈已移除（self 為 online、不會有 ring-busy）
  });

  it("狀態訊息顯示在列上（ADR-0214 情境切換：無未讀 → 狀態訊息）", () => {
    const c: Contact = { pubkey: "x", name: "Amy", status: "online", statusMessage: "在忙", nowPlaying: "" };
    const html = render({ contacts: [c] });
    expect(html).toContain('data-testid="contact-sec"'); // 副線上列（不再只在 tooltip）
    expect(html).toContain("在忙");
    expect(html).toContain('data-sec="status"');
  });

  it("分享列顯示縮短 ID + 複製鈕（提供 onAddContact 時）", () => {
    const html = render({ onAddContact: () => {}, selfNpub: longId });
    expect(html).toContain('data-testid="copy-id"');
    expect(html).toContain("…");
  });
});

describe("訊息請求區（ADR-0121）", () => {
  const requests = [{ pubkey: "zz", name: "小明" }];

  it("沒有請求時**完全不顯示**（不要在空的時候佔版面）", () => {
    expect(render({})).not.toContain('data-testid="requests"');
  });

  it("顯示請求者、接受／刪除／封鎖三個動作", () => {
    const html = render({ requests, onAcceptRequest: () => {}, onDeclineRequest: () => {}, onBlockContact: () => {} });
    expect(html).toContain('data-testid="requests"');
    expect(html).toContain("小明");
    expect(html).toContain('data-testid="request-accept-zz"');
    expect(html).toContain('data-testid="request-decline-zz"');
    expect(html).toContain('data-testid="request-block-zz"');
  });

  it("**必須說清楚「接受前對方能做什麼」**——否則使用者無從判斷風險", () => {
    const html = render({ requests, onAcceptRequest: () => {} });
    // 這句話是這個功能的重點：他不在你的聯絡人裡 → 不通知、不能敲你、看不到你上線。
    expect(html).toContain("不會跳通知");
    expect(html).toContain("上線狀態");
  });

  it("請求者**不會**混進聯絡人名冊裡", () => {
    const html = render({ requests, contacts: [], onAcceptRequest: () => {} });
    // 名冊分組（線上/離線）不該出現他 → 他只在請求區出現一次。
    expect(html.split("小明")).toHaveLength(2);
  });
});

describe("訊息請求防洪：全部刪除（ADR-0127）", () => {
  const two = [{ pubkey: "z1", name: "甲" }, { pubkey: "z2", name: "乙" }];

  it("多於一筆請求時顯示「全部刪除」", () => {
    const html = render({ requests: two, onClearRequests: () => {}, onAcceptRequest: () => {} });
    expect(html).toContain('data-testid="requests-clear"');
  });

  it("只有一筆時不顯示（一鍵刪一筆用單項刪除即可）", () => {
    const html = render({ requests: [two[0]], onClearRequests: () => {}, onAcceptRequest: () => {} });
    expect(html).not.toContain('data-testid="requests-clear"');
  });

  it("未提供 onClearRequests（示範/唯讀）時不顯示", () => {
    const html = render({ requests: two, onAcceptRequest: () => {} });
    expect(html).not.toContain('data-testid="requests-clear"');
  });
});

describe("排序切換 ＋ 可收合標頭（ADR-0215）", () => {
  const mk = (name: string, status: Status): Contact => ({ pubkey: name, name, status, statusMessage: "", nowPlaying: "" });

  it("排序切換列：三模式（依狀態/分組/名稱），預設依狀態", () => {
    const html = render({ contacts: [mk("Amy", "online")] });
    expect(html).toContain('data-testid="sortbar"');
    expect(html).toContain('data-testid="sort-status"');
    expect(html).toContain('data-testid="sort-group"');
    expect(html).toContain('data-testid="sort-name"');
    expect(html).toContain("依狀態");
  });

  it("區塊標頭可收合：展開時顯示 ▾ 收合鈕", () => {
    const html = render({ contacts: [mk("Amy", "online")] });
    expect(html).toContain('data-testid="collapse-toggle"');
    expect(html).toContain("▾");
  });

  it("依分組模式：標籤分區＋「線上/總數」計數、未分組殿後", () => {
    const store: Record<string, string> = { "nb.contactSort": "group" };
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: () => {},
    };
    try {
      const html = render({
        contacts: [mk("Amy", "online"), mk("Bob", "offline")],
        contactLabels: { Amy: ["家人"] },
      });
      expect(html).toContain("家人");
      expect(html).toContain("家人（1/1）"); // Amy 線上/總數
      expect(html).toContain("未分組（0/1）"); // Bob 離線
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });
});
