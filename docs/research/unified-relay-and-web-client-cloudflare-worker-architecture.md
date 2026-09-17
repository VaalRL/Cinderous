# 研究與設計：Cinderous 統一節點架構——單一 Cloudflare Worker 整合 Relay 與 Web 客戶端設計規格書 (Unified Relay & Web Client in Single Cloudflare Worker)

> **文件狀態**：研究稿（已審查）——決策見 **ADR-0354**；2026-09-17 依審查結論回寫修正，原稿錯誤處以「🔴 審查修正」標示  
> **建立日期**：2026-09-17  
> **研究目標**：評估將 Cinderous 後端 Relay（Cloudflare Worker + Durable Objects）與前端 Web 客戶端（Vite + React SPA）合體部署於「同一個 Cloudflare Worker 節點」之架構設計、路由分流、安全邊界與自動化部署流程。  
> **關聯文檔**：  
> - ADR-0005（自架 Relay 與 Worker 設計）  
> - ADR-0056（Durable Object 內建 SQLite 持久化）  
> - ADR-0059（休眠式 WebSocket 降低喚醒成本）  
> - ADR-0090（官網與通訊平面硬隔離鐵則）  
> - ADR-0147（自架網頁版部署與子網域邊界）  
> - ADR-0208（Cloudflare Pages / Workers Static Assets 原生部署）  
> - ADR-0241（分片路由機制）  
> - ADR-0243（公共 TURN 保底換發）  
> - **ADR-0354（本稿的審查結論與採用形態）**、ADR-0344（App 內一鍵部署）  

---

## 🔴 審查修正摘要（2026-09-17，對應 ADR-0354）

原稿方向與 ADR-0147／0208 相容、不違反 ADR-0090，但對照 `relay/src/worker.ts`、`relay/wrangler.toml`、`apps/desktop/src/ui/SignIn.tsx` 與 Cloudflare 官方文件後，下列五點必須修正；下文各段已就地更正：

1. **WebSocket 到不了 DO（致命）**：Workers Static Assets 預設「資產優先」，`GET /` 命中 `index.html` 就直接回傳、不執行 Worker；ADR-0241 的舊客戶端回退路徑正是 `/` ⇒ `wss://host/` 拿到 HTML。**必須設 `run_worker_first = true`**。
2. **「一次 API 呼叫」不成立**：含靜態資產的直傳是三步（`assets-upload-session` 送 manifest → 分桶上傳 → 帶完成 JWT 的 Script Upload）；web dist（約 1.1 MB）也要進 ADR-0344 的 App 打包鏈。
3. **`connect-src 'self'` 與路由設計衝突**：ADR-0344 明寫錨點仍留 pool 保底，客戶端會連多座 relay、`stun.cloudflare.com:3478` 與 `/turn` 換發的 TURN 主機。**維持 ADR-0208 基線 `'self' wss: stun.cloudflare.com:3478`**。
4. **`GET /` 純文字契約**（ADR-0089，`docs/SELF-HOSTING*.md` 與 zeabur 文件據此驗證）未處理 ⇒ 決策：**新增 `/healthz` 承接純文字**，兩座宿主一致。
5. **違反 Fix First 與 ADR-0344 命名**：不新增 `resolveDefaultRelayUrl()`（延伸既有 `initialRelayUrl`）、不新增 `wrangler.unified.toml`、worker 名稱維持 `cinder-relay`；原稿引用的 `./turn.js` 與 `/healthz` 當時不存在於 repo。

**採用形態**：合體為**自架者選配模式**（`[assets]` 可選），官方錨點站不啟用資產。

---

## 結論摘要 (Executive Summary)

1. **現況問題**：
   - 目前 Cinderous 網頁版部署在架構上分為兩個獨立實體：後端 Relay Worker（`cinder-relay`，佔用一個 `workers.dev` 網址）與前端 Web App（`apps/desktop` 的靜態建置，透過 Cloudflare Pages 或獨立 Static Assets Worker 託管於另一個網址）。
   - 此架構造成使用者自架或 Obsidian 外掛自動化一鍵部署時，必須**執行兩次 API 部署、管理兩套網址、處理跨域 (CORS) 與跨網域 CSP 設定**，且 Web 客戶端首次載入時需要手動配置或在 URL 附帶 `?relay=wss://...` 參數。
