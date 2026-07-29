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

  it("吉祥物在 me 列（ADR-0247 延伸）：與經典版對齊；有未讀＝alert 狀態", () => {
    const idle = render({});
    expect(idle).toContain("me__mascot");
    expect(idle).toContain('aria-label="Cinderous"'); // 無未讀＝待機
    const alerted = render({ unread: { p1: 2 } });
    expect(alerted).toContain('aria-label="Cinderous（有新訊息）"'); // 未讀＝alert
  });

  it("♪ 自動偵測切換（ADR-0252）：有 onToggleNpAuto 才是按鈕；開啟＝高亮＋偵測顯示取代輸入框", () => {
    // 無 onToggleNpAuto（瀏覽器）：♪ 是純圖示、無切換鈕
    expect(render({ onNowPlaying: () => {} })).not.toContain('data-testid="np-auto-toggle"');
    // 有（Tauri）、未開啟：按鈕 aria-pressed=false、仍是手動輸入框
    const off = render({ onNowPlaying: () => {}, onToggleNpAuto: () => {} });
    expect(off).toContain('data-testid="np-auto-toggle"');
    expect(off).toContain('aria-pressed="false"');
    expect(off).not.toContain('data-testid="np-auto-live"');
    // 開啟＋有偵測值：高亮、live 顯示曲目、輸入框退場
    const on = render({ onNowPlaying: () => {}, onToggleNpAuto: () => {}, npAuto: true, npAutoText: "某歌手 — 某首歌" });
    expect(on).toContain("me__np-auto--on");
    expect(on).toContain("某歌手 — 某首歌");
    expect(on).not.toContain("nowPlaying_placeholder"); // 不是 i18n 鍵漏翻
    // 開啟但沒偵測到：顯示「偵測中」佔位
    expect(render({ onNowPlaying: () => {}, onToggleNpAuto: () => {}, npAuto: true })).toContain("偵測中");
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
    expect(html).toContain('data-testid="contact-title-chip"'); // ADR-0214：改用共用 ContactRow 的 chip
    expect(html).toContain("chip--role");
    expect(html).toContain("設計師");
  });
});

// ADR-0285：三欄版**完全沒有請求區**——`App.tsx` 只把 `addContactProps` 傳進來，
// 帶著 `requests` 的 `manageProps` 只給了經典版。結果是「對方把你加為好友，
// 你在三欄佈局下看不到任何東西」，於是永遠不會接受，雙方名稱都停在 `npub1abc…`。
describe("訊息請求區（ADR-0121／0285）", () => {
  const req = [{ pubkey: "p9", name: "小明", at: 1 }];

  it("🔴 有請求 → 顯示請求區與接受鈕", () => {
    const html = render({ requests: req, onAcceptRequest: () => {}, onDeclineRequest: () => {} });
    expect(html).toContain('data-testid="requests"');
    expect(html).toContain('data-testid="request-p9"');
    expect(html).toContain('data-testid="request-accept-p9"');
    expect(html).toContain("小明"); // 顯示對方自報的名字，而不是 npub 縮寫
  });

  it("無請求 → 整區不出現（不佔位）", () => {
    expect(render()).not.toContain('data-testid="requests"');
    expect(render({ requests: [] })).not.toContain('data-testid="requests"');
  });

  it("請求區排在名冊之前——需要裁示的東西不該被埋在清單裡", () => {
    const html = render({ requests: req, onAcceptRequest: () => {} });
    expect(html.indexOf('data-testid="requests"')).toBeLessThan(html.indexOf('data-testid="sidebar-list"'));
  });

  it("只有一筆時不顯示「全部刪除」（ADR-0127 是防洪，不是單筆操作）", () => {
    const one = render({ requests: req, onClearRequests: () => {} });
    expect(one).not.toContain('data-testid="requests-clear"');
    const many = render({ requests: [...req, { pubkey: "pa", name: "阿華", at: 2 }], onClearRequests: () => {} });
    expect(many).toContain('data-testid="requests-clear"');
  });
});

// ADR-0285：封鎖名單與請求區同一個成因（`manageProps` 只給了經典版）。
// 沒有這一區＝封鎖之後**沒有任何地方解得開**。
describe("已封鎖名單（ADR-0285）", () => {
  const blocked = [{ pubkey: "pb", name: "騷擾者", at: 1 }];

  it("🔴 有封鎖 → 列出且提供解除鈕", () => {
    const html = render({ blocked, onUnblockContact: () => {} });
    expect(html).toContain('data-testid="sidebar-blocked"');
    expect(html).toContain('data-testid="unblock-pb"');
    expect(html).toContain("騷擾者");
  });

  it("無封鎖 → 整區不出現", () => {
    expect(render()).not.toContain('data-testid="sidebar-blocked"');
    expect(render({ blocked: [] })).not.toContain('data-testid="sidebar-blocked"');
  });
});
