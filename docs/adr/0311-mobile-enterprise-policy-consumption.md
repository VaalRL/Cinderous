# 0311. 行動端消費企業政策：接上 `onPolicy`，補齊三個 UI 閘門

- 狀態：已接受
- 日期：2026-08-03
- 相關文件：ADR-0048（企業政策開關與強制 TURN——政策的定義與兩層架構）、
  ADR-0310（桌面端補完 `disableStickers` 閘門時發現本缺口）、ADR-0173（行動端唯讀採用公司名冊）、
  ADR-0175（行動端企業消費端補完）、ADR-0294 §2（行動端 per-identity state 歸零守衛）、
  `apps/mobile/src/MobileApp.tsx`、`apps/mobile/src/screens/ConversationScreen.tsx`

## 背景與問題

`apps/mobile` 全庫搜不到 `disableFiles`／`disableCalls`／`disableStickers` 的任何**消費端**——
只有 `RosterAdminScreen` 能**發佈**政策。企業主在手機上設好政策、簽章名冊也正確分發，
但員工的手機**照樣送檔、照樣通話、照樣送貼圖**。

### 先修正一個先前的錯誤陳述

ADR-0310 的後續行動寫「`forceTurn` 也沒接進 WebRTC config」——**那是錯的**。實測程式後：

| 政策欄位 | 生效層 | 行動端現況 |
| --- | --- | --- |
| `forceTurn` | **引擎**（`relay-backend.ts` `adoptRoster` → `this.forceTurn` → `buildRtcConfig`） | ✅ 已生效 |
| `disableCloudBackup` | **引擎**（`this.cloudBackupBlocked`） | ✅ 已生效 |
| `messageTtlDays` | **引擎**（保留天數內部套用，ADR-0175 已記） | ✅ 已生效 |
| `relayFilesMaxMb` | **引擎** | ✅ 已生效 |
| `disableFiles` | **UI** | ❌ 未實作 |
| `disableCalls` | **UI** | ❌ 未實作 |
| `disableStickers` | **UI** | ❌ 未實作 |

分界線很清楚：**凡是引擎內部執行的政策，行動端因為共用 `packages/engine` 而免費得到**
（ADR-0074 抽出通訊後端的紅利）；**凡是靠 UI 隱藏入口的政策，兩端各要接一次**——
而行動端那次從來沒接。`forceTurn`（唯一與內網 IP 揭露有關、資安權重最高的那個）**一直是好的**。

真正缺的三個都屬 ADR-0048 §2 的「隱藏對應 UI」層。

## 考量的選項

- **選項 A：把三個旗標也下放引擎硬擋。** 引擎可以拒絕 `sendFile`／`startCall`，
  但那會讓 UI 顯示著按鈕、按下去靜默失敗——比不擋更糟（ADR-0243 已為通話立過
  「明確標示、非靜默失敗」的原則）。而貼圖是普通聊天訊息，引擎連攔的著力點都沒有。否決。
- **選項 B（採用）：行動端接上 `onPolicy`，鏡像桌面的 props 閘門形狀。**
  桌面已有 `fileProps`／`callProps`／`stickerProps` 的寫法（`App.tsx`），行動端照抄同一形狀，
  兩端行為一致、日後新增政策旗標時兩邊看得出對稱。

## 決策

1. **`MobileApp` 新增 `orgPolicy` state 並註冊 `onPolicy`**（引擎在 `adoptRoster` 採用名冊時發出）。
2. **`orgPolicy` 歸類為 per-identity**（ADR-0294 §2）：登入／切身分時歸零，並登記進
   `MobileApp.perIdentityState.test.ts` 的 `PER_IDENTITY` 名單。
   **這是必要的**——政策來自**該身分**的公司名冊；個人身分絕不能沿用工作身分的政策，
   反之亦然（行動端是就地切換，沒有桌面 `location.reload()` 的結構性保證）。
3. **三個閘門，鏡像桌面：**
   - `disableFiles` → 不傳 `onSendFile`／`onSendPhoto` ⇒ 📎 與 📷 不顯示（含拍照直傳，ADR-0274）。
   - `disableCalls` → 不傳 `onStartCall` ⇒ 通話鈕不顯示。
   - `disableStickers` → 新增 `stickersDisabled` prop ⇒ 😊 鈕與貼圖面板不顯示。
4. **不改變的事**：
   - **收到的檔案／貼圖照常顯示、通話照常可接**。政策是「不要發起」，不是「看不到別人發的」。
     單方面拒接來電會讓對方以為你不理他，且政策應由**發起端**的名冊決定。
   - 沿用 ADR-0048 的定位：這是 UX 層，不宣稱硬牆（檔案／通話另有中繼 `allowedKinds` 硬強制，
     由管理者在自架 relay 佈建，與客戶端無關）。

## 理由

- **鏡像桌面而非另立形狀**：`onSendFile` 之類的「可選 callback ＝ 功能開關」已是兩端共通慣例，
  行動端 `ConversationScreen` 本來就這樣寫（`onSendFile?`／`onStartCall?`／`onTakePhoto?`），
  接政策只是換一個條件，不需要新機制。
- **per-identity 是安全要求不是整潔要求**：政策殘留跨身分＝一個身分的公司規則套到另一個身分，
  或（更糟）離開公司後政策還黏著。ADR-0294 §2 的守衛測試正是為此存在。
- **貼圖用 prop 而非拿掉 callback**：貼圖面板的送出走的是共用的 `onSend`（就是送訊息），
  沒有專屬 callback 可以拿掉，只能用旗標。與桌面 `stickersDisabled` 同名同義。

## 後果

- 正面：企業政策在手機上真的生效；兩端閘門對稱，日後加旗標不會再只加一邊。
- 負面 / 已知殘餘風險：
  - 仍是 UX 層。決心的使用者可改客戶端——ADR-0048 的原始取捨不變。
  - 行動端沒有桌面的**文字觸發字**與**自訂 emoji 短碼**（那兩條 ADR-0310 才修的路徑
    在行動端本來就不存在），所以本次不需要對應處理。
- 後續行動 / 待辦：
  - 行動端設定頁未顯示「哪些功能被公司政策停用」，使用者只會看到按鈕消失。
    桌面亦同（ADR-0048 起就是如此），屬兩端共同的產品缺口，另議。
