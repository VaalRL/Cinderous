> 🌐 **English** · [English version](./MAINTAINER-ACTIVATION.en.md)

# 啟用維護者角色（點亮簽章 relay 池）

> 這份是**操作手冊**：維運「維護者簽章 relay 清單」機制（ADR-0039／0092），
> 讓第三方自架節點能被官方自動選座池收錄。
>
> **現況（2026-09-18）**：`MAINTAINER_PUBKEY` 已填（2026-07-18 起）、`relays.json` 已有兩座錨點、
> 機制運作中。所以下面的 ①③ 是**首次啟用**才需要的步驟，日常維運直接看 §②（離線簽章）
> 與「之後的維護者日常」。

## ⚠️ 先讀：這把金鑰是「信任根」

`MAINTAINER_NSEC` 是整個容錯拓樸的信任根——**誰握有它，誰就能簽出「客戶端會自動採用」的 relay 清單**。
外洩＝攻擊者可簽惡意清單→客戶端連到攻擊者的 relay（元資料收割／eclipse）。請當**根 CA 金鑰**對待：

- **專用**：別和任何個人身分／訊息金鑰共用。
- **離線產、離線備份**：線上唯一副本＝GitHub Actions secret。
- **絕不** commit、絕不貼進聊天/截圖、絕不印進日誌。

系統的隱私是**結構性**的（E2E Gift Wrap＋TTL＋P2P＋多中繼，本就假設 relay 為對手），
所以收錄審查只驗**行為**（穩不穩、轉發對不對、可否問責），不驗「可否信任」。

---

## ① 產生維護者金鑰（本機，輸出不進聊天）

```bash
pnpm --filter @cinderous/relay genkey:maintainer
```

行為（`relay/bootstrap/genkey.ts`）：
- **公鑰 hex** → 印到終端（可公開，下一步填進 code）。
- **私鑰 nsec** → **只寫入本機檔案** `./maintainer.nsec`（`chmod 600`、已 gitignore），**永不印到 stdout**。

選項：`MAINTAINER_NSEC_OUT=/path` 自訂輸出路徑；`MAINTAINER_NSEC_FORCE=1` 覆寫既有檔。

> 也可用任何你信任的（最好離線的）標準 Nostr 金鑰工具產。需要兩種表示：
> `MAINTAINER_PUBKEY` = 32-byte x-only 公鑰 **hex（64 字元）**；`MAINTAINER_NSEC` = **`nsec1…`**。

## ② 離線簽章（ADR-0239）

🔴 **絕對不要把 `MAINTAINER_NSEC` 設成 GitHub Actions secret。** 這份文件以前是這樣教的，
那是 ADR-0239 拔掉的反模式：CI 的傳遞相依任何一個被投毒，就能讀走整個容錯拓樸的信任根。
`relay-health.yml` 現在**不持有也不注入**這個 secret（見該檔第 23 行）。

金鑰只留在你的機器上。CI 只做探測與更新明文清單；**簽章與發佈由你在本機執行**：

```bash
# 1. 取回執行期的探測歷史（CI 把它存在 relay-health-state 分支，不進 main）
git fetch origin relay-health-state
git show FETCH_HEAD:health-history.json > relay/bootstrap/health-history.json

# 2. 對「已提交的明文清單」離線簽章並帶內發佈
MAINTAINER_NSEC="$(cat /path/to/maintainer.nsec)" \
  pnpm --filter @cinderous/relay bootstrap:sign
```

`--sign-only` 不重新探測，只對 `relays.json` 現有內容簽出 kind 10037 並推送到健康的 relay，
客戶端連上即學到。少了 `MAINTAINER_NSEC` 它會直接報錯，不會靜默跳過。

**什麼時候要跑**：`relays.json` 有變動之後（收錄新節點、標記退役、權重改變）。CI 改了明文清單
但**不會**替你簽，所以不跑這一步的話，客戶端永遠看不到新清單。

## ③ 把公鑰填進 code（＝點亮信任根）

`packages/engine/src/bootstrap-config.ts`：

```ts
export const MAINTAINER_PUBKEY = "<你的 64 字元 hex 公鑰>";
```

桌面（`apps/desktop/src/App.tsx`）與行動端（`apps/mobile/src/backend.ts`）都會在**非空時**帶
`maintainerPubkey` 給後端；後端才會訂閱 `kind 10037`（`RELAY_LIST_KIND`）＋以 `verifyRelayList` 驗簽採用。

> 這步動到信任根，**要配一份 ADR**（記錄維護者公鑰選定與其後果）。

## ④ 收錄第一座候選 relay

候選來源就是 `relay/bootstrap/relays.json` 本身（`listEntries` 讀它逐座探測）。把你的生產站加進去：

```json
{
  "relays": ["wss://relay.你的網域"],
  "entries": [{ "url": "wss://relay.你的網域" }],
  "updatedAt": 0
}
```

之後每 6 小時的 `relay-health.yml`（cron `17 */6 * * *`）：探測 → `evaluateAdmission` 定
`accepting`/`weight` → 變動時提交 `relays.json` 到 main。

⚠ **CI 到此為止，不簽章也不發佈**（ADR-0239）。要讓客戶端看到新清單，你得自己跑 §② 的離線簽章。

