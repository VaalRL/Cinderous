import { describe, expect, it, vi } from "vitest";
import {
  buildRewritePrompt,
  buildSummaryPrompt,
  DEFAULT_OLLAMA,
  ensureAllowed,
  isLocalEndpoint,
  ollamaAvailable,
  ollamaModels,
  ollamaRewrite,
  ollamaSummarize,
  type OllamaIo,
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
    const generate = vi.fn(async (_e: string, _m: string, _p: string) => "  改寫後的文字  ");
    const io: OllamaIo = { generate, available: vi.fn(async () => true), models: vi.fn(async () => []) };
    const out = await ollamaRewrite("原文", "更精簡", DEFAULT_OLLAMA, io);
    expect(out).toBe("改寫後的文字");
    const prompt = generate.mock.calls[0]![2];
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
    const generate = vi.fn(async (_e: string, _m: string, _p: string) => "  摘要重點  ");
    const io: OllamaIo = { generate, available: vi.fn(async () => true), models: vi.fn(async () => []) };
    const out = await ollamaSummarize([{ sender: "A", text: "訊息一" }], DEFAULT_OLLAMA, io);
    expect(out).toBe("摘要重點");
    expect(generate.mock.calls[0]![2]).toContain("訊息一");
  });
});
