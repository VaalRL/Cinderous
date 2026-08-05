// 行動端企業政策的 UI 閘門（ADR-0048 §2 的客戶端層；行動端接線＝ADR-0311）。
//
// 這裡驗的是 `ConversationScreen` 的三個入口在政策開啟時消失、且**收到的東西照常看得到**。
// 「政策有沒有送到 App」是 `MobileApp` 的接線（`onPolicy` → `orgPolicy` state），
// 由 `MobileApp.perIdentityState.test.ts` 保證它被歸類為 per-identity、切身分歸零。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatSticker } from "@cinderous/core";
import type { ChatMessage } from "@cinderous/engine";
import { ConversationScreen } from "./ConversationScreen.js";
import { SettingsScreen } from "./SettingsScreen.js";

const base = {
  name: "Bob",
  onSend: () => {},
  onBack: () => {},
  locale: "zh-Hant" as const,
};

const messages: ChatMessage[] = [{ id: "m1", outgoing: false, text: "嗨", at: 1 }];

describe("disableStickers（ADR-0311）", () => {
  it("政策未開：😊 入口在", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} messages={messages} />);
    expect(html).toContain('data-testid="sticker-btn"');
  });

  it("🔴 政策開啟：😊 入口消失", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} messages={messages} stickersDisabled />);
    expect(html).not.toContain('data-testid="sticker-btn"');
  });

  it("政策開啟仍看得到別人送的貼圖（只擋送出，不擋顯示）", () => {
    const sticker: ChatMessage = { id: "s1", outgoing: false, text: formatSticker("buddy", "cat"), at: 1 };
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} messages={[sticker]} stickersDisabled />,
    );
    expect(html).toContain('data-testid="sticker-s1"');
  });
});

describe("disableFiles / disableCalls 的閘門形狀（ADR-0311）", () => {
  // 這兩個走「可選 callback ＝ 功能開關」的既有慣例：MobileApp 依政策不傳 handler。
  it("有 handler：📎／📷／通話入口在", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen
        {...base}
        messages={messages}
        onSendFile={() => {}}
        onSendPhoto={() => {}}
        onStartCall={() => {}}
      />,
    );
    expect(html).toContain("📎");
    expect(html).toContain('data-testid="send-photo"');
    expect(html).toContain("📞"); // 語音
    expect(html).toContain("📹"); // 視訊
  });

  it("🔴 無 handler（政策停用）：四個入口都不在", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} messages={messages} />);
    expect(html).not.toContain("📎");
    expect(html).not.toContain('data-testid="send-photo"');
    expect(html).not.toContain("📞");
    expect(html).not.toContain("📹");
  });
});

describe("入群邀請閘門的設定（ADR-0317）", () => {
  const settingsBase = {
    selfName: "我",
    selfNpub: "npub1abc",
    selfNsec: "nsec1abc",
    relayUrl: "wss://x",
    theme: "light" as const,
    onTheme: () => {},
    locale: "zh-Hant" as const,
    onLocale: () => {},
    accent: null,
    onAccent: () => {},
    invisible: false,
    onInvisible: () => {},
    onLogout: () => {},
  };

  it("未提供 onGroupInvite → 不顯示（示範後端）", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...settingsBase} />);
    expect(html).not.toContain('data-testid="group-invite-setting"');
  });

  it("關閉時＝只有聯絡人可以把我加進群組（說明要講清楚）", () => {
    const html = renderToStaticMarkup(
      <SettingsScreen {...settingsBase} groupInviteFromAnyone={false} onGroupInvite={() => {}} />,
    );
    expect(html).toContain('data-testid="group-invite-setting"');
    expect(html).not.toContain("✓"); // 未勾選
    expect(html).toContain("只有你的聯絡人"); // 說明講清楚預設行為
    expect(html).toContain("封鎖"); // 說明講清楚封鎖優先
  });

  it("開啟時顯示已選取", () => {
    const html = renderToStaticMarkup(
      <SettingsScreen {...settingsBase} groupInviteFromAnyone onGroupInvite={() => {}} />,
    );
    expect(html).toContain("✓");
  });
});

