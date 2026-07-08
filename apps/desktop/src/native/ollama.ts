// 本機 Ollama 改寫（ADR-0060）。把 composer 的草稿送給本機 Ollama（localhost:11434）改寫。
// Tauri 走 Rust IPC（無 CORS、prod 穩）；瀏覽器走 fetch 後備。純函式（prompt/端點判斷）
// 與客戶端分離，IO 可注入以利測試。
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MessageKey } from "@cinder/i18n";

/** Ollama 連線設定。 */
export interface OllamaConfig {
  endpoint: string;
  model: string;
}
export const DEFAULT_OLLAMA: OllamaConfig = { endpoint: "http://localhost:11434", model: "llama3.2" };

/** 改寫風格快選：`labelKey` 供 UI 顯示、`instruction` 為送給模型的指示。 */
export interface RewriteStyle {
  key: string;
  labelKey: MessageKey;
  instruction: string;
}
export const REWRITE_STYLES: RewriteStyle[] = [
  { key: "polite", labelKey: "ai_stylePolite", instruction: "把訊息改寫得更客氣、更有禮貌，但保留原意。" },
  { key: "concise", labelKey: "ai_styleConcise", instruction: "把訊息改寫得更精簡扼要，去掉冗詞。" },
  { key: "grammar", labelKey: "ai_styleGrammar", instruction: "修正錯字與語法，盡量保留原本的用字與語氣。" },
  { key: "formal", labelKey: "ai_styleFormal", instruction: "把訊息改寫得更正式、更專業。" },
  { key: "english", labelKey: "ai_styleEnglish", instruction: "把訊息翻譯成自然、道地的英文。" },
];

/** 由原文 + 指示組出 prompt（純函式）；要求模型只輸出結果本身，避免多餘說明。 */
export function buildRewritePrompt(text: string, instruction: string): string {
  return [
    "你是訊息改寫助手。依「指示」改寫「原訊息」，只輸出改寫後的文字本身，",
    "不要加任何說明、標題、引號或前後綴。除非指示要求翻譯，否則用與原訊息相同的語言。",
    "",
    `指示：${instruction}`,
    "",
    "原訊息：",
    text,
  ].join("\n");
}

/** 隱私守則（ADR-0060）：只有 localhost 端點才保證文字不離開裝置。 */
export function isLocalEndpoint(endpoint: string): boolean {
  try {
    const h = new URL(endpoint).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
}

/** 底層收發（可注入以利測試）。 */
export interface OllamaIo {
  generate(endpoint: string, model: string, prompt: string): Promise<string>;
  available(endpoint: string): Promise<boolean>;
  /** 列出本機已安裝的模型名稱（供設定頁下拉選擇）。 */
  models(endpoint: string): Promise<string[]>;
}

/** 預設 IO：Tauri 走 Rust IPC（無 CORS）；瀏覽器走 fetch 後備。 */
export function defaultOllamaIo(): OllamaIo {
  if (isTauri()) {
    return {
      generate: (endpoint, model, prompt) => invoke<string>("ollama_generate", { endpoint, model, prompt }),
      available: (endpoint) => invoke<boolean>("ollama_available", { endpoint }),
      models: (endpoint) => invoke<string[]>("ollama_models", { endpoint }),
    };
  }
  return {
    async generate(endpoint, model, prompt) {
      const r = await fetch(`${endpoint}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt, stream: false }),
        signal: AbortSignal.timeout(120_000), // 逾時保護，避免卡住
      });
      if (!r.ok) throw new Error(`ollama ${r.status}`);
      return String(((await r.json()) as { response?: unknown }).response ?? "");
    },
    async available(endpoint) {
      try {
        return (await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(5_000) })).ok;
      } catch {
        return false;
      }
    },
    async models(endpoint) {
      const r = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(5_000) });
      if (!r.ok) throw new Error(`ollama ${r.status}`);
      const data = (await r.json()) as { models?: { name?: unknown }[] };
      return (data.models ?? []).map((m) => String(m.name ?? "")).filter(Boolean);
    },
  };
}

/** 請 Ollama 依指示改寫並回傳整理後結果。 */
export async function ollamaRewrite(
  text: string,
  instruction: string,
  cfg: OllamaConfig,
  io: OllamaIo = defaultOllamaIo(),
): Promise<string> {
  const out = await io.generate(cfg.endpoint, cfg.model, buildRewritePrompt(text, instruction));
  return out.trim();
}

/** 偵測 Ollama 是否可用（未啟動就把 UI 入口隱藏/停用）。 */
export function ollamaAvailable(cfg: OllamaConfig, io: OllamaIo = defaultOllamaIo()): Promise<boolean> {
  return io.available(cfg.endpoint);
}

/** 列出本機已安裝的模型（供設定頁下拉）。 */
export function ollamaModels(cfg: OllamaConfig, io: OllamaIo = defaultOllamaIo()): Promise<string[]> {
  return io.models(cfg.endpoint);
}
