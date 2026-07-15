import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import { autoRelayCandidates, hostOf, initialRelayUrl, SignIn } from "./SignIn.js";

describe("自動選座候選（ADR-0069 I4）", () => {
  it("錨點加權隨機排序（預設權重相等）；無錨點回空＝行為不變", () => {
    const seq = [0.9, 0];
    let i = 0;
    expect(autoRelayCandidates(["wss://a", "wss://b"], () => seq[i++] ?? 0)).toEqual(["wss://b", "wss://a"]);
    expect(autoRelayCandidates([], () => 0.5)).toEqual([]);
  });
});

describe("relay 欄位預設值（記住上次使用的網址）", () => {
  it("?relay= 參數優先於本地記憶", () => {
    expect(initialRelayUrl("?relay=wss://a.example", "wss://b.example")).toBe("wss://a.example");
  });

  it("無參數時回退到上次使用的網址", () => {
    expect(initialRelayUrl("", "wss://b.example")).toBe("wss://b.example");
  });

  it("兩者皆無時為空字串", () => {
    expect(initialRelayUrl("", null)).toBe("");
  });
});

describe("hostOf（relay 主機名顯示）", () => {
  it("去掉 scheme 與路徑，只留主機；空字串回空", () => {
    expect(hostOf("wss://cinder-relay.whoami885.workers.dev")).toBe("cinder-relay.whoami885.workers.dev");
    expect(hostOf("wss://relay.example.tw/path")).toBe("relay.example.tw");
    expect(hostOf("  ws://localhost:8787 ")).toBe("localhost:8787");
    expect(hostOf("")).toBe("");
  });
});

describe("SignIn 元件", () => {
  const setup = (stored: string | null) => {
    (globalThis as Record<string, unknown>).window = { location: { search: "" }, matchMedia: () => ({ matches: false }) };
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (key: string) => (key === "nb.relayUrl" ? stored : null),
    };
  };
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).localStorage;
  });
  const render = () =>
    renderToStaticMarkup(
      <ThemeProvider>
        <I18nProvider locale="zh-Hant">
          <SignIn onSignIn={() => {}} />
        </I18nProvider>
      </ThemeProvider>,
    );

  it("relay 欄預設收起：顯示將連線的主機與「使用其他中繼站」鈕，輸入欄不在 DOM", () => {
    setup("wss://last.example");
    const out = render();
    expect(out).toContain("last.example"); // 狀態列顯示主機
    expect(out).toContain('data-testid="relay-change"'); // 展開鈕
    expect(out).not.toContain('data-testid="relay-field"'); // 輸入欄預設不顯示
    expect(out).not.toContain('value="wss://last.example"');
  });

  it("無預設 relay 時：狀態列顯示示範模式", () => {
    setup(null);
    const out = render();
    expect(out).toContain("示範模式");
  });
});

describe("瀏覽器登入必填本地密碼（ADR-0122）", () => {
  const render = (extra: Record<string, unknown>) =>
    renderToStaticMarkup(
      // locale 釘死 zh-Hant：斷言用繁中字串，否則 CI（無 navigator.language → 預設英文）會不符。
      <I18nProvider locale="zh-Hant">
        <ThemeProvider>
          <SignIn onSignIn={() => {}} {...extra} />
        </ThemeProvider>
      </I18nProvider>,
    );

  it("桌面（Tauri）不顯示密碼欄——那裡有 OS 金鑰庫", () => {
    expect(render({})).not.toContain('data-testid="signin-password"');
  });

  it("瀏覽器顯示密碼欄，並**說明為什麼**（不設就會失去身分）", () => {
    const html = render({ requirePassword: true });
    expect(html).toContain('data-testid="signin-password"');
    // 使用者必須知道風險：nsec 只在這個分頁裡，重新整理就沒了。
    expect(html).toContain("重新整理");
  });

  it("提供「用 nsec 登入」的出路（忘記密碼、或在舊版被換掉身分的人）", () => {
    expect(render({ onEnterNsec: async () => true })).toContain('data-testid="nsec-open"');
    expect(render({})).not.toContain('data-testid="nsec-open"');
  });
});
