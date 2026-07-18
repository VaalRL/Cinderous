# 圖示（icons）

`icon.png` 為 512×512 佔位圖示（藍色漸層）。在具 Tauri 工具鏈的環境，執行：

```bash
pnpm --filter @cinderous/desktop tauri icon apps/desktop/src-tauri/icons/icon.png
```

即可由此來源產生各平台所需的完整圖示集（`32x32.png`、`128x128.png`、
`icon.icns`、`icon.ico` 等）。屆時可把 `tauri.conf.json` 的 `bundle.icon`
擴充為完整清單。正式版請以真正的產品圖示取代此佔位圖（注意避開商標素材）。
