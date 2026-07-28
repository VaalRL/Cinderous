# 研究：退役舊手機插電當家庭 relay（手機同時跑 relay＋客戶端、電腦另裝客戶端）

> 目的：評估「在手機上同時架設 relay 與客戶端，電腦再裝另一個客戶端連上來」的可行性，
> 並收斂出最有價值的形態——**退役 Android 手機插電常駐，作為個人／家庭 relay**。
> 判準：現有資產可否直接跑、網路可達性、作為伺服器的可靠性、與 multi-relay 架構的相容性。
> 相關：ADR-0075（容器化自架）、ADR-0034（客戶端 Relay Pool）、ADR-0039（錨點＋簽章清單）、
> `relay/src/node-relay.ts`、`docs/self-hosting-raspberry-pi.md`。結論先行，細節在後。

## 結論摘要

**Android 上今天就拼得出來，零程式碼修改**；iOS 實質不可行（背景常駐伺服器被系統與商店政策封死）。
真正的門檻不在「跑不跑得起來」，在**手機作為伺服器的可靠性**（息屏省電、換網、CGNAT）——
而「**退役舊手機＋插電＋常駐家中 Wi-Fi**」這個形態恰好把三個弱點解掉兩個半，
剩下的（對外可達性）由既有的 multi-relay pool＋錨點 fallback 兜住。它就是一台免費的樹莓派。

| 形態 | 可行性 | 定位 |
| --- | --- | --- |
| **退役手機插電當家庭 relay（Termux＋node-relay）** | 🟢 現在可行 | 本研究主推；樹莓派的零成本替代 |
| 隨身主力機跑 relay（人帶著走） | 🟡 勉強 | 息屏/換網/CGNAT 三弱點全中；只適合同 LAN 實驗 |
| App 內嵌 relay（產品化） | 🔴 不建議 | 需原生模組、iOS 不可行、可靠性天生受限 |

## 1. 為什麼零程式碼就能跑：現有資產盤點

| 資產 | 現況 | 對本題的意義 |
| --- | --- | --- |
| `node-relay`（ADR-0075） | esbuild 單檔 bundle（~97KB、已含 `@cinderous/core`），唯一外部依賴 `ws`（純 JS） | **無原生編譯**——Termux 的 Node 直接跑 |
| 離線留言持久化 | Node 22 內建 `node:sqlite`，檔案落地（`DB_PATH`） | 手機儲存即資料庫；重開機不掉留言 |
| 設定面 | 全走環境變數（`PORT`/`REQUIRE_AUTH`/`MAX_TTL_DAYS`/`MAX_EVENTS_PER_MINUTE`…） | 與雲端版同一組濫用防護常數（ADR-0235 H1） |
| 客戶端自訂 relay | 登入「使用其他中繼站」＋ per-identity relay；multi-relay pool（ADR-0034） | **客戶端零改動**即可連家庭 relay |
| 錨點 fallback（ADR-0039） | 簽章清單＋兩座錨點 | 家庭 relay 掛掉時訊息自動走錨點，體驗不破 |
| 樹莓派自架文件 | `docs/self-hosting-raspberry-pi.md` | Termux 版只差一份指南的距離 |

## 2. 目標拓撲

```
┌─ 退役 Android 手機（插電、家中 Wi-Fi）─────────────┐
│  Termux：node node-relay.js  (ws://0.0.0.0:8787)   │
│  └ SQLite 落地手機儲存（離線留言、重開機不掉）      │
│  （可選）同機客戶端連 ws://127.0.0.1:8787          │
└────────────────────────────────────────────────────┘
          ▲ 同一網路：ws://<手機IP>:8787
┌─ 電腦（桌面版客戶端）─┐   ┌─ 主力手機（客戶端）─┐
│  登入時填家庭 relay    │   │  同上；出門後走錨點  │
└───────────────────────┘   └─────────────────────┘
```

## 3. 逐項可行性

### 3.1 手機跑 relay（Android／Termux）🟢
- `pkg install nodejs`（Termux 供 Node 22+，`node:sqlite` 內建）→ 放入 bundle＋`npm i ws` → `PORT=8787 node node-relay.js`。
- **保活三件事**：`termux-wake-lock`（防 Doze 掛起）、系統設定把 Termux 排除於電池最佳化、（可選）Termux:Boot 開機自啟。插電常駐下實務穩定。
- 部分 OEM（小米/華為等）的激進殺程序仍可能出手——插電＋鎖定工作列通知可大幅緩解；這是 Android 生態現實，指南需明示。

### 3.2 手機同時跑客戶端 🟢
Termux relay 與客戶端是獨立程序；同機連 `ws://127.0.0.1:8787`（瀏覽器對 localhost 有 mixed-content 豁免）。

### 3.3 電腦客戶端連家庭 relay
- **同一網路**：桌面版填 `ws://<手機IP>:8787` 即通（Tauri 不受 mixed-content 限制）。手機開熱點時 IP 固定 `192.168.x.1`。
- **瀏覽器版電腦端連不上裸 ws**：https 頁面連非 localhost 的 `ws://` 被 mixed content 擋 → 電腦端用桌面版，或走 §3.5 的 Cloudflare Tunnel 取得 wss。
- **跨網路（外網連入）**：見 §3.5 專節。

