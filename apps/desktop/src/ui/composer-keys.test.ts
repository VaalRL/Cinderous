import { describe, expect, it } from "vitest";
import { resolveComposerKey, type ComposerKeyState } from "./composer-keys.js";

const base: ComposerKeyState = { hasSuggest: false, acceptOnEnter: false, enterToSend: true, allowIndent: true };
const withSuggest = (acceptOnEnter: boolean): ComposerKeyState => ({ ...base, hasSuggest: true, acceptOnEnter });

describe("resolveComposerKey — IME 守衛（ADR-0308）", () => {
  it("組字中一律交還輸入法，不送出也不接受建議", () => {
    expect(resolveComposerKey({ key: "Enter", isComposing: true }, base)).toEqual({ type: "none" });
    expect(resolveComposerKey({ key: "Enter", isComposing: true }, withSuggest(true))).toEqual({ type: "none" });
    expect(resolveComposerKey({ key: "ArrowDown", isComposing: true }, withSuggest(true))).toEqual({ type: "none" });
  });
});

describe("resolveComposerKey — Enter 政策（ADR-0308）", () => {
  it("預設（enterToSend）：Enter 送出、Shift+Enter 換行", () => {
    expect(resolveComposerKey({ key: "Enter" }, base)).toEqual({ type: "send" });
    expect(resolveComposerKey({ key: "Enter", shiftKey: true }, base)).toEqual({ type: "none" });
  });

  it("關閉 enterToSend：Enter 換行、不送出", () => {
    const s = { ...base, enterToSend: false };
    expect(resolveComposerKey({ key: "Enter" }, s)).toEqual({ type: "none" });
    expect(resolveComposerKey({ key: "Enter", shiftKey: true }, s)).toEqual({ type: "none" });
  });

  it("Ctrl/Cmd+Enter 在兩種設定下都送出", () => {
    for (const enterToSend of [true, false]) {
      const s = { ...base, enterToSend };
      expect(resolveComposerKey({ key: "Enter", ctrlKey: true }, s)).toEqual({ type: "send" });
      expect(resolveComposerKey({ key: "Enter", metaKey: true }, s)).toEqual({ type: "send" });
    }
  });

  it("建議列開著時 Ctrl+Enter 仍送出（不被接受建議攔截）", () => {
    expect(resolveComposerKey({ key: "Enter", ctrlKey: true }, withSuggest(true))).toEqual({ type: "send" });
  });
});

describe("resolveComposerKey — 建議列（ADR-0037 契約）", () => {
  it("Tab 接受選中", () => {
    expect(resolveComposerKey({ key: "Tab" }, withSuggest(true))).toEqual({ type: "accept" });
    expect(resolveComposerKey({ key: "Tab" }, withSuggest(false))).toEqual({ type: "accept" });
  });

  it("Enter 只接受非破壞性建議；破壞性（接受即送出）維持 Tab-only", () => {
    expect(resolveComposerKey({ key: "Enter" }, withSuggest(true))).toEqual({ type: "accept" });
    // acceptOnEnter=false（貼圖觸發字）：Enter 照原本的 Enter 政策走，不誤送貼圖
    expect(resolveComposerKey({ key: "Enter" }, withSuggest(false))).toEqual({ type: "send" });
  });

  it("↑↓ 移動、Esc 關閉", () => {
    expect(resolveComposerKey({ key: "ArrowDown" }, withSuggest(true))).toEqual({ type: "move", delta: 1 });
    expect(resolveComposerKey({ key: "ArrowUp" }, withSuggest(true))).toEqual({ type: "move", delta: -1 });
    expect(resolveComposerKey({ key: "Escape" }, withSuggest(true))).toEqual({ type: "dismiss" });
  });

  it("沒有建議時 ↑↓ 與 Esc 交還瀏覽器", () => {
    expect(resolveComposerKey({ key: "ArrowDown" }, base)).toEqual({ type: "none" });
    expect(resolveComposerKey({ key: "Escape" }, base)).toEqual({ type: "none" });
  });
});

describe("resolveComposerKey — Tab 縮排", () => {
  it("無建議時 Tab 縮排、Shift+Tab 退排", () => {
    expect(resolveComposerKey({ key: "Tab" }, base)).toEqual({ type: "indent", outdent: false });
    expect(resolveComposerKey({ key: "Tab", shiftKey: true }, base)).toEqual({ type: "indent", outdent: true });
  });

  it("不支援縮排的 composer 交還瀏覽器（維持焦點移動）", () => {
    expect(resolveComposerKey({ key: "Tab" }, { ...base, allowIndent: false })).toEqual({ type: "none" });
  });
});
