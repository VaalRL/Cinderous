import { describe, expect, it } from "vitest";
import { KIND } from "./constants.js";
import { relayHintOf } from "./giftwrap.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { openWrap, type Rumor } from "./nip59.js";
import { parseProfile, wrapProfile } from "./profile.js";

const aliceSk = generateSecretKey();
const alicePk = getPublicKey(aliceSk);
const bobSk = generateSecretKey();
const bobPk = getPublicKey(bobSk);

const rumor = (kind: number, content: string): Rumor => ({ kind, tags: [], content, created_at: 0, id: "x", pubkey: "p" });

describe("顯示名稱個人檔（ADR-0061，加密廣播）", () => {
  it("收件人可還原：kind 0、content 帶 name、寄件人正確、第三者無法解", () => {
    const wrap = wrapProfile("小明", aliceSk, bobPk);
    expect(wrap.kind).toBe(KIND.OFFLINE_DM_GIFT_WRAP);
    expect(wrap.pubkey).not.toBe(alicePk); // 外層藏寄件人
    const opened = openWrap(wrap, bobSk);
    expect(opened.sender).toBe(alicePk);
    expect(opened.rumor.kind).toBe(KIND.PROFILE);
    expect(parseProfile(opened.rumor)).toBe("小明");
    expect(() => openWrap(wrap, generateSecretKey())).toThrow();
  });

  it("relayHint（ADR-0066）：寫入 rumor 內層 ['relay', url]、外層不可見；未帶則無", () => {
    const wrap = wrapProfile("小明", aliceSk, bobPk, { relayHint: "wss://home.example" });
    expect(JSON.stringify(wrap.tags)).not.toContain("wss://home.example"); // 外層（中繼可見）不洩漏路由
    const opened = openWrap(wrap, bobSk);
    expect(opened.rumor.tags).toContainEqual(["relay", "wss://home.example"]);
    expect(relayHintOf(opened.rumor)).toBe("wss://home.example");
    expect(relayHintOf(openWrap(wrapProfile("小明", aliceSk, bobPk), bobSk).rumor)).toBeUndefined();
  });

  it("parseProfile：非個人檔 kind、壞 JSON、空名 → undefined；有效名去空白", () => {
    expect(parseProfile(rumor(KIND.CHAT, JSON.stringify({ name: "x" })))).toBeUndefined();
    expect(parseProfile(rumor(KIND.PROFILE, "not json"))).toBeUndefined();
    expect(parseProfile(rumor(KIND.PROFILE, JSON.stringify({ name: "  " })))).toBeUndefined();
    expect(parseProfile(rumor(KIND.PROFILE, JSON.stringify({ name: "  阿華  " })))).toBe("阿華");
  });
});
