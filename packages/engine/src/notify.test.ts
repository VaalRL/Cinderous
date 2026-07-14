import { describe, expect, it } from "vitest";
import { notificationFor } from "./notify.js";

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
