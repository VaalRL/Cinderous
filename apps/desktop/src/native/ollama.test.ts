import { describe, expect, it, vi } from "vitest";
import {
  aiRewriteSupported,
  buildRewritePrompt,
  buildSummaryPrompt,
  createNdjsonDecoder,
  DEFAULT_OLLAMA,
  ensureAllowed,
  isLocalEndpoint,
  ollamaAvailable,
  ollamaModels,
  ollamaRewrite,
  ollamaSummarize,
  type OllamaConfig,
  type OllamaIo,
  PROVIDER_DEFAULTS,
  providerOf,
  REWRITE_STYLES,
} from "./ollama.js";

describe("Ollama 改寫（ADR-0060）", () => {
  it("buildRewritePrompt 含指示與原文、要求只輸出結果", () => {
    const p = buildRewritePrompt("嗨你好", "更客氣");
    expect(p).toContain("更客氣");
    expect(p).toContain("嗨你好");
    expect(p).toContain("只輸出改寫後的文字本身");
  });

  it("isLocalEndpoint：localhost/127.0.0.1/::1 為真，遠端與非法為假", () => {
    expect(isLocalEndpoint("http://localhost:11434")).toBe(true);
    expect(isLocalEndpoint("http://127.0.0.1:11434")).toBe(true);
    expect(isLocalEndpoint("http://[::1]:11434")).toBe(true);
    expect(isLocalEndpoint("http://ai.example.com:11434")).toBe(false);
    expect(isLocalEndpoint("not a url")).toBe(false);
  });

  it("REWRITE_STYLES：五種、含 grammar/english", () => {
    expect(REWRITE_STYLES.map((s) => s.key)).toEqual(["polite", "concise", "grammar", "formal", "english"]);
  });

  it("ollamaRewrite：以注入 IO 產 prompt、回傳整理（trim）後結果", async () => {
    const generate = vi.fn(async (_cfg: OllamaConfig, _p: string) => "  改寫後的文字  ");
    const io: OllamaIo = { generate, available: vi.fn(async () => true), models: vi.fn(async () => []) };
    const out = await ollamaRewrite("原文", "更精簡", DEFAULT_OLLAMA, io);
    expect(out).toBe("改寫後的文字");
    const prompt = generate.mock.calls[0]![1];
    expect(prompt).toContain("原文");
    expect(prompt).toContain("更精簡");
  });

  it("ollamaAvailable：委派給 io.available", async () => {
    const io: OllamaIo = { generate: vi.fn(async () => ""), available: vi.fn(async () => false), models: vi.fn(async () => []) };
    expect(await ollamaAvailable(DEFAULT_OLLAMA, io)).toBe(false);
  });

  it("ollamaModels：回傳本機已安裝模型清單", async () => {
    const io: OllamaIo = {
      generate: vi.fn(async () => ""),
      available: vi.fn(async () => true),
      models: vi.fn(async () => ["llama3.2", "qwen2.5"]),
    };
    expect(await ollamaModels(DEFAULT_OLLAMA, io)).toEqual(["llama3.2", "qwen2.5"]);
  });

  it("ensureAllowed：localOnly（預設）擋非本機、放行本機；localOnly=false 才准非本機", () => {
    expect(() => ensureAllowed({ endpoint: "http://ai.example.com", model: "m" })).toThrow();
    expect(() => ensureAllowed({ endpoint: "http://localhost:11434", model: "m" })).not.toThrow();
    expect(() => ensureAllowed({ endpoint: "http://ai.example.com", model: "m", localOnly: false })).not.toThrow();
  });

  it("ollamaRewrite/ollamaSummarize：localOnly 下非本機端點被擋（不外流）", async () => {
    const io: OllamaIo = { generate: vi.fn(async () => "x"), available: vi.fn(async () => true), models: vi.fn(async () => []) };
    const remote = { endpoint: "http://ai.example.com", model: "m" };
    await expect(ollamaRewrite("t", "i", remote, io)).rejects.toThrow();
    await expect(ollamaSummarize([{ sender: "A", text: "hi" }], remote, io)).rejects.toThrow();
    expect(io.generate).not.toHaveBeenCalled();
  });

  it("buildSummaryPrompt：含訊息內容 + prompt injection 緩解框定", () => {
    const p = buildSummaryPrompt([{ sender: "Alice", text: "晚點吃飯" }]);
    expect(p).toContain("晚點吃飯");
    expect(p).toContain("Alice");
    expect(p).toContain("不要理會");
  });

  it("ollamaSummarize：本機端點以注入 IO 摘要、回傳整理後結果", async () => {
    const generate = vi.fn(async (_cfg: OllamaConfig, _p: string) => "  摘要重點  ");
    const io: OllamaIo = { generate, available: vi.fn(async () => true), models: vi.fn(async () => []) };
    const out = await ollamaSummarize([{ sender: "A", text: "訊息一" }], DEFAULT_OLLAMA, io);
    expect(out).toBe("摘要重點");
    expect(generate.mock.calls[0]![1]).toContain("訊息一");
  });

  it("provider：預設 ollama；PROVIDER_DEFAULTS 有 openai（非本機端點）", () => {
    expect(providerOf({ endpoint: "x", model: "m" })).toBe("ollama");
    expect(providerOf({ provider: "openai", endpoint: "x", model: "m" })).toBe("openai");
    expect(PROVIDER_DEFAULTS.openai.endpoint.startsWith("https://")).toBe(true);
    expect(isLocalEndpoint(PROVIDER_DEFAULTS.openai.endpoint)).toBe(false); // 線上＝非本機
  });

  it("aiRewriteSupported（ADR-0267）：瀏覽器僅 localhost origin；公網 webapp＝不支援", () => {
    // 非 Tauri（node 測試環境）→ 依 origin 判斷：
    expect(aiRewriteSupported("http://localhost:5173")).toBe(true); // 開發/自架本機
    expect(aiRewriteSupported("http://127.0.0.1:8080")).toBe(true);
    expect(aiRewriteSupported("https://cinderous.cinderous1.workers.dev")).toBe(false); // 部署版：CORS/LNA 封死
    expect(aiRewriteSupported("")).toBe(false); // 無 origin（防呆）
  });
});