- 你的 relay 若 `requireAuth:true`，探測會**當場產臨時金鑰**做 NIP-42 AUTH（`conformance.ts` 已處理）。
- ADR-0039 建議日後湊 **≥2 座**不同網域/平台的錨點，補單點風險。

分級收錄（ADR-0092）：

| 狀態 | 條件 | 效果 |
| --- | --- | --- |
| 不列入 | liveness 失敗 | — |
| 試用（`accepting:false`） | 一致性未過或 uptime 不足（<12 次探測） | 進清單供韌性/手動用，不自動分配新戶 |
| 收錄（`weight:1`） | 一致性過＋uptime≥95% | 自動分配（低權重） |
| 收錄（`weight:2`） | 一致性過＋uptime≥99% | 自動分配（較高權重） |

## ⑤ 重建並重新部署客戶端

`MAINTAINER_PUBKEY` 是**編譯期常數**，已出貨的舊 app 不會自動吃到，要重建：

- 桌面：`pnpm --filter @cinderous/desktop tauri build` → 重新發到 Releases
- 官網 web app：push 觸發 GitHub Pages 重建（自動）
- 行動端 / CLI：各自重建

## ⑥ 驗證上線

- Actions → 「Relay 健康檢查」→ **Run workflow**（或等 cron——每 6 小時的 :17，ADR-0350）。
- CI 的 log 應出現：`✅ <url>`，以及
  `未提供 MAINTAINER_NSEC：僅更新明文清單`——**那一行是正常的**，不是故障。
- `已簽章 relay 清單事件（kind 10037）` 與 `📡 發佈至 <url>` 只會出現在**你本機**跑
  §② 的離線簽章時。
- bot 只在 `relays.json` 真的變動時提交到 main；`health-history.json`（滾動 uptime 計數）
  是執行期狀態，存在 `relay-health-state` 分支、**不進 main**（ADR-0350）。
- 用**重建後**的客戶端確認登入自動選座已從簽章清單預填。

---

## 之後的維護者日常

- **人管加入/退役**：加 URL 進 `relays.json`（機器自動探測分級）；退役＝把 entry 的 `status`
  設 `draining`→`retired`，既有用戶自動搬離。
- **機器管品質**：每 6 小時 uptime／一致性自動更新（滾動窗 30 天＝4 次/天 × 30，由
  `relay/bootstrap/uptime.ts` 的 `PROBES_PER_DAY` 推導）。
  ⚠ 要在本機跑完整探測，得先把狀態取回來，否則會直接失敗（那是刻意的——空歷史會把
  正式收錄的 relay 降級成試用，帶金鑰時還會簽章發佈）：
  ```
  git fetch origin relay-health-state
  git show FETCH_HEAD:health-history.json > relay/bootstrap/health-history.json
  ```
- **第三方申請**（見 `docs/NODE-SUBMISSION.md`）＝ issue/PR 交 URL，你把 URL 加進 `relays.json` 即進探測流程。

## 金鑰輪替

### 🔴 目前這把金鑰待輪替（ADR-0239 後續 2）

`MAINTAINER_NSEC` 曾經是 GitHub Actions secret：**2026-07-03 注入、2026-07-23 移出**。
而現行公鑰 `6efd2603…` 是 **2026-07-18** 釘進客戶端的——正落在那個視窗內。

ADR-0239 寫明「若曾以任何形式進過 CI，視為**已曝險**、應輪替一次」。那二十天裡任一傳遞相依
被投毒都足以讀走它，而它是全體客戶端釘死的**唯一**信任錨：握有它就能簽出客戶端會自動採用的
relay 清單（eclipse／元資料收割）。沒有證據顯示它被拿走，但「沒有證據」不是「沒有發生」。

### 輪替程序

`MAINTAINER_PUBKEY` 是**編譯期常數**，已出貨的客戶端不會自動吃到新公鑰，所以順序很重要：

1. **產新金鑰**（本機、離線）：`pnpm --filter @cinderous/relay genkey:maintainer`
   （nsec 只寫檔、永不印到 stdout；舊的先別刪）。
2. **填新公鑰**進 `packages/engine/src/bootstrap-config.ts`，配一份 ADR 記錄輪替與原因。
3. **重建並發佈所有客戶端**（桌面、網頁、行動、CLI）。舊版客戶端在此之前只認舊公鑰。
4. **等出貨版本普及**再停用舊金鑰。這段期間**兩把都要簽**同一份清單——舊客戶端只驗得了舊簽章，
   停太早會把它們變成孤島（收不到任何清單更新，包括「這座 relay 退役了」）。
5. 舊金鑰的最後一個用途結束後，銷毀它的所有副本。

⚠ 第 4 步沒有自動化。並存期間每次改 `relays.json` 都要用兩把金鑰各跑一次 §② 的離線簽章。

## 參考

- ADR-0039（混合式引導路由／簽章清單信任根）、ADR-0092（節點提交與分級收錄）、ADR-0069（自動選座 I4）
- 程式：`relay/bootstrap/{genkey,health-check,conformance}.ts`、`packages/core/src/bootstrap.ts`
  （`signRelayList`/`verifyRelayList`/`evaluateAdmission`）、`packages/engine/src/bootstrap-config.ts`
- 流水線：`.github/workflows/relay-health.yml`
