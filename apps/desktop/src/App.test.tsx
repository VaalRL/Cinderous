import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddIdentityModal, relayChangeTarget } from "./App.js";
import type { Profile } from "./storage/profiles.js";

describe("AddIdentityModal", () => {
  it("relay 欄位預填目前作用中身分的網址（可改）", () => {
    const out = renderToStaticMarkup(
      <AddIdentityModal defaultRelayUrl="wss://relay.example" onAdd={() => {}} onCancel={() => {}} />,
    );
    expect(out).toContain('value="wss://relay.example"');
  });

  it("預設值為空字串時 relay 欄位維持空白且建立鈕停用", () => {
    const out = renderToStaticMarkup(
      <AddIdentityModal defaultRelayUrl="" onAdd={() => {}} onCancel={() => {}} />,
    );
    expect(out).toContain("disabled");
  });
});

const prof = (over: Partial<Profile> = {}): Profile => ({
  pubkey: "a",
  name: "我",
  relayUrl: "wss://x",
  enterprise: false,
  namespace: "",
  ...over,
});

describe("relayChangeTarget（ADR-0066 H2 更換守門）", () => {
  it("合法新網址：回傳正規化結果（trim、去尾斜線）", () => {
    expect(relayChangeTarget(prof(), " wss://y/ ")).toBe("wss://y");
  });

  it("同值（含正規化等價）與非法網址 → null（no-op）", () => {
    expect(relayChangeTarget(prof(), "wss://x/")).toBeNull();
    expect(relayChangeTarget(prof(), "https://y")).toBeNull();
    expect(relayChangeTarget(prof(), "")).toBeNull();
  });

  it("企業身分鎖定漫遊、無作用中身分 → null", () => {
    expect(relayChangeTarget(prof({ enterprise: true }), "wss://y")).toBeNull();
    expect(relayChangeTarget(null, "wss://y")).toBeNull();
  });
});
