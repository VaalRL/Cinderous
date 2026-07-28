import type { StoredCalendarEvent } from "@cinderous/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DialogProvider } from "./Dialog.js";
import { I18nProvider } from "../i18n.js";
import { CalendarPanel, type CalendarPanelProps } from "./CalendarPanel.js";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);
const NOW = Math.floor(Date.now() / 1000);

const evt = (over: Partial<StoredCalendarEvent> = {}): StoredCalendarEvent => ({
  id: "evt1",
  title: "週六爬山",
  start: NOW + 86_400,
  organizer: ME,
  updatedAt: NOW,
  ...over,
});

// 既有互動測試驗的是行程卡片邏輯（RSVP/編輯/提醒）→ 用清單視圖渲染卡片；
// 「預設月曆」與視圖切換另有獨立 describe（ADR-0269）。
function render(over: Partial<CalendarPanelProps> = {}): string {
  return renderToStaticMarkup(
    <I18nProvider locale="zh-Hant">
      <DialogProvider>
        <CalendarPanel
          events={[evt()]}
          selfPubkey={ME}
          initialView="list"
          onPublish={() => {}}
          onCancel={() => {}}
          onRsvp={() => {}}
          nameFor={(pk) => (pk === ME ? "我" : pk === OTHER ? "小美" : pk.slice(0, 4))}
          {...over}
        />
      </DialogProvider>
    </I18nProvider>,
  );
}

/** 不指定 initialView＝走預設（本月月曆），供視圖測試用。 */
function renderDefault(over: Partial<CalendarPanelProps> = {}): string {
  return renderToStaticMarkup(
    <I18nProvider locale="zh-Hant">
      <DialogProvider>
        <CalendarPanel
          events={[evt()]}
          selfPubkey={ME}
          onPublish={() => {}}
          onCancel={() => {}}
          onRsvp={() => {}}
          nameFor={(pk) => (pk === ME ? "我" : pk === OTHER ? "小美" : pk.slice(0, 4))}
          {...over}
        />
      </DialogProvider>
    </I18nProvider>,
  );
}

describe("行事曆視圖（ADR-0269）", () => {
  it("預設＝本月月曆：有四視圖切換列、月格陣、期間導覽；月視圖選中", () => {
    const html = renderDefault();
    expect(html).toContain('data-testid="cal-views"');
    for (const v of ["month", "week", "day", "list"]) expect(html).toContain(`data-testid="cal-view-${v}"`);
    expect(html).toContain('data-testid="cal-grid-month"');
    expect(html).toContain('data-testid="cal-nav"'); // 期間導覽（‹ 今天 ›）
    // 月鈕標 aria-selected=true（屬性在 data-testid 之前，取前一段窗口比對）。
    const monthBtn = html.indexOf('data-testid="cal-view-month"');
    expect(html.slice(monthBtn - 90, monthBtn)).toContain('aria-selected="true"');
    expect(html).not.toContain('data-testid="cal-item"'); // 月視圖不是卡片列表
  });

  it("清單視圖：卡片列表、無期間導覽", () => {
    const html = renderDefault({ initialView: "list" });
    expect(html).toContain('data-testid="cal-item"');
    expect(html).not.toContain('data-testid="cal-nav"'); // 清單無 ‹›
  });

  it("週視圖有 7 格表頭與格陣；日視圖列當天卡片容器", () => {
    expect(renderDefault({ initialView: "week" })).toContain('data-testid="cal-grid-week"');
    expect(renderDefault({ initialView: "day" })).toContain('data-testid="cal-grid-day"');
  });
});

