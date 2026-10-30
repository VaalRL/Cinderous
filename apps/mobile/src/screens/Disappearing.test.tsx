// @vitest-environment jsdom
//
// 行動端的限時訊息到期處理（ADR-0406）。ADR-0169 只做了「送出」限時訊息，收到之後從來不到期：
// 對話、聊天清單、引用、歷史紀錄都一直顯示原文。比照桌面與「已收回」：到期後**絕不顯示原文**。
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, MessageArchive, StoredMessage } from "@cinderous/engine";
import { buildChatList } from "../chat-list.js";
import { mount } from "../test/jsdom-mount.js";
import { ConversationScreen } from "./ConversationScreen.js";
import { HistoryScreen } from "./HistoryScreen.js";

const NOW = 1_800_000_000_000;
const base = { name: "Bob", onSend: () => {}, onBack: () => {}, locale: "zh-Hant" as const };
const expired: ChatMessage = { id: "e1", outgoing: false, text: "密碼是 1234", at: NOW - 60_000, expiresAt: NOW - 1, mentionsMe: true };
const live: ChatMessage = { id: "l1", outgoing: false, text: "週五見", at: NOW - 30_000, expiresAt: NOW + 60_000 };
const reply: ChatMessage = { id: "r1", outgoing: true, text: "收到", at: NOW - 10_000, replyTo: "e1" };

afterEach(() => vi.useRealTimers());

describe("對話畫面", () => {
  it("🔴 到期的訊息不顯示原文、改顯示「訊息已到期」；沒到期的照常顯示並帶 ⏱", () => {
    vi.useFakeTimers({ now: NOW });
    const m = mount(<ConversationScreen {...base} messages={[expired, live]} reactions={{ e1: ["👍"] }} />);
    const html = m.container.innerHTML;
    m.unmount();
    expect(html).not.toContain("密碼是 1234");
    expect(html).toContain("訊息已到期");
    expect(html).not.toContain("👍"); // 表情回應也不留
    expect(html).not.toContain("mention-badge-e1");
    expect(html).toContain("週五見");
    expect(html).toContain('data-testid="timer-badge-l1"');
  });

  it("🔴 回覆引用到期的訊息 → 引用處也不露原文", () => {
    vi.useFakeTimers({ now: NOW });
    const m = mount(<ConversationScreen {...base} messages={[expired, reply]} />);
    const html = m.container.innerHTML;
    m.unmount();
    expect(html).toContain('data-testid="reply-quote-r1"');
    expect(html).not.toContain("密碼是 1234");
  });

  it("🔴 開著畫面時到期 → 自己重繪（不用等別的事件）", async () => {
    vi.useFakeTimers({ now: NOW });
    const soon: ChatMessage = { ...live, id: "s1", text: "十秒後消失", expiresAt: NOW + 10_000 };
    const m = mount(<ConversationScreen {...base} messages={[soon]} />);
    expect(m.container.textContent).toContain("十秒後消失");
    await act(async () => {
      vi.advanceTimersByTime(10_100);
    });
    expect(m.container.textContent).not.toContain("十秒後消失");
    expect(m.container.textContent).toContain("訊息已到期");
    m.unmount();
  });

  it("🔴 到期超過 24.8 天（setTimeout 上限）也會到期：截斷的計時器醒來要再排下一段（2026-10-30 審查）", async () => {
    vi.useFakeTimers({ now: NOW });
    const far = 30 * 86_400_000; // 對方可以給任意的到期時間
    const late: ChatMessage = { ...live, id: "f1", text: "三十天後消失", expiresAt: NOW + far };
    const m = mount(<ConversationScreen {...base} messages={[late]} />);
    await act(async () => {
      vi.advanceTimersByTime(2 ** 31 - 1); // 第一段：截斷在上限
    });
    expect(m.container.textContent).toContain("三十天後消失");
    await act(async () => {
      vi.advanceTimersByTime(far - (2 ** 31 - 1) + 100); // 第二段：到期
    });
    expect(m.container.textContent).not.toContain("三十天後消失");
    expect(m.container.textContent).toContain("訊息已到期");
    m.unmount();
  });
});

describe("聊天清單", () => {
  it("🔴 最後一則到期 → 預覽顯示到期字樣", () => {
    const list = buildChatList(
      [{ pubkey: "p1", name: "Bob", status: "online", statusMessage: "", nowPlaying: "" }],
      [],
      { p1: [expired] },
      {},
      { expiredLabel: "訊息已到期", now: NOW },
    );
    expect(list[0]!.lastText).toBe("訊息已到期");
  });
});

describe("歷史紀錄（封存）", () => {
  it("🔴 封存裡到期的訊息不顯示原文", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] }); // 只固定時間，promise 照常跑
    const stored = { ...expired, contact: "bob" } as unknown as StoredMessage;
    const archive = {
      chunkCount: async () => 1,
      loadChunk: async () => [stored, { ...live, contact: "bob" } as unknown as StoredMessage],
    } as unknown as MessageArchive;
    const m = mount(<HistoryScreen name="Bob" convo="bob" archive={archive} selfLabel="我" onBack={() => {}} />);
    await act(async () => {});
    await act(async () => {});
    const body = m.container.textContent ?? "";
    expect(body).toContain("週五見");
    expect(body).not.toContain("密碼是 1234");
    expect(body).toContain("訊息已到期");
    m.unmount();
  });
});
