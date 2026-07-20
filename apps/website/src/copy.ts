// 官網雙語文案（ADR-0090；ADR-0187 資訊架構改版）。重用 @cinderous/i18n 的 Locale；行銷文案為官網專屬。
// 意象：夜晚森林裡，一小簇營火旁圍坐的少數人——溫暖、私密、只有受邀者在場。
// 首頁＝核心價值觀與「取回通訊自主權」願景；技術原理獨立一頁；下載直連 GitHub Releases。
import type { Locale } from "@cinderous/i18n";

export interface Copy {
  nav_home: string;
  nav_tech: string;
  nav_node: string;
  nav_download: string;
  nav_transparency: string;
  hero_eyebrow: string;
  hero_title: string;
  hero_subtitle: string;
  hero_download: string;
  hero_webapp: string;
  hero_tech: string;
  hero_github: string;
  vision_title: string;
  vision_body: string;
  values_title: string;
  val_autonomy_t: string;
  val_autonomy_b: string;
  val_privacy_t: string;
  val_privacy_b: string;
  val_decentral_t: string;
  val_decentral_b: string;
  val_free_t: string;
  val_free_b: string;
  tech_title: string;
  tech_intro: string;
  tech_proto_t: string;
  tech_proto_b: string;
  tech_multi_title: string;
  tech_multi_lead: string;
  md_list: string;
  md_cipher: string;
  md_anchorA: string;
  md_anchorB: string;
  md_community: string;
  md_offline: string;
  features_title: string;
  feat_e2e_t: string;
  feat_e2e_b: string;
  feat_decentral_t: string;
  feat_decentral_b: string;
  feat_local_t: string;
  feat_local_b: string;
  feat_free_t: string;
  feat_free_b: string;
  how_title: string;
  how_lead: string;
  fd_alice: string;
  fd_bob: string;
  fd_relay: string;
  fd_relay_note: string;
  fd_encrypt: string;
  fd_p2p: string;
  store_title: string;
  store_lead: string;
  store_desktop_t: string;
  store_desktop_b: string;
  store_web_t: string;
  store_web_b: string;
  store_mobile_t: string;
  store_mobile_b: string;
  store_relay_t: string;
  store_relay_b: string;
  donate_title: string;
  donate_intro: string;
  donate_disclaimer: string;
  node_title: string;
  node_intro: string;
  node_how_t: string;
  node_how_b: string;
  node_step1_t: string;
  node_step1_b: string;
  node_step2_t: string;
  node_step2_b: string;
  node_step3_t: string;
  node_step3_b: string;
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
  nav_tech: "技術原理",
  nav_node: "建立節點",
  nav_download: "下載",
  nav_transparency: "透明度",
  hero_eyebrow: "取回通訊自主權",
  hero_title: "Cinderous",
  hero_subtitle:
    "通訊本該屬於說話的人，而不是中間的平台。Cinderous 讓你在沒有伺服器帳號、沒有守門人的前提下，安全地和你邀來的人說話——像夜裡森林深處的一簇營火，只有圍坐的人聽得見。",
  hero_download: "下載桌面版",
  hero_webapp: "在瀏覽器開啟",
  hero_tech: "看技術原理",
  hero_github: "在 GitHub 檢視原始碼",
  vision_title: "為什麼要取回通訊自主權",
  vision_body:
    "今天你的對話幾乎都住在別人的伺服器上：平台掌握你的身分與社交圈，能讀取、審查、封鎖，甚至販售這些資料。帳號可以被停用，資料可以被傳喚，規則隨時會變。Cinderous 反過來——身分是一把只存在你裝置上的金鑰，訊息在離開前就已加密，傳遞只靠任何人都能自架的中繼。沒有一間公司站在你和朋友中間，通訊的主導權回到說話的人手上。",
  values_title: "我們相信什麼",
  val_autonomy_t: "你擁有你的身分",
  val_autonomy_b:
    "身分是一把金鑰，不是平台帳號。沒有人能替你停用、封鎖或販售它；設備全毀即帳號終止，沒有可被接管的中央資料。",
  val_privacy_t: "隱私是預設，不是選項",
  val_privacy_b:
    "明文永不離開你的裝置，全程端到端加密。連「誰在跟誰說話」中繼站都看不到——沒有可被翻閱的對話，也沒有可被分析的社交圖譜。",
  val_decentral_t: "沒有守門人",
  val_decentral_b:
    "沒有中央伺服器、沒有唯一入口。傳遞靠任何人都能自架的中繼與點對點連線；這片森林由許多小小的營火撐起，關掉任何一座都不會熄滅。",
  val_free_t: "永久免費・開源",
  val_free_b:
    "AGPL-3.0 授權、程式碼公開可稽核。沒有廣告、沒有帳號販售、沒有金流抽成；營運靠自願捐款與自架節點，而不是你的資料。",
  tech_title: "技術原理",
  tech_intro:
    "價值觀要靠機制守住。以下是 Cinderous 如何在不信任任何伺服器的前提下，安全地把一則訊息從你送到朋友手上。",
  tech_proto_t: "協定基線",
  tech_proto_b:
    "建構於 Nostr 開放協定：訊息以 NIP-17／44／59（Gift Wrap）加密封裝、NIP-42 驗證中繼連線、NIP-13 工作量證明抑制濫用。即時互動（檔案、在線、輸入中）改走 WebRTC P2P，直接點對點、完全不經中繼。全為開放標準，任何人都能自行實作與稽核。",
  tech_multi_title: "多個節點時，如何協作",
  tech_multi_lead:
    "當網路裡有很多節點，沒有誰是必經之路。你和好友各自連上任一可用中繼——中繼只轉發密文；任何一座離線，訊息自動改走其他座。哪些節點可用，由維護者簽章的節點清單決定（登入自動選座），即時互動則走 WebRTC P2P 直連、完全不經中繼。",
  md_list: "簽章節點清單 · 登入自動選座",
  md_cipher: "密文可經任一節點轉發",
  md_anchorA: "錨點 A",
  md_anchorB: "錨點 B",
  md_community: "社群節點",
  md_offline: "離線 → 改走其他節點",
  features_title: "四大技術支柱",
  feat_e2e_t: "端到端加密",
  feat_e2e_b: "以 Nostr NIP-17/44/59（Gift Wrap）加密——中繼站看不到內容，也看不到寄件者。",
  feat_decentral_t: "去中心化",
  feat_decentral_b: "透過 Nostr 中繼與 WebRTC P2P 通訊；沒有中央伺服器持有你的訊息，中繼只轉發密文。",
  feat_local_t: "本地優先",
  feat_local_b: "私鑰與資料留在你的裝置。明文永不上雲，設備全毀即帳號終止——沒有可被傳喚的資料庫。",
  feat_free_t: "開源・永久免費",
  feat_free_b: "AGPL-3.0 授權，程式碼公開可稽核。沒有廣告、沒有帳號販售、沒有中心化營利。",
  how_title: "訊息怎麼傳？",
  how_lead:
    "你送出的每則訊息，先在你的裝置上以 Gift Wrap 加密；中繼站只轉發密文——看不到內容，也看不到寄件者。即時互動（檔案、在線、輸入中）另走 WebRTC P2P，直接點對點、完全不經中繼。",
  fd_alice: "你",
  fd_bob: "好友",
  fd_relay: "中繼站 Relay",
  fd_relay_note: "只轉發密文·看不到內容與寄件者",
  fd_encrypt: "🔒 Gift Wrap 密文（NIP-17/44/59）",
  fd_p2p: "WebRTC P2P — 檔案／在線／輸入中，不經中繼",
  store_title: "你的資料存在哪裡",
  store_lead:
    "不管用哪個版本，明文與私鑰都只留在你的裝置——沒有中央資料庫、沒有可被傳喚的帳號。差別只在「私鑰用什麼保管」。",
  store_desktop_t: "桌面版（原生）",
  store_desktop_b:
    "私鑰交給作業系統金鑰庫（Windows 認證管理員／macOS 鑰匙圈／Linux Secret Service）；訊息與聯絡人以 AES-256-GCM 加密存本機磁碟。明文不上雲。",
  store_web_t: "網頁版（瀏覽器）",
  store_web_b:
    "瀏覽器沒有 OS 金鑰庫——私鑰以你設的本地密碼（Argon2id）包成密文存瀏覽器；訊息與聯絡人加密存在瀏覽器（localStorage／OPFS），綁在該網域、留在你這台裝置。托管網站只發送程式碼、零使用者資料。清除網站資料或忘記密碼＝身分消失，請務必備份 nsec／救援登入碼。",
  store_mobile_t: "行動版",
  store_mobile_b:
    "與網頁版同屬本地優先：私鑰以本地密碼包裹存裝置本機（未設密碼＝不落地、僅暫時 session）；資料留在裝置。",
  store_relay_t: "所有版本共通：中繼站看不到你的資料",
  store_relay_b:
    "中繼站只暫存密文離線留言（有保留上限、逾期自動汰除），看不到內容也看不到寄件者。只有開啟「多裝置狀態同步」時，才有一份加密狀態快照存在你的中繼站——仍是密文，中繼看不到明文。",
  donate_title: "為營火添柴",
  donate_intro: "捐款用於官方節點營運與部分貢獻者獎金。以下皆為純外部連結，交由你的第三方帳號/錢包處理。",
  donate_disclaimer: "本站無站內錢包、無托管、無抽成、不採 Zap。捐款完全自願。",
  node_title: "建立你自己的節點",
  node_intro:
    "這片森林靠許多小小的營火撐起。任何人都能自架一座 Cinderous 中繼節點——中繼只轉發密文，看不到你的訊息內容，也看不到誰在跟誰說話。",
  node_how_t: "怎麼架",
  node_how_b:
    "兩種方式：Cloudflare Worker（免費層即可）或容器（Docker，自架於 VPS／Raspberry Pi）。詳細步驟見自架文件。",
  node_step1_t: "Cloudflare Worker",
  node_step1_b: "relay/ 的 Worker 部署到 Cloudflare（免費層），wrangler deploy。",
  node_step2_t: "容器（Docker）",
  node_step2_b: "node-relay 以容器自架於 VPS／Raspberry Pi（ADR-0075）。",
  node_step3_t: "填捐款欄位（可選）",
  node_step3_b: "在 NIP-11 自報 GitHub Sponsors／BMC／Liberapay／Lightning（ADR-0089）。",
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
  footer_privacy: "本站零追蹤、無 cookie、無第三方分析；與 Cinderous 通訊平面完全隔離，永不接觸使用者資料或金鑰。",
};

