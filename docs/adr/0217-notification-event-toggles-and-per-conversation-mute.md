# 0217. 通知事件細分開關 ＋ 每對話靜音

- 狀態：已接受
- 日期：2026-07-20
- 相關文件：ADR-0076（通知抽象與內文組裝）、ADR-0116（Web Notification 共用基質）、ADR-0121（訊息請求防洪）、ADR-0149（依聯絡人音效）、ADR-0157（企業下班靜音）、`packages/engine/src/notify.ts`、`apps/desktop/src/App.tsx`

## 背景與問題

目前**唯一會跳桌面/瀏覽器通知的事件＝「收到訊息」**（含檔案訊息，走 `onMessage`），且只在「他人送＋視窗未聚焦」時。其他事件各有反應但不跳通知：敲一敲＝震動/動畫、來電＝響鈴、訊息請求＝刻意安靜（ADR-0121）、reaction＝只更新 UI。設定只有「總開關＋提示音＋隱藏預覽＋依聯絡人音效＋企業下班靜音」。

需求：讓使用者在設定**細分控制哪些事件要通知**，並可**單獨靜音某對話**。

## 考量的選項

群組細緻度（使用者選定）：**全域「群組訊息」開關 ＋「@我一律通知」override**（簡單、涵蓋大多數需求），而非每群 3 態（全部/只@我/靜音）。
每對話靜音（使用者選定）：**一併加上**。
分組資料：**復用既有 `GroupPrefsMap`**（已存 labels/pinned）加 `muted`，而非新資料層。

## 決策

**純函式 SSOT（engine，可測、與行動端共用）**：
- `NotifyEvent = "dm" | "group" | "nudge" | "call" | "request" | "reaction"`；`NotifyPrefs`（7 個開關，`mention` 為群訊 override 旗標）；`DEFAULT_NOTIFY_PREFS`（日常事件開、request/reaction 預設關）。
- `shouldNotify(prefs, ctx)`：收斂所有閘門——總開關 → 視窗未聚焦 → 非企業下班靜音 → 對話未靜音 → 該事件開關（群訊：`group || (mention && mentionsMe)`）。桌面/瀏覽器 toast 由它決定；in-app 效果（響鈴/震動/未讀）不歸它管。

**接線（App handlers）**：
- `onMessage`：以 `shouldNotify` 取代散落判斷（事件 dm/group、@我 override、每對話靜音、下班靜音）。
- `onNudge`：新增敲一敲通知（`nudge`）。`onCallState`：`state==="incoming"` 時新增來電通知（`call`），響鈴不變。`onRequests`：opt-in（`request`，預設關）——僅對「新出現」的請求者提示一次，沿用 ADR-0121 防洪。
- `reaction` 事件**已建模但 v1 未接線/未上 UI**（`onReaction` 目前不帶對話情境與訊息歸屬，貿然通知會失準）——保留於純模型供未來 onReaction 帶足情境後啟用。

**每對話靜音**：`GroupPrefs` 加 `muted` ＋ `isMuted`/`withMuted`（復用於群組與聯絡人）；`ConversationWindow` 標題列加 🔕 入口（`onToggleMute`）；靜音對話不跳通知（仍收訊、仍算未讀）。

**設定 UI**：`SettingsPanel` 總開關下加「要通知哪些事件」子區（dm/group/mention/nudge/call/request 六個開關），存 localStorage `nb.notifyEvents`。

## 理由

- **SSOT / 可測**：把「何時跳」從散落在 `onMessage` 的條件收斂為一個純函式，各 handler 共用、易測易維護。
- **Fix First**：每對話靜音復用既有 `GroupPrefsMap`；通知基質（getNotifier/notificationFor）不動。
- **尊重既有隱私/防洪**：隱藏預覽、企業下班靜音、請求防洪都保留；request/reaction 預設關避免擾民。
- **平台共用**：`shouldNotify` 在 engine，桌面與（未來）行動端同一套。

## 後果

- 正面：使用者可逐事件開關通知、可單獨靜音吵雜對話；敲一敲/來電/陌生人請求現在也能（選擇性）通知。
- 負面 / 已知殘餘風險：`reaction` 通知尚未實作（需 `onReaction` 帶對話/歸屬情境）；🔕 與依聯絡人音效 🔔 同列，靠 tooltip 區分（v1 可接受）。onRequests 的「新請求」判斷以上一次渲染的清單為準（重整後首批可能再提示一次）。
- 後續行動 / 待辦：補 `onReaction` 情境後啟用 reaction 事件並上 UI；可選把 🔕 也放進聯絡人列 hover；未來若要每群 3 態再擴充。
