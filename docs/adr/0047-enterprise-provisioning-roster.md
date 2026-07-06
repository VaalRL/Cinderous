# 0047. 企業佈建與組織通訊錄（簽章名冊）

- 狀態：已接受
- 日期：2026-07-05
- 相關文件：docs/adr/0044（封閉 allowlist）、0045（多身分）、0046（成員判定與邊界）；ADR-0035/0039（簽章清單機制，本 ADR 複用）；PRD §13、ROADMAP G1

## 背景與問題

企業模式（ADR-0044/0045）落地後，成員管制靠 relay allowlist，但**成員佈建與通訊錄**尚缺：管理者如何一次派發成員名單、成員如何自動看到同事（免手動加好友）、離職如何撤銷。需在隱私鐵則下提供此機制。

## 決策

**採「管理者簽章的組織名冊（org roster）」，複用 ADR-0039 的簽章清單機制。**

1. **資料模型：** `OrgRosterDoc = { org, members: [{ pubkey, name, relayUrl? }], updatedAt }`，由**管理者金鑰**簽章為 NIP-01 事件（kind `ORG_ROSTER_KIND = 10038`）。信任根＝管理者公鑰（佈建進企業建置/設定檔）。
2. **核心函式（`packages/core/src/org-roster.ts`，比照 `bootstrap.ts`）：**
   - `signOrgRoster(doc, adminSk)`：建立並簽章名冊事件。
   - `verifyOrgRoster(event, adminPubkey)`：kind/作者/簽章/內容/成員數（≥1，防清空）全數驗證；任一不符回 null。
   - `shouldAdoptRoster(current, candidate)`：僅較新（`updatedAt` 更大）才取代（防重放/清空）。
   - `rosterAllowlist(doc)`：取出 pubkey 陣列，供 relay `allowedAuthors` 佈建（單一真實來源）。
   - `diffRoster(prev, next, self)`：算出 `{ toAdd, toRemove }`，供客戶端同步聯絡人（新增新成員、移除離職者），排除自己。
3. **客戶端行為：** 工作身分收到/載入名冊 → 驗簽 → 較新才採用 → 依 `diffRoster` 預填/更新聯絡人（自動通訊錄）；離職者從名冊移除即從聯絡人移除。
4. **relay allowlist 同源：** 管理者用同一份名冊匯出 pubkey 佈建 relay `allowedAuthors`（server 端設定）。名冊是成員的**單一真實來源**。
5. **傳播：** 沿用 ADR-0039——以公司 relay 帶內為主（封閉節點僅成員可讀）、可 HTTP 後備。名冊揭露成員 pubkey 給「能讀取者」；封閉節點下即僅內部成員，可接受。

## 理由

- **最大複用、最小新面：** 驗簽/採用/防清空與 `bootstrap.ts` 同構，純函式可測；不新增密碼原語。
- **符合既有哲學：** 「較新才取代 + 最小數防清空 + 單一維護者簽章」與 ADR-0039 一致；撤銷語意與「移除即不放行」一致。
- **單一真實來源：** 名冊同時餵客戶端通訊錄與 relay allowlist，避免兩處不一致。

## 後果

- 正面：成員自動通訊錄、集中佈建、離職即撤銷；relay allowlist 與客戶端名單同源。
- 負面 / 已知限制：
  - **單一管理者金鑰**為信任根（單點）；多管理者/輪替為後續。
  - 名冊內容（成員 pubkey/名稱）對「能讀取名冊者」可見；封閉節點下僅內部成員，但仍是內部通訊錄的元資料。
  - relay allowlist 的實際套用是 server 端佈建（管理者匯出）；本 ADR 提供 `rosterAllowlist` 產出，佈建工具/自動同步為後續。
  - 客戶端「工作身分聯絡人由名冊管理」與「使用者手動加的聯絡人」之界線需定義（實作時：名冊管理的以 pubkey 集合標記，手動加的不被名冊移除）。
- 後續行動：核心名冊模組 + TDD（本批）；客戶端工作身分自動採用名冊、聯絡人同步接線；管理者佈建工具（產生名冊、匯出 allowlist、分發）。
