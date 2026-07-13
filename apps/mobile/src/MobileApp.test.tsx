import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@cinder/engine";
import type { ChatListEntry } from "./chat-list.js";
import { MobileApp } from "./MobileApp.js";
import { BottomTabs } from "./screens/BottomTabs.js";
import { ChatsListScreen } from "./screens/ChatsListScreen.js";
import { ConversationScreen } from "./screens/ConversationScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";

// 互動（點擊/送出/接後端）在 renderToStaticMarkup 下不跑；排序邏輯由 chat-list.test 把關，
// 此處確保 app 殼與兩個新畫面在深色＋自訂色下靜態渲染出關鍵結構（ADR-0085）。

describe("行動端 app 殼與畫面（ADR-0085）", () => {
  it("MobileApp 初始渲染登入畫面（SSR 下 effect 不跑）", () => {
    const html = renderToStaticMarkup(<MobileApp initialLocale="zh-Hant" initialTheme="dark" initialAccent="#2f6cd6" />);
    expect(html).toContain("用私鑰登入"); // mobileSignIn_title
  });

  it("BottomTabs：三分頁標籤＋未讀總數徽章（ADR-0087）", () => {
    const html = renderToStaticMarkup(<BottomTabs active="chats" onSelect={() => {}} unreadTotal={5} locale="zh-Hant" />);
    expect(html).toContain("聊天");
    expect(html).toContain("聯絡人");
    expect(html).toContain("設定");
    expect(html).toContain("5"); // 未讀徽章
  });

  it("SettingsScreen：身分備份、外觀、登出（ADR-0087）", () => {
    const html = renderToStaticMarkup(
      <SettingsScreen
        selfName="夜"
        selfNpub="npub1abc"
        selfNsec="nsec1xyz"
        relayUrl="wss://r.example"
        theme="light"
        onTheme={() => {}}
        locale="zh-Hant"
        onLocale={() => {}}
        accent={null}
        onAccent={() => {}}
        onLogout={() => {}}
      />,
    );
    expect(html).toContain("身分備份"); // settings_identityBackup
    expect(html).toContain("外觀"); // mobileSettings_appearance
    expect(html).toContain("登出"); // mobileSettings_logout
    expect(html).toContain("wss://r.example"); // relay 顯示
  });

  it("ChatsListScreen：LINE/Signal 風格列——名稱、最後訊息、未讀徽章、標題", () => {
    const entries: ChatListEntry[] = [
      { id: "p1", name: "Amy", isGroup: false, status: "online", lastText: "在嗎", lastAt: 1000, lastOutgoing: false, unread: 2 },
      { id: "g1", name: "工作", isGroup: true, memberCount: 3, lastText: "大家好", lastAt: 500, lastOutgoing: false, unread: 0 },
    ];
    const html = renderToStaticMarkup(<ChatsListScreen entries={entries} onOpen={() => {}} now={2000} locale="zh-Hant" />);
    expect(html).toContain("聊天"); // mobileChats_title
    expect(html).toContain("Amy");
    expect(html).toContain("在嗎");
    expect(html).toContain("工作");
    expect(html).toContain("2"); // 未讀徽章
  });

  it("ChatsListScreen：空清單顯示提示", () => {
    const html = renderToStaticMarkup(<ChatsListScreen entries={[]} onOpen={() => {}} locale="zh-Hant" />);
    expect(html).toContain("還沒有對話"); // mobileChats_empty
  });

  it("ConversationScreen：標題、雙向氣泡、輸入列", () => {
    const messages: ChatMessage[] = [
      { id: "m1", at: 1, text: "嗨", outgoing: false },
      { id: "m2", at: 2, text: "你好", outgoing: true },
    ];
    const html = renderToStaticMarkup(
      <ConversationScreen name="Amy" subtitle="線上" messages={messages} onSend={() => {}} onBack={() => {}} locale="zh-Hant" />,
    );
    expect(html).toContain("Amy");
    expect(html).toContain("嗨");
    expect(html).toContain("你好");
    expect(html).toContain("輸入訊息…"); // mobileConvo_input placeholder
    expect(html).toContain("送出"); // mobileConvo_send
  });
});
