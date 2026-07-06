# 0048. 企業政策開關與強制 TURN

- 狀態：已接受
- 日期：2026-07-05
- 相關文件：docs/adr/0044（封閉 allowlist）、0047（組織名冊）、0008/0017/0026（WebRTC 信令/檔案/通話）；PRD §13、ROADMAP G2

## 背景與問題

企業常需依資安政策**停用部分功能**（檔案傳輸、通話、貼圖）與**避免 P2P 揭露內網 IP**。需在既有設計下提供集中、可強制的政策機制。

## 決策

**兩層政策：中繼端事件類型 allowlist（硬強制）+ 名冊分發的客戶端政策（UX + 強制 TURN）。**

1. **中繼端 `allowedKinds`（`RelayCore`，硬強制）：** 比照 `allowedAuthors`（ADR-0044），設定後只轉發/儲存 kind ∈ 名單的事件，其餘回 `OK false "blocked: kind"`。
   - 停用**檔案/通話** = 從名單排除其**信令 kind**（SDP `21000–21999`、CALL `21002`）→ 無信令即無 WebRTC。此為協定層硬強制。
   - 貼圖是 kind 14 聊天訊息（內容標記），**無法以 kind 阻擋** → 由客戶端政策處理。
2. **客戶端政策（名冊分發，UX + 強制 TURN）：** 管理者於組織名冊（ADR-0047）附帶可選 `policy`：`{ disableFiles?, disableCalls?, disableStickers?, forceTurn? }`。客戶端採用名冊時一併採用政策：
   - 隱藏對應 UI（檔案/通話/貼圖鈕）——UX 層，與中繼 kind allowlist 形成縱深防禦。
   - `forceTurn` → WebRTC `iceTransportPolicy: "relay"`（只用 TURN candidate，不揭露 host/srflx 內網 IP）。
3. **信任與來源：** 政策由管理者簽章的名冊分發（單一真實來源）；`allowedKinds` 由管理者於 relay 佈建。兩者一致由管理者掌控。

## 理由

- **縱深防禦：** 中繼 kind allowlist 是**協定層硬強制**（客戶端改不了）；客戶端政策是 UX 與 IP 遮蔽。檔案/通話兩層皆可擋；貼圖只能 UX 層（本質是訊息）。
- **最大複用：** `allowedKinds` 與 `allowedAuthors` 同構；政策搭名冊分發，複用 ADR-0047 採用機制。
- **強制 TURN 對症：** `iceTransportPolicy: "relay"` 是標準做法，直接消除內網 IP 揭露（需 TURN 伺服器）。

## 後果

- 正面：企業可集中停用功能、遮蔽內網 IP；檔案/通話有協定層硬強制。
- 負面 / 已知限制：
  - **貼圖停用僅 UX 層**（無法以 kind 擋，因是普通訊息）；決心的使用者可繞過客戶端。可接受（貼圖非資安要項）。
  - `forceTurn` 需企業部署 TURN 伺服器；無 TURN 時通話/檔案將無法建立（即等同停用 P2P）。
  - 政策 UI 隱藏非硬牆；真正硬牆是中繼 kind allowlist。
- 後續行動：`RelayCore.allowedKinds`（本批）；名冊 `policy` 欄位 + 客戶端 UI 閘門 + `forceTurn` 接入 WebRTC config；管理者佈建 UI 補政策設定。
