# 0038. 網址衛生：貼上清除追蹤參數 + 本地啟發式高風險警告

- 狀態：已接受
- 日期：2026-07-02
- 相關文件：apps/desktop/src/ui/url-hygiene.ts、markdown.tsx、ConversationWindow.tsx

## 背景與問題

1. 貼上的網址常帶追蹤參數（`utm_*`、`fbclid`、`gclid`…），收端點開即被
   跨站關聯——與「隱私預設」硬規則相悖。
2. Markdown 連結 `[文字](href)` 的顯示文字與實際 href 可完全不同，是
   經典釣魚向量；另有 IDN 同形字、`userinfo@` 混淆等手法，目前無任何防護。

## 考量的選項

- **追蹤碼清除**：(a) 貼上時清理（使用者送出前看得到）；(b) 送出時偷偷改；
  (c) 收端渲染時改。
- **風險判定**：(i) **本地啟發式**（零網路）；(ii) 外部信譽 API
  （Google Safe Browsing 等）；(iii) 內建靜態黑名單快照。

## 決策

- **清除採 (a) 貼上時清理**（composer `onPaste` 攔截）：透明——清理結果
  就在輸入框裡，使用者可自行改回。規則引擎純函式（`cleanUrl`/`cleanText`）：
  - 全域規則：`utm_` 前綴 + 已知追蹤參數名精確比對（fbclid/gclid/msclkid/
    igshid/ttclid/twclid/yclid/wbraid/gbraid/spm/mc_eid/_hsenc…）。
  - 站點規則：參數語意依站而異者只在該站清（如 `si` 僅 YouTube/Spotify）；
    Amazon 另清 `/ref=` 路徑段與 `pd_rd_`/`pf_rd_` 前綴。
  - **只刪已註冊的名字、不整段砍 query**；無可清除時回傳原字串
    （避免 URL 正規化造成的無謂改寫）。redirect 拆殼留 v2。
- **風險判定採 (i) 本地啟發式**，`assessUrl(href, linkText?) → {level, reasons}`：
  - danger：連結文字偽裝（文字長得像網址但網域與 href 不符）、
    `userinfo@` 混淆、punycode（`xn--`）、IP 直連。
  - caution：非常規 port、純 http、已知短網址服務（無法預覽目的地）。
  - 呈現：連結加 ⚠ 徽章；點擊時 `confirm` 列出具體理由、確認才開
    （警告不封鎖——使用者自主）。**收發兩端都在渲染層生效**。
- **明確否決 (ii) 外部信譽 API**：Lookup 模式把每條網址送第三方，洩漏
  通訊 metadata（同 ADR-0035 否決 NIP-65 的邏輯）；Update（hash 前綴庫）
  仍需 API key、常態同步與部分洩漏，且與零伺服器狀態衝突。未來若需，
  走自家 relay 代理另立 ADR。(iii) 時效差、體積大，不採。

## 理由

- 兩功能皆純本地、零網路、純函式可測，與隱私硬規則完全同向。
- 貼上時清理是唯一「使用者看得到發生了什麼」的位置；渲染層警告則
  同時保護收端（對方或未升級客戶端送來的原始連結一樣被檢查）。

## 後果

- 正面：發收兩端的跨站追蹤面下降；釣魚連結在點擊前有明確攔截點。
- 負面／限制：參數清單需隨生態演進維護（誤清風險以「精確名單＋站點
  範圍」壓低）；啟發式無法辨識「乾淨網域的純釣魚內容」（那是信譽庫
  的領域，已明確延後）；貼上清理發生時 textarea 原生 undo 佇列會中斷。
- 後續：redirect 拆殼（`google.com/url?q=`、`l.facebook.com/l.php?u=`）、
  hash 片段追蹤碼、設定開關。
