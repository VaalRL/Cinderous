// 行動端消費 @cinderous/engine（ADR-0074 K2）：與桌面**同一套**通訊引擎，前端換成
// react-native-web——證明引擎與 UI 框架解耦、可跨前端重用（不拖入 React-DOM/Tauri）。
import { BrowserChatBackend, type ChatBackend } from "@cinderous/engine";

/** 建立示範後端（記憶體 relay，免網路）；正式版改注入 RelayChatBackend＋自訂 storage。 */
export function createDemoChat(name: string): ChatBackend {
  return new BrowserChatBackend(name);
}
