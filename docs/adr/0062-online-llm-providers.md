# 0062. 桌面版接線上 LLM provider（OpenAI 相容；API key 存金鑰庫；localhost 硬守則把關）

- 狀態：已接受
- 日期：2026-07-08
- 相關文件：PRD §6（隱私）；ADR-0053（Tauri 基質）、0060（本機 Ollama 改寫/摘要）
- 精化：ADR-0060 的 provider 一般化

## 背景與問題

ADR-0060 讓改寫/摘要走**本機 Ollama**。使用者要能改接**線上 LLM provider**（OpenAI、Groq、OpenRouter、LM Studio…）。這與 Cinder「明文不上雲」有張力——必須在保留隱私閘門的前提下做。

## 決策

**把 AI 客戶端一般化為多 provider；線上以 OpenAI 相容格式為主；隱私靠既有 localhost 硬守則把關。**

1. **provider 抽象：** `provider: "ollama" | "openai"`。`openai` 走 **OpenAI 相容 `/v1/chat/completions`**——**一種吃掉最多**（OpenAI/Groq/OpenRouter/together/LM Studio/llama.cpp，甚至 Ollama 自己的相容端點）。`OllamaIo` 的方法改吃整個 `cfg`（含 provider）。
2. **API key 存 OS 金鑰庫：** `ai_set_key(provider, key)` 寫入 keyring（account `ai:<provider>`）；`ai_generate` 在 **Rust 端**讀 key 加 `Bearer`——**key 全程不落 JS/localStorage**。`ai_has_key` 供 UI 顯示狀態。
3. **隱私閘門不變（重點）：** `ensureAllowed()` 的 **localhost 硬守則**照舊——線上 provider 端點本就非本機，故**使用者必須把 `localOnly` 關掉（明確同意文字外流）** 才能用。設定頁對此有雙重提示（開著會被擋／關掉會外流）。
4. **摘要（他人訊息）：** 一樣受 localhost 硬守則管——要用線上服務摘要別人訊息，得使用者主動關 `localOnly`，知情下才可。
5. **平台：** 線上 provider **需 Tauri**（金鑰庫）；瀏覽器（demo）僅支援本機 Ollama（無安全金鑰儲存）。
6. **模型清單：** Ollama → `/api/tags` 的 name；OpenAI → `/v1/models` 的 id（帶 key）。

## 理由

- **重用基質**：keyring（B5）＋ reqwest（0060）已在，接線上幾乎零新增基礎。
- **OpenAI 相容＝事實標準**：一種覆蓋最廣，日後再視需要加 Anthropic（`/v1/messages`）、Google（`generateContent`）。
- **隱私閘門保留**：本機仍是預設；線上是「知情 opt-in」，且 key 存金鑰庫最安全。

## 後果

- 正面：桌面可用雲端 LLM（便利），且 key 安全、外流需明確同意。
- 負面 / 已知限制：
  - 線上＝文字送第三方（本質取捨）；以 `localOnly` 預設開 + 雙重警告把關，非強制封鎖。
  - 瀏覽器不支援線上 provider（無金鑰庫）。
  - `available` 對 openai 僅檢查「有無 key」（不多打 API）——不保證 key 有效，錯誤於實際呼叫時回報。
  - Rust 命令需 `tauri:dev` 建置驗證（本沙箱無法 `cargo build`）；純 TS 附測試。
- 後續：Anthropic/Google provider、串流輸出（ADR-0060 已列延後）。
