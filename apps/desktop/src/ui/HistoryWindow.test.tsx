// @vitest-environment jsdom
//
// 封存搜尋（ADR-0256 階段 3）：以 mock archive 驅動「逐塊解密掃描、即掃即棄」的完整流程。
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { MessageArchive, StoredMessage } from "@cinderous/engine";
import { I18nProvider } from "../i18n.js";
import { mount } from "../test/jsdom-mount.js";
import { HistoryWindow } from "./HistoryWindow.js";

const sm = (id: string, text: string, at: number): StoredMessage =>
  ({ id, contact: "bb", outgoing: false, text, at }) as StoredMessage;

/** 兩塊封存：塊 1（較新）含「週五」，塊 0（較舊）也含「週五」＋不相干訊息。 */
const archive = {
  chunkCount: async () => 2,
  loadChunk: async (_c: string, i: number) =>
    i === 1 ? [sm("n1", "新的週五訊息", 200), sm("n2", "無關內容", 201)] : [sm("o1", "舊的週五備忘", 100)],
} as unknown as MessageArchive;

/** React 受控 input 的 jsdom 打字（原生 setter＋input 事件）。 */
function type(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("封存搜尋（ADR-0256 階段 3）", () => {
  it("輸入關鍵字→掃描兩塊→命中新→舊列出；清除回到分頁瀏覽", async () => {
    const m = mount(
      <I18nProvider locale="zh-Hant">
        <HistoryWindow convo="bb" name="Bob" archive={archive} selfLabel="我" onClose={() => {}} />
      </I18nProvider>,
    );
    await act(async () => {}); // 沖 chunkCount＋自動載入最新塊

    const input = m.container.querySelector('[data-testid="history-search"]') as HTMLInputElement;
    await act(async () => type(input, "週五"));
    await act(async () => {
      (m.container.querySelector('[data-testid="history-search-go"]') as HTMLButtonElement).click();
    });
    await act(async () => {}); // 沖掃描迴圈

    const body = m.container.textContent ?? "";
    expect(body).toContain("2/2"); // 掃描完成進度
    expect(body).toContain("新的週五訊息");
    expect(body).toContain("舊的週五備忘");
    expect(body).not.toContain("無關內容"); // 未命中不列出
    // 新在上（塊由新到舊掃）
    expect(body.indexOf("新的週五訊息")).toBeLessThan(body.indexOf("舊的週五備忘"));

    // 清除 → 回到分頁瀏覽（最新塊已自動載入）
    await act(async () => {
      (m.container.querySelector('[data-testid="history-search-clear"]') as HTMLButtonElement).click();
    });
    expect(m.container.querySelector('[data-testid="history-scan"]')).toBeNull();
    expect(m.container.textContent).toContain("無關內容"); // 分頁模式顯示整塊
    m.unmount();
  });

  it("跨塊重複 id 只列一次（與 pager 的 prependChunk 同去重語意）", async () => {
    const dup = {
      chunkCount: async () => 2,
      loadChunk: async (_c: string, i: number) =>
        i === 1 ? [sm("x", "重複的週五訊息", 200)] : [sm("x", "重複的週五訊息", 200)],
    } as unknown as MessageArchive;
    const m = mount(
      <I18nProvider locale="zh-Hant">
        <HistoryWindow convo="bb" name="Bob" archive={dup} selfLabel="我" onClose={() => {}} />
      </I18nProvider>,
    );
    await act(async () => {});
    const input = m.container.querySelector('[data-testid="history-search"]') as HTMLInputElement;
    await act(async () => type(input, "週五"));
    await act(async () => {
      (m.container.querySelector('[data-testid="history-search-go"]') as HTMLButtonElement).click();
    });
    await act(async () => {});
    expect((m.container.textContent?.match(/重複的週五訊息/g) ?? []).length).toBe(1);
    m.unmount();
  });

  it("查無命中：掃描完成後顯示無符合", async () => {
    const m = mount(
      <I18nProvider locale="zh-Hant">
        <HistoryWindow convo="bb" name="Bob" archive={archive} selfLabel="我" onClose={() => {}} />
      </I18nProvider>,
    );
    await act(async () => {});
    const input = m.container.querySelector('[data-testid="history-search"]') as HTMLInputElement;
    await act(async () => type(input, "找不到的詞"));
    await act(async () => {
      (m.container.querySelector('[data-testid="history-search-go"]') as HTMLButtonElement).click();
    });
    await act(async () => {});
    expect(m.container.textContent).toContain("無符合");
    m.unmount();
  });
});
