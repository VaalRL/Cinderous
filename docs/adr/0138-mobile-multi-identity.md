# 0138. 行動端多身分：採用 profiles 登錄、每身分密碼包裹金鑰、切換即解鎖

- 狀態：已接受（已實作）
- 日期：2026-07-15
- 相關文件：**ADR-0045（多身分設定檔）**、0055（禁跨身分交友）、0067（本地密碼）、
  0112（web/mobile Argon2id 包裹 nsec）、0117（行動端記住我）、0135（行動端改密碼/備份碼，同批）

## 背景與問題

多身分（ADR-0045）在**桌面**能用：`packages/engine/src/storage/profiles.ts` 是**平台無關**的登錄
（有哪些身分、誰在作用中，純狀態轉換），桌面 App 在其上做切換器＋新增。**行動端只有單一身分**——

- `auth.ts` 只模型化一個身分；記住的身分是**單一** `nb.remembered`。
- `MobileApp` 一次一個身分，無登錄、無切換、無新增。

但行動端其實**已具備切換的地基**：資料一向以 **pubkey 命名空間**隔離（`LocalStorage(pubkey, …)`），
`signInWith` 本就是「停舊後端、起新後端」。缺的是**登錄**、**多把金鑰的儲存**、與**UI**。

## 決策

### 1. 採用共用登錄 `profiles.ts`，不另造

行動端 `MobileApp` 用 engine 的 `loadProfiles`/`upsertProfile`/`setActive`/`removeProfile`/
`activeProfile`/`visibleProfiles`（純狀態轉換，ADR-0045）。登錄 `nb.profiles` 存**中繼資料**
（pubkey、名稱、relay、namespace），**不含 nsec**。

### 2. 每身分一份密碼包裹的 nsec（行動端專屬儲存）

行動端**絕不明文存 nsec**（ADR-0112 紅線），所以每身分的金鑰是一份 **Argon2id 密碼包裹的 blob**，
鍵為 `nb.remembered.<pubkey>`（新的 `apps/mobile/src/identities.ts`：`getRemembered`/`putRemembered`/
`rememberInProfile`/`removeIdentity`/`switchActive`）。**每身分各有自己的本地密碼**——切換到某身分＝
解**那把**密碼。

### 3. 舊單一身分無縫遷移

首次載入（無 `nb.profiles`）若存在舊的單一 `nb.remembered`，`loadIdentities` 把它遷成一個 profile
（namespace＝pubkey，對齊行動端既有儲存）＋複製 blob 到 `nb.remembered.<pubkey>`＋清掉舊鍵。既有
使用者開機仍是同一把密碼解鎖、資料原封——**向後相容、零手動遷移**。

### 4. 切換／新增／登出

- **切換**：設定裡的切換器列出 `visibleProfiles`；點非作用中者 → 用**同一個解鎖畫面**指向目標身分 →
  解其密碼 → `setActive`＋`signInWith`（換命名空間，資料天然隔離）。
- **新增**：重用 `NsecSignInScreen`（加 `onBack`）貼另一把 nsec／備份碼＋設密碼 → `rememberInProfile`
  加入登錄並切過去。
- **登出**＝移除**這個**身分（刪 blob＋登錄移除）：還有其他身分就去解下一個，沒有了才回登入。

### 5. 禁跨身分交友（ADR-0055）

行動端 `addContact` 加 `isOwnIdentity(profiles, npub)`：後端只擋作用中身分，多身分下連**其他已註冊
身分**也一起靜默擋——把自己的兩個身分互加＝洩漏「這兩個 npub 是同一人」。

## 理由

- 登錄是純狀態轉換、已在 engine 且已測——行動端**採用**而非重造（Fix First）。金鑰儲存與遷移是行動端
  專屬（桌面有 OS 金鑰庫，行動端只能密碼包裹），收在 `identities.ts`。
- 資料隔離「免費」：命名空間本就是 pubkey，切換＝換命名空間，各身分聯絡人/訊息/群組天然分開。
- 每身分獨立密碼 ＋ 切換即解鎖：符合 ADR-0067「密碼即解密原料」——沒有那把密碼就進不了那個身分。

## 後果

- 正面：
  - 行動端能**並存多個身分、一鍵切換、新增、逐一登出**；既有單一身分無縫遷移。
  - 資料隔離免費（pubkey 命名空間）；跨身分交友被擋（ADR-0055）。
  - 測試 +13（identities 9：遷移/round-trip/拒明文/加兩身分/空密碼/切換持久化/移除/自我交友防護；
    UI SSR 4：切換器與新增入口分流、新增模式返回）。全綠：mobile 127→140。

- 已知限制：
  - 要成為**可切換**的身分必須「記住」（設本地密碼）——無密碼登入仍是轉瞬 session，不進切換器
    （與 ADR-0117「無密碼＝不記住」一致）。
  - 行動端這版是**個人身分**：不含企業身分（連公司座/allowlist/鎖漫遊）、隱藏身分、每身分雲端快照、
    搬家排水（ADR-0066）——那些是桌面既有的進階項，另議。
  - 切換/新增的**互動流程**是薄接線，核心在 `identities.test.ts`（含 Argon2id 包裹 round-trip）；UI
    顯示分流有 SSR 測試。面板互動需 jsdom（行動端目前純 SSR，同 ADR-0133 取捨）。
