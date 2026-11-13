// 行動端頭像 UI（ADR-0154）：設定頁頭像區的顯示分流＋聊天清單的廣播頭像顯示。
// 互動（選檔→縮圖）需 DOM canvas，SSR 驗顯示分流；縮圖/廣播核心邏輯在 core/engine 已測。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatListEntry } from "../chat-list.js";
import { ChatsListScreen } from "./ChatsListScreen.js";
import { SettingsScreen } from "./SettingsScreen.js";

const settingsBase = {
  selfName: "夜",
  selfNpub: "npub1abc",
  selfNsec: "nsec1abc",
  relayUrl: "wss://relay.example",
  theme: "light" as const,
  onTheme: () => {},
  locale: "zh-Hant" as const,
  onLocale: () => {},
  accent: null,
  onAccent: () => {},
  onLogout: () => {},
};

describe("設定：頭像區（ADR-0154）", () => {
  it("提供 onAvatar → 顯示頭像區（更換/從網址＋同步提示）；未設頭像時顯示首字、無移除鈕", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...settingsBase} onAvatar={() => true} />);
    expect(html).toContain('data-testid="avatar-section"');
    expect(html).toContain('data-testid="avatar-pick"');
    expect(html).toContain('data-testid="avatar-url-toggle"');
    expect(html).toContain("會同步給聯絡人"); // avatar_syncHint
    expect(html).not.toContain('data-testid="avatar-remove"'); // 未設頭像
    expect(html).toContain(">夜<"); // 生成首字預覽
  });

  it("已有頭像 → 顯示圖片預覽與移除鈕", () => {
    const html = renderToStaticMarkup(
      <SettingsScreen {...settingsBase} onAvatar={() => true} selfAvatar="data:image/jpeg;base64,AAA=" />,
    );
    expect(html).toContain("data:image/jpeg;base64,AAA=");
    expect(html).toContain('data-testid="avatar-remove"');
  });

  it("未提供 onAvatar（示範模式）→ 不顯示頭像區", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...settingsBase} />);
    expect(html).not.toContain('data-testid="avatar-section"');
  });
});

describe("聊天清單：廣播頭像（ADR-0154）", () => {
  it("條目帶 avatar → 渲染圖片；未帶 → 生成色圓＋首字", () => {
    const entries: ChatListEntry[] = [
      { id: "p1", name: "Amy", isGroup: false, status: "online", avatar: "data:image/png;base64,BCAST", lastText: "hi", lastAt: 1000, lastOutgoing: false, unread: 0 },
      { id: "p2", name: "Ben", isGroup: false, status: "online", lastText: "yo", lastAt: 900, lastOutgoing: false, unread: 0 },
    ];
    const html = renderToStaticMarkup(<ChatsListScreen entries={entries} onOpen={() => {}} now={2000} locale="zh-Hant" />);
    expect(html).toContain("data:image/png;base64,BCAST"); // Amy 用廣播頭像
    expect(html).toContain(">B<"); // Ben 仍是生成首字
  });
});
