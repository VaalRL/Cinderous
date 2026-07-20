# 0213. 對話標題列 P2P 直連品質晶片

- 狀態：已接受
- 日期：2026-07-20
- 相關文件：ADR-0210（一般模式加預設 STUN＋靜音 P2P 失敗）、ADR-0088/0109（P2P 卸載中繼）、ADR-0162（企業 relay 檔案暫存）、`packages/engine/src/backend/webrtc.ts`、`apps/desktop/src/ui/ConversationWindow.tsx`

## 背景與問題

ADR-0210 把「⚠️ P2P 連線失敗」的全域錯誤靜音（改 `console.debug`），因為 P2P 失敗**不影響文字訊息**（文字走 relay），跳全域錯誤會讓使用者誤以為訊息壞了。

但靜音留下一個資訊缺口：P2P 失敗**確實**會影響部分功能——**檔案內容**（一般使用者 P2P-only、無 relay 退路，見 `sendFile`）與**語音/視訊通話**。使用者送檔案卡在「傳輸中」時，沒有任何線索知道是「對方直連建不起來」。

需求：在**不落成訊息串裡的假訊息**（ADR-0210 反對的那種）前提下，給使用者一個**冷靜、脈絡化**的直連狀態提示。使用者選擇「對話標題列常駐狀態晶片」呈現。

## 考量的選項

- **選項 A（採用）：對話標題列常駐晶片**——`⚡ 直連`（綠）／`⚪ 直連未建立`（低調灰）。持續反映連線品質，資訊透明。
- 選項 B：只在受影響的檔案泡泡上內聯警示（最精準、零假警報），但使用者要的是對話層級的常駐指示。
- 選項 C：對話內一次性「系統」樣式提示行（非訊息）。比 A 更顯眼、也更容易被當成訊息，且不常駐。

## 決策

採用選項 A，並貫徹「脈絡化、不假警報」原則：

**引擎（狀態來源）**：
- `webrtc.ts` `TransferHandlers` 新增 `onConnectionState?(peer, connected)`。發射點：資料通道 `onopen`→`true`（直連可用）、`onclose`→`false`、`pc.connectionState==="failed"`→`false`（與 ADR-0210 的降級 log 同處）。以**資料通道開啟**為「直連可用」的權威訊號（它才是承載檔案/通話/輸入中的通道）。
- `types.ts` `ChatBackendEvents` 新增 `onPeerConnection?(contact, connected)`；`relay-backend.ts` 把 transfer 的 `onConnectionState` 轉發上去。

**UI（呈現）**：
- `App.tsx` 以 `p2pConnected: Set<pubkey>` 追蹤，換身分/後端時清空；只把 `p2pConnected.has(pk)` 傳給 **1:1** 的 `ConversationWindow`（群組為多對端、無單一直連概念，`undefined`＝不顯示）。
- `ConversationWindow` 標題列（`win__title`，通話鈕左側，語意相關）渲染晶片；**僅在 `p2pConnected !== undefined` 且對方非離線時顯示**（離線時直連本就不可能、且已有離線提示，再顯示屬噪音）。
- i18n `convo_p2pDirect`/`convo_p2pNone` ＋ tooltip `convo_p2pDirectHint`/`convo_p2pNoneHint`（明載「文字不受影響」）。CSS `.chip--p2p.on` 用線上綠 `#36c46b`（對齊 `.dot.online` 的視覺語言）。

## 理由

- **補完 ADR-0210 而非違背**：0210 拿掉的是「訊息沒壞卻報錯」的假警報；本晶片是冷靜、常駐、只在相關（1:1×在線）時出現的資訊，且明載文字不受影響——資訊而非警報。
- **Fix First**：直連狀態本來就存在於 `webrtc.ts`（`hasOpenChannel`、`onconnectionstatechange`），只加一條回報 handler 串到 UI，不新增機制。
- **零伺服器狀態／隱私不變**：純本機事件（資料通道開/關），不與中繼互動、不新增外洩面。

## 後果

- 正面：使用者能一眼看出「直連是否建立」，理解檔案/通話為何可用或卡住；文字訊息的可靠性不被混淆。
- 負面 / 已知殘餘風險：晶片在「在線但直連建立中」的短暫視窗會顯示「未建立」（誠實但可能被誤讀為失敗）——以低調灰＋非阻斷降低誤解，未做去抖動（v1 從簡）。晶片僅桌面/瀏覽器 `ConversationWindow`；行動端另案對齊。
- 後續行動 / 待辦：可選加「未建立」狀態的去抖動（避開連線握手期的閃動）；以及 ADR-0210 標的的「檔案 P2P 失敗時的 relay 退路」為獨立產品決策，與本晶片互補（晶片先讓失敗可見）。
