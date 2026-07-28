// 行動端共享行程（ADR-0261）：協定與權威在 core／engine 已驗過（packages/core/src/calendar.test.ts、
// packages/engine/src/backend/calendar.test.ts）。這裡驗**行動端 UI 新加的可視行為**——
// 尤其是「權威三層一致」的 UI 那一層在手機上也成立（桌面已有 22 個測試，手機不能是漏洞）。
//
// 測試環境是純 SSR（vite config `environment: "node"`，`renderToStaticMarkup`）：點不了東西。
// 所以預填狀態刻意由呼叫端持有並以 prop 傳入——內部 state 只能靠點擊觸發，SSR 一行都測不到。

import type { StoredCalendarEvent } from "@cinderous/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationScreen } from "./ConversationScreen.js";

const ME = "pk_me";
const BOB = "pk_bob";

const base = {
  name: "Bob",
  messages: [],
  onSend: () => {},
  onBack: () => {},
  selfPubkey: ME,
  locale: "zh-Hant" as const,
};

/** 有這些才等於「後端具備行事曆能力」。 */
const cal = {
  onCalendarPublish: () => {},
  onCalendarCancel: () => {},
  onCalendarRsvp: () => {},
  onPickDate: () => {},
  calendarNameFor: (pk: string) => (pk === ME ? "我" : "Bob"),
};

const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const PAST = Math.floor(Date.now() / 1000) - 86400;

const ev = (over: Partial<StoredCalendarEvent> = {}): StoredCalendarEvent => ({
  id: "e1",
  title: "週會",
  start: FUTURE,
  organizer: ME,
  contact: BOB,
  updatedAt: 1,
  ...over,
});

const render = (props: Record<string, unknown>): string =>
  renderToStaticMarkup(<ConversationScreen {...base} {...props} />);

describe("行動端行程分頁（ADR-0261）", () => {
  it("後端無行事曆能力 → 分頁完全不出現（示範模式）", () => {
    const html = render({});
    expect(html).not.toContain('data-testid="aux-tab-calendar"');
  });

  it("有能力 → 分頁出現並帶行程數（面板要開著才看得到分頁列）", () => {
    const html = render({ ...cal, calendar: [ev()], calendarDraft: { at: FUTURE, nonce: 1 } });
    expect(html).toContain('data-testid="aux-tab-calendar"');
    expect(html).toContain("行程（1）");
  });

  it("點對話中的日期（＝呼叫端給 draft）→ 面板自動開在行程分頁且表單已開", () => {
    const html = render({ ...cal, calendar: [], calendarDraft: { at: FUTURE, nonce: 1 } });
    expect(html).toContain('data-testid="aux-panel"');
    expect(html).toContain('data-testid="aux-calendar"');
    expect(html).toContain('data-testid="cal-form"'); // 直接開表單，不用再點一次「新增行程」
  });

  it("沒有 draft → 面板預設不開（**不自動導覽**，ADR-0259 §1.6）", () => {
    const html = render({ ...cal, calendar: [ev()] });
    expect(html).not.toContain('data-testid="aux-panel"');
  });
});

describe("行動端行程權威（ADR-0259 §1.7）：UI 那一層在手機上也要擋", () => {
  it("自己是主揪 → 有編輯與取消，沒有 RSVP 鈕（自己不必回覆自己）", () => {
    const html = render({ ...cal, calendar: [ev()], calendarDraft: { at: FUTURE, nonce: 1 } });
    expect(html).toContain('data-testid="cal-edit"');
    expect(html).toContain('data-testid="cal-cancel"');
    expect(html).not.toContain('data-testid="cal-rsvp-accepted"');
  });

  it("**非主揪連按鈕都不出現**——不是按了才被拒", () => {
    const html = render({
      ...cal,
      calendar: [ev({ organizer: BOB })],
      calendarDraft: { at: FUTURE, nonce: 1 },
    });
    expect(html).not.toContain('data-testid="cal-edit"');
    expect(html).not.toContain('data-testid="cal-cancel"');
    expect(html).toContain('data-testid="cal-rsvp-accepted"');
  });

  it("取消不是一按就發生：先出確認鈕（破壞性動作的行動端二次確認）", () => {
    const html = render({ ...cal, calendar: [ev()], calendarDraft: { at: FUTURE, nonce: 1 } });
    expect(html).toContain('data-testid="cal-cancel"');
    expect(html).not.toContain('data-testid="cal-cancel-confirm"'); // 要按過才出現
  });
});

