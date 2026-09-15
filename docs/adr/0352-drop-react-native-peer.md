# 0352. 不自動安裝 peer：把 React Native 工具鏈移出出貨相依圖

- 狀態：已接受
- 日期：2026-09-15
- 相關文件：ADR-0235 M2（相依弱點掃描硬閘）、ADR-0095/0096（訊息狀態圖示改用 `react-native-svg`）、ADR-0282（動作圖示）、ADR-0085（行動端 web preview）、ADR-0350（bot 洪水——見 §背景二）

## 背景與問題

PR #1 的 CI 讓 `pnpm audit --prod --audit-level low` 這道硬閘第一次被看見是紅的：**5 個弱點（4 high / 1 moderate）**，來自 3 個套件、同一條相依鏈：

```
apps/mobile → react-native-svg → react-native → ┬ metro → image-size 1.2.1      (high ×2)
                                                └ @react-native/codegen → @babel/core
                                                   → browserslist 4.28.4          (high ×2)
                                                     → baseline-browser-mapping   (moderate)
```

🔴 **升級解不掉**：`image-size` 的 `patched_versions` 是 `<0.0.0`——npm 的表示法，意思是上游沒有修。

**二、為什麼拖到現在才發現。** main 上最後一次 CI 是 **2026-08-10**（而且也是紅的）。之後一次都沒有——因為從那時起 main 的提交全是 bot 推送，而以 `GITHUB_TOKEN` 推的 commit 不觸發 workflow。**這個 repo 一個多月沒有 CI 訊號。** ADR-0350 修的是那個洪水的源頭；這裡是它的第二層後果，先前被我低估為「純粹的歷史污染」。

## 關鍵觀察

這些弱點全是 **React Native 的建置工具鏈**（metro bundler、codegen、babel），而 `apps/mobile` 跑的是 **`react-native-web`（DOM）**：`vite.config.ts` 把 `react-native` 別名成 `react-native-web`、`react-native-svg` 指向它的 `.web.js` 實作。

⇒ **那套工具鏈從來沒有被打包進去。** 它只存在於相依圖裡，卻讓一道「**會出貨給使用者**的相依必須零已知弱點」的閘門長紅。閘門掃到的東西，和它宣稱要守的東西對不上。

`react-native` 之所以在圖裡，是因為它是 `react-native-svg` 的 **`peerDependency`**（未標 optional），而 pnpm 8 起預設 `auto-install-peers=true`。

## 考量的選項

- **選項 A（採用）：`auto-install-peers=false`。** 讓相依圖只包含有人明講要的東西。
- 選項 B：移除 `react-native-svg`，圖示改回內嵌 DOM `<svg>`。**否決**——那會反轉 ADR-0095/0096 的決定（當初正是為了讓 `MsgStatusIcon`／`ActionIcon` 能原樣移植到真 RN 才換成它，見 `call-media.tsx` 檔頭的對照說明）。為了兩個圖示元件放棄可攜性，代價不對。
- 選項 C：`pnpm.overrides` 把 `react-native` 換成 `react-native-web`。**實測無效**——`overrides` 作用於**宣告的**相依，對自動安裝的 peer 不生效（試過，`react-native 0.86.0` 仍在圖裡）。
- 選項 D：advisory 允許清單。最快，但會讓硬閘開一個沒有期限的洞，與 ADR-0235 的立場衝突。

## 決策

**一、`.npmrc` 設 `auto-install-peers=false`。**

**二、補上唯一真正需要的那一個。** 關掉之後測試紅了——`react-native-svg` 的 **web 實作**在 `resolveAssetUri.js` 裡 import `@react-native/assets-registry/registry`。這是實測發現的，不是推論：它是那 158 個套件裡**唯一**在 web 路徑上真的會被載入的。改為 `apps/mobile` 的明示相依（該套件本身零相依）。

**三、`pnpm.peerDependencyRules.ignoreMissing: ["react-native"]`。** 把「這個 peer 故意缺著」寫成明示的設定，否則每次 install 那行 WARN 會變成大家學會忽略的雜訊。

## 結果

- `pnpm audit --prod --audit-level low` ⇒ **No known vulnerabilities found**（原本 5 個）。
- lockfile **移除約 238 筆、新增約 9 筆**（−1,393 行）。
- **行動端實際打包成功**——這是最關鍵的一項驗證：它證明 web bundle 真的不需要 `react-native`，而不只是「測試沒紅」。
- 全工作區 3,064 測試、`pnpm -r typecheck`、`version:check`、scripts 測試、desktop build 全過；`--frozen-lockfile`（CI 的安裝方式）一致。

## 後果

- 正面：出貨相依圖縮小一個量級；硬閘回到綠，且它現在掃的是真正會出貨的東西。安裝也更快。
- 負面／已知殘餘風險：
  - ⚠ **日後新增套件時，它的 peer 不會自動出現**——缺了要自己在 `package.json` 補。這比較囉嗦，但也比較誠實：相依圖裡的東西都是有人明講要的。**這是本決策唯一持續性的代價**，而它會落在下一個加套件的人身上（不一定是我）。
  - **`@react-native/assets-registry` 是實測補出來的，不是分析出來的。** 若日後 `react-native-svg` 的 web 實作新增其他 RN 相依，症狀會是「測試載入失敗」而不是明確的錯誤訊息——那時要回頭看這份 ADR。
  - **真 React Native 移植路徑未受影響但也未驗證**：元件原始碼仍是可攜的 `import Svg from "react-native-svg"`，Metro 會自行挑 native 實作並帶上自己的 `react-native`。但這條路本來就沒有實機驗證過（ADR-0085：原生 App 尚未推出）。
  - **開發鏈的 36 個弱點依然存在**（`pnpm audit --audit-level high`，15 moderate / 19 high / 2 critical）。那是 `continue-on-error` 的軟性檢查，本決策沒有動它——ADR-0235 已把它列為 vite/vitest 的升級債。
  - 關閉 auto-install-peers 是**全 workspace** 的設定，影響不只行動端。目前所有測試、typecheck 與兩個 build 都過，但那是「沒看到問題」，不是「證明沒問題」。
- 後續行動／待辦：
  1. 開發鏈那 36 個弱點另案盤點（尤其 2 個 critical）。
  2. ADR-0235 M2 那句「會出貨給使用者的相依」值得寫出明確定義——這次的紅燈本質上是定義不清造成的。
