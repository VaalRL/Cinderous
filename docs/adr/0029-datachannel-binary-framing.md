# 0029. 資料通道檔案分塊改用二進位框架（F3/C4）

- 狀態：已接受
- 日期：2026-07-01
- 相關文件：docs/adr/0008（WebRTC 信令與資料通道）、0017（檔案傳輸）；ROADMAP F3

## 背景與問題

原本檔案分塊以 JSON 訊息攜帶 base64 編碼的位元組（`{t:"file-chunk", data:<base64>}`）。
base64 使承載膨脹約 **33%**，且經 JSON 再一層字串化——對大檔案（照片、語音、相簿）
浪費頻寬與 CPU。

## 決策

- **控制訊息維持 JSON 字串**（`nudge`、`file-begin`）：小、結構化、可讀。
- **檔案分塊改為二進位框架**（`packages/core` `encodeFileChunk`/`decodeFileChunk`）：
  `[type=1][idLen][id(ASCII)][seq(uint32 BE)][chunk bytes]`，原位元組**不經 base64**。
- `encodeFile` 回傳 `(string | Uint8Array)[]`；`DataChannelReceiver.receive` 依型別分流
  （字串→控制、二進位→分塊）。WebRTC 端 `dc.binaryType="arraybuffer"`，送出時分塊直接
  以底層 `ArrayBuffer`（零拷貝）送出。

## 後果

- 正面：檔案/語音/相簿承載去除 base64 ~33% 膨脹與 JSON 開銷；核心單元測試涵蓋框架
  round-trip、非法框架、超量中止；經真實 WebRTC E2E 驗證圖片位元組完整還原（byte-exact）。
- 負面 / 相容：資料通道分塊格式改變（**Buddy P2P 內部協定**，非 Nostr 事件契約，無外部
  相容顧慮）；新舊客戶端若混用需同版。id 以 ASCII 假設（app 產生的短 id，符合）。
