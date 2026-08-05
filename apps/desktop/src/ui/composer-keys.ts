// Composer 鍵盤政策（ADR-0308）：把按鍵解析成動作，讓主 composer 與串內回覆共用同一條鏈。
//
// 純函式、零 React 依賴——過去這條鏈在 `ConversationWindow` 裡寫了兩份且能力不同
// （串內少了短碼/觸發字/Tab 縮排），統一到這裡後行為不再分裂。
//
// **IME 守衛集中於此**：組字中（`isComposing`）一律交還輸入法。沒有這道守衛，
// 繁中／日文選字按 Enter 在部分瀏覽器與輸入法組合下會直接把半成品送出去。

/** 從 KeyboardEvent 取出的最小輸入（不依賴 DOM 型別，便於測試）。 */
export interface ComposerKey {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  /** 輸入法組字中（`KeyboardEvent.isComposing`）。 */
  isComposing?: boolean;
}

export interface ComposerKeyState {
  /** 目前建議列是否有候選。 */
  hasSuggest: boolean;
  /**
   * 這列建議可否用 Enter 接受。
   * 破壞性建議（貼圖觸發字＝接受即送出訊息）為 `false`，維持 ADR-0037 的 Tab-only。
   */
  acceptOnEnter: boolean;
  /** 使用者設定：Enter 是否送出（`composer-prefs.ts`，預設 true）。 */
  enterToSend: boolean;
  /** 無建議時 Tab 是否縮排（主 composer 與串內皆為 true；供未來單行 composer 關閉）。 */
  allowIndent: boolean;
}

export type ComposerAction =
  | { type: "accept" }
  | { type: "move"; delta: number }
  | { type: "dismiss" }
  | { type: "indent"; outdent: boolean }
  | { type: "send" }
  /** 不攔截，交還瀏覽器預設（換行、焦點移動、關閉 IME 候選…）。 */
  | { type: "none" };

const NONE: ComposerAction = { type: "none" };

/** 解析按鍵 → 動作。呼叫端對非 `none` 的結果 `preventDefault()`。 */
export function resolveComposerKey(k: ComposerKey, s: ComposerKeyState): ComposerAction {
  // 1. 組字中一律讓輸入法處理——最優先，其餘規則都不得搶在前面。
  if (k.isComposing) return NONE;

  // 2. Ctrl/Cmd+Enter 永遠送出（含建議列開著時），肌肉記憶不隨設定改變。
  if (k.key === "Enter" && (k.ctrlKey || k.metaKey)) return { type: "send" };

  // 3. 建議列開著時吃掉導覽鍵。
  if (s.hasSuggest) {
    if (k.key === "Tab") return { type: "accept" };
    if (k.key === "Enter" && !k.shiftKey && s.acceptOnEnter) return { type: "accept" };
    if (k.key === "ArrowDown") return { type: "move", delta: 1 };
    if (k.key === "ArrowUp") return { type: "move", delta: -1 };
    if (k.key === "Escape") return { type: "dismiss" };
  }

  // 4. Enter 政策（使用者設定）。
  if (k.key === "Enter" && !k.shiftKey) return s.enterToSend ? { type: "send" } : NONE;

  // 5. Tab 縮排／退排（供清單巢狀與程式碼區塊）。
  if (k.key === "Tab" && s.allowIndent) return { type: "indent", outdent: !!k.shiftKey };

  return NONE;
}
