# 0219. 可換式同步鍵值儲存（行動端就緒的 KV 抽象）

- 狀態：已接受
- 日期：2026-07-20
- 相關文件：ADR-0045（多身分登錄 profiles）、ADR-0071（裝置 id）、ADR-0076/0116（Notifier 可換基質模式）、`packages/engine/src/kv.ts`

## 背景與問題

盤點行動端（Android/iOS）原生化的抽象需求時發現：大多數平台邊界**已經抽好**——`Notifier`（notify.ts）、`AppStorage`／`MessageArchive`（可注入）、`webSocketConnector`、`rtcConfig`，加密是**純 `@noble`**（全 packages 零 `crypto.subtle` 實際呼叫）。RN 只要實作既有介面，或在進入點掛 global polyfill（`react-native-get-random-values`、`react-native-webrtc` 的 `registerGlobals()`）。

唯一沒走任何抽象、**直接呼叫同步 `localStorage`** 的是幾個 app 級登錄：`storage/profiles.ts`（身分登錄，必須持久）、`storage/device-id.ts`（裝置 id）等。關鍵限制：`localStorage` 是**同步** API，而 RN 的 `AsyncStorage` 是**非同步**、換不進來——這些同步呼叫需要**同步**的替身（`react-native-mmkv`）。

## 考量的選項

- **可換式同步 KV 基質（採用）**：抽一層 `KvStore` 介面＋單一可 `set` 的基質（比照 `getNotifier()`），預設 localStorage，RN 進入點注入 MMKV。只動「直接呼叫 localStorage」的 app 級登錄。
- 把 `localStorage` 呼叫改成 async：破壞性大（profiles/device-id 是同步流程），且無必要（MMKV 是同步）。
- 現在不抽、等 RN 時再抽：可行，但這個 seam 小、有測試、現在鎖住成本最低。

其餘介面**刻意不再多包**（YAGNI）：已抽好的不動；`apps/desktop` 的 `nb.*`（notify/sort…）是桌面 app 級、`apps/mobile` 有自己的，不進 engine 抽象。

## 決策

新增 `packages/engine/src/kv.ts`：
- `interface KvStore { getItem; setItem; removeItem }`（皆同步）。
- 預設 `localStorageKv`：包 localStorage，環境不支援時各方法**優雅失敗**（回 null / no-op），保留既有「不可用就退回預設」的行為。
- `getKv()` 取當前基質；`setKvBackend(store | null)` 換基質（RN 注入同步 MMKV；null 還原預設）。
- `storage/profiles.ts`、`storage/device-id.ts` 的 `localStorage.*` 改走 `getKv()`。engine index 匯出 kv。

## 理由

- **RN 就緒、web 零變**：預設就是 localStorage，桌面/瀏覽器行為與測試完全不變；RN 只需 `setKvBackend(mmkv)`。
- **同步對同步**：MMKV 是同步，API 與 localStorage 對齊，不必把同步流程改 async。
- **一致的可換基質模式**：與既有 `getNotifier()` 同風格，低認知負擔。
- **不過度抽象**：只處理真正硬綁 localStorage 的 app 級登錄；已抽象的邊界與 desktop-only 鍵不碰。

## 後果

- 正面：行動端原生化時，身分登錄/裝置 id 的持久化只需注入一個 MMKV 基質即可；抽象小、有測試、web 不受影響。
- 負面 / 已知殘餘風險：`relay-backend.ts` 內的其他 localStorage 用途（home-relay 離線起點、快照節流）暫未走 kv——它們**本就優雅降級**（不可用時退回 session），屬次要，可日後一併收斂。`passlock-web.ts`（瀏覽器密碼庫）在 RN 會改用 SecureStore、另一套，不在此抽象內。
- 後續行動 / 待辦：真正開 RN 時，(1) `setKvBackend(mmkv)`、(2) 掛 `getRandomValues`／`registerGlobals` polyfill、(3) 實作 `AppStorage`/`MessageArchive`/`Notifier` 的 RN 版；可選把 relay-backend 的節流也走 kv。
