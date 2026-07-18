// 行動端通知平台縫（ADR-0116）。
//
// 這是**唯一**碰通知平台 API 的地方——UI 只呼叫這裡，不直接碰 `Notification`。
// 目前行動端跑在 react-native-web（DOM），故直接沿用 `@cinderous/engine` 的 Web Notification
// 基質——**與桌面的瀏覽器路徑是同一份實作**，不各寫一遍（ADR-0116）。
//
// 移植到真正的 React Native 時只需換掉本檔內部：
//   - `notifier`     → expo-notifications（本機通知）
//   - `onNotifyClick` → Notifications.addNotificationResponseReceivedListener
// 介面與呼叫端皆不變（比照 `native/files.ts`、`native/call-media.tsx`）。
//
// 註：本機通知**只在 App 還活著時有效**。真正的「App 關掉也收得到」需要推播
// （FCM/APNs），那會把「有訊息」這件事洩漏給推播供應商——與 Cinderous 的威脅模型衝突，
// 需另立 ADR 評估（見 ADR-0116 的「不做什麼」）。

import { type Notifier, type NotifyPayload, onWebNotificationClick, webNotifier } from "@cinderous/engine";

export type { NotifyPayload };

/** 行動端的通知基質。 */
export const notifier: Notifier = webNotifier;

/** 註冊通知點擊回呼（App 掛載時呼叫一次）；回傳取消註冊函式。 */
export const onNotifyClick = onWebNotificationClick;
