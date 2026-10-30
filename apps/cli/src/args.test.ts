import { describe, expect, it } from "vitest";
import { ArgError, DEFAULT_RELAY, HELP, parseArgs, resolveNsecSource, DEFAULT_PORT } from "./args.js";

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

describe("serve（本地啟動器，ADR-0113）", () => {
  it("預設 port 固定、預設開瀏覽器", () => {
    expect(parseArgs(["serve"])).toEqual({ cmd: "serve", port: DEFAULT_PORT, dir: undefined, open: true });
  });

  it("**不解析私鑰**：serve 沒有 nsec 來源也不該報錯（私鑰在瀏覽器裡，不經過 CLI）", () => {
    expect(() => parseArgs(["serve"], {})).not.toThrow();
    expect(parseArgs(["serve"])).not.toHaveProperty("nsec");
  });

  it("--port / --dir / --no-open", () => {
    expect(parseArgs(["serve", "--port", "9000", "--dir", "/x/dist", "--no-open"])).toEqual({
      cmd: "serve",
      port: 9000,
      dir: "/x/dist",
      open: false,
    });
  });

  it("非法 port 直接拒絕（不要靜默退回預設，那會換掉 origin）", () => {
    expect(() => parseArgs(["serve", "--port", "abc"])).toThrow(ArgError);
    expect(() => parseArgs(["serve", "--port", "0"])).toThrow(ArgError);
    expect(() => parseArgs(["serve", "--port", "70000"])).toThrow(ArgError);
  });

  it("--dir 的值不會被當成位置參數（同 ADR-0098 的 VALUE_FLAGS 修正）", () => {
    const cmd = parseArgs(["serve", "--dir", "/x/dist"]);
    expect(cmd.cmd).toBe("serve");
  });
});

describe("agent 私人頻道的旗標（ADR-0404）", () => {
  const A = "npub1owner";

  it("--from 可重複；--state-dir／--name 帶進 listen", () => {
    const c = parseArgs(["listen", ...F, "--from", A, "--from", "npub1b", "--state-dir", "/s", "--name", "家裡的 agent"]);
    expect(c).toMatchObject({ cmd: "listen", from: [A, "npub1b"], stateDir: "/s", name: "家裡的 agent" });
  });

  it("沒給的旗標不出現（舊的 send／listen 形狀不變）", () => {
    expect(parseArgs(["listen", ...F])).toEqual({ cmd: "listen", nsec: { kind: "file", path: "/k/nsec" }, relay: DEFAULT_RELAY });
  });

  it("旗標的值不會混進訊息內容", () => {
    const c = parseArgs(["send", A, "嗨", "--state-dir", "/s", "--name", "bot", "--ttl", "60", "--from", "npub1x", ...F]);
    if (c.cmd !== "send") throw new Error("expected send");
    expect(c.text).toBe("嗨");
    expect(c.ttl).toBe(60);
  });

  it("--ttl：1 秒到 7 天，其他一律報錯（不靜默夾值）", () => {
    expect(() => parseArgs(["send", A, "嗨", ...F, "--ttl", "0"])).toThrow(ArgError);
    expect(() => parseArgs(["send", A, "嗨", ...F, "--ttl", "1.5"])).toThrow(ArgError);
    expect(() => parseArgs(["send", A, "嗨", ...F, "--ttl", String(7 * 86400 + 1)])).toThrow(/7 天/);
    const c = parseArgs(["send", A, "嗨", ...F, "--ttl", String(7 * 86400)]);
    expect(c).toMatchObject({ ttl: 7 * 86400 });
  });

  it("--fs on|off 必須搭 --state-dir（EK 存不下來就解不開對方加密到它的訊息）", () => {
    expect(() => parseArgs(["listen", ...F, "--fs", "on"])).toThrow(/--state-dir/);
    expect(() => parseArgs(["listen", ...F, "--state-dir", "/s", "--fs", "maybe"])).toThrow(ArgError);
    expect(parseArgs(["listen", ...F, "--state-dir", "/s", "--fs", "off"])).toMatchObject({ fs: "off" });
  });

  it("ask：收件人＋問題；預設逾時 300 秒、不帶短碼", () => {
    const c = parseArgs(["ask", A, "要部署嗎？", ...F]);
    expect(c).toMatchObject({ cmd: "ask", to: A, text: "要部署嗎？", timeout: 300, approve: false });
  });

  it("ask：--approve、--timeout；逾時要是正整數", () => {
    expect(parseArgs(["ask", A, "部署", ...F, "--approve", "--timeout", "30"])).toMatchObject({ approve: true, timeout: 30 });
    expect(() => parseArgs(["ask", A, "部署", ...F, "--timeout", "0"])).toThrow(ArgError);
    // 🔴 超過約 24.8 天 Node 的 setTimeout 會溢位成 1ms：還沒送出就判定失敗（2026-10-30 審查）
    expect(() => parseArgs(["ask", A, "部署", ...F, "--timeout", String(7 * 86400 + 1)])).toThrow(/7 天/);
    expect(parseArgs(["ask", A, "部署", ...F, "--timeout", String(7 * 86400)])).toMatchObject({ timeout: 7 * 86400 });
    expect(() => parseArgs(["ask", ...F])).toThrow(/收件人/);
    expect(() => parseArgs(["ask", A, ...F])).toThrow(/內容/);
  });

  it("keygen：要 --out，而且**不解析私鑰來源**（它就是在產生私鑰）", () => {
    expect(parseArgs(["keygen", "--out", "/k/agent.nsec"], {})).toEqual({ cmd: "keygen", out: "/k/agent.nsec" });
    expect(() => parseArgs(["keygen"], {})).toThrow(/--out/);
  });
});

describe("--version（ADR-0405：從 Release 下載的單檔要看得出版本）", () => {
  it("--version／-v → version（不需要金鑰）", () => {
    expect(parseArgs(["--version"], {})).toEqual({ cmd: "version" });
    expect(parseArgs(["-v"], {})).toEqual({ cmd: "version" });
  });
  it("help 開頭說得出這是什麼，不再只寫「無狀態」", () => {
    expect(HELP.split("\n")[0]).not.toContain("無狀態");
    expect(HELP).toContain("--version");
  });
});