2. **核心突破（Workers with Static Assets）**：
   - 善用 Cloudflare 於 2024～2025 年正式合流的 **Workers with Static Assets（靜態資產與動態 Worker 原生合體）** 機制。
   - 在單一 Worker 設定檔中，同時綁定前端 SPA 靜態產物目錄（`[assets]`）與後端 Durable Object（`[[durable_objects.bindings]]`）。
3. **關鍵收益**：
   - **單一流程一鍵部署**：🔴 審查修正——不是「一次 API 呼叫」。含資產的部署為三步（manifest → 分桶上傳 → 帶 JWT 的 Script Upload），由 ADR-0344 的 `cloudflare-deploy` 模組串成一個流程；資產未變更時 `buckets` 為空、直接拿完成 token。
   - **自指連線 (Self-Referencing Relay)**：前端網頁在「由啟用資產的 Worker 送出」時預設連 `wss://${location.host}`；🔴 審查修正——以延伸 `initialRelayUrl` 的第三順位實作，且不得以「凡是瀏覽器就自指」推論（Pages 與 `vite dev` 也是瀏覽器）。
   - ~~**密碼學安全極限收緊 (Ultra-Strict CSP)**：`connect-src 'self'`~~ 🔴 審查修正——**不採用**。錨點 pool、H2/H3 搬家、STUN 與 TURN 都是跨源連線，鎖死同源會打壞多 relay 路由與通話保底；維持 ADR-0208 的 `'self' wss: stun.cloudflare.com:3478`。
   - **跨客戶端 100% 無縫相容**：Obsidian 筆記同步外掛 (`CinderSync`)、通訊外掛 (`Cinderous Chat`)、Tauri 桌面端與行動端 App 依然能無礙將此 Worker 視為標準 Nostr Relay 連線使用。

---

## 1. 系統架構拓撲與協定層分流機制 (Architecture & Protocol Routing)

在 HTTP 協定層面，「靜態網頁載入」與「中繼通訊連線」具備天然正交的請求特徵。單一 Worker 可以在 Cloudflare 邊緣節點進行微秒級精準分流：

```mermaid
flowchart TD
    Req["客戶端請求到達：<br/>https://cinderous.<subdomain>.workers.dev"] --> IsWS{"檢查請求標頭：<br/>Upgrade === 'websocket'？"}

    subgraph 通訊與中繼平面 (Relay Plane)
        IsWS -->|是 (YES)| RouteDO["⚡ 路由給 Durable Objects (RelayRoom)<br/>• 依 URL 進行分片路由 (ADR-0241)<br/>• NIP-42 密碼學簽章認證<br/>• Nostr NIP-59 / NIP-44 密文廣播<br/>• SQLite 離線事件隊列 (ADR-0056)"]
    end

    subgraph 特殊 API 平面 (Control Plane)
        IsWS -->|否 (NO)| CheckAPI{"檢查請求路徑：<br/>url.pathname"}
        CheckAPI -->|/turn| RouteTurn["🔑 WebRTC 短期 TURN 憑證換發 (ADR-0243)<br/>• 向 Cloudflare API 申請短期憑證<br/>• 附帶 CORS 標頭回傳"]
        CheckAPI -->|NIP-11 Accept| RouteNIP11["📜 NIP-11 Relay 資訊文件 (ADR-0260)<br/>• 回傳站名、公鑰、支援功能 JSON"]
    end

    subgraph 前端資產平面 (Static Assets Plane)
        CheckAPI -->|其他所有 HTTP GET| RouteAssets["🌐 env.ASSETS.fetch(request)<br/>• 直接命中 Cloudflare 邊緣 CDN 快取<br/>• 0 CPU 運算開銷<br/>• not_found_handling 自動回退 index.html (SPA)"]
    end
```

