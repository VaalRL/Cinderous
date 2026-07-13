# 0103. 送出端也走原生選檔對話框：取得原檔路徑（補完 ADR-0102 的殘留）

- 狀態：已接受（已實作）
- 日期：2026-07-13
- 相關文件：ADR-0093（檔案接收：App 不保存位元組）、0102（縮圖＋讀回原圖＋重新指定位置）；
  `apps/desktop/src/native/save-file.ts`、`apps/desktop/src-tauri/src/main.rs`

## 背景與問題

ADR-0102 讓圖片跨 session 存活（縮圖）並可從 `savedPath` **讀回原圖**。但它留下一個不對稱的殘留：

> 送出端的原圖沒有 `savedPath`（瀏覽器 File API 拿不到完整路徑）→ **自己送出的圖片，重載後只看得到縮圖。**

也就是說：**別人傳給我的圖看得到原圖，我自己傳出去的反而看不到**——這很怪。

根因很單純：桌面的 📎 走的是瀏覽器 `<input type="file">`，而**瀏覽器基於安全，不給完整路徑**
（`File` 物件只有檔名）。所以送出端從來就沒有路徑可存。

## 考量的選項

- **A. 送出端也保存位元組**：直接違反 ADR-0093 的裁示（「不用在上面保存檔案本身」）。**不採**。
- **B（採用）. 送出端改走原生選檔對話框**：Tauri 的原生對話框**會回傳完整路徑**。
  而 ADR-0102 為了「重新指定位置」已經加了 `pick_existing_file` 指令——**直接複用即可**，
  不必新增任何原生能力。

## 決策

1. **Tauri：📎 走原生選檔**（`pickFileToSend()`）→ 拿到 `{ path, name, mime, bytes }`
   → `sendFile(to, file, { thumb, savedPath: path })`。送出端自此**有原檔路徑**。
   - mime 由**副檔名**推斷（原生對話框只給路徑，沒有 `File.type`）。
2. **瀏覽器：維持 `<input type="file">`**——拿不到路徑是平台的安全限制，不假裝有。
   `onAttach` prop 未提供時，📎 自動退回原本的 `<input>`（拖放也走這條）。
3. `ChatBackend.sendFile` 的第三參數從 `thumb?: string` 改為 **options 物件**
   `{ thumb?, savedPath? }`——比繼續加位置參數清楚，也留擴充空間。

## 理由

- **零新增原生能力**：`pick_existing_file` 是 ADR-0102 已經有的指令，這裡只是**換個用途複用**。
- 對稱性修好了：自己送出的圖片，重載後同樣能讀回原圖；檔案被搬走時，一樣可以「重新指定位置」
  （ADR-0102 的流程對送出端也適用）。
- 不碰 ADR-0093 的紅線——**原檔位元組依然不由 App 保存**，我們存的只是一個**路徑字串**。

## 後果

- 正面：送出端與接收端行為一致；自己傳的圖也看得到原圖、也能重新指定位置。
- 負面 / 已知殘餘風險：
  - **瀏覽器版仍然沒有送出端路徑**（平台限制，無解；UI 已誠實顯示「只能顯示縮圖」）。
  - **拖放（drag & drop）仍走瀏覽器 File**，因此拖進來的檔案沒有路徑。Tauri v2 有 file-drop
    事件可拿到真實路徑，但那是另一條接線，本次未做。
  - mime 由副檔名推斷 → 副檔名錯誤或缺失時會落到 `application/octet-stream`（不影響傳輸，
    只影響是否產縮圖／是否當圖片顯示）。
  - 行動端仍用 DOM `<input>`（無路徑）；真 RN 的 document picker 會給 URI，屆時可比照帶入。
- 測試：engine +2（原生選檔帶入 `savedPath` 並持久化；瀏覽器無路徑時仍正常送出且 `savedPath`
  為 undefined）。全 791 測試通過、typecheck 通過、`cargo check --features tauri-app` 通過。
