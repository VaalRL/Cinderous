import { describe, expect, it } from "vitest";
import { generateEncryptionKey, openWrapWithEks } from "./subkey.js";
import { wrapGroupFile } from "./group.js";
import { KIND } from "./constants.js";
import {
  applyGroupControl,
  canPostToGroup,
  DEVICE_COUNT_MAX,
  GROUP_MEMBERS_MAX,
  groupReceiptMode,
  groupSizeExceeded,
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

  it("自封副本（ADR-0107）：群訊也送自己一份——否則自己的另一台裝置看不到自己發的群訊", () => {
    const g = group();
    const w = wrapGroupMessage("嗨大家", aliceSk, alicePk, g);
    // 扇出腿仍只給「其他」成員（送出狀態的判準不變）；自封副本另計。
    expect(w.events.length).toBe(2);
    expect(w.selfCopy.tags).toContainEqual(["p", alicePk]);

    const asAlice = openWrap(w.selfCopy, aliceSk); // Alice 的另一台裝置
    expect(asAlice.sender).toBe(alicePk); // 寄件人是自己 → 收端判為自封副本（標 outgoing）
    expect(asAlice.rumor.content).toBe("嗨大家");
    expect(groupTarget(asAlice.rumor)).toBe(g.id); // 由 g tag 歸檔，不需 `to` 標記

    // 關鍵：自封副本與成員收到的是**同一個 rumor** → 同一個 id → 回條/回應對得起來。
    expect(asAlice.rumor.id).toBe(openWrap(w.events[0]!, bobSk).rumor.id);
    expect(asAlice.rumor.id).toBe(w.id);
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

describe("規模上限（ADR-0303 A3：D=5／N=15，先緊後放寬）", () => {
  it("常數本身", () => {
    expect(DEVICE_COUNT_MAX).toBe(5);
    expect(GROUP_MEMBERS_MAX).toBe(15);
  });

  it("建群：成員數（含自己）在上限內＝可建", () => {
    expect(groupSizeExceeded(GROUP_MEMBERS_MAX)).toBe(false);
    expect(groupSizeExceeded(1)).toBe(false);
  });

  it("🔴 超過上限＝擋下", () => {
    expect(groupSizeExceeded(GROUP_MEMBERS_MAX + 1)).toBe(true);
  });

  it("🔴 上限只擋「新增」，不得弄壞既有超額群組——那會是拿走使用者已有的東西", () => {
    // 舊版沒有上限，既有群可能已超額（或日後放寬後又收緊）。
    // 判定函式只回答「這個數字超了嗎」，收訊端**不得**用它去拒絕既有群的控制訊息。
    // 這條測試釘住語意：函式本身不帶副作用、不做「刪掉超額成員」之類的事。
    const before: Group = { id: "g1", name: "舊群", admin: "a", members: Array.from({ length: 30 }, (_, i) => `m${i}`) };
    const after = applyGroupControl(before, { type: "group-add", id: "g1", member: "新成員" }, "a");
    expect(after.members).toHaveLength(31);
  });

  it("上限與回條分級相容：N=15 落在「完全不記回條」那一級（ADR-0095）", () => {
    // 若日後放寬 N，這條會提醒回條成本也跟著變。
    expect(groupReceiptMode(GROUP_MEMBERS_MAX)).toBe("off");
  });
});

describe("群訊的 FS retarget（ADR-0320 批二）", () => {
  const alice = generateSecretKey();
  const alicePk = getPublicKey(alice);
  const bobIk = generateSecretKey();
  const bobPk = getPublicKey(bobIk);
  const carolIk = generateSecretKey();
  const carolPk = getPublicKey(carolIk);
  const bobEk = generateEncryptionKey();
  const group = { id: "g1", name: "群", admin: alicePk, members: [alicePk, bobPk, carolPk] };

  it("🔴 **rumor.id 不變**——回條與引用都以它為鍵（ADR-0095）", () => {
    const plain = wrapGroupMessage("嗨", alice, alicePk, group, { now: 1 });
    const fs = wrapGroupMessage("嗨", alice, alicePk, group, { now: 1, encryptToFor: () => bobEk.pk });
    expect(fs.id).toBe(plain.id);
  });

  it("🔴 逐位成員各自決定：Bob 有 EK → 用 EK 鎖；Carol 沒有 → 退回身分（同一則訊息混合）", () => {
    const w = wrapGroupMessage("午餐吃什麼", alice, alicePk, group, {
      now: 1,
      encryptToFor: (pk) => (pk === bobPk ? bobEk.pk : pk), // 只知道 Bob 的 EK
    });
    const forBob = w.events.find((e) => e.tags.some((t) => t[0] === "p" && t[1] === bobPk))!;
    const forCarol = w.events.find((e) => e.tags.some((t) => t[0] === "p" && t[1] === carolPk))!;

    // Bob：EK 解得開、身分解不開（＝這一份有 FS）
    expect(openWrapWithEks(forBob, [bobEk.sk]).rumor.content).toBe("午餐吃什麼");
    expect(() => openWrapWithEks(forBob, [bobIk])).toThrow();
    // Carol：退回身分（＝這一份沒有 FS，但照樣收得到——不是失敗）
    expect(openWrapWithEks(forCarol, [carolIk]).rumor.content).toBe("午餐吃什麼");
  });

  it("外層 #p 仍為身分（中繼照樣路由；EK 只換加密對象）", () => {
    const w = wrapGroupMessage("嗨", alice, alicePk, group, { now: 1, encryptToFor: () => bobEk.pk });
    for (const ev of w.events) {
      expect(ev.tags.some((t) => t[0] === "p" && (t[1] === bobPk || t[1] === carolPk))).toBe(true);
    }
  });

  it("群組檔案 metadata 走同一條路（檔名同樣敏感）", () => {
    const meta = { tid: "t1", name: "薪資表.xlsx", size: 10, mime: "application/vnd.ms-excel" };
    const plain = wrapGroupFile(meta, alice, alicePk, group, { now: 1 });
    const fs = wrapGroupFile(meta, alice, alicePk, group, { now: 1, encryptToFor: () => bobEk.pk });
    expect(fs.id).toBe(plain.id); // id 不變
    const forBob = fs.events.find((e) => e.tags.some((t) => t[0] === "p" && t[1] === bobPk))!;
    expect(openWrapWithEks(forBob, [bobEk.sk]).rumor.tags.find((t) => t[0] === "file")?.[2]).toBe("薪資表.xlsx");
  });
});
