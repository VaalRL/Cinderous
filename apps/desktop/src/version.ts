// App 版號（ADR-0227 P2）：build-time 由 vite `define` 注入（`__APP_VERSION__`），
// 源自 root package.json 的 version（SSOT）；供設定「關於」區與問題回報顯示。
export const APP_VERSION: string = __APP_VERSION__;
