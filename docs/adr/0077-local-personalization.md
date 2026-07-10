# 0077. 本地個人化（對話框縮放 ＋ 本地頭像 ＋ 每對話背景）

- 狀態：已接受
- 日期：2026-07-10
- 相關文件：docs/adr/0061（加密顯示名廣播——本 ADR 為其反向：純本地不廣播）、
  0064（自訂主題色，本地儲存）、0031/0032（SVG 貼圖，圖像本機表示先例）、
  apps/desktop/src/ui/msn.css、ConversationWindow.tsx、ContactListWindow.tsx

## 背景與問題

桌面版目前：頭像由 pubkey 自動生成（漸層底色＋名字首字，無自訂）；對話框固定
`380×460` 不可縮放；無對話背景。使用者要三項個人化，且**明確要求只存本機、不廣播給
聯絡人**（換頭像看得到臉、每個對話配不同背景看心情），不牽動協定／加密／隱私廣播面。

## 考量的選項

- 選項 A：走加密個人檔廣播（ADR-0061）讓頭像/背景同步給聯絡人——圖片體積大、隱私面
  擴大、需協定改動；使用者明確不要，否決。
- 選項 B：**純本地個人化層**（採用）——localStorage keyed by pubkey，圖片本機縮圖壓縮成
  data URI；不進 Nostr 事件、不進雲端快照/備份廣播。
- 選項 C：Tauri 原生檔案系統存圖——跨瀏覽器/示範不一致、較複雜；localStorage data URI
  已足夠（量大再議 IndexedDB），否決。

## 決策

1. **純本地個人化儲存**（只寫 localStorage，不進雲端快照/備份/Nostr）：
   - 頭像：`nb.avatar.<pubkey>` → data URI（自己與各聯絡人皆可；本機縮圖至 ≤128px 邊、壓縮）。
   - 背景：`nb.chatbg.<pubkey>` → `{ type: "preset" | "image", value }`（preset＝內建色/漸層 id；
     image＝縮圖 data URI）。**每對話一組**（含群組，keyed by pubkey/groupId）。
   - 對話框尺寸：`nb.convoSize` → `{ w, h }`（**全域一個偏好**；決策 O1）。
2. **共用 `<Avatar>` 元件**：有 `nb.avatar.<pubkey>` 用圖，否則沿用現行漸層底＋首字。
   套用於**對話框標題**與**「我」區**；**聯絡人精簡清單維持純狀態圓點**——不因自訂圖回頭
   放頭像（決策 O2，延續 ADR 之前的精簡列改善）。點頭像＝換圖（file input → canvas 縮圖
   → 存），可移除還原為生成頭像。
3. **對話框縮放**：`.convo` 加 `resize: both` ＋ min/max ＋ `overflow: hidden`；縮放結束把
   尺寸寫入 `nb.convoSize`，之後開啟的對話框套用（全域）。
4. **每對話背景**：套用到該對話 `.convo__body`；對話框標題加背景設定入口（選內建預設／
   上傳圖片／清除）。preset 提供數個純色/漸層/淡紋（決策 O3：圖片＋預設）。
5. **圖片一律本機處理**：`<input type="file" accept="image/*">` → canvas 等比縮圖 →
   `toDataURL`（壓縮）→ localStorage。無外部請求、CSP 相容；`QuotaExceeded` 時提示並拒存。

## 理由

- 純本地、零協定/加密改動，隱私面不擴大（這些資料從不上網，明文/私鑰不外流的鐵則與其
  無關）。延續 ADR-0064「主題色本地儲存」與 ADR-0032「圖像本機表示」的既有取向（Fix First）。

## 後果

- 正面：換頭像、每對話背景、順手縮放全部本地即時、離線可用、不外洩。
- 負面／已知殘餘風險：localStorage 有容量上限（以縮圖壓縮＋尺寸上限把關；大量背景圖可能
  觸頂，未來可移 IndexedDB）；本地頭像/背景**不隨換機/雲端快照同步**（本地限定的必然結果，
  使用手冊將註明）；**自訂頭像僅自己看得到**（設計如此，非 bug）。
- 後續行動：實作分 O1（縮放）→ O2（頭像）→ O3（背景）；測試涵蓋儲存純函式與 `<Avatar>`
  選圖/還原邏輯；`docs/ROADMAP.md` 補 Phase O。