### 1.1 為什麼分流不會產生衝突？
- 🔴 **審查修正（前提）**：上圖的分流只有在 **`run_worker_first = true`** 時成立。Static Assets 預設是「資產優先」——Cloudflare 先比對資產，命中就直接回傳、**根本不執行 Worker**；`GET /`（含帶 `Upgrade: websocket` 的 `/`）會命中 `index.html`，而 `/` 正是 ADR-0241 舊客戶端的回退路徑。未設此旗標＝靜默故障（HTML 200，不是錯誤）。
- **WebSocket 升級**：任何標準 Nostr 連線（包括 Obsidian 外掛、桌面 App、手機 App）皆帶有 `Upgrade: websocket` 標頭，Worker 第一行優先攔截並派發給 Durable Object，不觸發資產尋址（在 `run_worker_first` 前提下）。
- **靜態檔案優先級**：靜態資產請求（如 `/assets/index-D7a8.js`、`/favicon.ico`）全部由 Cloudflare 底層 Assets 引擎直接於快取層命中並交付，不消耗 Worker CPU 執行時間額度。
- **SPA 路由回退**：若使用者在瀏覽器深層造訪 `/chat/npub1...`，由於沒有同名實體檔案，Cloudflare Assets 引擎自動將請求回退至 `/index.html`，交由前端 React Router 渲染。

---

## 2. 設定檔與 Monorepo 建置管線規格

### 2.1 統一 Worker 設定檔：`relay/wrangler.toml`
在既有的 `relay/wrangler.toml` 中，以**註解化的選配區塊**呈現 `[assets]`（🔴 審查修正：不新增 `wrangler.unified.toml`；worker 名稱維持 `cinder-relay`，ADR-0344 冪等重跑依賴此名；官方錨點站不啟用）：

```toml
name = "cinder-relay"
main = "src/worker.ts"
compatibility_date = "2024-12-01"

# ── 1. 前端 React SPA 靜態資產綁定（選配；ADR-0354）───────────────────
# 自架者要「同一網址＝relay＋網頁版」時取消註解。
# 🔴 run_worker_first 必設：預設「資產優先」會讓 `/` 命中 index.html 而不執行 Worker，
#    ADR-0241 回退路徑 `wss://host/` 就到不了 Durable Object。
[assets]
directory = "../apps/desktop/dist"
not_found_handling = "single-page-application"
binding = "ASSETS"
run_worker_first = true

# ── 2. Durable Object 記憶體房間與 SQLite 持久儲存───────────────────
[[durable_objects.bindings]]
name = "RELAY_ROOM"
class_name = "RelayRoom"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RelayRoom"]

# ── 3. 公共 TURN 保底憑證換發設定（ADR-0243）────────────────────────
[vars]
TURN_KEY_ID = "99042103a647961e049a2783b8e87d3b"
TURN_TTL_SECONDS = "300"

[[ratelimits]]
name = "TURN_LIMIT"
namespace_id = "1001"

[ratelimits.simple]
limit = 20
period = 60
```

### 2.2 建置管線整合（Monorepo Build Pipeline）
在專案根目錄，一鍵建置前端並部署統一 Worker：

```bash
# 步驟 1：建置桌面/Web 共用的純前端 SPA 產物
pnpm --filter @cinderous/desktop build

# 步驟 2：部署合體後的統一 Worker
pnpm --filter @cinderous/relay deploy
```

---

## 3. 核心程式碼實作細節

### 3.1 Worker 進入點分流實作 (`relay/src/worker.ts`)
🔴 審查修正：延伸既有 `worker.ts`，不重寫。`mintTurnResponse`／`turnPreflightResponse`／`relayInfoFrom` 都定義在 `worker.ts` 本身（沒有 `./turn.js`）；`ASSETS` 為**選配**綁定，未啟用時行為與現況完全相同；`/healthz` 為新增端點，承接 `GET /` 的純文字契約（ADR-0089）。示意：

```typescript
import { buildRelayInfo, NIP11_HEADERS, wantsRelayInfo } from "./nip11.js";
import { shardNameForPath } from "./shard.js";
// mintTurnResponse / turnPreflightResponse / relayInfoFrom：同檔既有函式

export interface Env {
  RELAY_ROOM: DurableObjectNamespace;
  ASSETS?: Fetcher; // 靜態資產綁定（選配，ADR-0354）；未綁定＝純 relay
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
  TURN_TTL_SECONDS?: string;
  // ...其餘 NIP-11 環境變數
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── 軌道 A：WebSocket 中繼連線（全生態客戶端入口）──────────────
    if (request.headers.get("Upgrade") === "websocket") {
      const stub = env.RELAY_ROOM.get(
        env.RELAY_ROOM.idFromName(shardNameForPath(url.pathname))
      );
      return stub.fetch(request);
    }

