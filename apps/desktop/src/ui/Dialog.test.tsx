// @vitest-environment jsdom
//
// 統一自訂對話框（ADR-0139）：confirm/alert/prompt 的 Promise 介面與鍵盤/按鈕行為。
// 在 jsdom 掛載真 provider＋harness，點按鈕觸發、await 微任務、斷言解析值與 DOM。

import { act, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { DialogProvider, useDialog } from "./Dialog.js";
import { mount } from "../test/jsdom-mount.js";

function Harness(): JSX.Element {
  const { confirm, alert, prompt } = useDialog();
  const [result, setResult] = useState("");
  return (
    <>
      <button data-testid="do-confirm" onClick={() => void confirm({ message: "刪除？", danger: true }).then((r) => setResult(`c:${r}`))}>c</button>
      <button data-testid="do-alert" onClick={() => void alert("提示內容").then(() => setResult("a:done"))}>a</button>
      <button data-testid="do-prompt" onClick={() => void prompt({ message: "名稱？", defaultValue: "舊值" }).then((r) => setResult(`p:${r}`))}>p</button>
      <span data-testid="result">{result}</span>
    </>
  );
}

const app = (): JSX.Element => (
  <I18nProvider>
    <DialogProvider>
      <Harness />
    </DialogProvider>
  </I18nProvider>
);

const q = (c: HTMLElement, id: string): HTMLElement | null => c.querySelector(`[data-testid="${id}"]`);
const click = async (el: Element | null): Promise<void> => {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const setInput = async (el: HTMLInputElement, val: string): Promise<void> => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const esc = async (el: Element | null): Promise<void> => {
  await act(async () => {
    el?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
};

afterEach(() => {
  /* 每個 mount 各自建立容器；jsdom 由測試隔離 */
});

describe("confirm（ADR-0139）", () => {
  it("按確定 → resolve(true)；破壞性操作確認鈕帶 danger", async () => {
    const m = mount(app());
    await click(q(m.container, "do-confirm"));
    expect(q(m.container, "dialog-message")?.textContent).toBe("刪除？");
    const ok = q(m.container, "dialog-confirm")!;
    expect(ok.className).toContain("dialog__btn--danger");
    await click(ok);
    expect(q(m.container, "result")?.textContent).toBe("c:true");
  });

  it("按取消 → resolve(false)", async () => {
    const m = mount(app());
    await click(q(m.container, "do-confirm"));
    await click(q(m.container, "dialog-cancel"));
    expect(q(m.container, "result")?.textContent).toBe("c:false");
  });

  it("Esc → resolve(false)，且對話框關閉", async () => {
    const m = mount(app());
    await click(q(m.container, "do-confirm"));
    await esc(m.container.querySelector(".modal"));
    expect(q(m.container, "result")?.textContent).toBe("c:false");
    expect(q(m.container, "dialog-confirm")).toBeNull(); // 已關閉
  });
});

describe("alert（ADR-0139）", () => {
  it("只有一顆確定鈕（無取消）；按下 → resolve", async () => {
    const m = mount(app());
    await click(q(m.container, "do-alert"));
    expect(q(m.container, "dialog-cancel")).toBeNull(); // alert 無取消
    await click(q(m.container, "dialog-confirm"));
    expect(q(m.container, "result")?.textContent).toBe("a:done");
  });
});

describe("prompt（ADR-0139）", () => {
  it("預設值帶入輸入；改值後確定 → resolve(輸入)", async () => {
    const m = mount(app());
    await click(q(m.container, "do-prompt"));
    const input = q(m.container, "dialog-input") as HTMLInputElement;
    expect(input.value).toBe("舊值");
    await setInput(input, "新名稱");
    await click(q(m.container, "dialog-confirm"));
    expect(q(m.container, "result")?.textContent).toBe("p:新名稱");
  });

  it("取消 → resolve(null)", async () => {
    const m = mount(app());
    await click(q(m.container, "do-prompt"));
    await click(q(m.container, "dialog-cancel"));
    expect(q(m.container, "result")?.textContent).toBe("p:null");
  });
});

describe("useDialog 無 provider（ADR-0139）", () => {
  it("回退不丟例外，元件照常渲染", () => {
    function Bare(): JSX.Element {
      const api = useDialog();
      return <span data-testid="bare">{typeof api.confirm === "function" ? "ok" : "no"}</span>;
    }
    const m = mount(<Bare />);
    expect(q(m.container, "bare")?.textContent).toBe("ok");
  });
});
