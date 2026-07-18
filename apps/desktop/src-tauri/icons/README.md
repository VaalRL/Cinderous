# 圖示（icons）

Cinderous 的桌面應用程式圖示——**深藍圓角底＋餘燼三層（暖橙／琥珀／亮黃）**，與官網 favicon／`CinderMark` 同一意象（ADR-0195）。

- 來源：[`cinderous-ember.svg`](./cinderous-ember.svg)（1024×1024）。
- 整套（`32x32.png`、`128x128.png`、`icon.ico`、`icon.icns`、`Square*Logo.png` 等）由 `tauri icon` 生成。

## 重新生成

```bash
# 由 SVG 光柵化為 1024 PNG（任何 rasterizer 皆可；Windows 可用 GDI+），再交給 tauri icon：
pnpm --filter @cinderous/desktop exec tauri icon <1024.png>
```

會覆蓋本目錄整套圖示，並依 `tauri.conf.json` 的 `bundle.icon` 打包進安裝檔與 exe。
（`icons/android/`、`icons/ios/` 由 `tauri icon` 一併生成但 gitignore；桌面建置不需。）
