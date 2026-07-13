import { describe, expect, it } from "vitest";
import { KIND } from "./constants.js";
import {
  applyGroupControl,
  canPostToGroup,
  groupReceiptMode,
  groupTarget,
  newGroupId,
  parseGroupControl,
  wrapGroupControl,
  wrapGroupMessage,
  type Group,
} from "./group.js";
import { isMentioned } from "./mention.js";
import { threadRoot } from "./thread.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { openWrap } from "./nip59.js";

const aliceSk = generateSecretKey();
const alicePk = getPublicKey(aliceSk);
const bobSk = generateSecretKey();
const bobPk = getPublicKey(bobSk);
const carolSk = generateSecretKey();
const carolPk = getPublicKey(carolSk);

const group = (): Group => ({ id: newGroupId(), name: "好友", admin: alicePk, members: [alicePk, bobPk, carolPk] });

describe("群組訊息扇出（M9，Gift-Wrap 成對）", () => {
  it("對每位其他成員各扇出一個 Gift Wrap，收件端還原 kind 14 + g tag", () => {
    const g = group();
    const { events } = wrapGroupMessage("嗨大家", aliceSk, alicePk, g);
    expect(events.length).toBe(2); // Bob、Carol（排除自己）

    const asBob = openWrap(events[0]!, bobSk);
    expect(asBob.sender).toBe(alicePk);
    expect(asBob.rumor.kind).toBe(KIND.CHAT);
    expect(asBob.rumor.content).toBe("嗨大家");
    expect(groupTarget(asBob.rumor)).toBe(g.id);

    // 兩個 wrap 各自只能由對應收件人解開
    expect(() => openWrap(events[0]!, carolSk)).toThrow();
    expect(openWrap(events[1]!, carolSk).rumor.content).toBe("嗨大家");
  });

  it("提及（ADR-0050）：mentions 寫進加密 rumor 內層 p-tag，收端可判定被提及", () => {
    const g = group();
    const { events } = wrapGroupMessage("@Bob 看這個", aliceSk, alicePk, g, { mentions: [bobPk] });
    const asBob = openWrap(events[0]!, bobSk);
    expect(isMentioned(asBob.rumor, bobPk)).toBe(true);
    const asCarol = openWrap(events[1]!, carolSk);
    expect(isMentioned(asCarol.rumor, bobPk)).toBe(true); // 群成員都看得到提及對象
    expect(isMentioned(asCarol.rumor, carolPk)).toBe(false);
  });

  it("對話串（ADR-0051）：replyTo 寫進加密 rumor 內層 reply e-tag，收端可讀串根", () => {
    const g = group();
    const { events } = wrapGroupMessage("我覺得可行", aliceSk, alicePk, g, { replyTo: "root-msg" });
    const asBob = openWrap(events[0]!, bobSk);
    expect(threadRoot(asBob.rumor)).toBe("root-msg");
  });

  it("外層作者非寄件人（隱藏群組社交圖譜）", () => {
    const g = group();
    const [evt] = wrapGroupMessage("hi", aliceSk, alicePk, g).events;
    expect(evt!.kind).toBe(KIND.OFFLINE_DM_GIFT_WRAP);
    expect(evt!.pubkey).not.toBe(alicePk);
  });

  it("群訊 id 跨成員一致（ADR-0095）：每位收件人解出的 rumor.id 相同＝回傳的 id，外層 wrap id 則各不同", () => {
    const g = group();
    const { id, events } = wrapGroupMessage("同一則", aliceSk, alicePk, g);
    const asBob = openWrap(events[0]!, bobSk);
    const asCarol = openWrap(events[1]!, carolSk);
    // 內層 rumor id：發訊者回傳值＝兩位收件人解出的值（送達/已讀回條才對得回來）
    expect(asBob.rumor.id).toBe(id);
    expect(asCarol.rumor.id).toBe(id);
    // 外層 wrap id 每人不同（一次性金鑰＋各自密文）→ 不可當群訊識別
    expect(events[0]!.id).not.toBe(events[1]!.id);
  });

  it("移除成員後不再扇出給他（即時、免 rekey）", () => {
    const g = group();
    const removed: Group = { ...g, members: [alicePk, bobPk] };
    const { events } = wrapGroupMessage("秘密", aliceSk, alicePk, removed);
    expect(events.length).toBe(1);
    expect(openWrap(events[0]!, bobSk).rumor.content).toBe("秘密");
    // Carol 已不在成員，沒有屬於她的 wrap
    expect(() => openWrap(events[0]!, carolSk)).toThrow();
  });
});

describe("群組回條分級（ADR-0095）", () => {
  it("≤5 人＝名單制、6–10 人＝計數制、>10 人＝完全不記", () => {
    expect(groupReceiptMode(2)).toBe("list");
    expect(groupReceiptMode(5)).toBe("list"); // 邊界：含 5
    expect(groupReceiptMode(6)).toBe("count"); // 邊界：6 起改計數
    expect(groupReceiptMode(10)).toBe("count"); // 邊界：含 10
    expect(groupReceiptMode(11)).toBe("off"); // 邊界：11 起完全不記（連送達都不送）
    expect(groupReceiptMode(50)).toBe("off");
  });
});

