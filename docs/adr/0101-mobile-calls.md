# 0101. 行動端通話（語音/視訊）：媒體平台縫與 react-native-webrtc 的移植路徑

- 狀態：已接受（已實作於 react-native-web；真 RN 需補 `.native` 實作，見後果）
- 日期：2026-07-13
- 相關文件：ADR-0025/0026（通話信令與 P2P 媒體）、0096（行動端向量圖示改採 react-native-svg）、
  0100（行動端補齊：錨點/雲端備份/檔案）；`apps/mobile/src/native/call-media.tsx`、`screens/CallScreen.tsx`

## 背景與問題

ADR-0100 補齊了行動端的錨點、雲端備份與檔案，唯獨**通話**留下——當時判斷它比其他項大一級，
應另立 ADR。本 ADR 處理它。

引擎端其實**早就備妥**：`WebRtcCall`（`packages/engine/src/backend/webrtc-call.ts`）已實作完整的
通話狀態機與 P2P 媒體，`ChatBackend` 也已暴露 `startCall`/`acceptCall`/`rejectCall`/`hangupCall`
與 `onCallState`/`onCallLocalStream`/`onCallRemoteStream`。缺的**只有行動端的 UI 與媒體渲染**。

### 核心困難：媒體渲染無法「一套通吃」

ADR-0096 把行動端的內嵌 `<svg>` 換成 `react-native-svg`，理由是**它有 web 實作**——所以能整包
換掉、雙端共用同一元件、把 DOM 依賴徹底移除。

**`react-native-webrtc` 的情況根本不同：它沒有 web 實作。** Web 上本來就直接用瀏覽器原生的
WebRTC（`RTCPeerConnection`／`getUserMedia`／`<video srcObject>`）；`react-native-webrtc` 存在的
意義正是「在 native 上補出這些原本沒有的東西」，並提供 `RTCView` 來渲染串流（RN 沒有 `<video>`）。

也就是說 **web / native 的分歧是本質性的**——即使是一個真正的 Expo app，web 與 native 也得走
兩條媒體渲染路徑。這不是我們架構沒做好，而是平台事實。

## 考量的選項

- **A. 現在就裝 `react-native-webrtc`**：它是純 native 模組，**在 web 上無法解析**（不像
  react-native-svg 有 web 實作可別名過去）。而本專案目前**根本沒有 RN/Expo 建置目標**
  （沒有 app.json、metro.config、ios/android）。裝進來只會讓能跑的 web 預覽多一份破壞風險，
  換得零實際好處。**不採**。
- **B（採用）. 把媒體渲染關進單一平台縫，並鋪好 `.native` 移植路徑**。

## 決策

### 1. 媒體平台縫：`apps/mobile/src/native/call-media.tsx`

**唯一**碰媒體元素的檔案，匯出兩個東西：
- `StreamView({ stream, audioOnly, muted, mirror })` — 渲染一條串流。
- `hasCallSupport()` — 平台是否具備 WebRTC 全域；沒有就**不顯示通話入口**（不給死按鈕）。

目前以瀏覽器原生 WebRTC ＋ `<video>`/`<audio>` 實作（供 react-native-web 預覽，也就是**現在
唯一存在的行動端建置**）。

### 2. 移植真 RN 的路徑（已鋪好，機械式）

新增 `call-media.native.tsx`——**Metro 會自動優先挑 `.native`**，`import` 路徑與所有呼叫端
**一行都不用改**。該檔內部改用：
- `react-native-webrtc` 的 `RTCView` 渲染串流；
- 在 app 進入點呼叫其 `registerGlobals()`，提供 `RTCPeerConnection`/`getUserMedia`
  （引擎的 `WebRtcCall` 用的就是這些全域，**引擎完全不需改動**）。

### 3. UI：`screens/CallScreen.tsx`

全螢幕覆蓋層，**不論當下在哪個畫面都會蓋上來**（來電不該被埋在分頁裡）：
- 來電 → 接聽／拒接；撥號中/連線中/通話中 → 靜音／掛斷。
- 視訊：遠端全屏＋本地小窗（鏡像、靜音以免回授）。語音：頭像＋不佔版面的音訊播放槽。
- 靜音＝**停用本地音軌**（`track.enabled = false`），對方是真的聽不到，不是只調本地音量。
- 通話時長計時（active 起算）。
- 對話標題列加 📞／📹；**群組不顯示**（引擎的通話是 1:1）。

## 理由

- 選項 B 讓「現在可用」與「日後可移植」同時成立，且**不引入一個在當前唯一建置目標上會壞掉的依賴**。
- 把 `<video>` 關在一個檔裡，而不是散落 UI——剛在 ADR-0096 把內嵌 `<svg>` 清乾淨，
  不該立刻又把 DOM 灑回畫面層。差別在於：SVG 那次有更好的解（整包換掉），這次沒有，
  所以要把不可避免的分歧**收斂到一個點**。

## 後果

- 正面：行動端有通話了（語音/視訊、來電覆蓋、靜音、計時）。引擎零改動。ADR-0086 的四項落差
  至此全部補完。
- 負面 / 已知殘餘風險：
  - **真 RN 上仍需補 `call-media.native.tsx` ＋ `react-native-webrtc`**。介面已定、路徑已鋪，
    但**尚未寫、也無法在此驗證**（沒有 RN 建置目標）。這點必須誠實記著，不能宣稱「通話已跨平台完成」。
  - 群組通話不支援（引擎的 `WebRtcCall` 本就是 1:1）。
  - 未做：來電鈴聲/震動、背景來電喚醒（RN 需 CallKit/ConnectionService）——那是另一個層級的工程。
- 測試：mobile +5 項（來電只顯示接聽/拒接、通話中只顯示靜音/掛斷、撥號中顯示對方與狀態、
  語音不渲染 `<video>`、視訊有 `<video>`）＝40 項。全 779 測試通過、typecheck 通過、
  行動端真實 vite build 通過。
