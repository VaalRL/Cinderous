// 官網雙語文案（ADR-0090）。重用 @cinder/i18n 的 Locale；行銷文案為官網專屬。
// 意象：夜晚森林裡，一小簇營火旁圍坐的少數人——溫暖、私密、只有受邀者在場。
import type { Locale } from "@cinder/i18n";

export interface Copy {
  nav_home: string;
  nav_download: string;
  nav_node: string;
  nav_transparency: string;
  hero_eyebrow: string;
  hero_title: string;
  hero_subtitle: string;
  hero_download: string;
  hero_github: string;
  features_title: string;
  feat_e2e_t: string;
  feat_e2e_b: string;
  feat_decentral_t: string;
  feat_decentral_b: string;
  feat_local_t: string;
  feat_local_b: string;
  feat_free_t: string;
  feat_free_b: string;
  download_title: string;
  download_desktop: string;
  download_mobile: string;
  download_releases: string;
  donate_title: string;
  donate_intro: string;
  donate_disclaimer: string;
  node_title: string;
  node_intro: string;
  node_how_t: string;
  node_how_b: string;
  node_pool_t: string;
  node_pool_b: string;
  node_donate_t: string;
  node_donate_b: string;
  node_docs: string;
  tr_title: string;
  tr_intro: string;
  tr_loading: string;
  tr_failClosed: string;
  tr_runway: string;
  tr_months: string;
  tr_balance: string;
  tr_burn: string;
  tr_updatedAt: string;
  tr_notRealtime: string;
  tr_placeholderNote: string;
  tr_allocations: string;
  tr_col_period: string;
  tr_col_nodeOps: string;
  tr_col_bonuses: string;
  tr_col_other: string;
  tr_col_note: string;
  footer_privacy: string;
}

const zhHant: Copy = {
  nav_home: "首頁",
  nav_download: "下載",
  nav_node: "建立節點",
  nav_transparency: "透明度",
  hero_eyebrow: "圍著營火",
  hero_title: "Cinder",
  hero_subtitle:
    "像夜裡森林深處的一簇營火——只有你邀來的人圍坐。開源、永久免費、端到端加密的去中心化即時通。",
  hero_download: "下載桌面版",
  hero_github: "在 GitHub 檢視原始碼",
  features_title: "為什麼是 Cinder",
  feat_e2e_t: "端到端加密",
  feat_e2e_b: "以 Nostr NIP-17/44/59（Gift Wrap）加密——中繼站看不到內容，也看不到寄件者。",
  feat_decentral_t: "去中心化",
  feat_decentral_b: "透過 Nostr 中繼與 WebRTC P2P 通訊；沒有中央伺服器持有你的訊息，中繼只轉發密文。",
  feat_local_t: "本地優先",
  feat_local_b: "私鑰與資料留在你的裝置。明文永不上雲，設備全毀即帳號終止——沒有可被傳喚的資料庫。",
  feat_free_t: "開源・永久免費",
  feat_free_b: "AGPL-3.0 授權，程式碼公開可稽核。沒有廣告、沒有帳號販售、沒有中心化營利。",
  download_title: "下載",
  download_desktop: "桌面版（Windows／macOS／Linux）由 GitHub Releases 發佈。",
  download_mobile: "行動版開發中（Phase D）。",
  download_releases: "前往 GitHub Releases",
  donate_title: "為營火添柴",
  donate_intro: "捐款用於官方節點營運與部分貢獻者獎金。以下皆為純外部連結，交由你的第三方帳號/錢包處理。",
  donate_disclaimer: "本站無站內錢包、無托管、無抽成、不採 Zap。捐款完全自願。",
  node_title: "建立你自己的節點",
  node_intro:
    "這片森林靠許多小小的營火撐起。任何人都能自架一座 Cinder 中繼節點——中繼只轉發密文，看不到你的訊息內容，也看不到誰在跟誰說話。",
  node_how_t: "怎麼架",
  node_how_b:
    "兩種方式：Cloudflare Worker（免費層即可）或容器（Docker，自架於 VPS／Raspberry Pi）。詳細步驟見自架文件。",
  node_pool_t: "我的節點會被別人用到嗎？",
  node_pool_b:
    "跑起來，它就是一座可用的中繼。要被「自動選座」的公共池採用，需由維護者把它加進『簽章節點清單』（防蹭曝光/釣魚）。在那之前，你的節點仍可被：手動填入網址的人、或把它設為 home 的聯絡人（會自動學到路由）使用。",
  node_donate_t: "營運者贊助入口",
  node_donate_b:
    "你可在節點的 NIP-11 資訊自報贊助連結（GitHub Sponsors／Buy Me a Coffee／Liberapay／Lightning）；桌面版會低調顯示「贊助此節點」、純導流，App 不碰金流（ADR-0089）。",
  node_docs: "看自架文件",
  tr_title: "資金透明度",
  tr_intro: "官方財務以維護者簽章的資料檔公開；前端驗簽通過才顯示數字，任何主機被入侵也無法竄改。",
  tr_loading: "載入並驗簽中…",
  tr_failClosed: "無法驗證透明度資料的簽章，為安全起見暫不顯示數字。",
  tr_runway: "官方節點可續營運約",
  tr_months: "個月",
  tr_balance: "餘額",
  tr_burn: "月燒（節點營運＋已承諾獎金）",
  tr_updatedAt: "上次更新",
  tr_notRealtime: "為上次更新時的估算，非秒級即時。",
  tr_placeholderNote: "目前顯示的是開發用佔位資料（佔位金鑰），非真實財務。",
  tr_allocations: "歷史分配",
  tr_col_period: "期別",
  tr_col_nodeOps: "節點營運",
  tr_col_bonuses: "貢獻者獎金",
  tr_col_other: "其他",
  tr_col_note: "備註",
  footer_privacy: "本站零追蹤、無 cookie、無第三方分析；與 Cinder 通訊平面完全隔離，永不接觸使用者資料或金鑰。",
};

