# 0086. 行動端接真實 relay：RelayChatBackend＋加好友（npub）

- 狀態：已接受
- 日期：2026-07-12
- 相關文件：ADR-0085（行動端 app 殼）、ADR-0053（原生安全儲存）、ADR-0034（多中繼路由）；`apps/mobile/src/backend.ts`、`packages/engine/src/backend/relay-backend.ts`

## 背景與問題

行動端 app 殼（ADR-0085）此前只接**示範後端**（`BrowserChatBackend`，記憶體 relay＋機器人）。要真的能與人通訊，需接**真實中繼站**。桌面已有成熟的 `RelayChatBackend`（連真 relay、加密、NIP-17/44/59、多中繼、雲端備份…），問題是如何在行動端重用而非重寫，以及真實 relay 下清單一開始是空的、需要**加好友**入口。

## 決策

**行動端接真實 relay 走與桌面同一套 `@cinder/engine`，只換前端呈現層；並補「加好友（npub）」與「分享自己 npub」。**

1. **`backend.ts` 後端工廠**：
   - `createRelayChat(identity, relayUrl)`＝`new RelayChatBackend(new LocalStorage(pubkey), webSocketConnector(relayUrl), name, { relayUrl, connectorFor: webSocketConnector, anchors:[relayUrl], nsecOverride: identity.nsec })`。
   - `createBackend(identity, relayUrl|null)`：有 relayUrl＝真實 relay；null＝示範後端。
2. **身分注入**：以 `nsecOverride` 帶入登入取得的 nsec（**私鑰不落 localStorage**）；聯絡人/訊息以 `LocalStorage` 命名空間＝pubkey 持久化。**同一 `AppStorage` 介面**——正式行動版把 `LocalStorage` 換成 RN 安全儲存即可（ADR-0053／D2）。
3. **加好友 / 分享**（真實 relay 才顯示）：`ChatsListScreen` 標題「＋」展開面板——貼好友 `npub` → `backend.addContact(npub)`；並顯示自己的 `selfNpub` 供分享。示範模式不顯示（`BrowserChatBackend` 無 `addContact`、npub 為隨機）。
4. **預設中繼站**：`DEFAULT_RELAY = wss://cinder-relay.…workers.dev`（生產錨點），UI 可覆寫。
5. **web preview**：加「示範 ↔ 真實 relay」切換與 relay URL 欄；切換時以 `key` 重掛 `MobileApp`（重新登入）。瀏覽器有 `WebSocket`／`localStorage`，故真實 relay 於 preview 即可連線實測（雙向需兩個分頁各自不同 nsec 互加）。

## 理由

- **重用而非重寫**：`RelayChatBackend`／`webSocketConnector`／`LocalStorage` 都是既有、經桌面驗證的元件；行動端加薄薄一層工廠即可。
- **同帳號、私鑰不外流**：`nsecOverride` 讓私鑰只在記憶體用於簽章，不寫入 localStorage blob（延續 ADR-0053 精神）。
- **介面穩定**：`AppStorage` 抽象讓「web 用 localStorage、原生換安全儲存」零 UI 改動。

## 後果

- 正面：行動端可連真實中繼站收發訊息；加好友/分享 npub 讓真實 relay 實際可用。
- 負面 / 已知殘餘：
  - preview／web 用 `localStorage`；**原生安全儲存（RN Keystore/Secure Enclave）待 D2**。
  - 行動端尚未接**多中繼 hint／雲端備份／通話**等進階（桌面有）；先做核心收發＋加好友。
  - 配對匯入仍需 WebRTC（原生），web 不可用。
  - preview bundle 變大（engine＋crypto 進 bundle）；屬開發預覽，不影響原生打包。
- 後續：底部分頁與設定、relay hint／雲端備份行動端 UI、RN 安全儲存、原生打包。
