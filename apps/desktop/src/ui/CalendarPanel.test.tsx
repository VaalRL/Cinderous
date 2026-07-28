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

function render(over: Partial<CalendarPanelProps> = {}): string {
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

describe("右欄行程分頁（ADR-0259 階段三）", () => {
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
