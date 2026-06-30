# 0008. WebRTC 信令與資料通道協定（M3）

- 狀態：已接受
- 日期：2026-06-30
- 相關文件：PRD.md §5、§9；ARCHITECTURE.md §5；docs/adr/0002

## 背景與問題

M3 需定義 P2P 的三件事：SDP/ICE 信令如何經中繼交換而不洩漏「誰呼叫誰」、資料通道上 Nudge 與檔案傳輸的訊息格式、以及 P2P 失敗時的降級策略。

## 決策

1. **信令封裝**：SDP offer/answer 與 ICE candidate 以 **NIP-59 Gift Wrap** 包成 **ephemeral kind 21000**（21000-21999 區間），帶 `#p` 收件人、不帶 NIP-40 過期，純記憶體轉發。重用 `nip59.ts` 的通用信封（與離線私訊共用，避免重造）。
2. **資料通道協定**：通道本身由 WebRTC DTLS 加密，故上層為明文 JSON：
   - Nudge：`{ t: "nudge" }`
   - 檔案：`file-begin`（id/name/mime/size/chunks）後接多則 `file-chunk`（id/seq/base64 data）；接收端依 seq 重組，支援亂序，空檔在 begin 後即完成。
3. **雙軌降級**：`selectTransport` 依偏好順序挑第一個可用路徑。Nudge `p2p→turn→relay`；檔案 `p2p→turn`（不經中繼）。

## 理由

信令重用 NIP-59 確保元資料隱藏與程式碼單一來源；資料通道用簡單 JSON 框架便於測試與跨平台；降級策略明確對應 PRD §9，避免核心功能在對稱 NAT 下完全失效。

## 後果

- 正面：信令不洩漏社交圖譜；檔案分塊可亂序重組；降級邏輯可單元測試且與傳輸實作解耦。
- 負面 / 待辦：實際 `RTCPeerConnection`/ICE/TURN 接線、檔案背壓（backpressure）與大型檔案的記憶體上限策略，需在具 WebRTC 執行期的環境（瀏覽器/webview/Rust）實作與壓測。
- 後續行動：以 core 的信令/資料通道/降級邏輯接上真實 WebRTC；評估 TURN 伺服器來源。
