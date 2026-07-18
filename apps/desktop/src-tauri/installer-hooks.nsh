; NSIS 反安裝 hook（ADR-0203）：反安裝時可選一併清空使用者資料與私鑰。
;
; 預設「否」＝只移除程式、保留資料（/SD IDNO 讓靜默反安裝也不刪資料）。選「是」則呼叫仍在
; 原地的主程式以 `--wipe-local` headless 模式清除——重用 app 自己的 keyring 邏輯刪金鑰庫條目
; （NSIS 難以正確枚舉/刪除認證管理員項），再清 app data 與 WebView2 設定檔。
;
; 掛載於 tauri.conf.json → bundle.windows.nsis.installerHooks。${MAINBINARYNAME} 由 Tauri
; NSIS 範本提供＝已安裝的主程式檔名（不含副檔名）。

!macro NSIS_HOOK_PREUNINSTALL
  MessageBox MB_YESNO|MB_ICONEXCLAMATION "Also permanently delete ALL your identities, private keys and messages on this device?$\n$\nThis cannot be undone. Choose No to remove only the app and keep your data.$\n$\n一併永久刪除這台裝置上的所有身分、私鑰與訊息嗎？此動作無法復原。選「否」只移除程式、保留你的資料。" /SD IDNO IDNO cinder_skip_wipe
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --wipe-local'
  cinder_skip_wipe:
!macroend