describe("右欄行程分頁（ADR-0263 階段三）", () => {
  it("列出行程的名稱、地點與備註", () => {
    const html = render({ events: [evt({ location: "象山", description: "帶水" })] });
    expect(html).toContain("週六爬山");
    expect(html).toContain("象山");
    expect(html).toContain("帶水");
    expect(html).toContain('data-testid="cal-item"');
  });

  it("沒有行程時顯示空狀態，且仍能新增", () => {
    const html = render({ events: [] });
    expect(html).toContain("這個對話還沒有行程");
    expect(html).toContain('data-testid="cal-new"');
  });

  describe("主揪權威在 UI 的體現（§1.7）", () => {
    it("自己是主揪 → 有編輯與取消，**沒有** RSVP 按鈕", () => {
      const html = render({ events: [evt({ organizer: ME })] });
      expect(html).toContain('data-testid="cal-edit"');
      expect(html).toContain('data-testid="cal-cancel"');
      expect(html).not.toContain('data-testid="cal-rsvp-accepted"');
      expect(html).toContain("由你發起");
    });

    it("⚠ 別人是主揪 → **連編輯/取消按鈕都不出現**（不是按了才被拒）", () => {
      const html = render({ events: [evt({ organizer: OTHER })] });
      expect(html).not.toContain('data-testid="cal-edit"');
      expect(html).not.toContain('data-testid="cal-cancel"');
      expect(html).toContain('data-testid="cal-rsvp-accepted"');
      expect(html).toContain("由 小美 發起");
    });
  });

  describe("RSVP", () => {
    it("三個選項都在，目前選擇以 aria-pressed 標示", () => {
      const html = render({
        events: [evt({ organizer: OTHER, rsvps: { [ME]: { status: "tentative", at: NOW } } })],
      });
      for (const s of ["accepted", "tentative", "declined"]) {
        expect(html).toContain(`data-testid="cal-rsvp-${s}"`);
      }
      // 只有「也許」是按下的狀態
      expect(html).toMatch(/data-testid="cal-rsvp-tentative"[^>]*aria-pressed="true"/);
      expect(html).toMatch(/aria-pressed="false"[^>]*data-testid="cal-rsvp-accepted"|data-testid="cal-rsvp-accepted"[^>]*aria-pressed="false"/);
    });

    it("列出要來與也許的人；**不列缺席者**（噪音，且對沒回覆的人不公平）", () => {
      const html = render({
        events: [
          evt({
            rsvps: {
              [OTHER]: { status: "accepted", at: NOW },
              ["c".repeat(64)]: { status: "declined", at: NOW },
            },
          }),
        ],
      });
      expect(html).toContain('data-testid="cal-going"');
      expect(html).toContain("小美");
      expect(html).not.toContain("cccc"); // 缺席者不出現
    });

    it("也許的人標問號，與確定要來的區分得出來", () => {
      const html = render({ events: [evt({ rsvps: { [OTHER]: { status: "tentative", at: NOW } } })] });
      expect(html).toContain("小美?");
    });

    it("沒有人回覆時不渲染名單區塊", () => {
      expect(render({ events: [evt()] })).not.toContain('data-testid="cal-going"');
    });
  });

  it("已過去的行程留著但退到背景（本機是真實來源，不刪）", () => {
    const html = render({ events: [evt({ start: NOW - 86_400 * 2, end: NOW - 86_400 })] });
    expect(html).toContain("cal__item--past");
    expect(html).toContain("週六爬山"); // 沒有被移除
  });

  it("未來的行程不套過去樣式", () => {
    expect(render({ events: [evt({ start: NOW + 3600 })] })).not.toContain("cal__item--past");
  });

  it("依開始時間升冪排序（最近的在最上面）", () => {
    const html = render({
      events: [
        evt({ id: "late", title: "後天", start: NOW + 86_400 * 2 }),
        evt({ id: "soon", title: "明天", start: NOW + 86_400 }),
      ],
    });
    expect(html.indexOf("明天")).toBeLessThan(html.indexOf("後天"));
  });
});

describe("由對話日期預填（ADR-0264 階段四）", () => {
  it("有 draft → 直接開啟新建表單（使用者點了才會有 draft）", () => {
    const html = render({ events: [], draft: { at: NOW + 7200, nonce: 1 } });
    expect(html).toContain('data-testid="cal-form"');
  });

  it("沒有 draft → 只顯示「新增行程」按鈕，表單不自己冒出來", () => {
    const html = render({ events: [] });
    expect(html).not.toContain('data-testid="cal-form"');
    expect(html).toContain('data-testid="cal-new"');
  });
});

describe("行程提醒（ADR-0266）：本機設定，其他人不會知道", () => {
  it("未提供 onRemind（後端無此能力）→ 完全不顯示提醒選單", () => {
    expect(render()).not.toContain('data-testid="cal-remind"');
  });

  it("提供 onRemind → 顯示提醒選單，預設是「關」（不替使用者決定要被吵）", () => {
    const html = render({ onRemind: () => {} });
    expect(html).toContain('data-testid="cal-remind"');
    // 未設 remindLead → select 的值為空字串＝「關」。
    expect(/data-testid="cal-remind-evt1"[^>]*>/.test(html)).toBe(true);
    expect(html).toContain('<option value="" selected="">關</option>');
  });

  it("已設提醒 → 選單反映目前的提前量", () => {
    const html = render({ events: [evt({ remindLead: 15 * 60 })], onRemind: () => {} });
    expect(html).toContain('<option value="900" selected="">15 分前</option>');
  });

  it("**已過去的行程不顯示提醒選單**——提醒一個過去的時間沒有意義", () => {
    const html = render({ events: [evt({ start: NOW - 86_400 })], onRemind: () => {} });
    expect(html).toContain('data-testid="cal-item"'); // 行程本身留著
    expect(html).not.toContain('data-testid="cal-remind"');
  });

  it("非主揪也能設自己的提醒（提醒與權威無關——那是你自己的鬧鐘）", () => {
    const html = render({ events: [evt({ organizer: OTHER })], onRemind: () => {} });
    expect(html).not.toContain('data-testid="cal-edit"'); // 仍然改不動別人的行程
    expect(html).toContain('data-testid="cal-remind"');
  });
});
