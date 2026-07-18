# @cinderous/website — Cinderous 官方網站（ADR-0090）

純靜態站：**開源・永久免費・隱私**主張、下載、捐款導流、**簽章式資金透明度**。

## 鐵則（ADR-0090）

- **與 E2E 通訊平面硬隔離**：獨立網域，**永不接觸**使用者資料／金鑰／relay 流量／npub。
- **零追蹤**：無分析、無 cookie、無第三方腳本/字型。
- **無常駐後台**：透明度靠「靜態檔＋維護者簽章＋前端驗簽計算」，非有狀態伺服器。

## 開發

```bash
pnpm --filter @cinderous/website dev        # 本機預覽（Vite）
pnpm --filter @cinderous/website build      # 產出 dist/（靜態託管，如 Pages）
pnpm --filter @cinderous/website test       # funds 驗簽/ runway 測試
pnpm --filter @cinderous/website typecheck
```

## 資金透明度（funds.json）

`public/funds.json` 是一份**以透明度金鑰簽章的 Nostr 事件**（同 relay-list 信任根，ADR-0039）。
前端 `verifyFunds` 對 **`src/funds.ts` 釘死的 `TRANSPARENCY_PUBKEY`** 驗簽——**通過才渲染數字**，
故 CDN/host 被入侵也改不動（改了就驗簽失敗、fail-closed 不顯示）。

### 更新流程（「後台＝流程而非伺服器」）

1. 離線編輯 `funds.draft.json`（形狀＝ `FundsData`：`balance`/`currency`/`monthlyBurn`/`updatedAt`/`allocations[]`）。
2. 以透明度金鑰簽章、寫出 `public/funds.json`：
   ```bash
   TRANSPARENCY_NSEC=nsec1... FUNDS_DRAFT=funds.draft.json tsx scripts/sign-funds.ts
   ```
3. 確認 `TRANSPARENCY_PUBKEY` 與簽章金鑰一致 → 提交/發佈。

無 DB、無 API、無登入面板。

## ⚠️ 上線前必做（目前為佔位）

- **透明度金鑰**：`src/funds.ts` 的 `TRANSPARENCY_PUBKEY` 與 `public/funds.json` 目前由**開發用佔位金鑰**簽出
  （數字為示範）。上線前**產一把專屬離線透明度金鑰**（與 relay-list 維護者金鑰、任何使用者身分皆分離），
  以其 nsec 簽真實 `funds.json`，並把 `TRANSPARENCY_PUBKEY` 換成該金鑰公鑰。
- **捐款連結**：`src/donations.ts` 為佔位帳號，換成真實 GitHub Sponsors／Buy Me a Coffee／Liberapay／Lightning。
- **獎金分配準則**：`allocations` 的分項由組織定義並首次公開（ADR-0090 不代為決定比例）。
- **網域／託管**：以獨立網域靜態託管；勿與 relay/app 共用網域。