### 3.5 外網連入：三條路

| 方案 | 難度 | 傳輸加密 | 穿 CGNAT | 適合 |
| --- | --- | --- | --- | --- |
| **① Tailscale（推薦）** | 🟢 最低 | ✅ WireGuard | ✅ | 自己＋家人的裝置 |
| **② Cloudflare Tunnel** | 🟡 中 | ✅ wss（至 CF 邊緣） | ✅ | 開放給朋友、或瀏覽器版客戶端 |
| **③ Port-forward＋DDNS** | 🟡 中 | ❌ 裸 ws | ❌ 需家用寬頻有公網 IP | 技術控 |

- **① Tailscale**：手機（Android app）＋各客戶端裝置登同一 tailnet → 任何地方填
  `ws://<tailscale IP>:8787`（MagicDNS 可給穩定名稱）。零路由器設定、穿 CGNAT、隧道本身
  即 WireGuard 加密（順帶解掉裸 ws 疑慮）；relay 綁所有介面故 Termux 端零改動。
  限制：每台要連的裝置都須在 tailnet 內——「自己＋家人」剛好，陌生人不行。
- **② Cloudflare Tunnel**：Termux `pkg install cloudflared` → tunnel 指 `localhost:8787` →
  綁 CF 網域得 `wss://relay.<網域>`。不開入站 port、穿 CGNAT、**真 wss**（瀏覽器版客戶端
  也能連）。誠實取捨：TLS 於 CF 邊緣終止——訊息內容仍為 E2E 密文，但連線層元資料
  （誰何時連）CF 可見，與純自架的資料主權敘事有所折衷。
  - **無網域變體：Quick Tunnel（TryCloudflare）**——免帳號免網域：
    `cloudflared tunnel --url http://localhost:8787` 即得隨機
    `https://<random>.trycloudflare.com`，客戶端填對應 `wss://`（客戶端 30s 心跳
    〔ADR-0059〕恰好也讓 CF 閒置逾時咬不到長連線）。**定位＝臨時測試/短暫分享**：
    網址每次重啟都變（常駐 relay 的硬傷——重開機後全部客戶端要重設）、官方定位測試用
    無 SLA。常駐請走 ①（Tailscale 完全不需網域且位址穩定）或買網域走具名 tunnel。
- **③ Port-forward＋DDNS**：路由器轉發 TCP 8787 → 手機固定區網 IP＋DDNS。前提是家用寬頻
  有公網 IPv4（部分 ISP／4G 家用寬頻為 CGNAT 即不通）。裸 `ws://` 走公網：內容有 E2E
  保護（relay 本就只見密文），但傳輸層無加密——要 wss 得再架反代＋憑證，家庭場景不划算，
  有此需求直接用 ①②。
- **安全底線（已內建，維持預設即可）**：`REQUIRE_AUTH` 預設開（NIP-42 擋匿名讀取）＋
  速率限制等濫用防護（ADR-0235 H1，與雲端版同一組常數）。

### 3.4 iOS 🔴
無 Termux 等價物；背景常駐伺服器被系統掛起策略與 App Store 政策雙重封死。不做。

## 4. 可靠性誠實評估（這才是決策重點）

relay 的職責＝離線留言暫存＋presence/信令轉發，期望 always-on。手機三弱點 vs 本形態：

| 弱點 | 隨身機 | **插電退役機** |
| --- | --- | --- |
| 息屏/省電殺程序 | 🔴 常態 | 🟢 插電＋wake-lock＋豁免省電＝基本解掉 |
| 換網路/IP 變動 | 🔴 常態 | 🟢 常駐家中 Wi-Fi，LAN IP 可固定 |
| 入站可達性 | 🔴 CGNAT 無解 | 🟡 家用寬頻可 port-forward／隧道 |

再加一層架構保險：客戶端 relay pool 同時掛「家庭 relay＋錨點」——家庭 relay 睡著/斷線時訊息走錨點，
**不會因為自架而變脆**；家庭 relay 在線時提供資料主權增益（離線留言存自己手機、密文不落他人雲）。

## 5. 否決的路徑：App 內嵌 relay

RN/webview 的 JS 沒有 server socket API → 需原生模組（Android 前台服務＋nodejs-mobile 或 Rust server）；
iOS 不可行導致做完也只有半個平台；可靠性天花板同 §4 卻多揹一整套原生工程。
投入產出不成比例，**不建議**。Termux 路徑把同樣的價值以零程式碼交付。

## 6. 建議路線

1. **短期（零程式碼）**：實機驗證 Termux 跑 node-relay 一輪（bundle 已就緒），寫
   `docs/self-hosting-android-termux.md`（比照樹莓派文件：安裝、保活三件事、OEM 殺程序注意、
   桌面端連線、錨點 fallback 說明）。
2. **不做** app 內嵌 relay（理由見 §5）。
3. 客戶端**零改動**——自訂 relay＋pool＋錨點 fallback 全部現成。
4. 若日後把「舊手機變家庭節點」做成產品敘事（官網/文件入口），另立 ADR。

> 本文件為**研究記錄、非決策**。實作第 1 項（Termux 指南）時不需 ADR（純文件）；
> 產品化敘事或內嵌路線若重啟，再依該路線立 ADR。