const en: Copy = {
  nav_home: "Home",
  nav_tech: "How it works",
  nav_node: "Run a node",
  nav_download: "Download",
  nav_transparency: "Transparency",
  hero_eyebrow: "Own your conversations",
  hero_title: "Cinderous",
  hero_subtitle:
    "Conversations should belong to the people having them — not to the platform in the middle. Cinderous lets you talk safely with the people you invite, with no server account and no gatekeeper — like a campfire deep in a night forest, heard only by those sitting around it.",
  hero_download: "Download desktop",
  hero_webapp: "Open in browser",
  hero_tech: "How it works",
  hero_github: "View source on GitHub",
  vision_title: "Why reclaim communication autonomy",
  vision_body:
    "Today your conversations mostly live on someone else's servers: the platform owns your identity and your social graph, and can read, censor, block, or even sell it. Accounts get suspended, data gets subpoenaed, rules change overnight. Cinderous inverts that — your identity is a key that exists only on your device, messages are encrypted before they ever leave, and delivery rides on relays anyone can self-host. No company sits between you and your friends; control over your conversations returns to the people having them.",
  values_title: "What we believe",
  val_autonomy_t: "You own your identity",
  val_autonomy_b:
    "Your identity is a key, not a platform account. No one can suspend, block, or sell it; lose all your devices and the account simply ends — there is no central record to seize.",
  val_privacy_t: "Privacy by default, not by setting",
  val_privacy_b:
    "Plaintext never leaves your device; everything is end-to-end encrypted. Relays cannot even see who talks to whom — no conversations to browse, no social graph to mine.",
  val_decentral_t: "No gatekeeper",
  val_decentral_b:
    "No central server, no single entry point. Delivery rides on relays anyone can host plus peer-to-peer links; this forest is held up by many small fires — put out any one and it stays lit.",
  val_free_t: "Free forever, open",
  val_free_b:
    "AGPL-3.0 licensed and fully auditable. No ads, no selling accounts, no cut of any transaction; it runs on voluntary donations and self-hosted nodes — not on your data.",
  tech_title: "How it works",
  tech_intro:
    "Values only hold if the mechanism enforces them. Here is how Cinderous gets a message from you to your friend safely — without trusting any server.",
  tech_proto_t: "Protocol baseline",
  tech_proto_b:
    "Built on the open Nostr protocol: messages are encrypted and wrapped with NIP-17/44/59 (Gift Wrap), relay connections are authenticated with NIP-42, and NIP-13 proof-of-work deters abuse. Real-time interactions (files, presence, typing) go over WebRTC P2P, straight peer-to-peer, bypassing relays entirely. All open standards — implementable and auditable by anyone.",
  tech_multi_title: "How many nodes collaborate",
  tech_multi_lead:
    "With many nodes in the network, no single one is on the critical path. You and your friend each connect to any available relay — relays only forward ciphertext; if one goes offline, messages route via others automatically. Which nodes are available is decided by a maintainer-signed node list (auto-seat on sign-in), while real-time interactions go straight over WebRTC P2P, bypassing relays entirely.",
  md_list: "Signed node list · auto-seat on sign-in",
  md_cipher: "ciphertext via any node",
  md_anchorA: "Anchor A",
  md_anchorB: "Anchor B",
  md_community: "Community node",
  md_offline: "offline → route via others",
  features_title: "Four technical pillars",
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
  how_title: "How a message travels",
  how_lead:
    "Every message is Gift-Wrap encrypted on your device first; relays only forward ciphertext — they see neither the content nor the sender. Real-time bits (files, presence, typing) go over WebRTC P2P, straight peer-to-peer, bypassing relays entirely.",
  fd_alice: "You",
  fd_bob: "Friend",
  fd_relay: "Relay",
  fd_relay_note: "Forwards ciphertext only · no content, no sender",
  fd_encrypt: "🔒 Gift Wrap ciphertext (NIP-17/44/59)",
  fd_p2p: "WebRTC P2P — files / presence / typing, no relay",
  store_title: "Where your data lives",
  store_lead:
    "Whichever version you use, plaintext and your private key stay on your device — no central database, no account to subpoena. The only difference is how the private key is kept.",
  store_desktop_t: "Desktop (native)",
  store_desktop_b:
    "The private key is held in the OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service); messages and contacts sit in AES-256-GCM–encrypted files on your local disk. Plaintext never touches the cloud.",
  store_web_t: "Web (browser)",
  store_web_b:
    "A browser has no OS keychain — the private key is wrapped with your local password (Argon2id) and stored in the browser; messages and contacts are encrypted in the browser (localStorage / OPFS), scoped to the site and kept on your device. The hosting site only serves code and stores zero user data. Clearing site data or forgetting the password erases the identity — back up your nsec / rescue login code.",
  store_mobile_t: "Mobile",
  store_mobile_b:
    "Local-first like the web version: the private key is password-wrapped on the device (no password = not persisted, session-only); data stays on the device.",
  store_relay_t: "Across all versions: relays can't see your data",
  store_relay_b:
    "Relays only briefly hold ciphertext offline messages (capped and auto-expired), seeing neither content nor sender. Only if you enable multi-device state sync does an encrypted state snapshot live on your relay — still ciphertext; the relay never sees plaintext.",
  donate_title: "Feed the fire",
  donate_intro:
    "Donations fund official node operations and some contributor bonuses. All links below are external and handled by your own third-party account or wallet.",
  donate_disclaimer: "This site has no in-app wallet, no custody, no cut, and no Zaps. Donating is entirely voluntary.",
  node_title: "Run your own node",
  node_intro:
    "This forest is held up by many small fires. Anyone can self-host a Cinderous relay node — a relay only forwards ciphertext; it sees neither your message content nor who talks to whom.",
  node_how_t: "How to host",
  node_how_b:
    "Two ways: a Cloudflare Worker (free tier is enough) or a container (Docker, self-hosted on a VPS / Raspberry Pi). See the self-hosting docs for steps.",
  node_step1_t: "Cloudflare Worker",
  node_step1_b: "Deploy the relay/ Worker to Cloudflare (free tier), wrangler deploy.",
  node_step2_t: "Container (Docker)",
  node_step2_b: "Self-host node-relay as a container on a VPS / Raspberry Pi (ADR-0075).",
  node_step3_t: "Donation fields (optional)",
  node_step3_b: "Self-report GitHub Sponsors / BMC / Liberapay / Lightning in NIP-11 (ADR-0089).",
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
    "This site has zero tracking, no cookies, and no third-party analytics; it is fully isolated from Cinderous's messaging plane and never touches user data or keys.",
};

const CATALOG: Record<Locale, Copy> = { "zh-Hant": zhHant, en };

export function useCopy(locale: Locale): Copy {
  return CATALOG[locale] ?? zhHant;
}
