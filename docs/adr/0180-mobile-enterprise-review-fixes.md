# 0180. 行動端企業模式審查修正——接管上線洩漏／配對連錯座／隱身殘留

- 狀態：已接受（已實作）
- 日期：2026-07-17
- 相關文件：ADR-0164（本機記住上線狀態·seed 於建構）、0088（隱身）、0172~0179（行動端
  企業模式）、0176（per-identity 公司座）、0179（離職接管）

## 背景與問題

對 ADR-0172~0179（行動端企業模式）做對抗式程式碼審查（自審＋獨立子代理），發現三個**高
嚴重度**問題，全落在沒有測試覆蓋的「接線層」：

1. **[高] 離職接管上線瞬間洩漏**：`takeoverOffboarded` 先 `signInWith`（內部 `backend.start()`
   會**同步**跑首拍 `beat()`）再 `setInvisible(true)`。離職員工在企業主裝置首次登入 →
   `loadPresence` 為空 → `self.status` 預設 `online`、`invisible=false` → **首拍即廣播一則存活
   信標**，把已離職員工對其（仍留著他的）同事短暫顯示在線。這是 ADR-0164「上線瞬間不得洩漏」
   在接管路徑的重演——`initialStatus` 有 seed 保護，`invisible` 卻沒有。
2. **[高] 配對企業身分連錯座**：`signInWith` 的公司座解析鏈**漏了 `bundle.relayUrl`**，且剛
   `rememberInProfile` 的同一輪 `profiles` 為 stale（`setProfiles` 未 commit）→ `prof` 為
   undefined → 落到全域預設 relay。桌面企業員工配對到手機後，後端帶著正確 `orgAdminPubkey`
   卻**訂在錯的 relay**，永遠收不到名冊/同事，且把「企業身分裝置存在」的心跳洩漏到公司外的座。
3. **[高] 隱身跨身分殘留**：`invisible` 僅 `logout` 會重置。接管（程式自動設 `invisible`）後切回
   自己身分，`invisible` 仍為 `true` → 本人**不自覺地對真正的聯絡人持續隱身**。

## 決策（修正）

### 1. 引擎新增 `initialInvisible` — 建構即隱身

`RelayPoolOptions.initialInvisible`：建構時 `this.invisible = pool?.initialInvisible ?? false`，
與 `initialStatus` 同理讓 `start()` 首拍 `beat()` 直接靜默（beat 第一行即 `if (invisible ||
status==="offline") return`）。行動端 `MobileBackendOptions`／`createRelayChat` 一路透傳。
`takeoverOffboarded` 改以 `forceInvisible` 讓後端**建構就隱身**，不再「start 後補 setInvisible」。

### 2. 公司座解析純函式 `resolveIdRelay`（含 `bundleRelay`）

抽出純函式：優先序 **接管 ＞ 入職邀請 ＞ 配對捆包 ＞ 已記住登錄 ＞ 全域**（補回漏掉的
`bundleRelay`）。純函式可測，鎖住優先序不再回歸。

### 3. `signInWith` 統一重設隱身＋改用選項物件

`signInWith` 開頭 `setInvisible(!!forceInvisible)`——切身分/登出對稱，接管以 `forceInvisible`
覆寫。並把成長中的位置參數（bundle/joinInvite/overrideOrg/overrideRelay/forceInvisible）
重構為**選項物件**，降低誤傳（審查發現的 bug 正是位置參數串太長所致）。

## 後果

- 正面：三個高嚴重度問題修掉——離職接管不再洩漏上線、配對企業身分連對公司座、隱身不再跨
  身分殘留。`initialInvisible` 補上 `invisible` 的建構期 seed（與 `initialStatus` 對稱）。
- 已知殘留（審查建議，非阻擋，後續處理）：
  - 公司儲存槽員工端佇列**無管理 UI**（done/failed 項留記憶體、failed 無法重試）——ADR-0177
    已記 v1 限制，後續補設定頁列表。
  - 行動端企業身分仍帶 `anchors`/`connectorFor`（桌面對企業身分刻意鎖單座不漫遊）——**既有
    行為、非本次回歸**，待評估是否對 `opts.org` 存在時比照桌面拿掉漫遊。
  - 刪除託管/接管無二次確認——非阻斷性建議。
- 測試：引擎 `initialInvisible` 首拍不漏心跳（260）；`resolveIdRelay` 優先序（含 bundleRelay
  勝全域）；engine 260＋mobile 190＋desktop 408 全綠、三端 typecheck 通過。
