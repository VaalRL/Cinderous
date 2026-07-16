import { makeOrgInvite } from "@cinder/core";
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

describe("ADR-0146：登入名稱命中本機既有身分", () => {
  const render = (extra: Record<string, unknown>) =>
    renderToStaticMarkup(
      <I18nProvider locale="zh-Hant">
        <ThemeProvider>
          <SignIn onSignIn={() => {}} {...extra} />
        </ThemeProvider>
      </I18nProvider>,
    );

  it("命中既有（enter）→ 顯示登入提示、按鈕改「登入既有身分」，且**收起**建新用的密碼/中繼站欄", () => {
    const html = render({ requirePassword: true, lookupName: () => "enter" });
    expect(html).toContain('data-testid="signin-enter-existing"');
    expect(html).toContain("登入既有身分"); // 按鈕改標
    expect(html).not.toContain('data-testid="signin-password"'); // 不在此設新密碼（於解鎖畫面驗證）
    expect(html).not.toContain('data-testid="relay-status"'); // 既有身分自帶中繼站，收起選站
  });

  it("多個同名（ambiguous）→ 顯示無法自動判斷的提示", () => {
    const html = render({ lookupName: () => "ambiguous" });
    expect(html).toContain('data-testid="signin-enter-existing"');
    expect(html).toContain("多個同名身分");
  });

  it("未提供 lookupName（示範/無登錄）→ 維持建新流程（不顯示登入既有提示）", () => {
    expect(render({ requirePassword: true })).not.toContain('data-testid="signin-enter-existing"');
  });
});

describe("ADR-0156：登入畫面貼入職邀請碼 → 加入組織面板", () => {
  const render = (extra: Record<string, unknown>) =>
    renderToStaticMarkup(
      <I18nProvider locale="zh-Hant">
        <ThemeProvider>
          <SignIn onSignIn={() => {}} {...extra} />
        </ThemeProvider>
      </I18nProvider>,
    );
  const invite = makeOrgInvite({
    relayUrl: "wss://corp.example",
    adminPubkey: "a".repeat(64),
    token: "tok123",
  });

  it("名稱欄含邀請碼＋提供 onJoinOrg → 顯示加入面板（主機提示＋顯示名稱欄＋加入鈕），收起建新/登入/nsec/配對區塊", () => {
    const html = render({ requirePassword: true, onJoinOrg: () => {}, onEnterNsec: async () => true, initialName: `歡迎加入！${invite}` });
    expect(html).toContain('data-testid="signin-join"');
    expect(html).toContain("corp.example"); // signIn_joinHint 帶主機
    expect(html).toContain("加入組織"); // signIn_joinButton
    expect(html).toContain("你的顯示名稱"); // signIn_joinName
    expect(html).not.toContain('data-testid="relay-status"'); // 建新用區塊全收起
    expect(html).not.toContain('data-testid="nsec-open"');
    expect(html).toContain("本機密碼"); // 瀏覽器仍要設密碼（面板內）
  });

  it("未提供 onJoinOrg → 邀請碼當一般名稱處理（不顯示加入面板）", () => {
    const html = render({ initialName: invite });
    expect(html).not.toContain('data-testid="signin-join"');
  });

  it("一般名字不觸發加入面板", () => {
    const html = render({ onJoinOrg: () => {}, initialName: "小明" });
    expect(html).not.toContain('data-testid="signin-join"');
  });
});
