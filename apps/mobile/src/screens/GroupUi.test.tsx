import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatsListScreen } from "./ChatsListScreen.js";
import { ConversationScreen } from "./ConversationScreen.js";

const contacts = [
  { pubkey: "pk_bob", name: "Bob" },
  { pubkey: "pk_carol", name: "Carol" },
];

describe("行動端建立群組（ADR-0114）", () => {
  const base = { entries: [], onOpen: () => {}, locale: "en" as const };

  it("沒有聯絡人就不顯示建群入口（空群沒有收件人，群訊會直接標成 failed）", () => {
    const html = renderToStaticMarkup(<ChatsListScreen {...base} onCreateGroup={() => {}} contacts={[]} />);
    expect(html).not.toContain('data-testid="new-group"');
  });

  it("有聯絡人 → 顯示建群入口", () => {
    const html = renderToStaticMarkup(<ChatsListScreen {...base} onCreateGroup={() => {}} contacts={contacts} />);
    expect(html).toContain('data-testid="new-group"');
  });

  it("未提供 onCreateGroup（示範模式）→ 不顯示入口", () => {
    const html = renderToStaticMarkup(<ChatsListScreen {...base} contacts={contacts} />);
    expect(html).not.toContain('data-testid="new-group"');
  });
});

describe("行動端群組管理（ADR-0114）", () => {
  const base = {
    name: "專案群",
    messages: [],
    onSend: () => {},
    onBack: () => {},
    locale: "en" as const,
    groupMembers: ["pk_me", "pk_bob"],
    nameFor: (pk: string) => (pk === "pk_me" ? "Me" : "Bob"),
    selfPubkey: "pk_me",
  };

  it("1:1 對話不顯示群組選單", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen name="Bob" messages={[]} onSend={() => {}} onBack={() => {}} onLeaveGroup={() => {}} />,
    );
    expect(html).not.toContain('data-testid="group-menu"');
  });

  it("群組 → 顯示群組選單", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} onLeaveGroup={() => {}} />);
    expect(html).toContain('data-testid="group-menu"');
  });

  it("**成員面板要點開才出現**（避免佔掉對話空間）", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} onLeaveGroup={() => {}} />);
    expect(html).not.toContain('data-testid="leave-group"'); // 未點開
  });
});

describe("行動端敲一下與上線狀態（ADR-0114）", () => {
  const base = { name: "Bob", messages: [], onSend: () => {}, onBack: () => {}, locale: "en" as const };

  it("1:1 顯示敲一下（過去行動端只能收、不能發）", () => {
    expect(renderToStaticMarkup(<ConversationScreen {...base} onNudge={() => {}} />)).toContain(
      'data-testid="nudge"',
    );
  });

  it("**群組不顯示敲一下**（敲一下是 1:1 的定址事件）", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} groupMembers={["pk_me", "pk_bob"]} onNudge={() => {}} />,
    );
    expect(html).not.toContain('data-testid="nudge"');
  });

  it("未提供 onNudge（示範模式）→ 不顯示", () => {
    expect(renderToStaticMarkup(<ConversationScreen {...base} />)).not.toContain('data-testid="nudge"');
  });
});
