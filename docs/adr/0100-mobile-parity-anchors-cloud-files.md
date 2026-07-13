# 0100. 行動端補齊：錨點/簽章清單、加密雲端備份、檔案傳輸（收斂 ADR-0086）＋引導設定 SSOT

- 狀態：已接受（已實作；通話仍缺，見後果）
- 日期：2026-07-13
- 相關文件：ADR-0086（行動端真實 relay 後端，當時明記「尚未接多中繼 hint／雲端備份／通話」）、
  0039（錨點與簽章 relay 清單）、0034（多中繼路由）、0071（加密雲端快照）、0093（檔案接收）；
  `apps/mobile/`、`packages/engine/src/bootstrap-config.ts`

## 背景與問題

ADR-0086 讓行動端接上真實 relay，但明記「先做核心收發＋加好友」，其餘留待補齊。實測對照桌面：

| 能力 | 桌面 | 行動端（補齊前） |
|---|---|---|
| 錨點 relay／簽章清單 | ✅ | ❌ `anchors: [relayUrl]` 只有一座、`maintainerPubkey` 未帶 |
| 加密雲端備份 | ✅ | ❌ 完全沒有 |
| 檔案傳輸 | ✅ | ❌ 完全沒有 |
| 通話 | ✅ | ❌ 完全沒有 |

其中**錨點缺失最致命**：行動端只綁使用者當下那一座 relay——該座掛掉就等於斷線，
也吃不到 ADR-0069 的自動改道／退役遷移。

另外發現 `bootstrap-config.ts`（ANCHOR_RELAYS／MAINTAINER_PUBKEY——**整個容錯拓樸的信任根**）
只存在於 `apps/desktop`。行動端要用就得複製一份，兩份必然漂移。

## 決策

### 1. 引導設定移入 `@cinder/engine`（SSOT）

`packages/engine/src/bootstrap-config.ts` 成為**唯一來源**；桌面改為從 `@cinder/engine` 匯入，
刪除本地副本。理由：桌面與行動端連的是**同一張網**，錨點與維護者公鑰不該各留一份。

### 2. 行動端接上錨點、簽章清單、多中繼

`anchors: [...new Set([relayUrl, ...ANCHOR_RELAYS])]`（使用者那座優先、錨點在後保底、去重）；
帶入 `maintainerPubkey`（可驗簽採用帶內清單）與 `connectorFor`（對聯絡人 relay hint 另開連線）。

### 3. 加密雲端備份（ADR-0071）

`cloudSync` 偏好（`nb.cloudSync`：off／basic／full）→ 建後端時帶入；設定頁三檔切換。
**關閉時立即 `purgeCloudSnapshot`**——「已關閉」必須即刻為真。
模式變更於**下次登入生效**（後端在建構時取用），與桌面行為一致；purge 是即時的。
`onCloudSyncMode` 讓還原時採用快照傳播的模式（僅本機從未設定時）。

### 4. 檔案傳輸（ADR-0093 語意）

新增 `apps/mobile/src/native/files.ts` 作為**唯一的平台縫**（比照桌面的 `native/save-file.ts`）：
- `pickFile()` → 選檔；`saveFile()` → 收檔另存（**App 不保管位元組**）。
- 目前以 DOM（`<input type=file>`／瀏覽器下載）實作，供 react-native-web 預覽；
  移植真正 RN 只需換掉**本檔內部**（expo-document-picker／expo-file-system），
  UI 與呼叫端完全不動。
- 對話畫面加 📎 鈕；檔案氣泡顯示大小／已存路徑／「📍 檔案在你另一台裝置」（與桌面同語意）。

## 理由

- 錨點與清單是**可用性的地基**，且是純設定注入——投報率最高，先補。
- 把平台相依集中在 `native/files.ts` 一個檔，避免 DOM 呼叫散落在 UI（剛在 ADR-0096 才把
  行動端的內嵌 `<svg>` 清掉，不該立刻又灑回去）。

## 後果

- 正面：行動端不再單點依賴一座 relay；可換機還原；可收發檔案。引導設定不會再兩份漂移。
- 負面 / 已知殘餘風險：
  - **通話仍未做**。它需要 `react-native-webrtc`——不只是 `RTCPeerConnection`／`getUserMedia`
    的全域（該套件會注入），還需要 `RTCView` 才能渲染串流（`<video>` 是 DOM，無法移植）。
    這是比 ADR-0096 的 SVG 更大的一步，應另立 ADR 專做，不塞在本次。
  - 檔案在**真正的 RN** 上仍需換掉 `native/files.ts` 內部（介面已備妥）。
  - `MAINTAINER_PUBKEY` 目前是空字串 → **兩端都還不會採用帶內簽章清單**。這是待維護者填入
    真實公鑰的營運事項，非程式缺口。
- 測試：mobile +3 項（錨點去重與保底、真實後端具備檔案/快照能力、示範模式無 P2P 檔案）；
  合計 35 項。全 774 測試通過、全 typecheck 通過、行動端真實 vite build 通過。
