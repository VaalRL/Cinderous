// @cinder/engine — 通訊引擎公開 API（ADR-0074）。
// 與 UI 無關：前端只呼叫 ChatBackend 方法、訂閱 ChatBackendEvents，不直接碰加密/協定。
// 平台特有基質（Tauri 金鑰庫/加密儲存）不在此——由前端經 AppStorage 介面注入。

// ── 前端↔通訊契約與 DTO ──
export * from "./backend/types.js";
// ── 通訊後端實作 ──
export * from "./backend/relay-backend.js";
export * from "./backend/browser-backend.js";
// ── WebRTC 與 RTC 設定 ──
export * from "./backend/rtc-config.js";
export * from "./backend/webrtc.js";
export * from "./backend/webrtc-call.js";
// ── 換機/配對（D4a）──
export * from "./backend/pairing-session.js";
export * from "./backend/pairing-transport.js";
// ── 本機儲存抽象與實作 ──
export * from "./bootstrap-config.js";
export * from "./storage/types.js";
export * from "./storage/local.js";
export * from "./storage/memory.js";
export * from "./storage/archive.js";
export * from "./storage/opfs-archive.js";
// ── 多身分登錄／搬家／快照／裝置 id ──
export * from "./storage/profiles.js";
export * from "./storage/cloud-snapshot.js";
export * from "./storage/pair-bundle.js";
export * from "./storage/device-id.js";
export * from "./storage/export.js";
// ── 前端擴充縫（K4 實驗性；僅註冊機制，第三方載入待 ADR）──
export * from "./extensions.js";
