## 更新內容（繁體中文）

- 我的裝置：看得到這個身分曾在哪些裝置上出現，手機掉了可以從另一台把它移除——移除後那台就讀不到之後的新訊息。⚠ 已經收到的歷史救不回來；而且如果外流的是你的身分鑰匙本身（不只是一台裝置），移除擋不住
- 裝置鑰匙進了系統保管庫：桌面走作業系統金鑰庫、Android 走安全晶片，磁碟被複製也解不開。設定頁會如實顯示這台在哪一級——瀏覽器版只到「已加密」，那句話直接寫在畫面上
- 斜線指令：在輸入框打「/」開快捷選單；Enter 要送出還是換行現在可以自己設定（預設送出）
- 公司政策在手機上也生效了，並且會條列告訴你哪些功能被公司停用——先前手機端完全沒有套用，而且被停用時看起來只像是壞掉
- 手機的外觀、語言與主色現在會記住，重開 App 不再回到預設
- 手機的雲端備份改為每個身分各自獨立——先前是整台裝置一個開關，工作身分開了，個人身分也跟著開著
- 前向保密（實驗性選項、預設關閉、尚未經外部審計）：啟用後每週自動換一次鑰匙，可以隨時停用，保護範圍從一對一文字擴大到群組訊息、檔案名稱、共享行程與訊息回應。並修正一個多裝置的問題——先前在一台按「關閉」，會被另一台的備份翻回開啟

## What's new (English)

- My devices: see which devices this identity has appeared on, and remove one from another device if a phone is lost — a removed device can no longer read new messages. ⚠ History it already received cannot be clawed back, and if what leaked was your identity key itself (not just one device), removal does not help
- Device keys now live in the system vault: the OS keystore on desktop, the secure element on Android — a copied disk cannot open them. Settings states which tier this machine is actually on; the browser build only reaches "encrypted", and it says so on screen
- Slash commands: type "/" in the composer for a quick menu; whether Enter sends or inserts a newline is now yours to choose (sends by default)
- Company policy now applies on mobile too, and settings lists which features your company has disabled — previously mobile ignored policy entirely, and a disabled feature just looked broken
- Appearance, language and accent colour are now remembered on mobile; reopening the app no longer resets them
- Cloud backup on mobile is now per identity — it used to be one switch for the whole device, so turning it on for work turned it on for personal too
- Forward secrecy (experimental, off by default, not yet externally audited): once enabled it rotates keys weekly, can be turned off at any time, and now covers group messages, file names, shared events and reactions in addition to one-to-one text. Also fixes a multi-device problem — turning it off on one device used to be flipped back on by another device's backup

---

⚠️ **Android APK 是 debug 簽章版**（與 v0.0.14 相同）——首次安裝需允許「安裝未知來源的應用程式」。

⚠️ **桌面版尚未程式碼簽章**，Windows SmartScreen 會出現警告；那是發佈面的已知殘餘，不是安裝檔有問題（見 `docs/SECURITY.md`）。

🔴 **前向保密是實驗性選項、預設關閉、尚未經任何外部密碼學審計。** 啟用前會再確認一次。請勿在生命安全等級的高風險情境倚賴它。
