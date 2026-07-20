import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFY_PREFS, type NotifyContext, notificationFor, shouldNotify } from "./notify.js";

describe("通知內文組裝（ADR-0076／0116；桌面與行動共用）", () => {
  const base = { convo: "pk_bob", convoName: "Bob", text: "祕密內容", hidePreview: false, newMessageLabel: "有新訊息" };

  it("1:1：標題＝對話名，內文＝訊息", () => {
    expect(notificationFor(base)).toEqual({ title: "Bob", body: "祕密內容", convo: "pk_bob" });
  });

  it("群訊前綴發送者名（否則群裡誰說的都分不出來）", () => {
    const n = notificationFor({ ...base, convoName: "專案群", senderName: "Carol" });
    expect(n.title).toBe("專案群");
    expect(n.body).toBe("Carol: 祕密內容");
  });

  it("**隱藏預覽 → 絕不放內容**（通知會出現在鎖定畫面，那是裝置的非加密表面）", () => {
    const n = notificationFor({ ...base, hidePreview: true });
    expect(n.body).toBe("有新訊息");
    expect(n.body).not.toContain("祕密內容");
  });

  it("隱藏預覽時，群訊也不洩漏發送者名", () => {
    const n = notificationFor({ ...base, senderName: "Carol", hidePreview: true });
    expect(n.body).toBe("有新訊息");
    expect(n.body).not.toContain("Carol");
    expect(n.body).not.toContain("祕密內容");
  });

  it("convo 一定帶著（供點擊回跳到該對話）", () => {
    expect(notificationFor({ ...base, hidePreview: true }).convo).toBe("pk_bob");
  });
});

describe("shouldNotify 通知事件閘門（ADR-0217）", () => {
  const ok: NotifyContext = {
    event: "dm",
    masterOn: true,
    windowHidden: true,
    offHoursMuted: false,
    convoMuted: false,
  };
  const P = DEFAULT_NOTIFY_PREFS;

  it("四道全域閘門：總開關/視窗聚焦/下班靜音/對話靜音任一擋下 → 否", () => {
    expect(shouldNotify(P, { ...ok, masterOn: false })).toBe(false);
    expect(shouldNotify(P, { ...ok, windowHidden: false })).toBe(false);
    expect(shouldNotify(P, { ...ok, offHoursMuted: true })).toBe(false);
    expect(shouldNotify(P, { ...ok, convoMuted: true })).toBe(false);
  });

  it("各事件依自己的開關；預設：dm/group/nudge/call 開，request/reaction 關", () => {
    expect(shouldNotify(P, { ...ok, event: "dm" })).toBe(true);
    expect(shouldNotify(P, { ...ok, event: "group" })).toBe(true);
    expect(shouldNotify(P, { ...ok, event: "nudge" })).toBe(true);
    expect(shouldNotify(P, { ...ok, event: "call" })).toBe(true);
    expect(shouldNotify(P, { ...ok, event: "request" })).toBe(false);
    expect(shouldNotify(P, { ...ok, event: "reaction" })).toBe(false);
  });

  it("關掉某事件 → 該事件不跳", () => {
    expect(shouldNotify({ ...P, dm: false }, { ...ok, event: "dm" })).toBe(false);
    expect(shouldNotify({ ...P, group: false }, { ...ok, event: "group" })).toBe(false);
  });

  it("@提及 override：群組訊息關，但 @我 且 mention 開 → 仍跳", () => {
    const groupOff = { ...P, group: false, mention: true };
    expect(shouldNotify(groupOff, { ...ok, event: "group", mentionsMe: true })).toBe(true);
    expect(shouldNotify(groupOff, { ...ok, event: "group", mentionsMe: false })).toBe(false);
    // mention 也關 → 即使 @我也不跳
    expect(shouldNotify({ ...P, group: false, mention: false }, { ...ok, event: "group", mentionsMe: true })).toBe(false);
  });
});
