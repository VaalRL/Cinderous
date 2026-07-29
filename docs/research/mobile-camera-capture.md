# 研究：行動版「拍照直接傳」的可行性（Capacitor 障礙評估）＋ EXIF 隱私缺口

> 目的：評估在行動端加入「點按鈕 → 開相機 → 拍完直接傳進對話」（LINE 式）的可行性，
> 特別是在 Capacitor 打包下是否有執行障礙。
> 判準：與現有送檔路徑的落差、平台限制、以及與本專案隱私立場的一致性。
> 相關：ADR-0100（行動端檔案平台縫）、ADR-0102（縮圖）、ADR-0017/0029（P2P 檔案傳輸）、
> `docs/research/android-packaging.md`（打包方案＝Capacitor）。結論先行。

## 結論摘要

**Capacitor 本身幾乎沒有障礙**——官方 `@capacitor/camera` 接進現有 `OutgoingFile` 介面即可，
唯一的真障礙（大圖記憶體）外掛本身就有解。**真正的障礙在別處：整個 repo 沒有任何 EXIF 處理**，
送檔是原檔位元組直送。加了「拍照直接傳」等於把一個潛在洞變成主要洩漏管道
（GPS 座標、拍攝時間、手機型號）——與本專案的元資料隱藏立場明顯不一致。

**建議順序：先修 EXIF，再做相機。**

## 1. Capacitor 的執行障礙評估

現有送檔路徑（`apps/mobile/src/native/files.ts`，ADR-0100 的平台縫）已產出標準結構：

```
pickFile() → OutgoingFile { name, mime, bytes: Uint8Array } → 既有 P2P/relay 送檔路徑
```

`@capacitor/camera` 回傳 `base64String` 或 `webPath`，轉 `Uint8Array` 後**餵進同一個介面**——
只需在該平台縫**新增一個 `takePhoto()`**，呼叫端與介面皆不變（這正是該檔設計的用途）。

| 潛在障礙 | 實際情況 |
| --- | --- |
| 相機權限 | 外掛自動處理請求流程；manifest 加 `CAMERA` |
| 取得位元組 | `base64String` → `Uint8Array`，無縫 |
| **記憶體（唯一真障礙）** | 12MP 照片約 5–10MB，base64 再膨脹 33%，低階機可能 OOM。**外掛內建解法**：`width`／`height`／`quality` 參數在**原生層**先縮再回傳 |
| 縮圖 | 現有 `makeThumbnail()` 走 canvas，WebView 完全支援 |
| 相簿選取 | 同一外掛的 `PhotoSource` 即可 |

**真 RN 對照**：`expo-image-picker` 工作量相當——**這題兩個打包方案打平**，不影響
`android-packaging.md` 的結論。

## 2. 🔴 真正的問題：送檔路徑零 EXIF 處理

全 repo 搜尋 `exif`／`stripMetadata`／`orientation`：**零命中**。送檔是原封不動的：

```ts
// apps/mobile/src/native/files.ts
void f.arrayBuffer().then((buf) => resolve({ ..., bytes: new Uint8Array(buf) }))
```

因此傳一張照片會**連同 GPS 座標、拍攝時間、裝置型號一併送出**。

- **現況**：洞已存在但較不顯眼（使用者需自行到相簿挑檔）。
- **加了相機之後**：每張都是**剛拍的**——GPS 最準、時間最新、使用者最無感。潛在洞變主要管道。
- **不一致性**：本專案花大力氣藏元資料（Gift Wrap 藏寄件者、presence jitter〔ADR-0088〕、
  威脅情報純本地比對〔ADR-0231〕），卻讓照片把實際座標送出去。

**注意**：`makeThumbnail()` 經 canvas 重編碼**確實會清掉縮圖的 EXIF**，但那只是預覽圖，
**原檔仍照送**——所以現況並非「已經有保護」。

## 3. 修法：送出前 canvas 重編碼（一石三鳥）

與 `makeThumbnail()` 同一招，只是輸出較大尺寸：

- ✅ **EXIF/GPS 全部消失**（canvas 只保留像素）；
- ✅ 同時降尺寸／壓縮 → **順帶解決 §1 的記憶體與頻寬問題**；
- ✅ 桌面拖放送圖走同一函式，**一併修好**；
- ⚠️ 取捨：重編碼有畫質損失且**不是原檔**——應提供「傳送原檔」選項（明示會含位置資訊），
  或於設定可調。這個取捨需在 ADR 中明確定案（預設應為「清除」，符合隱私預設鐵則）。

## 4. 建議實作順序

1. **先修 EXIF（獨立 ADR）**：`core`／`engine` 新增 `sanitizeImage(bytes, mime)` 純函式
   （canvas 重編碼、限最大邊、去 EXIF），**桌面與行動端送圖路徑共用**；
   測試驗證輸出不含 EXIF marker（`0xFFE1`／`Exif\0\0`）與 GPS IFD。
2. **再做相機（獨立 ADR）**：`native/files.ts` 新增 `takePhoto()`——Capacitor 走
   `@capacitor/camera`、RN-web 開發環境以 `<input capture>` 後備（比照該檔既有的
   「同介面、換內部」模式）。
3. **UI**：對話輸入列加 📷 鈕（與現有 📎 並列）。

> 本文件為**研究記錄、非決策**。上述兩項各自實作時另立 ADR（EXIF 是隱私決策、
> 相機是新的平台縫與權限面）。
