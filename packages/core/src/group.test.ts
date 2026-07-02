import { describe, expect, it } from "vitest";
import { KIND } from "./constants.js";
import {
  applyGroupControl,
  groupTarget,
  newGroupId,
  parseGroupControl,
  wrapGroupControl,
  wrapGroupMessage,
  type Group,
} from "./group.js";
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
    const events = wrapGroupMessage("嗨大家", aliceSk, alicePk, g);
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

  it("外層作者非寄件人（隱藏群組社交圖譜）", () => {
    const g = group();
    const [evt] = wrapGroupMessage("hi", aliceSk, alicePk, g);
    expect(evt!.kind).toBe(KIND.OFFLINE_DM_GIFT_WRAP);
    expect(evt!.pubkey).not.toBe(alicePk);
  });

  it("移除成員後不再扇出給他（即時、免 rekey）", () => {
    const g = group();
    const removed: Group = { ...g, members: [alicePk, bobPk] };
    const events = wrapGroupMessage("秘密", aliceSk, alicePk, removed);
    expect(events.length).toBe(1);
    expect(openWrap(events[0]!, bobSk).rumor.content).toBe("秘密");
    // Carol 已不在成員，沒有屬於她的 wrap
    expect(() => openWrap(events[0]!, carolSk)).toThrow();
  });
});

describe("群訊 relay hint（ADR-0036）", () => {
  it("wrapGroupMessage/wrapGroupControl 帶 hint：rumor 內層可讀、外層不可見", () => {
    const aliceSk = generateSecretKey();
    const alicePk = getPublicKey(aliceSk);
    const bobSk = generateSecretKey();
    const bobPk = getPublicKey(bobSk);
    const group = { id: "g1", name: "測試群", admin: alicePk, members: [alicePk, bobPk] };

    const [msgWrap] = wrapGroupMessage("群訊", aliceSk, alicePk, group, { relayHint: "wss://x" });
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
