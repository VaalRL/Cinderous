# 0009. 多設備同步：QR 配對、競速與收斂語意（M4）

- 狀態：已接受
- 日期：2026-06-30
- 相關文件：PRD.md §4、§11；ARCHITECTURE.md §4；docs/adr/0004

## 背景與問題

M4 需定義：QR 配對載荷與同步包加密、首次配對的連線競速、以及多設備之間「各自 SQLite SSOT」如何持續收斂而不發散。

## 決策

1. **QR 配對**：QR 僅含 `{ v, key(base64 32B AES-256 金鑰), lan, room }`，不含任何明文。同步包以 **AES-256-GCM**（`nonce || ciphertext`，每次隨機 nonce）加密；金鑰用後即焚。AES-GCM 採 `@noble/ciphers`，與 ADR-0004「core 以 @noble 為加密原語」一致。
2. **連線競速**：`raceConnections` 同時發起 LAN 直連與 WAN 打洞，**先連通者勝、AbortSignal 中止其餘**（RFC 8305 Happy Eyeballs 精神；採同時發起的簡化版而非嚴格分階段延遲）。
3. **收斂語意**：訊息以 **event id 去重**（集合語意）；可變狀態（已讀位置、暱稱、封鎖）採 **last-writer-wins（updatedAt 比較）**。兩者皆具交換律，任意套用順序收斂一致。

## 理由

QR 只帶一次性金鑰與連線資訊，最小化暴露面；AES-GCM 提供 AEAD 完整性；競速確保複雜網路下最高連通率；去重 + LWW 是最簡單且可證明收斂的多設備合併策略，避免多 SSOT 發散。

## 後果

- 正面：配對安全且最小暴露；多設備可收斂；皆可純單元測試。
- 負面 / 待辦：QR 通道的雙向 challenge-response 互認、LWW 對並發編輯的取捨（必要時改 CRDT）、實際 LAN/WAN 連線器與背景同步觸發需在具網路/Tauri 的環境實作。
- 後續行動：接上真實連線器與設備間同步事件（自封 NIP-17）；評估是否需 CRDT。
