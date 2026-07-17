# 0176. 行動端企業模式・階段 B——邀請碼入職（員工端）

- 狀態：已接受（已實作）
- 日期：2026-07-17
- 相關文件：ADR-0156（邀請碼＋自動入職）、0163（公司帳號金鑰託管＋離職接管）、0173（行動端
  企業身分後端接線・唯讀）、0174（配對企業身分跨重啟持久）、0175（消費端補完）

## 背景與問題

「行動版完整企業模式」路線圖**階段 B**：讓員工**純從手機**加入公司（個人裝置無需桌面）。
桌面早有此流程（`SignIn` 貼邀請碼 → `onJoinOrg` → 生成企業成員身分）；行動端缺。前一階段
（ADR-0173）刻意把行動端鎖在「唯讀採用名冊」，**不從行動端觸發入職寫入**——本階段刻意、經
同意地放開這一條。

## 決策

### 1. 貼邀請碼＝生成全新企業成員身分（鏡像桌面）

`NsecSignInScreen` 的顯示名稱欄貼入邀請碼（`parseOrgInvite` 偵測）→ 轉「加入組織」面板：
顯示公司座 host、輸入顯示名稱、**若 escrow 則明示託管警告並經同意**（`signIn_joinEscrow`）。
送出 → `joinOrg(invite, name, password?)`：**`generateSecretKey()` 生成全新身分**（不是拿現有
nsec 轉）＋顯示名稱，走 `inviteToOrg(invite)`（→`{enterprise, adminPubkey, orgJoinToken, orgEscrow?}`）。

### 2. 後端帶入職權杖／託管（放開 ADR-0173 的唯讀）

`backend.ts` 起也轉發 `orgJoinToken`／`orgEscrow`：開機自動向管理者提出入職（ADR-0156）、
公司帳號則把私鑰 E2E 託管給管理者（ADR-0163）。入職與託管皆**冪等**，故對搬入的成員亦帶
（確保一定在名冊、託管一致）——不再限唯讀。

### 3. 企業成員鎖定公司座（per-identity relay）

行動端 `relayUrl` 原為單一全域值；企業成員必須連**公司座**才收得到名冊。`signInWith` 改以
`joinInvite.relayUrl || 登錄 Profile.relayUrl || 全域` 決定該身分的 relay，用於 store 與後端建構。

### 4. 跨重啟持久（沿用 ADR-0174）

`joinOrg` 有密碼＝`rememberInProfile(…, inviteToOrg(invite))` 把企業精華＋公司座寫進登錄；
重啟解鎖即以企業成員身分（連公司座）啟動。

## 後果

- 正面：員工可**純從手機**貼邀請碼入職——生成工作身分、鎖公司座、自動入職、公司帳號託管
  （明示同意）、跨重啟持久、採用名冊（同事/allowlist/政策）。**員工端在手機上完全獨立**
  （＋階段 C 儲存槽存入即補齊「員工完整體驗」）。
- 已知限制／取捨：
  - 連線狀態細條（ADR-0169）仍看全域 `relayUrl` prop；成員連的是公司座時該條可能不反映——
    純顯示、後端連線正確，留待後續小修。
  - 入職為生成**全新**身分（與桌面同）；不支援把既有個人 nsec 「轉」成企業成員（避免個人與
    工作身分混同）。
  - SSR 測試無法輸入 → 只驗「提供 onJoinOrg 時顯示入職入口」＋`inviteToOrg` 純函式；貼碼後的
    加入面板互動由 `parseOrgInvite`（core 已測）＋引擎入職/託管測試把關。
- 路線圖 **B 完成**；接續 **C（儲存槽員工端）→ D（企業主管理）**。
- 測試：`identities.test` 補 `inviteToOrg`；`SignInScreens.test` 補入職入口顯示/隱藏；mobile 172
  綠燈、typecheck 通過（engine/desktop 未動）。