    // ── 軌道 B：WebRTC TURN 短期憑證換發 API（ADR-0243）─────────────
    if (url.pathname === "/turn") {
      if (request.method === "OPTIONS") return turnPreflightResponse();
      return mintTurnResponse(env, request);
    }

    // ── 軌道 C：NIP-11 Relay 資訊文件查詢（ADR-0260）───────────────
    if (wantsRelayInfo(request.headers.get("Accept"))) {
      return new Response(JSON.stringify(relayInfoFrom(env)), {
        status: 200,
        headers: NIP11_HEADERS,
      });
    }

    // ── 軌道 D：健康檢查（ADR-0354 新增；承接 ADR-0089 的純文字契約）────
    // node-relay.ts 同步提供，兩座宿主一致。
    if (url.pathname === "/healthz") {
      return new Response("Cinderous relay", { status: 200 });
    }

    // ── 軌道 E：前端 Web 客戶端靜態資源交付（選配）──────────────────
    // 有 ASSETS 綁定 → 交給資產（SPA 回退由 not_found_handling 處理）；
    // 無綁定 → 維持現況純文字（既有文件與 PaaS 健康檢查不受影響）。
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Cinderous relay", { status: 200 });
  },
};
```

對應測試（`worker.test.ts` 需補）：有 `ASSETS` 時 `/` 走資產、`/healthz` 回純文字、帶 `Upgrade: websocket` 的 `/` 仍到 DO；無 `ASSETS` 時行為與現況相同。

### 3.2 前端客戶端自指連線（Self-Referencing Relay）
🔴 審查修正：`apps/desktop/src/ui/SignIn.tsx` 已有 `initialRelayUrl(search, lastUsed)`（`?relay=` 優先於本地記憶，附測試 `SignIn.test.tsx`），**不得另起 `resolveDefaultRelayUrl()`**（Fix First）。改為擴充順位：

```typescript
/**
 * 預設 Relay 網址順位（ADR-0354 延伸 ADR-0147 §4）：
 *   1. ?relay=wss://...（既有）
 *   2. 本地記憶（既有）
 *   3. 非 Tauri 且頁面由「啟用資產的 Worker」送出 → wss://${location.host}
 *   4. engine 的 ANCHOR_RELAYS（既有，不寫死字串）
 */
export function initialRelayUrl(search: string, lastUsed: string | null, selfHost?: string): string {
  const param = new URLSearchParams(search).get("relay");
  if (param) return param;
  if (lastUsed) return lastUsed;
  if (selfHost) return `wss://${selfHost}`;
  return ""; // 呼叫端照舊退回 ANCHOR_RELAYS
}
```

「由啟用資產的 Worker 送出」須以**建置期注入或 NIP-11 探測**判定，不可用「凡是瀏覽器就自指」推論：Cloudflare Pages 與本機 `vite dev` 都是瀏覽器環境，卻不是 relay；誤判時瀏覽器會嘗試連一個不存在的同源 `wss://`，需有明確失敗訊息並退回錨點。

---

## 4. 資安邊界審查與既有 ADR 規範對齊

| 既有 ADR 規範 | 統一 Worker 架構相容性判定 | 技術合規論證與防禦細節 |
| :--- | :--- | :--- |
| **ADR-0090<br>官網與通訊硬隔離** | 🟢 **100% 嚴格合規** | 官方行銷/捐款網站（`apps/website`）仍維持在獨立的 GitHub Pages 或獨立網域，**絕不**併入此 Worker。行銷攻擊面與通訊平面依然保持物理隔離。 |
| **ADR-0147<br>自架 Web App 邊界** | 🟡 **相容，但信任邊界要誠實揭露** | Web App 與 Relay 原本就同屬「端到端加密通訊平面」。🔴 審查修正：~~CSP 縮緊為 `connect-src 'self'`~~ **不採用**——錨點 pool（ADR-0039／0069）、H2/H3 搬家、`stun.cloudflare.com:3478` 與 `/turn` 換發的 TURN 主機都是跨源連線，鎖死同源會打壞多 relay 路由與通話保底；維持 ADR-0208 基線，自架者確知不用錨點與公共 TURN 時可自行收斂。另外：合體後自架 Worker **同時送 JS 與轉發密文**，「relay 只轉密文」的最小攻擊面不再成立——這與 ADR-0147 自架 web 版的固有信任問題相同，非新增，但文件必須說明。 |
| **ADR-0208<br>真標頭 CSP 防禦** | 🟢 **完全支援** | 靜態資產目錄包含 `_headers` 檔案，Cloudflare Assets 引擎原生支援注入 `frame-ancestors 'none'`、`X-Content-Type-Options: nosniff` 等真實 HTTP 回應標頭，點擊劫持防禦無懈可擊。 |
| **零知識隱私邊界** | 🟢 **絕對維持** | Relay 內之 Durable Object 僅負責轉發加密封包（NIP-59 / NIP-44），完全不接觸使用者私鑰 `nsec`。私鑰僅以 Argon2id 加密存於客戶端本機 `localStorage`，伺服端零知識。 |