describe("群訊 relay hint（ADR-0036）", () => {
  it("wrapGroupMessage/wrapGroupControl 帶 hint：rumor 內層可讀、外層不可見", () => {
    const aliceSk = generateSecretKey();
    const alicePk = getPublicKey(aliceSk);
    const bobSk = generateSecretKey();
    const bobPk = getPublicKey(bobSk);
    const group = { id: "g1", name: "測試群", admin: alicePk, members: [alicePk, bobPk] };

    const [msgWrap] = wrapGroupMessage("群訊", aliceSk, alicePk, group, { relayHint: "wss://x" }).events;
    expect(JSON.stringify(msgWrap!.tags)).not.toContain("wss://x");
    const opened = openWrap(msgWrap!, bobSk);
    expect(opened.rumor.tags).toContainEqual(["relay", "wss://x"]);
    expect(groupTarget(opened.rumor)).toBe("g1"); // g tag 不受影響

    const [ctlWrap] = wrapGroupControl(
      { type: "group-create", id: "g1", name: "測試群", admin: alicePk, members: [alicePk, bobPk] },
      aliceSk,
      [bobPk],
      { relayHint: "wss://x" },
    );
    expect(openWrap(ctlWrap!, bobSk).rumor.tags).toContainEqual(["relay", "wss://x"]);
  });
});

describe("群組控制訊息", () => {
  it("group-create 扇出並可還原、解析", () => {
    const g = group();
    const control = { type: "group-create" as const, id: g.id, name: g.name, admin: g.admin, members: g.members };
    const events = wrapGroupControl(control, aliceSk, [bobPk, carolPk]);
    expect(events.length).toBe(2);
    const { sender, rumor } = openWrap(events[0]!, bobSk);
    expect(sender).toBe(alicePk);
    expect(rumor.kind).toBe(KIND.GROUP_CONTROL);
    expect(groupTarget(rumor)).toBe(g.id);
    expect(parseGroupControl(rumor)).toEqual(control);
  });

  it("parseGroupControl 拒絕非法/非控制訊息", () => {
    const chat = { pubkey: alicePk, created_at: 1, kind: KIND.CHAT, tags: [], content: "hi", id: "x" };
    expect(parseGroupControl(chat)).toBeNull();
    const bad = { pubkey: alicePk, created_at: 1, kind: KIND.GROUP_CONTROL, tags: [], content: "{}", id: "x" };
    expect(parseGroupControl(bad)).toBeNull();
  });

  it("applyGroupControl：add/remove(僅管理者)/leave", () => {
    const g: Group = { id: "g1", name: "x", admin: alicePk, members: [alicePk, bobPk] };
    // 非管理者新增成員無效
    const byBob = applyGroupControl(g, { type: "group-add", id: "g1", member: carolPk }, bobPk);
    expect(byBob.members).not.toContain(carolPk);
    // 管理者新增有效
    const added = applyGroupControl(g, { type: "group-add", id: "g1", member: carolPk }, alicePk);
    expect(added.members).toContain(carolPk);

    // 非管理者移除他人無效
    const notAdmin = applyGroupControl(added, { type: "group-remove", id: "g1", member: carolPk }, bobPk);
    expect(notAdmin.members).toContain(carolPk);
    // 管理者移除有效
    const removed = applyGroupControl(added, { type: "group-remove", id: "g1", member: carolPk }, alicePk);
    expect(removed.members).not.toContain(carolPk);
    // 離開移除自己
    const left = applyGroupControl(added, { type: "group-leave", id: "g1" }, bobPk);
    expect(left.members).not.toContain(bobPk);
  });
});

describe("canPostToGroup（公告授權，ADR-0049）", () => {
  const g = { id: "g", name: "n", admin: "admin", members: ["admin", "alice"] };
  it("一般群：任何成員可發、非成員不可", () => {
    expect(canPostToGroup(g, "alice")).toBe(true);
    expect(canPostToGroup(g, "admin")).toBe(true);
    expect(canPostToGroup(g, "stranger")).toBe(false);
  });
  it("公告群：僅管理者可發", () => {
    const a = { ...g, announce: true };
    expect(canPostToGroup(a, "admin")).toBe(true);
    expect(canPostToGroup(a, "alice")).toBe(false);
  });
});

describe("群組快照（ADR-0068）", () => {
  it("group-snapshot 扇出並可還原、解析（同 create 的欄位驗證）", () => {
    const g = group();
    const control = { type: "group-snapshot" as const, id: g.id, name: g.name, admin: g.admin, members: g.members };
    const [evt] = wrapGroupControl(control, aliceSk, [bobPk]);
    const { sender, rumor } = openWrap(evt!, bobSk);
    expect(sender).toBe(alicePk);
    expect(parseGroupControl(rumor)).toEqual(control);
  });

  it("applyGroupControl snapshot：管理者可對帳名稱/成員；非管理者與組織群不動", () => {
    const g: Group = { id: "g1", name: "舊名", admin: alicePk, members: [alicePk, bobPk, carolPk] };
    const snap = { type: "group-snapshot" as const, id: "g1", name: "新名", admin: alicePk, members: [alicePk, bobPk] };
    // 管理者快照＝權威對帳（名稱與成員以快照為準；Carol 被移除）
    const reconciled = applyGroupControl(g, snap, alicePk);
    expect(reconciled.name).toBe("新名");
    expect(reconciled.members).toEqual([alicePk, bobPk]);
    // 非管理者（前成員偽造）不動
    expect(applyGroupControl(g, snap, carolPk)).toEqual(g);
    // 組織群由名冊權威管理（ADR-0049），快照不得觸碰
    const org: Group = { ...g, org: true };
    expect(applyGroupControl(org, snap, alicePk)).toEqual(org);
  });
});