describe("群組成員的 FS 狀態（ADR-0319，行動端）", () => {
  const me = "aa".repeat(32);
  const bobPk = "bb".repeat(32);
  const carolPk = "cc".repeat(32);
  const davePk = "dd".repeat(32);
  const state = (pk: string): "known" | "unknown" | "lost" =>
    pk === bobPk ? "known" : pk === carolPk ? "unknown" : "lost";

  const render = (withFs: boolean): string =>
    renderToStaticMarkup(
      <ConversationScreen
        {...base}
        messages={messages}
        selfPubkey={me}
        groupMembers={[me, bobPk, carolPk, davePk]}
        initialMembersOpen
        {...(withFs ? { fsPeerState: state } : {})}
      />,
    );

  it("未啟用 FS（未提供 fsPeerState）→ 整欄不出現", () => {
    const html = render(false);
    expect(html).not.toContain('data-testid="group-fs-summary"');
  });

  it("🔴 三態各自呈現；自己不算在內", () => {
    const html = render(true);
    expect(html).toContain('data-testid="member-fs-known"');
    expect(html).toContain('data-testid="member-fs-unknown"');
    expect(html).toContain('data-testid="member-fs-lost"');
  });

  it("🔴「未知」不是警告：只有「曾知現無」帶 ⚠", () => {
    const html = render(true);
    const at = html.indexOf('data-testid="member-fs-unknown"');
    expect(html.slice(at, at + 120)).not.toContain("⚠");
    const lostAt = html.indexOf('data-testid="member-fs-lost"');
    expect(html.slice(lostAt, lostAt + 120)).toContain("⚠");
  });
});

describe("我的裝置（ADR-0321，行動端）", () => {
  const settingsBase2 = {
    selfName: "我",
    selfNpub: "npub1abc",
    selfNsec: "nsec1abc",
    relayUrl: "wss://x",
    theme: "light" as const,
    onTheme: () => {},
    locale: "zh-Hant" as const,
    onLocale: () => {},
    accent: null,
    onAccent: () => {},
    invisible: false,
    onInvisible: () => {},
    onLogout: () => {},
  };
  const devices = [
    { id: "aabbccdd11223344", firstSeen: Date.now(), source: "local" },
    { id: "eeff001122334455", firstSeen: Date.now(), source: "snapshot" },
  ];

  it("沒有裝置資料時不顯示", () => {
    expect(renderToStaticMarkup(<SettingsScreen {...settingsBase2} />)).not.toContain('data-testid="devices"');
  });

  it("🔴 列出裝置並標明「這台」", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...settingsBase2} devices={devices} />);
    expect(html).toContain('data-testid="devices"');
    expect(html).toContain("aabbccdd");
    expect(html).toContain("這台");
  });

  it("🔴 限制揭露必須在（與桌面同一條驗收條件）", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...settingsBase2} devices={devices} />);
    expect(html).toContain('data-testid="devices-limit"');
    expect(html).toContain("不等於沒有人在讀你的訊息");
  });
});

describe("行動端顯示自己的裝置代碼（ADR-0322 S5）", () => {
  const settingsBase3 = {
    selfName: "我",
    selfNpub: "npub1abc",
    selfNsec: "nsec1abc",
    relayUrl: "wss://x",
    theme: "light" as const,
    onTheme: () => {},
    locale: "zh-Hant" as const,
    onLocale: () => {},
    accent: null,
    onAccent: () => {},
    invisible: false,
    onInvisible: () => {},
    onLogout: () => {},
  };
  const devices = [{ id: "aabbccdd11223344", firstSeen: Date.now(), source: "local" }];

  it("🔴 顯示代碼供在桌面授權（行動端刻意不提供授權入口）", () => {
    const html = renderToStaticMarkup(
      <SettingsScreen {...settingsBase3} devices={devices} selfDevicePk={"cd".repeat(32)} />,
    );
    expect(html).toContain('data-testid="my-device-code"');
    expect(html).toContain("cd".repeat(32));
    expect(html).not.toContain('data-testid="authorize-input"');
  });
});
