# 0169. 行動端功能對齊批次二——輸入中提示、限時訊息、移除聯絡人、連線狀態指示

- 狀態：已接受（已實作）
- 日期：2026-07-17
- 相關文件：ADR-0168（行動端對齊批次一）、0120（輸入中提示）、0057（限時訊息／
  閱後即焚）、0121（移除聯絡人 vs 封鎖）、0034/0036（多中繼與連線狀態）

## 背景與問題

延續 ADR-0168 的行動端對齊：行動端與桌面共用同一套 `RelayChatBackend`，多數缺口是
「引擎已就緒、UI 沒接」。批次二挑四項**對話與聯絡人層**的高價值項目：

1. **輸入中提示**（ADR-0120）：`sendTyping()`／`onTyping` 引擎都在，行動端卻**送也沒送、
   收也是 no-op**（`onTyping: () => {}`）。
2. **限時訊息**（ADR-0057）：`sendMessage(to, text, ttlSeconds, …)` 早支援閱後即焚，
   行動端 `send` 硬塞 `undefined`、輸入列也沒有燒毀鈕。
3. **移除聯絡人**（ADR-0121，非封鎖）：`removeContact()` 在，行動端長按選單只有「封鎖」。
4. **連線狀態指示**（ADR-0034）：`onConnection(state)` 在，行動端不顯示連線中/離線。

## 決策

### 1. 輸入中提示（送＋收，元件內節流）

- **送**：`ConversationScreen` 新增 `onTyping?` prop；輸入框 `onChangeText` 包一層
  `onDraftChange`——草稿非空且**距上次 ≥3 秒**才呼叫 `onTyping`（節流，避免每個按鍵打中繼）。
  `MobileApp` 只在 1:1 接上 `sendTyping`（群組不送 typing）。
- **收**：`onTyping(pk)` → `markTyping(pk)` 記下來源並設 6 秒計時器（typing 是易失提示，
  逾時自動退回一般副標）。對話副標題**最優先**顯示「對方正在輸入…」（`convo_typing`）。

### 2. 限時訊息（ADR-0057，1:1）

- `ConversationScreen` 加 `ttl` 狀態與燒毀切換鈕：點一下循環 **關→1 分→1 小時→1 天**
  （`convo_timer*` 既有 i18n），作用中顯示 🔥＋效期標籤（`burn-label`），關閉時為 ⏱ 淡色。
- 送出時 `onSend(text, mentions, replyTo, ttlSeconds)`；`MobileApp.send` 把 `ttlSeconds`
  傳進 `sendMessage`。**群組不顯示此鈕**（`sendGroupMessage` 介面不帶 ttl）。送出後保留
  效期設定（連發同效期）。

### 3. 移除聯絡人（ADR-0121，非封鎖）

- `ContactListScreen` 長按選單並排「移除／封鎖」兩鈕（未提供 `onRemove` 則只有封鎖）。
- `MobileApp.removeContact` 先以 `window.confirm(contact_removeConfirm)` 確認（環境無
  confirm 時略過確認直接執行），再 `removeContact()`；正在看該對話則退回主畫面。
  **移除＝清對話但不封鎖、可再加回**；封鎖＝移出並忽略後續訊息（語意與桌面一致）。

### 4. 連線狀態細條

- `MobileApp` 接 `onConnection` → `connState`；主畫面與對話畫面頂端在**非 online** 時顯示
  一條固定色細條（琥珀＝連線中、紅＝離線，兩主題皆清楚）。**只在真實 relay** 顯示
  （示範模式無中繼、不顯示）；登入前畫面不掛此條。

## 理由

- 四項共享對話／聯絡人層的接線點，一起做脈絡一致；全部「引擎已就緒」＝零協定變更、
  零中繼變更。節流、群組排除 ttl、移除 vs 封鎖語意皆對齊桌面既有設計（Fix First）。

## 後果

- 正面：行動端在「輸入中提示／閱後即焚／移除聯絡人／連線可見性」對齊桌面。
- 已知限制／取捨：
  - typing 為易失提示（6 秒逾時清）；不做「停止輸入」明確訊號，與桌面一致。
  - 限時訊息僅 1:1（群組扇出協定不帶 ttl）——這是協定限制，非 UI 取捨。
  - 連線細條用固定色（不吃主題 tokens），因 `MobileApp` 未於該層解析主題；顏色在深/淺
    主題下皆可辨。
  - 行動端測試為 SSR（無 fireEvent）：以 testID 斷言**條件渲染**（燒毀鈕僅 1:1、移除鈕
    需長按），互動效果由引擎 TTL／typing 契約既有測試把關。
  - 仍待對齊（後續批次）：新增群組成員 UI、企業自報頭銜 chip 與組織套件、語音/燈箱等。
- 測試：`ConvoComposer.test.tsx`（燒毀鈕 1:1 顯示/群組隱藏/初始無 burn-label）；
  `ContactListScreen.test.tsx` 補移除入口條件；行動端 159 測試綠燈、typecheck 通過。
