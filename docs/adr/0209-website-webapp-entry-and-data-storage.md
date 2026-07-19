# 0209. 官網新增網頁版入口＋各版本資料存放說明

- 狀態：已接受
- 日期：2026-07-19
- 相關文件：`apps/website/src/App.tsx`、`apps/website/src/copy.ts`、`apps/website/src/pages/Home.tsx`、ADR-0090／0147（web app 獨立 origin）、ADR-0187（官網 IA）、ADR-0207／0208（web app 部署）

## 背景與問題

有了官方託管的**網頁版**（瀏覽器 app，部署於 `cinderous.propfolk.com`，見 ADR-0208），官網卻只提供桌面下載入口。且使用者常問「資料/私鑰到底存在哪」——這正是本專案的核心價值（本地優先、無中央資料庫），值得在官網明講。

## 決策

1. **網頁版入口**：`App.tsx` 新增 `WEBAPP_URL` 常數（單一來源、換網域改一行），首頁 hero 加「在瀏覽器開啟／Open in browser」按鈕，`target="_blank"` 的**跨 origin 連結**（不 iframe、不同 origin——遵循 ADR-0090/0147 的金鑰邊界；官網被入侵也替換不了 app 的 JS）。
2. **各版本資料存放區塊**：首頁新增「你的資料存在哪裡／Where your data lives」段，三張卡片說明：
   - **桌面版**：私鑰在 OS 金鑰庫；訊息/聯絡人 AES-256-GCM 加密存本機磁碟。
   - **網頁版**：無 OS 金鑰庫→私鑰以本地密碼（Argon2id）包裹存瀏覽器；資料加密存 localStorage/IndexedDB/OPFS，綁 origin、留在裝置；**托管站只發程式碼、零使用者資料**；清資料/忘密碼＝身分消失，須備份。
   - **行動版**：本地優先，私鑰密碼包裹存裝置（無密碼＝暫時 session）。
   - 共通註記：中繼站只暫存密文離線留言（有上限、逾期汰除）；開多裝置同步才有加密狀態快照（仍密文）。
   - 文案雙語（`copy.ts` 的 `store_*`／`hero_webapp`，中英各一）。

## 理由

- 網頁版是官方交付管道之一，官網應提供入口；跨 origin 連結是 ADR-0090/0147 的既定安全模式（self-hosting-web-app §6）。
- 資料存放說明把「本地優先／無可傳喚資料庫」從口號變成具體、可驗證的事實，強化信任並回答常見疑問。

## 後果

- 正面：官網同時提供桌面與網頁兩條入口；各版本資料邊界透明化。
- 中性 / 已知殘餘：
  - `WEBAPP_URL` 硬編於官網（`cinderous.propfolk.com`），與既有錨點 relay/`GITHUB_URL` 硬編做法一致；換網域改一行。**該網址須先完成自訂網域綁定才會通**，否則按鈕暫時連不上。
  - 官網變更會觸發 GitHub Pages 重部署（pages.yml）。
- typecheck／build 綠。
