// 混合式引導路由設定（ADR-0039）。
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
  "wss://cinder-relay.whoami885.workers.dev", // 生產站（Cloudflare，已部署驗證）
  // 建議日後再綁一座自架/獨立網域，避免單點故障（ADR-0039 建議 2–3 座）。
];

/** 維護者公鑰（hex，64 字元）；發佈簽章 relay 清單者。留空 = 不學帶內清單。 */
export const MAINTAINER_PUBKEY = "";
