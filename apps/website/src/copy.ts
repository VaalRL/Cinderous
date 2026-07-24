// 官網雙語文案（ADR-0090；ADR-0187 資訊架構改版）。重用 @cinderous/i18n 的 Locale；行銷文案為官網專屬。
// 意象：夜晚森林裡，一小簇營火旁圍坐的少數人——溫暖、私密、只有受邀者在場。
// 首頁＝核心價值觀與「取回通訊自主權」願景；技術原理獨立一頁；下載直連 GitHub Releases。
import type { Locale } from "@cinderous/i18n";

export interface Copy {
  nav_home: string;
  nav_tech: string;
  nav_node: string;
  nav_enterprise: string;
  nav_roadmap: string;
  nav_faq: string;
  nav_download: string;
  nav_transparency: string;
  /** FAQ 頁（ADR-0235 SEO-4）：標題、引言，與問答清單（同時餵頁面與 FAQPage JSON-LD）。 */
  faq_title: string;
  faq_intro: string;
  /** 問答對——GEO 關鍵：答案引擎最常擷取的正是這種「一問一答」結構。 */
  faqItems: { q: string; a: string }[];
  roadmap_title: string;
  roadmap_intro: string;
  roadmap_shipped_t: string;
  roadmap_shipped_b: string;
  roadmap_planned_t: string;
  roadmap_p_mobile_t: string;
  roadmap_p_mobile_b: string;
  roadmap_p_push_t: string;
  roadmap_p_push_b: string;
  roadmap_p_desktop_t: string;
  roadmap_p_desktop_b: string;
  roadmap_p_domain_t: string;
  roadmap_p_domain_b: string;
  hero_eyebrow: string;
  hero_title: string;
  /**
   * H1 內的**平述句**（ADR-0235 SEO-5）。
   *
   * 修正前 `<h1>` 就是 `"Cinderous"`——頁面最強的語意訊號只放一個沒人認識的品牌名，
   * 而整個 hero（eyebrow「取回通訊自主權」、subtitle「夜裡森林的營火」）都是意象。
   * 結果：**全站沒有任何一句話直接說出這是什麼產品**。搜尋引擎排不上、答案引擎也無從引用。
   * 這一行負責把「是什麼」講清楚，詩意留給 subtitle。
   */
  hero_h1_tagline: string;
  hero_subtitle: string;
  /** hero icon 按鈕列（ADR-0229）：可見標籤（手機）＋tooltip／aria-label 文案。 */
  hero_ic_windows: string;
  hero_ic_mac: string;
  hero_ic_mobile: string;
  hero_ic_web: string;
  hero_ic_github: string;
  hero_tip_windows: string;
  hero_soon: string;
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
  /** 威脅防護介紹（ADR-0231 P4）：主打純本地比對、URL 不外送、可自訂可關。 */
  tech_threat_t: string;
  tech_threat_b: string;
  tech_multi_title: string;
  tech_multi_lead: string;
  md_list: string;
  md_cipher: string;
  md_anchorA: string;
  md_anchorB: string;
  md_community: string;
  md_offline: string;
  /** 底層機制（進階）——近期落地的擴充：分片、多裝置同步、通話 NAT 穿透、換機備援。 */
  tech_adv_title: string;
  tech_adv_lead: string;
  tech_scale_t: string;
  tech_scale_b: string;
  tech_sync_t: string;
  tech_sync_b: string;
  tech_calls_t: string;
  tech_calls_b: string;
  tech_migrate_t: string;
  tech_migrate_b: string;
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
  /** 企業版頁（ADR-0246）：自架封閉節點、組織名冊、離職接管、政策與資料主權。 */
  ent_title: string;
  ent_intro: string;
  ent_closed_t: string;
  ent_closed_b: string;
  ent_roster_t: string;
  ent_roster_b: string;
  ent_offboard_t: string;
  ent_offboard_b: string;
  ent_policy_t: string;
  ent_policy_b: string;
  ent_sovereign_t: string;
  ent_sovereign_b: string;
  ent_open_t: string;
  ent_open_b: string;
  ent_deploy_t: string;
  ent_deploy_b: string;
  ent_note: string;
  ent_cta: string;
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
  nav_enterprise: "企業版",
  nav_roadmap: "藍圖",
  nav_faq: "常見問題",
  nav_download: "下載",
  nav_transparency: "透明度",
  faq_title: "常見問題",
  faq_intro: "關於 Cinderous 是什麼、如何保護你的隱私，以及與其他通訊軟體有何不同——最常被問到的問題。",
  faqItems: [
    {
      q: "Cinderous 是什麼？",
      a: "Cinderous 是一款開源、永久免費、隱私優先的去中心化即時通訊軟體。訊息以端到端加密（Nostr NIP-44／Gift Wrap），採本地優先儲存，中繼站不保存任何線上狀態——明文與私鑰永遠不離開你的裝置。桌面版（Windows）與網頁版皆可使用。",
    },
    {
      q: "Cinderous 安全嗎？我的訊息會被誰看到？",
      a: "只有對話中的人看得到內容。訊息以 NIP-44 端到端加密，並用 NIP-17／59 Gift Wrap 封裝——寄件人以一次性金鑰隱藏，中繼站看不到訊息內容、也看不出是誰發的。明文只存在你自己的裝置上，且經作業系統金鑰庫或本地密碼加密落地。（註：接收聯絡人在線狀態時，中繼會知道你的聯絡人清單；若要連這也不外流，可自架中繼。）",
    },
    {
      q: "使用 Cinderous 需要手機號碼或電子郵件嗎？",
      a: "不需要。首次啟動會在本機產生一組密碼學金鑰對，你的公鑰（npub）就是全網唯一的身分。沒有電話、沒有電子郵件、沒有實名——不會有一個中央資料庫握著你的通訊錄。",
    },
    {
      q: "Cinderous 和 Signal、Session、SimpleX 有什麼不同？",
      a: "Cinderous 建立在開放的 Nostr 協定上，任何人都能自架相容的中繼站、彼此互通——沒有單一公司控制的伺服器。它同時走 WebRTC P2P 直連（通話、檔案、在線狀態繞過中繼），並主打還原經典即時通訊的體驗（浮動對話窗、聯絡人分組、狀態文字）。與 Signal 不同，它不需要手機號碼，也不依賴單一營運方。",
    },
    {
      q: "真的完全免費嗎？背後靠什麼營運？",
      a: "是，永久免費、無廣告、無內購、不販售資料。程式碼以 AGPL-3.0 開源。官方中繼站的營運成本由自願捐款支持，並以簽章式的資金透明度公開。你也可以完全自架，不依賴任何官方基礎設施。",
    },
    {
      q: "伺服器是誰在運作？我的資料存在哪裡？",
      a: "你的資料（訊息、聯絡人、設定）以加密形式存在你自己的裝置上——那是唯一的真相來源。中繼站只轉發密文與暫存有到期時間的離線留言（預設 7 天），不持久化任何線上狀態。中繼可跑在 Cloudflare Workers、Docker 或樹莓派上，任何人都能自架。",
    },
    {
      q: "我的公司可以用 Cinderous 嗎？",
      a: "可以。企業模式支援自架封閉節點（以 allowlist 只放行組織成員）、組織名冊與邀請碼入職、離職接管，以及保留天數等公司設定。資料完全留在公司自己的基礎設施上，中繼全程只看得到密文與成員公鑰。",
    },
    {
      q: "如果我換手機或弄丟裝置，訊息會不見嗎？",
      a: "Cinderous 提供三條換機路徑：加密備份碼（自持）、opt-in 的加密雲端快照（中繼只見密文），以及桌面配對克隆（一次性 P2P 全量搬家、以 SAS 短碼互相確認，內容不經中繼）。由於沒有金鑰託管，建議重要身分登記在兩台裝置作為冗餘。",
    },
  ],
  roadmap_title: "產品藍圖",
  roadmap_intro: "Cinderous 已上線桌面版與網頁版。以下是已完成的能力，以及正在規劃的未來待辦。",
  roadmap_shipped_t: "✅ 已上線",
  roadmap_shipped_b:
    "桌面版（Windows）、網頁版（瀏覽器・本地優先加密）、端到端加密訊息（Nostr NIP-17/44/59）與去中心化中繼、WebRTC P2P（檔案／在線／通話）、群組、多身分、企業名冊、通知細分開關與每對話靜音、經典 MSN 佈局（浮動視窗、聯絡人分組）。",
  roadmap_planned_t: "🗓️ 未來待辦",
  roadmap_p_mobile_t: "行動版原生 App（Android／iOS）",
  roadmap_p_mobile_b:
    "目前行動端為 React Native Web（可攜底子與原生 shim 已備）；原生打包（Expo／RN）、系統金鑰庫、原生通知等待接。iOS 需 macOS 建置。",
  roadmap_p_push_t: "背景推播（APNs／FCM）",
  roadmap_p_push_b:
    "行動端要「關 App 也能收通知」需接推播＋一個推播中繼；含隱私取捨（可只推「有新訊息」、不含內容）。",
  roadmap_p_desktop_t: "macOS／Linux 桌面版",
  roadmap_p_desktop_b: "Tauri 已支援；目前釋出為 Windows，macOS／Linux 打包待補。",
  roadmap_p_domain_t: "自訂網域",
  roadmap_p_domain_b: "網頁版目前用 Cloudflare Worker 預設網址，日後綁自訂網域。",
  hero_eyebrow: "取回通訊自主權",
  hero_title: "Cinderous",
  hero_h1_tagline: "開源、端對端加密的去中心化即時通訊",
  hero_subtitle: "你的對話像夜裡森林深處的一簇營火，只有圍坐的人聽得見。",
  hero_ic_windows: "Windows",
  hero_ic_mac: "macOS",
  hero_ic_mobile: "行動版",
  hero_ic_web: "網頁版",
  hero_ic_github: "GitHub",
  hero_tip_windows: "下載 Windows 版",
  hero_soon: "即將推出",
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
    "明文永不離開你的裝置，全程端到端加密。訊息的寄件人以一次性金鑰隱藏，中繼站沒有可被翻閱的對話。想連元資料都握在自己手上？自架你自己的中繼。",
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
  tech_threat_t: "威脅防護：純本地、不送 URL",
  tech_threat_b:
    "訊息中的連結會與開源威脅情報清單（URLhaus、StevenBlack）比對——比對完全在你的裝置上進行，網址絕不外送到任何伺服器。命中的連結預設遮罩並標示來源；可自訂封鎖清單、可加嚴（不可展開、阻止送出），也可完全關閉。",
  tech_multi_title: "多個節點時，如何協作",
  tech_multi_lead:
    "當網路裡有很多節點，沒有誰是必經之路。你和好友各自連上任一可用中繼——中繼只轉發密文；任何一座離線，訊息自動改走其他座。哪些節點可用，由維護者簽章的節點清單決定（登入自動選座），即時互動則走 WebRTC P2P 直連、完全不經中繼。",
  md_list: "簽章節點清單 · 登入自動選座",
  md_cipher: "密文可經任一節點轉發",
  md_anchorA: "錨點 A",
  md_anchorB: "錨點 B",
  md_community: "社群節點",
  md_offline: "離線 → 改走其他節點",
  tech_adv_title: "底層機制（進階）",
  tech_adv_lead:
    "為了在「零伺服器狀態」前提下仍能規模化、跨裝置、且通話穩定，Cinderous 近期落地了幾項機制——全部維持中繼只見密文的原則。",
  tech_scale_t: "中繼分片與 presence 分層",
  tech_scale_b:
    "單一中繼可依公鑰把收件匣切成多個分片（Durable Object），負載自動分散、規模化不需要中央狀態；在線狀態走獨立的 presence 層，與訊息片分離。分片與否只改路由，中繼看到的仍然只有密文與公鑰，沒有可翻閱的對話（ADR-0241）。",
  tech_sync_t: "多裝置無衝突同步",
  tech_sync_b:
    "同一身分可在多台裝置登入。聯絡人、群組、設定等可變狀態以 CRDT（OR-Set／LWW／墓碑）合併——兩台裝置同時改動也能無衝突收斂，刪除以墓碑表示、逾期自動回收。跨裝置只透過一份加密狀態快照交換，中繼全程只見密文（ADR-0242／0071）。",
  tech_calls_t: "通話與 NAT 穿透",
  tech_calls_b:
    "語音／視訊與檔案優先走 WebRTC P2P 直連、完全不經中繼。連線協商用 STUN 探測公網位址；遇到對稱 NAT／嚴格防火牆無法直連時，改用短效憑證的 TURN 中繼保底（憑證由 Worker 現發、有到期），把接不通率壓到最低。企業可強制只走 TURN（relay-only）以符合網路政策（ADR-0243／G2）。",
  tech_migrate_t: "換機與備援",
  tech_migrate_b:
    "沒有金鑰託管＝沒有後門，因此換機提供三條自持路徑：加密備份碼、opt-in 的加密雲端快照（中繼只見密文），以及桌面配對克隆（一次性 P2P 全量搬家、以 SAS 短碼互相確認、內容不經中繼）。建議重要身分登記於兩台裝置作為冗餘。",
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
  ent_title: "企業版",
  ent_intro:
    "同一套開源核心，換一種部署姿態：企業自架一座封閉中繼，只放行組織成員，資料完全留在公司自己的基礎設施。中繼全程只看得到密文與成員公鑰——沒有明文、沒有可被傳喚的中央對話庫，也沒有第三方 SaaS 供應商站在你和員工中間。",
  ent_closed_t: "封閉自架節點",
  ent_closed_b:
    "以 allowlist 建立只放行組織成員的封閉中繼；非名冊成員連不進來。可跑在 Cloudflare Workers、Docker 或自有機房，資料與元資料都留在公司邊界內。",
  ent_roster_t: "組織名冊與邀請碼入職",
  ent_roster_b:
    "管理者維護一份簽章的成員名冊；新人以一次性邀請碼加入，自動取得工作身分與預設聯絡人／群組。無需手機號碼或電子郵件即可完成入職。",
  ent_offboard_t: "離職接管（無金鑰託管）",
  ent_offboard_b:
    "採「工作身分輪替」而非金鑰託管——公司不持有解密後門。成員離職或換機時，管理者以名冊撤舊、發新，成員端自動接續；想保留歷史者建議雙設備登記（ADR-0052）。",
  ent_policy_t: "公司政策設定",
  ent_policy_b:
    "可設定離線留言保留天數、允許的事件類型（kind allowlist），以及強制通話只走 TURN（relay-only）以符合網路／稽核政策。政策由自架中繼執行，不外流給任何第三方。",
  ent_sovereign_t: "資料主權",
  ent_sovereign_b:
    "明文與私鑰只存在成員裝置；中繼只轉發密文。整條通訊平面跑在你自己的基礎設施上，不依賴任何官方或第三方服務——關掉外網也能內部互通。",
  ent_open_t: "開源、可稽核、不鎖定",
  ent_open_b:
    "AGPL-3.0 授權，伺服器與客戶端程式碼皆可稽核；建構於開放的 Nostr 協定，任何相容中繼都能互通。沒有專有格式、沒有供應商鎖定——要遷出隨時可以。",
  ent_deploy_t: "如何部署",
  ent_deploy_b:
    "把 relay/ 的 Worker 部署到 Cloudflare（wrangler deploy），或以容器自架 node-relay 於 VPS／機房；設定 allowlist 與政策後，成員以邀請碼加入即可。詳見自架文件。",
  ent_note:
    "企業模式重用與一般版完全相同的加密核心——差別只在「誰來營運中繼、放行誰」。沒有另一套閉源企業版，也沒有為了功能而弱化的加密。",
  ent_cta: "看自架與企業部署文件",
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
  nav_enterprise: "Enterprise",
  nav_roadmap: "Roadmap",
  nav_faq: "FAQ",
  nav_download: "Download",
  nav_transparency: "Transparency",
  faq_title: "Frequently asked questions",
  faq_intro: "The questions people ask most — what Cinderous is, how it protects your privacy, and how it differs from other messengers.",
  faqItems: [
    {
      q: "What is Cinderous?",
      a: "Cinderous is open-source, forever-free, privacy-first decentralized messaging. Messages are end-to-end encrypted (Nostr NIP-44 / Gift Wrap), storage is local-first, and relays keep no online state — plaintext and private keys never leave your device. It runs on desktop (Windows) and in the browser.",
    },
    {
      q: "Is Cinderous secure? Who can read my messages?",
      a: "Only the people in the conversation. Messages are end-to-end encrypted with NIP-44 and wrapped with NIP-17/59 Gift Wrap — the sender is hidden behind a one-time key, so relays see neither the content nor who sent it. Plaintext exists only on your own device, encrypted at rest via the OS keychain or a local password. (Note: to receive contacts' online status, the relay does learn your contact list; self-host a relay if you want even that kept private.)",
    },
    {
      q: "Do I need a phone number or email to use Cinderous?",
      a: "No. On first launch your device generates a cryptographic keypair; your public key (npub) is your unique identity across the whole network. No phone, no email, no real name — there is no central database holding your contacts.",
    },
    {
      q: "How is Cinderous different from Signal, Session, or SimpleX?",
      a: "Cinderous is built on the open Nostr protocol, so anyone can self-host a compatible relay and interoperate — there is no single company-controlled server. It also uses WebRTC P2P for calls, files and presence (bypassing relays), and deliberately restores the classic instant-messenger experience (floating chat windows, contact groups, status text). Unlike Signal it needs no phone number and depends on no single operator.",
    },
    {
      q: "Is it really free? How is it funded?",
      a: "Yes — forever free, no ads, no in-app purchases, no data sales. The code is AGPL-3.0 open source. Official relay costs are covered by voluntary donations, published with signed funding transparency. You can also self-host entirely, depending on no official infrastructure.",
    },
    {
      q: "Who runs the servers? Where is my data stored?",
      a: "Your data (messages, contacts, settings) lives encrypted on your own device — that is the single source of truth. Relays only forward ciphertext and briefly hold offline messages with an expiry (7 days by default); they persist no online state. A relay can run on Cloudflare Workers, Docker, or a Raspberry Pi, and anyone can self-host one.",
    },
    {
      q: "Can my company use Cinderous?",
      a: "Yes. Enterprise mode supports a self-hosted closed node (an allowlist admitting only organization members), org rosters with invite-code onboarding, offboarding takeover, and company settings such as retention days. Data stays entirely on the company's own infrastructure, and the relay only ever sees ciphertext and member public keys.",
    },
    {
      q: "If I switch phones or lose my device, do I lose my messages?",
      a: "Cinderous offers three device-migration paths: an encrypted backup code you hold yourself, an opt-in encrypted cloud snapshot (relays see only ciphertext), and desktop pairing clone (a one-time P2P full transfer confirmed via a short SAS code, with content never touching a relay). Since there is no key escrow, registering an important identity on two devices is recommended for redundancy.",
    },
  ],
  roadmap_title: "Roadmap",
  roadmap_intro: "Cinderous already ships desktop and web. Here's what's done, and what's planned next.",
  roadmap_shipped_t: "✅ Shipped",
  roadmap_shipped_b:
    "Desktop (Windows), web app (browser, local-first encrypted), end-to-end encrypted messaging (Nostr NIP-17/44/59) with decentralized relays, WebRTC P2P (files / presence / calls), groups, multi-identity, enterprise roster, per-event notification toggles and per-conversation mute, and the classic MSN layout (floating windows, contact grouping).",
  roadmap_planned_t: "🗓️ Planned",
  roadmap_p_mobile_t: "Native mobile apps (Android / iOS)",
  roadmap_p_mobile_b:
    "Mobile is currently React Native Web (the portable base and native shims are in place); native packaging (Expo / RN), OS keychain, and native notifications remain to be wired. iOS requires a macOS build.",
  roadmap_p_push_t: "Background push (APNs / FCM)",
  roadmap_p_push_b:
    'For mobile to notify while the app is closed, we need push plus a relay; this involves a privacy trade-off (can push only "new message" without content).',
  roadmap_p_desktop_t: "macOS / Linux desktop",
  roadmap_p_desktop_b: "Tauri already supports them; current releases are Windows — macOS / Linux packaging is pending.",
  roadmap_p_domain_t: "Custom domain",
  roadmap_p_domain_b: "The web app currently uses the default Cloudflare Worker URL; a custom domain will be bound later.",
  hero_eyebrow: "Own your conversations",
  hero_title: "Cinderous",
  hero_h1_tagline: "Open-source, end-to-end encrypted decentralized messaging",
  hero_subtitle: "Your conversations are a campfire deep in a night forest — heard only by those sitting around it.",
  hero_ic_windows: "Windows",
  hero_ic_mac: "macOS",
  hero_ic_mobile: "Mobile",
  hero_ic_web: "Web app",
  hero_ic_github: "GitHub",
  hero_tip_windows: "Download for Windows",
  hero_soon: "Coming soon",
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
    "Plaintext never leaves your device; everything is end-to-end encrypted. Message senders are hidden behind one-time keys, so relays have no conversations to browse. Want even the metadata in your own hands? Self-host your own relay.",
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
  tech_threat_t: "Threat protection: local-only, no URL ever sent",
  tech_threat_b:
    "Links in messages are checked against open-source threat-intelligence lists (URLhaus, StevenBlack) — matching happens entirely on your device; URLs are never sent to any server. Flagged links are masked with their source shown; you can add your own blocklist, go strict (no reveal, block sending), or turn it off entirely.",
  tech_multi_title: "How many nodes collaborate",
  tech_multi_lead:
    "With many nodes in the network, no single one is on the critical path. You and your friend each connect to any available relay — relays only forward ciphertext; if one goes offline, messages route via others automatically. Which nodes are available is decided by a maintainer-signed node list (auto-seat on sign-in), while real-time interactions go straight over WebRTC P2P, bypassing relays entirely.",
  md_list: "Signed node list · auto-seat on sign-in",
  md_cipher: "ciphertext via any node",
  md_anchorA: "Anchor A",
  md_anchorB: "Anchor B",
  md_community: "Community node",
  md_offline: "offline → route via others",
  tech_adv_title: "Under the hood (advanced)",
  tech_adv_lead:
    "To stay scalable, multi-device, and reliable on calls — all while keeping zero server state — Cinderous recently landed a few mechanisms, every one of them keeping relays to ciphertext only.",
  tech_scale_t: "Relay sharding & presence layer",
  tech_scale_b:
    "A single relay can split its inbox into shards by public key (Durable Objects), spreading load and scaling without any central state; online presence runs on a separate layer, decoupled from message shards. Sharding only changes routing — the relay still sees only ciphertext and public keys, with no conversations to browse (ADR-0241).",
  tech_sync_t: "Conflict-free multi-device sync",
  tech_sync_b:
    "One identity can sign in on several devices. Mutable state — contacts, groups, settings — merges via CRDTs (OR-Set / LWW / tombstones), so simultaneous edits on two devices converge without conflict; deletions are tombstoned and garbage-collected on expiry. Devices exchange only an encrypted state snapshot, and relays see ciphertext throughout (ADR-0242 / 0071).",
  tech_calls_t: "Calls & NAT traversal",
  tech_calls_b:
    "Voice/video and files prefer a direct WebRTC P2P link, bypassing relays entirely. Connection setup uses STUN to discover public addresses; when symmetric NAT or a strict firewall blocks a direct path, it falls back to a TURN relay with short-lived credentials (minted on demand by the Worker, with expiry) to minimize failed calls. Enterprises can force relay-only (TURN) to satisfy network policy (ADR-0243 / G2).",
  tech_migrate_t: "Device migration & redundancy",
  tech_migrate_b:
    "No key escrow means no backdoor, so device migration offers three self-held paths: an encrypted backup code, an opt-in encrypted cloud snapshot (relays see only ciphertext), and desktop pairing clone (a one-time P2P full transfer confirmed via a short SAS code, content never touching a relay). Registering an important identity on two devices is recommended for redundancy.",
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
  ent_title: "Enterprise",
  ent_intro:
    "The same open-source core, deployed differently: your organization self-hosts a closed relay that admits only its members, keeping data entirely on your own infrastructure. The relay only ever sees ciphertext and member public keys — no plaintext, no central conversation store to subpoena, and no third-party SaaS vendor sitting between you and your employees.",
  ent_closed_t: "Closed self-hosted node",
  ent_closed_b:
    "Stand up a closed relay whose allowlist admits only organization members; non-roster keys can't connect. Run it on Cloudflare Workers, Docker, or your own hardware — data and metadata stay inside your boundary.",
  ent_roster_t: "Org roster & invite-code onboarding",
  ent_roster_b:
    "Admins maintain a signed member roster; new hires join with a one-time invite code and automatically receive a work identity plus default contacts/groups. Onboarding needs no phone number or email.",
  ent_offboard_t: "Offboarding takeover (no key escrow)",
  ent_offboard_b:
    "Uses work-identity rotation rather than key escrow — the company holds no decryption backdoor. When a member leaves or switches devices, an admin revokes the old and issues a new identity via the roster, and the member's client picks up seamlessly; register two devices to retain history (ADR-0052).",
  ent_policy_t: "Company policy controls",
  ent_policy_b:
    "Set offline-message retention days, an allowed event-kind list, and force calls to relay-only (TURN) to meet network or audit policy. Policies are enforced by your self-hosted relay and never leave it.",
  ent_sovereign_t: "Data sovereignty",
  ent_sovereign_b:
    "Plaintext and private keys live only on member devices; the relay forwards ciphertext only. The entire messaging plane runs on your own infrastructure, depending on no official or third-party service — cut off the internet and internal messaging still works.",
  ent_open_t: "Open, auditable, no lock-in",
  ent_open_b:
    "AGPL-3.0 licensed — both server and client code are auditable; built on the open Nostr protocol, so any compatible relay interoperates. No proprietary formats, no vendor lock-in — you can migrate out anytime.",
  ent_deploy_t: "How to deploy",
  ent_deploy_b:
    "Deploy the relay/ Worker to Cloudflare (wrangler deploy), or self-host node-relay as a container on a VPS / in your data center; configure the allowlist and policies, then members join with an invite code. See the self-hosting docs.",
  ent_note:
    "Enterprise mode reuses the exact same encryption core as the regular app — the only difference is who operates the relay and who it admits. There is no separate closed-source enterprise build, and no crypto weakened for features.",
  ent_cta: "Read the self-hosting & enterprise docs",
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
