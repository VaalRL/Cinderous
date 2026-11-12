// @vitest-environment jsdom
//
// AI 改寫串流輸出（ADR-0416）：改寫中就逐段顯示、產生完才能採用、取消會中止請求。

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n.js";
import type { RewriteStream } from "../native/ollama.js";
import { mount } from "../test/jsdom-mount.js";
import { ComposerRewrite } from "./ComposerRewrite.js";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(onRewrite: (text: string, instruction: string, stream?: RewriteStream) => Promise<string>) {
  const onAdopt = vi.fn();
  const m = mount(
    <I18nProvider locale="en">
      <ComposerRewrite text="hello" onRewrite={onRewrite} onAdopt={onAdopt} />
    </I18nProvider>,
  );
  const q = (sel: string): HTMLElement | null => m.container.querySelector(sel);
  act(() => q('[data-testid="ai-rewrite-btn"]')!.click());
  act(() => (q(".rewrite__style") as HTMLButtonElement).click());
  return { m, q, onAdopt };
}

describe("ComposerRewrite 串流（ADR-0416）", () => {
  it("改寫中逐段顯示；產生完才出現採用鈕，採用的是完整結果", async () => {
    const d = deferred<string>();
    let stream: RewriteStream | undefined;
    const { q, onAdopt } = setup((_t, _i, s) => {
      stream = s;
      return d.promise;
    });
    expect(stream).toBeDefined();
    act(() => stream!.onDelta("Hel"));
    act(() => stream!.onDelta("lo!"));
    expect(q('[data-testid="ai-rewrite-streaming"]')?.textContent).toBe("Hello!");
    expect(q(".rewrite__adopt")).toBeNull();

    await act(async () => d.resolve("Hello!"));
    expect(q('[data-testid="ai-rewrite-streaming"]')).toBeNull();
    expect(q(".rewrite__result")?.textContent).toBe("Hello!");
    act(() => q(".rewrite__adopt")!.click());
    expect(onAdopt).toHaveBeenCalledWith("Hello!");
  });

  it("改寫中按取消：中止訊號送出、回到風格選單、不顯示錯誤", async () => {
    const d = deferred<string>();
    let stream: RewriteStream | undefined;
    const { q } = setup((_t, _i, s) => {
      stream = s;
      return d.promise;
    });
    act(() => stream!.onDelta("par"));
    act(() => (q('[data-testid="ai-rewrite-stop"]') as HTMLButtonElement).click());
    expect(stream!.signal?.aborted).toBe(true);
    await act(async () => d.reject(new Error("cancelled")));
    expect(q('[data-testid="ai-rewrite-streaming"]')).toBeNull();
    expect(q(".rewrite__style")).not.toBeNull();
    expect(q(".rewrite__error")).toBeNull();
  });

  it("關閉面板也會中止進行中的改寫", () => {
    let stream: RewriteStream | undefined;
    const { q } = setup((_t, _i, s) => {
      stream = s;
      return new Promise<string>(() => {});
    });
    act(() => q('[data-testid="ai-rewrite-btn"]')!.click());
    expect(stream!.signal?.aborted).toBe(true);
  });
});