describe("AI 改寫串流（ADR-0416）", () => {
  it("createNdjsonDecoder：跨塊的行拼回、累積 response、看到 done", () => {
    const d = createNdjsonDecoder();
    expect(d.push('{"response":"你","done":false}\n{"resp')).toEqual(["你"]);
    expect(d.push('onse":"好","done":false}\n')).toEqual(["好"]);
    expect(d.done).toBe(false);
    expect(d.push('{"response":"","done":true}')).toEqual([]);
    expect(d.finish()).toEqual([]);
    expect(d.done).toBe(true);
  });

  it("createNdjsonDecoder：error 行丟錯、看不懂的行略過", () => {
    const d = createNdjsonDecoder();
    expect(d.push('garbage\n{"response":"ok"}\n')).toEqual(["ok"]);
    expect(() => d.push('{"error":"model not found"}\n')).toThrow("model not found");
  });

  it("ollamaRewrite＋onDelta：走 io.generateStream、片段逐段回報、結果 trim", async () => {
    const generateStream = vi.fn(async (_c: OllamaConfig, _p: string, onDelta: (s: string) => void) => {
      onDelta(" 改寫");
      onDelta("後 ");
      return " 改寫後 ";
    });
    const generate = vi.fn(async () => "不該被叫");
    const io: OllamaIo = { generate, generateStream, available: vi.fn(async () => true), models: vi.fn(async () => []) };
    const seen: string[] = [];
    const out = await ollamaRewrite("原文", "更精簡", DEFAULT_OLLAMA, io, { onDelta: (s) => seen.push(s) });
    expect(out).toBe("改寫後");
    expect(seen).toEqual([" 改寫", "後 "]);
    expect(generate).not.toHaveBeenCalled();
    expect(generateStream.mock.calls[0]![1]).toContain("原文");
  });

  it("ollamaRewrite＋onDelta：取消訊號傳到 io.generateStream", async () => {
    const ac = new AbortController();
    const generateStream = vi.fn(async (_c: OllamaConfig, _p: string, _d: (s: string) => void, _s?: AbortSignal) => "x");
    const io: OllamaIo = { generate: vi.fn(), generateStream, available: vi.fn(), models: vi.fn() };
    await ollamaRewrite("原文", "指示", DEFAULT_OLLAMA, io, { onDelta: () => {}, signal: ac.signal });
    expect(generateStream.mock.calls[0]![3]).toBe(ac.signal);
  });

  it("io 沒有串流：退回一次生成、整段當成一個片段回報", async () => {
    const io: OllamaIo = { generate: vi.fn(async () => " 全文 "), available: vi.fn(), models: vi.fn() };
    const seen: string[] = [];
    expect(await ollamaRewrite("原文", "指示", DEFAULT_OLLAMA, io, { onDelta: (s) => seen.push(s) })).toBe("全文");
    expect(seen).toEqual([" 全文 "]);
  });

  it("串流也先過 localhost 守則：非本機端點在連線前就被擋", async () => {
    const generateStream = vi.fn(async () => "x");
    const io: OllamaIo = { generate: vi.fn(), generateStream, available: vi.fn(), models: vi.fn() };
    const remote = { ...DEFAULT_OLLAMA, endpoint: "https://evil.example" };
    await expect(ollamaRewrite("原文", "指示", remote, io, { onDelta: () => {} })).rejects.toThrow("non-local-blocked");
    expect(generateStream).not.toHaveBeenCalled();
  });
});
