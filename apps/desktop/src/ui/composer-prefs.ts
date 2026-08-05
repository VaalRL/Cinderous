// Composer 行為偏好（ADR-0308）：目前只有一項——Enter 是送出還是換行。
//
// 形狀比照 `url-hygiene.ts` 的 `cleanOnPasteEnabled()`：localStorage 薄包裝、讀不到即回預設。
// 純本機設定，不隨訊息外流、不進雲端快照。

const ENTER_KEY = "nb.composer.enterToSend";

/**
 * Enter 是否送出訊息（**預設 true**）。
 *
 * - `true`：Enter 送出、Shift+Enter 換行（經典即時通訊習慣）。
 * - `false`：Enter 換行、Ctrl/Cmd+Enter 送出。
 *
 * 兩種設定下 Ctrl/Cmd+Enter 都送出——肌肉記憶不隨設定改變（ADR-0308 §5）。
 */
export function enterToSendEnabled(): boolean {
  try {
    return localStorage.getItem(ENTER_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setEnterToSendEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENTER_KEY, on ? "1" : "0");
  } catch {
    /* 不可用時維持預設 */
  }
}
