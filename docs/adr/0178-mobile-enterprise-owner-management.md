# 0178. 行動端企業模式・階段 D（v1）——企業主管理：建立公司＋名冊＋邀請碼

- 狀態：已接受（已實作）
- 日期：2026-07-17
- 相關文件：ADR-0155（企業主身分/名冊管理）、0156（邀請碼＋自動入職）、0157（公司設定/
  下班靜音）、0160（保留天數）、0163（金鑰託管/離職接管）、0172/0174/0176（行動端企業身分）

## 背景與問題

路線圖**階段 D**：把企業主管理搬上手機。桌面有完整 `RosterAdminModal`＋owner 建立流程；行動端
缺。本 ADR 為 **v1**——涵蓋**建立公司、名冊管理、邀請碼、公司設定**；**離職接管**（含
`onOrgEscrow` 持久化）另立 v2（見下「取捨」）。企業主**收儲存槽落盤**維持桌面（原生 FS，路線圖 E）。

## 決策

### 1. 企業主核准權杖跨端流通（`PairBundleOrg.orgInviteToken`）

`PairBundleOrg` 加 `orgInviteToken`（＋build/parse 淨化、桌面搬家帶上、`profileOrg`／
`rememberInProfile`／`backend.ts` 一路透傳）。企業主的核准權杖因此**跨重啟持久**、可搬家
（先前 0172 只帶到 orgEscrow 為止）。

### 2. 建立公司（`createCompany`）

沿用入職的「生成全新身分」模式：`generateSecretKey()` → 一般身分＋`{orgOwner:true,
orgInviteToken: newInviteToken()}`。有密碼＝記住（跨重啟持久）。`signInWith` 加 `overrideOrg`
參數（新企業主 profiles 尚未 commit，直接帶 org），末尾覆寫落在**組織名冊畫面**。後端以
`orgOwner`＋`orgInviteToken` 啟動（訂自己的名冊找回狀態＋入職自動核准）。

### 3. 組織名冊管理畫面（`RosterAdminScreen`）

新增行動端管理表單（鏡像桌面 `RosterAdminModal` 的 `onPublish` 契約）：組織名、成員
（`npub 名稱`／行，預填自己為管理者）、歡迎詞、上下班時間、保留天數、**入職邀請碼**
（`makeOrgInvite`，可複製、可勾「公司帳號託管」）。發布＝`publishRoster` 簽章 replaceable 名冊
＋回傳 relay allowlist。入口：建立公司後直達，或**設定頁「組織名冊」**（企業主才顯示）。

## 後果

- 正面：企業主可**純從手機**建立公司、發布/更新名冊、複製邀請碼給員工、設定歡迎詞/工時/
  保留天數。搭配階段 B（員工入職）＝**一家公司可完全在手機上組起來並運作**（除收儲存槽落盤）。
- 已知限制／取捨（v2 待辦）：
  - **離職接管未做**：`onOrgEscrow`（企業主收員工託管私鑰）**本 v1 不持久化**——存員工 nsec
    是紅線敏感（須比照桌面加密儲存，不可貿然明文落 localStorage），連同「名冊標記離職→以託管
    金鑰接管查看/刪除」一起留 v2。故**目前手機企業主收到的託管會被忽略**（明載）。
  - 名冊畫面**未含**：群組管理、進階政策開關（停用檔案/通話/貼圖/強制 TURN）、身分輪替、
    relay 檔案上限——桌面有，行動端後續補。
  - 成員以文字區「npub 名稱／行」編輯（與桌面同）——非精緻聯絡人挑選器，v1 夠用。
  - 企業主**收儲存槽落盤**仍桌面（原生 FS，路線圖 E）。
- 路線圖 **D（v1）完成**；剩 **D-v2（離職接管）** 與 **E（企業主收儲存槽，需原生）**。
- 測試：`RosterAdmin.test`（表單結構/邀請碼顯示條件/預填）；`SignInScreens.test` 補「建立公司」
  入口；engine 259＋i18n 8＋mobile 182 綠燈、engine/desktop/mobile typecheck 通過。
