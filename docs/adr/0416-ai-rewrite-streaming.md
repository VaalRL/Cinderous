# 0416. AI 改寫邊產生邊顯示（串流輸出）

- 狀態：已接受
- 日期：2026-11-12
- 相關文件：ADR-0060（本機 AI 改寫、先預覽再採用）、ADR-0062（線上 provider、API key 存 OS 金鑰庫）、
  ADR-0235 H3（API key 綁端點主機）、ADR-0267（瀏覽器版只在 localhost origin 出現）；ROADMAP「此環境可選打磨：AI 改寫串流輸出」

## 背景與問題

✨ 改寫原本是一次拿完整結果：本機小模型改寫一段話常要十幾秒，這段時間面板只顯示「改寫中…」，
使用者看不出是卡住還是在跑，也沒辦法中途放棄——放棄只能關面板，而 Rust 端仍把整段生成讀完
（線上 provider 照樣計費）。

## 考量的選項

- 選項 A：前端直接 `fetch` provider 的串流端點。Tauri 版會繞過 Rust 端的端點守則與 API key 綁定（ADR-0235 H3），
  而且 API key 要交給 JS——不行。
- 選項 B：Rust 端讀串流，用 Tauri 的 `ipc::Channel` 逐段推給前端；另給一個取消指令。
- 選項 C：Tauri 事件（`emit`）推送。事件是全域廣播、要自己配對請求編號與清理監聽；`Channel` 是點對點且隨呼叫結束。

## 決策

採選項 B。

1. **新 IPC `ai_generate_stream(provider, endpoint, model, prompt, req, onDelta)`**：與 `ai_generate`
   同一套守則——先 `check_endpoint`、OpenAI 的 key 依端點主機查（換端點就查不到）、同一個 120 秒上限。
   請求送 `stream: true`，每收到一段文字就經 `onDelta`（`Channel<String>`）送出，最後回傳完整文字。
   `ai_generate`（摘要仍用它）不變。
2. **格式解析放在 lib 的 `aistream` 模組**（無 feature 閘門，`cargo test` 預設就測）：
   Ollama 是 NDJSON（`response`、`done`、`error`），OpenAI 相容是 SSE（`data:` 的 `choices[0].delta.content`、`[DONE]`、`error.message`）。
   位元組先按換行收齊整行再解碼——一行、甚至一個 UTF-8 字元都可能被切在兩塊中間。看不懂的行略過。
3. **取消**：`ai_cancel(req)` 把請求編號記進一個集合，串流迴圈每讀一塊前檢查，被取消就停止讀取（連線隨之關閉）。
   前端用 `AbortSignal` 表達：面板的「取消」、關閉面板、元件卸載都會中止。
4. **瀏覽器後備**（只在 localhost origin、只限本機 Ollama，ADR-0267）：`fetch` 讀 `ReadableStream`，用同規則的 JS 解碼器
   `createNdjsonDecoder`；中止訊號與 120 秒逾時合併。
5. **UI**：改寫中把已收到的文字顯示在預覽框（`ai-rewrite-streaming`），旁邊是取消鈕；**產生完才出現「採用」**，
   採用的是完整結果（trim 後）——不讓半截文字被誤採用，維持 ADR-0060「先預覽再採用」。
6. `OllamaIo.generateStream` 是可選的：沒有實作（測試替身、舊 IO）就退回一次生成，整段當一個片段回報。

## 理由

- 守則與金鑰都留在 Rust：串流沒有開出新的「把文字或 key 送到任意端點」的路。prompt 與 localhost 守則（`ensureAllowed`）完全沿用。
- `Channel` 不需要全域事件名稱與手動清理，取消只靠一個小集合，比改用 `AbortHandle` 加任務登錄簡單。
- 解析做成純函式並放進預設測試範圍，與 `aikey`、`partfile` 同一個慣例。

## 後果

- 正面：改寫中看得到進度；中途取消會真的停止讀取，線上 provider 不會把整段生成讀完。
- 負面 / 已知殘餘風險：
  - 取消是在「下一塊資料到達時」生效；provider 卡住不送資料時，要等到 120 秒逾時才結束。
  - 取消後 provider 端是否立刻停止生成取決於 provider（Ollama 會在連線關閉後停止）。
  - 摘要（🧠）仍是一次拿完整結果。
- 後續行動 / 待辦：實機用本機 Ollama 與一個 OpenAI 相容服務各跑一次，確認逐段顯示與取消。

## 實機驗證（2026-11-12）

- 桌面 QA 版（`app.cinder.qa`）接本機 Ollama `gemma4:e4b`（CPU）：預覽逐段長出（4→17→27→40→53 字、約 5 秒），完成前輸入框不變；中途按停止，畫面回到選風格、輸入框不變，Ollama 記錄 `stop: cancel task`（真的停掉，不是只藏起來）。
- 發現：會「思考」的模型預設先默默推理，暖機後仍要 56–67 秒才吐第一個字。請求本體改帶 `think: false`（Rust `aistream::ollama_body`、瀏覽器 `ollamaBody` 同形），同一句改寫 56 秒 → 5 秒；不支援思考的模型忽略這格（實測無錯）。
- 未驗：OpenAI 相容端點（需要 API key）。
