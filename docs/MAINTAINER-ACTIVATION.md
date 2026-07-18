> 🌐 **English** · [English version](./MAINTAINER-ACTIVATION.en.md)

# 啟用維護者角色（點亮簽章 relay 池）

> 這份是**操作手冊**：把目前**已寫好但休眠**的「維護者簽章 relay 清單」機制（ADR-0039／0092）打開，
> 讓第三方自架節點能被官方自動選座池收錄。休眠現況：`MAINTAINER_PUBKEY` 為空、
> `relay/bootstrap/relays.json` 為空、GitHub secret `MAINTAINER_NSEC` 未設。

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

## ② 把 nsec 設成 GitHub Actions secret

GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**
- Name：`MAINTAINER_NSEC`
- Value：`maintainer.nsec` 檔案內容（`nsec1…`）

`.github/workflows/relay-health.yml` 已在讀 `secrets.MAINTAINER_NSEC`；沒設時只更新明文清單、不簽章
（`relay/bootstrap/health-check.ts`）。設好後，**離線備份該檔並從本機刪除**。

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

之後每小時的 `relay-health.yml`：探測 → `evaluateAdmission` 定 `accepting`/`weight` → 有 nsec 即簽章並
**帶內推送**（`publishEvent`）到健康 relay，客戶端連上即學到。

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

- Actions → 「Relay 健康檢查」→ **Run workflow**（或等整點 cron）。
- Log 應出現：`✅ <url>`、`已簽章 relay 清單事件（kind 10037）`、`📡 發佈至 <url>`。
- bot 會提交更新後的 `relays.json`（帶 `accepting`/`weight`）與 `health-history.json`。
- 用**重建後**的客戶端確認登入自動選座已從簽章清單預填。

---

## 之後的維護者日常

- **人管加入/退役**：加 URL 進 `relays.json`（機器自動探測分級）；退役＝把 entry 的 `status`
  設 `draining`→`retired`，既有用戶自動搬離。
- **機器管品質**：每小時 uptime／一致性自動更新（`health-history.json` 滾動窗 ≈30 天）。
- **第三方申請**（見 `docs/NODE-SUBMISSION.md`）＝ issue/PR 交 URL，你把 URL 加進 `relays.json` 即進探測流程。

## 金鑰輪替

換 `MAINTAINER_PUBKEY` 需要**重建所有客戶端**（編譯期常數），並在期間讓新舊清單並存過渡。事前規劃好流程，
避免緊急輪替時把客戶端變孤島。

## 參考

- ADR-0039（混合式引導路由／簽章清單信任根）、ADR-0092（節點提交與分級收錄）、ADR-0069（自動選座 I4）
- 程式：`relay/bootstrap/{genkey,health-check,conformance}.ts`、`packages/core/src/bootstrap.ts`
  （`signRelayList`/`verifyRelayList`/`evaluateAdmission`）、`packages/engine/src/bootstrap-config.ts`
- 流水線：`.github/workflows/relay-health.yml`
