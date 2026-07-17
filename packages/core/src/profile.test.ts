import { describe, expect, it } from "vitest";
import { KIND } from "./constants.js";
import { relayHintOf } from "./giftwrap.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { openWrap, type Rumor } from "./nip59.js";
import { parseProfile, PROFILE_AVATAR_MAX_BYTES, PROFILE_TITLE_MAX, validAvatarDataUri, wrapProfile } from "./profile.js";

const aliceSk = generateSecretKey();
const alicePk = getPublicKey(aliceSk);
const bobSk = generateSecretKey();
const bobPk = getPublicKey(bobSk);

const rumor = (kind: number, content: string): Rumor => ({ kind, tags: [], content, created_at: 0, id: "x", pubkey: "p" });

/** 迷你合法頭像 data URI（1x1 JPEG 標頭開場即可，內容不驗）。 */
const AVATAR = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

describe("顯示名稱個人檔（ADR-0061，加密廣播）", () => {
  it("收件人可還原：kind 0、content 帶 name、寄件人正確、第三者無法解", () => {
    const wrap = wrapProfile({ name: "小明" }, aliceSk, bobPk);
    expect(wrap.kind).toBe(KIND.OFFLINE_DM_GIFT_WRAP);
    expect(wrap.pubkey).not.toBe(alicePk); // 外層藏寄件人
    const opened = openWrap(wrap, bobSk);
    expect(opened.sender).toBe(alicePk);
    expect(opened.rumor.kind).toBe(KIND.PROFILE);
    expect(parseProfile(opened.rumor)?.name).toBe("小明");
    expect(parseProfile(opened.rumor)?.avatar).toBeUndefined(); // 未帶頭像＝欄位缺席
    expect(() => openWrap(wrap, generateSecretKey())).toThrow();
  });

  it("relayHint（ADR-0066）：寫入 rumor 內層 ['relay', url]、外層不可見；未帶則無", () => {
    const wrap = wrapProfile({ name: "小明" }, aliceSk, bobPk, { relayHint: "wss://home.example" });
    expect(JSON.stringify(wrap.tags)).not.toContain("wss://home.example"); // 外層（中繼可見）不洩漏路由
    const opened = openWrap(wrap, bobSk);
    expect(opened.rumor.tags).toContainEqual(["relay", "wss://home.example"]);
    expect(relayHintOf(opened.rumor)).toBe("wss://home.example");
    expect(relayHintOf(openWrap(wrapProfile({ name: "小明" }, aliceSk, bobPk), bobSk).rumor)).toBeUndefined();
  });

  it("parseProfile：非個人檔 kind、壞 JSON、空名且無頭像 → undefined；有效名去空白", () => {
    expect(parseProfile(rumor(KIND.CHAT, JSON.stringify({ name: "x" })))).toBeUndefined();
    expect(parseProfile(rumor(KIND.PROFILE, "not json"))).toBeUndefined();
    expect(parseProfile(rumor(KIND.PROFILE, JSON.stringify({ name: "  " })))).toBeUndefined();
    expect(parseProfile(rumor(KIND.PROFILE, JSON.stringify({ name: "  阿華  " })))?.name).toBe("阿華");
  });

  it("頭像 round-trip（ADR-0154）：wrap 帶 avatar，收端解回同一 data URI", () => {
    const opened = openWrap(wrapProfile({ name: "小明", avatar: AVATAR }, aliceSk, bobPk), bobSk);
    const p = parseProfile(opened.rumor);
    expect(p?.name).toBe("小明");
    expect(p?.avatar).toBe(AVATAR);
  });

  it("頭像移除記號（ADR-0154）：avatar '' 原樣傳遞（收端據此清除）", () => {
    const opened = openWrap(wrapProfile({ name: "小明", avatar: "" }, aliceSk, bobPk), bobSk);
    expect(parseProfile(opened.rumor)?.avatar).toBe("");
  });

  it("收端防禦（ADR-0154）：超大、非白名單 mime（含 SVG）、非 data URI 的頭像一律丟棄", () => {
    const huge = `data:image/jpeg;base64,${"A".repeat(PROFILE_AVATAR_MAX_BYTES)}`;
    for (const bad of [huge, "data:image/svg+xml;base64,PHN2Zz4=", "https://evil.example/x.jpg", "javascript:alert(1)"]) {
      const p = parseProfile(rumor(KIND.PROFILE, JSON.stringify({ name: "x", avatar: bad })));
      expect(p?.name).toBe("x"); // 名字照收
      expect(p?.avatar).toBeUndefined(); // 壞頭像丟棄
    }
  });

  it("無名字但有合法頭像仍可解析（僅更新頭像的廣播）", () => {
    const p = parseProfile(rumor(KIND.PROFILE, JSON.stringify({ avatar: AVATAR })));
    expect(p?.name).toBeUndefined();
    expect(p?.avatar).toBe(AVATAR);
  });

  it("頭銜 round-trip（ADR-0158）：wrap 帶 title，收端清洗後還原；'' 移除記號原樣傳遞", () => {
    const opened = openWrap(wrapProfile({ name: "小明", title: "  後端  工程師 " }, aliceSk, bobPk), bobSk);
    expect(parseProfile(opened.rumor)?.title).toBe("後端 工程師"); // 收斂空白＋修剪
    const removed = openWrap(wrapProfile({ name: "小明", title: "" }, aliceSk, bobPk), bobSk);
    expect(parseProfile(removed.rumor)?.title).toBe("");
    const none = openWrap(wrapProfile({ name: "小明" }, aliceSk, bobPk), bobSk);
    expect(parseProfile(none.rumor)?.title).toBeUndefined(); // 缺席＝無變更
  });

  it("頭銜收端防禦（ADR-0158）：超長截斷至上限；全空白視同缺席", () => {
    const long = "職".repeat(PROFILE_TITLE_MAX + 10);
    const p = parseProfile(rumor(KIND.PROFILE, JSON.stringify({ name: "x", title: long })));
    expect(p?.title?.length).toBe(PROFILE_TITLE_MAX);
    const blank = parseProfile(rumor(KIND.PROFILE, JSON.stringify({ name: "x", title: "   " })));
    expect(blank?.title).toBeUndefined();
  });

  it("validAvatarDataUri：白名單 jpeg/png/webp/gif；拒 SVG、非 data、超長；驗 base64 字元集（審查修正）", () => {
    expect(validAvatarDataUri(AVATAR)).toBe(true);
    expect(validAvatarDataUri("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(validAvatarDataUri("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(validAvatarDataUri("https://x.example/a.jpg")).toBe(false);
    expect(validAvatarDataUri(`data:image/jpeg;base64,${"A".repeat(PROFILE_AVATAR_MAX_BYTES)}`)).toBe(false);
    // 非法 base64 字元（會進 CSS url()）→ 拒；空 payload → 拒。
    expect(validAvatarDataUri("data:image/png;base64,abc<script>")).toBe(false);
    expect(validAvatarDataUri("data:image/png;base64,")).toBe(false);
  });
});
