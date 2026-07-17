# 0172. 企業身分經配對搬家帶到行動端——據以設閘企業專屬 UI（頭銜編輯）

- 狀態：已接受（已實作）
- 日期：2026-07-17
- 相關文件：ADR-0170（行動端頭銜，遺留「未設閘」限制）、0118/0125（配對搬家）、0072
  （配對捆包）、0045（多身分登錄）、0155/0156/0163（企業主/入職/託管）、程式碼審查發現 #6

## 背景與問題

ADR-0170 在行動端補上企業自報頭銜，但**編輯器對所有身分顯示**——因為行動端無從判斷某身分
是不是企業身分。查證後確認根因：

- 引擎 `Profile`（行動端與桌面共用）已有 `enterprise`/`orgOwner`/`adminPubkey` 等欄，但行動端
  建立身分一律 `enterprise: false`，**沒有任何流程把它設 true**（行動端無入職/建企業 UI）。
- 引擎只在**設定了 `orgAdminPubkey`** 時才訂閱並採用名冊（`adoptRoster`→`onOrgInfo`），行動端
  從不傳 → 執行期也偵測不到企業身分。

結論：行動端上一個企業身分**只可能來自桌面**（在桌面入職/建企業，再配對搬家到手機）。因此
正確的訊號來源是**配對搬家捆包**。

## 決策

### 1. 配對捆包帶「企業身分精華」`org`（`PairBundle.org`）

新增可選 `PairBundleOrg { enterprise?, orgOwner?, adminPubkey?, orgJoinToken?, orgEscrow? }`。
這些欄位在 `Profile`（登錄）而非 `AppStorage`（快照）裡，故獨立帶。**向後相容**：舊捆包無此欄
＝一般身分。`buildPairBundle`／`parsePairBundle` 皆**淨化**（只留合法欄位、全空回 undefined、
不信任收到的形狀）。

捆包本身走一次性金鑰 E2E 加密＋SAS 人工比對，且都是**使用者自己的資料/持有的權杖**、只在
自己的兩台裝置間傳 → 無隱私顧慮（明文不上雲鐵則不受影響）。

### 2. 桌面來源端帶上 org（`runPairSource`）

`runPairSource`／`buildPairBundle` 的 `profile` 參數新增 `org?`；桌面搬家時從**作用中 profile**
組出 org（僅在真的是企業身分時帶）。附帶好處：桌面→桌面搬家也開始保留企業身分（先前會遺失）。

### 3. 行動端據 org 設閘頭銜編輯器

行動端無登錄化的企業旗標（配對進來的身分目前是**暫時 session**，不寫入 profiles 登錄），故以
**執行期狀態** `selfEnterprise`——於 `signInWith` 從 `bundle.org.enterprise || orgOwner` 取得
（一般/示範身分恒 false）。頭銜編輯器改為 `selfEnterprise && setSelfTitle` 才顯示（與桌面
`enterprise || orgOwner` 設閘語意一致）。頭銜 chip **顯示**（看同事頭銜）不受影響、照常。

## 後果

- 正面：解掉 ADR-0170 的「未設閘」遺留——一般個人身分的行動端設定頁不再出現「頭銜」欄；
  從桌面搬來的工作身分則正確顯示可編輯。桌面↔桌面搬家也一併保留企業身分。零協定/中繼變更、
  捆包向後相容。
- 已知限制／取捨：
  - `adminPubkey`/`orgJoinToken`/`orgEscrow` 已隨捆包帶到行動端，但**行動端後端尚未據以
    連公司座/抓名冊**（`createRelayChat` 還沒傳 orgAdminPubkey）——這是「企業身分完整運作於
    行動端」的下一步，本 ADR 只先解「設閘」。
  - 行動端配對進來的身分是**暫時 session**（不寫 profiles 登錄、重啟即失，既有限制），故
    `selfEnterprise` 為 session 執行期訊號；要跨重啟持久，需先讓行動端把配對身分連同 org
    精華記住進登錄（另一批工作）。
  - 純行動端**新建**的身分無法成為企業身分（無入職 UI）——這是刻意，企業身分一律在桌面建立。
- 測試：`pair-bundle.test.ts` 補 org 往返/一般身分不帶/非法淨化；engine 259＋mobile 164＋
  desktop 408 全綠、三端 typecheck 通過。
