# 0060. 本機 Ollama 訊息改寫（Rust IPC、localhost 限定、先預覽再採用）

- 狀態：已接受
- 日期：2026-07-08
- 相關文件：PRD §4/§6（隱私、本地優先）；ADR-0002（隱私基線）、0053（Tauri 原生基質整合）
- 範圍：桌面版 composer 草稿的 AI 改寫（opt-in；未裝 Ollama 則功能隱藏）

## 背景與問題

使用者想在對話輸入框打好草稿後，請 AI 改寫（更客氣／精簡／修錯字／翻譯…）。需求是**本機、可控、不破壞隱私**——不能把草稿送到雲端。

## 決策

**串接本機 [Ollama](https://ollama.com)（`http://localhost:11434`）改寫 composer 草稿。**

1. **接法：Rust IPC。** webview `invoke("ollama_generate", {endpoint, model, prompt})` → Rust `reqwest` 打 Ollama `/api/generate`（`stream:false`）。**無 CORS**、prod 穩，符合基質架構（ADR-0053）。瀏覽器版以 `fetch` 後備（需使用者設 `OLLAMA_ORIGINS`）。
2. **隱私守則：localhost 限定。** endpoint **預設 `http://localhost:11434`**；`isLocalEndpoint()` 判斷，**非 localhost 會在 UI 明確警告「文字會離開此裝置」**——因為 Ollama 可跑在遠端，那就違反「明文不離裝置」。
3. **先預覽再採用。** 改寫結果先顯示、由使用者按「採用」才取代草稿，**不直接洗掉**使用者打的字。
4. **風格：快選 + 自由指示。** 預設風格按鈕（更客氣／更精簡／修錯字／更正式／翻成英文）＋一個自由指示輸入框。指示與原文組成 prompt，要求模型**只輸出結果本身**。
5. **偵測可用性。** 以 `/api/tags`（或 IPC）偵測 Ollama 是否啟動；沒開就把入口隱藏/停用、顯示「未偵測到 Ollama」。功能**完全 opt-in**，不影響核心通訊。
6. **設定。** endpoint 與模型名稱可在 SettingsPanel 設定（預設 `llama3.2`）。

## 理由

- **本地優先/隱私契合**：草稿只送到 `localhost`、純本機推論，明文不上雲。
- **Rust IPC 無 CORS**：prod（`tauri://`）不會被瀏覽器同源政策卡。
- **opt-in + 偵測**：沒裝 Ollama 的使用者零影響。

## 後果

- 正面：本機 AI 改寫，隱私可控。
- 負面 / 已知限制：
  - Rust 端需加 `reqwest`（用 rustls-tls，避免 OpenSSL/Perl；比照 ADR-0054）。
  - Rust 命令需 Tauri 建置才能驗（本沙箱無法可靠 `cargo build` tauri-app 特徵）；純 TS（prompt/端點/客戶端）附單元測試。
  - 非 localhost endpoint 會讓文字離開裝置——以 UI 警告把關，不強制封鎖（使用者知情下可用遠端）。
  - 改寫品質取決於使用者選的本機模型。
- 增量：
  1. **core/TS（本增量）：** `native/ollama.ts`（風格/prompt/`isLocalEndpoint`/客戶端 + 可注入 IO）+ i18n + 測試。
  2. **Rust + UI（下一增量）：** `ollama_generate`/`ollama_available` 命令（reqwest）；composer ✨ 改寫鈕 + 快選/自由指示 + 預覽採用/取消 + 載入/偵測；SettingsPanel 端點/模型設定。
