# 0354. 中繼站與網頁前端可選地部署成同一個 Cloudflare Worker

- 狀態：已接受
- 日期：2026-09-17
- 相關文件：`ARCHITECTURE.md`（中繼站）、`docs/research/unified-relay-and-web-client-cloudflare-worker-architecture.md`、ADR-0005（自建最小 Worker relay）、ADR-0241（分片路由）、ADR-0092（引導清單）

## 背景與問題

有人提出把中繼站與網頁前端整合成同一個 Worker，理由是「一個網域、一次部署、少一個要管的東西」。

這個提案有一個**會靜默毀掉中繼站**的陷阱，所以值得一份 ADR 而不是直接動手。Cloudflare 的 Static Assets 預設是**資產優先**：請求先比對資產清單，命中就直接回檔案，Worker 的程式碼根本不會執行。中繼站的入口是 `/`——而 `/` 正好會命中 `index.html`。

結果不是「壞掉」，是**更糟的那種**：`/` 回 200 與一段 HTML。客戶端不會看到錯誤，它會看到一個握不了手的 WebSocket 升級失敗，然後退回重試。錯誤訊息不會說「你的部署方式殺掉了中繼站」。

## 考量的選項

- **選項 A：不整合。** 中繼站與前端各自部署，維持現狀。
- **選項 B：一律整合。** 把兩者合併為唯一的部署方式。
- **選項 C：整合成一個「可選的部署模式」。** 預設仍是分離；想要單一 Worker 的人多打一個旗標。

## 決策

採**選項 C**。`relay/wrangler.toml` 新增 `[env.unified]` 環境，其中 `[env.unified.assets]` 帶 **`run_worker_first = true`**，並把 Durable Objects、migrations、vars 與 ratelimits 重新宣告一次（Wrangler 的具名環境**不繼承**頂層設定，漏掉任何一項就是另一種靜默的壞掉）。

兩個指令，兩種部署：

| 指令 | 結果 |
| --- | --- |
| `pnpm --filter cinder-relay deploy` | 只有中繼站（預設，與過去相同） |
| `pnpm --filter cinder-relay deploy:unified` | 中繼站 ＋ 網頁前端，同一個 Worker |

Worker 端配合兩件事：`ASSETS` 綁定宣告為**可選**（分離部署時它不存在），以及在所有中繼路由都沒命中時才 `return env.ASSETS.fetch(request)`。另加一個 `/healthz` 純文字端點——整合部署之後，用「`/` 回不回 HTML」來判斷中繼站活著與否已經不再可靠。

前端也需要知道自己是哪一種：`vite.config.ts` 在 `mode === "unified"` 時把 `__SELF_RELAY__` 編譯為 true，`SignIn` 的預設中繼站於是指向**自己這個來源**而不是公共錨點。

## 理由

**為什麼不是選項 A。** 提案本身是合理的：自架的人確實少一個網域、少一次部署、少一組 CORS 設定。沒有技術上的理由禁止它。

**為什麼不是選項 B。** 公共錨點的職責是「只轉發密文」。把前端資產塞進同一個 Worker 會讓錨點多背一個與它的職責無關的東西，而資產更新（改一行文案）會連帶重新部署中繼站。兩者的變更節奏完全不同。

**為什麼 `run_worker_first` 是硬性的。** 見上：預設的資產優先會讓 `/` 變成 HTML，而中繼站的所有路由（`/`、`/s/<prefix>`、`/presence`，ADR-0241）都在 Worker 裡。這不是效能調校，是這個部署模式能不能成立的前提。

## 後果

- **正面**：想自架的人有一條一個指令的路；公共錨點維持單一職責。
- **正面**：`/healthz` 讓健康檢查與「首頁是不是 HTML」脫鉤，兩種部署都適用。
- **負面**：`[env.unified]` 與頂層設定是**兩份**必須手動同步的宣告。Wrangler 不會警告你漏了 DO 綁定——改頂層設定時必須同時改它。
- **負面**：整合部署的資產更新會重新部署中繼站，那一刻既有的 WebSocket 連線會被切掉。
- **後續行動**：README 與自架文件要同時給兩個指令，並寫明 `run_worker_first` 的理由；否則有人會照著 Cloudflare 的官方範例做，然後得到一個「看起來正常」的壞中繼站。