const en: Copy = {
  nav_home: "Home",
  nav_download: "Download",
  nav_node: "Run a node",
  nav_transparency: "Transparency",
  hero_eyebrow: "Around the fire",
  hero_title: "Cinder",
  hero_subtitle:
    "Like a small campfire deep in a night forest — only the people you invite sit around it. An open-source, forever-free, end-to-end encrypted decentralized messenger.",
  hero_download: "Download desktop",
  hero_github: "View source on GitHub",
  features_title: "Why Cinder",
  feat_e2e_t: "End-to-end encrypted",
  feat_e2e_b: "Encrypted with Nostr NIP-17/44/59 (Gift Wrap) — relays see neither the content nor the sender.",
  feat_decentral_t: "Decentralized",
  feat_decentral_b:
    "Communicates over Nostr relays and WebRTC P2P; no central server holds your messages — relays only forward ciphertext.",
  feat_local_t: "Local-first",
  feat_local_b:
    "Your keys and data stay on your device. Plaintext never touches the cloud; lose all devices and the account ends — no database to subpoena.",
  feat_free_t: "Open source, forever free",
  feat_free_b: "AGPL-3.0 licensed, fully auditable. No ads, no selling accounts, no centralized monetization.",
  download_title: "Download",
  download_desktop: "Desktop (Windows / macOS / Linux) is published via GitHub Releases.",
  download_mobile: "Mobile is in development (Phase D).",
  download_releases: "Go to GitHub Releases",
  donate_title: "Feed the fire",
  donate_intro:
    "Donations fund official node operations and some contributor bonuses. All links below are external and handled by your own third-party account or wallet.",
  donate_disclaimer: "This site has no in-app wallet, no custody, no cut, and no Zaps. Donating is entirely voluntary.",
  node_title: "Run your own node",
  node_intro:
    "This forest is held up by many small fires. Anyone can self-host a Cinder relay node — a relay only forwards ciphertext; it sees neither your message content nor who talks to whom.",
  node_how_t: "How to host",
  node_how_b:
    "Two ways: a Cloudflare Worker (free tier is enough) or a container (Docker, self-hosted on a VPS / Raspberry Pi). See the self-hosting docs for steps.",
  node_pool_t: "Will others use my node?",
  node_pool_b:
    "Running it makes it a working relay. To be picked up by the auto-assigned public pool, a maintainer must add it to the signed relay list (to prevent freeloading/phishing). Until then, your node is still usable by anyone who enters its URL manually, or by contacts who set it as their home (they learn the route automatically).",
  node_donate_t: "Operator donation entry",
  node_donate_b:
    "You can self-report donation links in your node's NIP-11 info (GitHub Sponsors / Buy Me a Coffee / Liberapay / Lightning); the desktop app shows a low-key “Support this node” card — pure external links, the app never touches money (ADR-0089).",
  node_docs: "Read the self-hosting docs",
  tr_title: "Fund transparency",
  tr_intro:
    "Official finances are published as a maintainer-signed data file; numbers render only after the signature verifies, so a compromised host cannot tamper with them.",
  tr_loading: "Loading and verifying…",
  tr_failClosed: "The transparency data's signature could not be verified; numbers are withheld for safety.",
  tr_runway: "Official node runway ≈",
  tr_months: "months",
  tr_balance: "Balance",
  tr_burn: "Monthly burn (node ops + committed bonuses)",
  tr_updatedAt: "Last updated",
  tr_notRealtime: "An estimate at last update — not real-time.",
  tr_placeholderNote: "Currently showing placeholder development data (placeholder key), not real finances.",
  tr_allocations: "Allocation history",
  tr_col_period: "Period",
  tr_col_nodeOps: "Node ops",
  tr_col_bonuses: "Bonuses",
  tr_col_other: "Other",
  tr_col_note: "Note",
  footer_privacy:
    "This site has zero tracking, no cookies, and no third-party analytics; it is fully isolated from Cinder's messaging plane and never touches user data or keys.",
};

const CATALOG: Record<Locale, Copy> = { "zh-Hant": zhHant, en };

export function useCopy(locale: Locale): Copy {
  return CATALOG[locale] ?? zhHant;
}