---

## 5. 全生態跨客戶端相容性驗證

合體後的統一節點位址（例：`cinderous.your-name.workers.dev`）能同時、無衝突地服務全生態所有客戶端：

```
                               ┌────────────────────────────────────────┐
                               │  https://cinderous.myuser.workers.dev  │
                               │  (單一 Cloudflare Worker 統一節點)      │
                               └──────────────────┬─────────────────────┘
                                                  │
                ┌─────────────────────────────────┼─────────────────────────────────┐
                ▼                                 ▼                                 ▼
   【Obsidian 外掛生態】               【桌面與行動端原生 App】               【純網頁免安裝使用者】
   • CinderSync (筆記庫同步)           • Tauri v2 桌面客戶端 (Windows/Mac)    • 朋友用手機/電腦點開網址
   • Cinderous Chat (加密聊天)         • iOS / Android 原生 App              • 立即進入 Web 版聊天介面
   (連線協定: wss://, 走 DO)           (連線協定: wss://, 走 DO)             (連線協定: https://, 走 Assets)
```

1. **Obsidian 外掛相容性**：
   - `CinderSync` 在設定面板輸入 `wss://cinderous.myuser.workers.dev`，發送 `Upgrade: websocket` 請求，直接接入後端 Durable Object，增量同步毫秒級傳遞。
2. **原生桌面端與行動端相容性**：
   - Tauri 或手機 App 本來就需要一個後端 Relay 作為訊號轉發站，直接掛載此網址作為中繼台，行為與獨立版 Relay 毫無二致。
3. **極致友善的「雙重語義分享連結」**：
   - 傳統自架聊天軟體（Matrix/XMPP）最難推廣之處在於：給朋友一個伺服器網址，朋友不知道如何使用。
   - **統一節點優勢**：你只需將 `https://cinderous.myuser.workers.dev` 傳給朋友：
     - 朋友在瀏覽器打開 ➔ **直接是漂亮的 Web 聊天登入畫面**，免裝軟體即刻連線對話。
     - 自己在 Obsidian 或手機設定 ➔ **直接當作專屬高速中繼台**。

---

## 6. 實施路線圖（🔴 審查修正：以 ADR-0354 待辦為準）

- [ ] **1. 設定檔**：`relay/wrangler.toml` 加註解化 `[assets]` 選配範本（含 `run_worker_first = true`）；不新增 `wrangler.unified.toml`。
- [ ] **2. Worker 路由**：`worker.ts`／`node-relay.ts` 新增 `/healthz`；`ASSETS` 存在才走資產，否則維持純文字；`worker.test.ts` 補三條測試（`/` 走資產、`/healthz` 純文字、WebSocket `/` 仍到 DO）。
- [ ] **3. 前端**：`initialRelayUrl` 擴充第三順位＋`SignIn.test.tsx`；「啟用資產的 Worker」判定以建置期注入或 NIP-11 探測。
- [ ] **4. 部署器**：ADR-0344 的 `cloudflare-deploy` 加「附帶網頁版」流程（manifest → 分桶上傳 → 帶 `assets.jwt` 的 Script Upload；TDD、mock API）；量化 web dist 進 App 打包鏈的體積影響。
- [ ] **5. 文件同步**：`ARCHITECTURE.md` 部署拓撲、`docs/SELF-HOSTING*.md` 與 `docs/self-hosting-zeabur*.md` 的驗證步驟改指 `/healthz`、`docs/self-hosting-web-app.md` 加「與 relay 同站」選項並揭露信任邊界。

**不做**：官方錨點站啟用資產；CSP 收斂到 `'self'`；Worker 改名。
