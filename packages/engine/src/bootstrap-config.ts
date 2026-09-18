// 混合式引導路由設定（ADR-0039）——**跨前端單一來源**（ADR-0100 把它從 apps/desktop 移到這裡：
// 桌面與行動端連的是同一張網，錨點與維護者公鑰不該各留一份、各自漂移）。
//
// 這兩個值是整個容錯拓樸的「人類持有信任根」，需由專案維護者填入真實值：
//   1. ANCHOR_RELAYS：硬編碼錨點 relay（建議 2–3 座、綁定專屬網域）。恆連保底，
//      並作為帶內引導清單的取得來源。留空時退化為既有單/多 relay 行為（無錨點）。
//   2. MAINTAINER_PUBKEY：發佈簽章 relay 清單的維護者公鑰（hex）。留空則不學清單。
//
// 清單本身由維護者金鑰簽章（kind RELAY_LIST），客戶端驗簽後才採用；
// GitHub Actions（.github/workflows/relay-health.yml）只是產生/發佈通道，
// 被入侵也無法偽造清單（簽章驗不過）。詳見 docs/adr/0039。

/** 硬編碼錨點 relay（恆連保底＋登入自動選座來源，ADR-0039/0069）。 */
export const ANCHOR_RELAYS: string[] = [
  "wss://cinder-relay.cinderous1.workers.dev", // 生產站（Cloudflare，已部署驗證）
  "wss://cinder-relay.jt0856.workers.dev", // 第二錨點（另一 Cloudflare 帳號，ADR-0189）
  // 建議日後再綁一座自架/獨立網域或換平台，進一步降單點（ADR-0039 建議 2–3 座）。
];

/** 維護者公鑰（hex，64 字元）；發佈簽章 relay 清單者。留空 = 不學帶內清單。 */
// 🔄 2026-09-18 輪替（ADR-0358）。舊值 `6efd2603…` 曾在金鑰住在 CI 的期間被釘進來
// （2026-07-03～07-23，ADR-0239 判定為已曝險），故換掉。
//
// ⚠ 這是**編譯期常數**：已出貨的客戶端仍只認舊公鑰。並存期間 `relays.json` 每次變動
// 都要用新舊金鑰**各簽一次**，否則舊客戶端會收不到任何清單更新而變成孤島。
export const MAINTAINER_PUBKEY = "7b5cd386c71c1c68ecf979ffe9dde6a008090ee3fbe377934a1bbb3ff6dd5114";
