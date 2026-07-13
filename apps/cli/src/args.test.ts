import { describe, expect, it } from "vitest";
import { ArgError, DEFAULT_RELAY, parseArgs, resolveNsecSource } from "./args.js";

const F = ["--nsec-file", "/k/nsec"]; // 最短的合法金鑰來源

describe("CLI 參數解析（ADR-0098）", () => {
  it("無參數／--help → help（不需要金鑰）", () => {
    expect(parseArgs([])).toEqual({ cmd: "help" });
    expect(parseArgs(["--help"])).toEqual({ cmd: "help" });
    expect(parseArgs(["send", "--help"], { CINDER_NSEC: "x" })).toEqual({ cmd: "help" });
  });

  it("whoami：只需金鑰（純本機，不連線）", () => {
    expect(parseArgs(["whoami", ...F])).toEqual({
      cmd: "whoami",
      nsec: { kind: "file", path: "/k/nsec" },
      hex: false,
    });
  });

  it("send：收件人＋訊息；訊息可為多個未加引號的詞", () => {
    const c = parseArgs(["send", "npub1abc", "晚點", "打給你", ...F]);
    expect(c).toEqual({
      cmd: "send",
      nsec: { kind: "file", path: "/k/nsec" },
      relay: DEFAULT_RELAY,
      to: "npub1abc",
      text: "晚點 打給你",
    });
  });

  it("send：缺收件人或缺內容 → 明確報錯", () => {
    expect(() => parseArgs(["send", ...F])).toThrow(ArgError);
    expect(() => parseArgs(["send", "npub1abc", ...F])).toThrow(/訊息/);
  });

  it("旗標的值不可被當成訊息內容（否則私鑰路徑會被送出去！）", () => {
    const c = parseArgs(["send", "npub1abc", "嗨", "--nsec-file", "/k/nsec", "--relay", "wss://a"]);
    if (c.cmd !== "send") throw new Error("expected send");
    expect(c.text).toBe("嗨"); // 不含 /k/nsec、不含 wss://a
    expect(c.relay).toBe("wss://a");
  });

  it("relay：--relay > CINDER_RELAY > 預設", () => {
    const relayOf = (argv: string[], env: Record<string, string | undefined> = {}) => {
      const c = parseArgs(argv, env);
      if (c.cmd !== "listen") throw new Error("expected listen");
      return c.relay;
    };
    expect(relayOf(["listen", ...F, "--relay", "wss://a"])).toBe("wss://a");
    expect(relayOf(["listen", ...F], { CINDER_RELAY: "wss://b" })).toBe("wss://b");
    expect(relayOf(["listen", ...F])).toBe(DEFAULT_RELAY);
  });

  it("未知指令 → 報錯（不亂猜）", () => {
    expect(() => parseArgs(["delete-everything", ...F])).toThrow(/未知指令/);
  });

  it("帶值旗標缺值 → 報錯", () => {
    expect(() => parseArgs(["listen", "--nsec-file"])).toThrow(/需要一個值/);
  });
});

describe("私鑰來源決策（ADR-0098：優先安全的來源）", () => {
  it("優先序：--nsec-file > --nsec-stdin > CINDER_NSEC", () => {
    const env = { CINDER_NSEC: "nsec1zzz" };
    expect(resolveNsecSource(["--nsec-file", "/k", "--nsec-stdin"], env)).toEqual({ kind: "file", path: "/k" });
    expect(resolveNsecSource(["--nsec-stdin"], env)).toEqual({ kind: "stdin" });
    expect(resolveNsecSource([], env)).toEqual({ kind: "env" }); // 最不安全，執行時會警告
  });

  it("完全沒有金鑰來源 → 報錯（不去猜、不去翻使用者的檔案）", () => {
    expect(() => resolveNsecSource([], {})).toThrow(ArgError);
  });
});

describe("whoami --hex（ADR-0039 維護者公鑰取值）", () => {
  it("預設印 npub；--hex 改印 hex 公鑰", () => {
    const a = parseArgs(["whoami", ...F]);
    if (a.cmd !== "whoami") throw new Error("expected whoami");
    expect(a.hex).toBe(false);
    const b = parseArgs(["whoami", "--hex", ...F]);
    if (b.cmd !== "whoami") throw new Error("expected whoami");
    expect(b.hex).toBe(true);
  });
});