describe("行動端行程列表呈現", () => {
  it("RSVP 名單只列要來與也許，**不列缺席者**（噪音，且會與「還沒回覆」混淆）", () => {
    const html = render({
      ...cal,
      calendarDraft: { at: FUTURE, nonce: 1 },
      calendar: [
        ev({
          organizer: BOB,
          rsvps: {
            [ME]: { status: "accepted", at: 1 },
            pk_carol: { status: "declined", at: 1 },
          },
        }),
      ],
      calendarNameFor: (pk: string) => ({ [ME]: "阿明", pk_carol: "Carol" })[pk] ?? "Bob",
    });
    // 斷言名單節點本身，不是整份 HTML——「我」之類的字在畫面各處都有，那種斷言測不到東西。
    const going = /data-testid="cal-going"[^>]*>([^<]*)</.exec(html)?.[1] ?? "";
    expect(going).toContain("阿明");
    expect(going).not.toContain("Carol");
  });

  it("過去的行程留著（本機是真實來源）但退到背景", () => {
    const html = render({
      ...cal,
      calendarDraft: { at: FUTURE, nonce: 1 },
      calendar: [ev({ id: "old", title: "上週的事", start: PAST })],
    });
    expect(html).toContain("上週的事"); // 不刪
    expect(html).toContain('data-testid="cal-item-past"'); // 但退到背景，不搶注意力
  });

  it("沒有行程 → 顯示空狀態文案", () => {
    const html = render({ ...cal, calendar: [], calendarDraft: { at: FUTURE, nonce: 1 } });
    expect(html).toContain("這個對話還沒有行程");
  });
});

describe("行動端日期偵測（ADR-0260 階段四）：偵測→提示，不代替使用者行動", () => {
  const msg = (text: string): unknown[] => [{ id: "m1", outgoing: false, sender: BOB, text, at: 1 }];

  it("訊息含未來日期 → 氣泡下方出現可點標記", () => {
    const html = render({ ...cal, messages: msg("我們下週三見") });
    expect(html).toContain('data-testid="date-chip"');
  });

  it("**沒有行事曆能力就完全不偵測**——不給做不到的事的提示", () => {
    const html = render({ messages: msg("我們下週三見") });
    expect(html).not.toContain('data-testid="date-chip"');
  });

  it("已收回的訊息不掃：內容不該再被解讀", () => {
    const html = render({ ...cal, messages: msg("我們下週三見"), unsent: new Set(["m1"]) });
    expect(html).not.toContain('data-testid="date-chip"');
  });

  it("過去的日期不報（「上週三」不是在約時間）", () => {
    const html = render({ ...cal, messages: msg("我上週三看到的") });
    expect(html).not.toContain('data-testid="date-chip"');
  });
});

describe("行動端行程提醒（ADR-0262）：本機設定，其他人不會知道", () => {
  const open = { calendarDraft: { at: FUTURE, nonce: 1 } };

  it("未提供 onCalendarRemind（後端無此能力）→ 完全不顯示提醒列", () => {
    const html = render({ ...cal, calendar: [ev()], ...open });
    expect(html).not.toContain('data-testid="cal-remind"');
  });

  it("提供後 → 顯示提醒列，且**預設選中「關」**（不替使用者決定要被吵）", () => {
    const html = render({ ...cal, calendar: [ev()], ...open, onCalendarRemind: () => {} });
    expect(html).toContain('data-testid="cal-remind"');
    expect(html).toContain('data-testid="cal-remind-cal_remindOff-on"');
  });

  it("已設提醒 → 選中的是對應的那個 chip", () => {
    const html = render({
      ...cal,
      calendar: [ev({ remindLead: 15 * 60 })],
      ...open,
      onCalendarRemind: () => {},
    });
    expect(html).toContain('data-testid="cal-remind-cal_remind15m-on"');
    expect(html).toContain('data-testid="cal-remind-cal_remindOff"'); // 「關」在，但沒被選中
  });

  it("**已過去的行程不顯示提醒列**——提醒一個過去的時間沒有意義", () => {
    const html = render({ ...cal, calendar: [ev({ start: PAST })], ...open, onCalendarRemind: () => {} });
    expect(html).toContain('data-testid="cal-item-past"'); // 行程本身留著
    expect(html).not.toContain('data-testid="cal-remind"');
  });

  it("非主揪也能設自己的提醒（提醒與權威無關——那是你自己的鬧鐘）", () => {
    const html = render({ ...cal, calendar: [ev({ organizer: BOB })], ...open, onCalendarRemind: () => {} });
    expect(html).not.toContain('data-testid="cal-edit"'); // 仍然改不動別人的行程
    expect(html).toContain('data-testid="cal-remind"');
  });
});
