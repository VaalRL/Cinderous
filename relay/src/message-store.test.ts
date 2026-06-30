import { describe, expect, it } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type NostrEvent,
} from "@nostr-buddy/core";
import { getExpiration, MessageStore } from "./message-store.js";

const recipient = getPublicKey(generateSecretKey());

/** 製作一筆已簽章的離線留言（kind 1059 Gift Wrap），可帶 NIP-40 過期。 */
function giftWrap(opts: { to?: string; created_at?: number; expiration?: number } = {}): NostrEvent {
  const tags: string[][] = [["p", opts.to ?? recipient]];
  if (opts.expiration !== undefined) tags.push(["expiration", String(opts.expiration)]);
  return finalizeEvent(
    { kind: 1059, created_at: opts.created_at ?? 1000, tags, content: "x" },
    generateSecretKey(),
  );
}

describe("NIP-40 過期解析", () => {
  it("讀取 expiration 標籤為秒數", () => {
    expect(getExpiration(giftWrap({ expiration: 1234 }))).toBe(1234);
  });
  it("無 expiration 標籤回 undefined", () => {
    expect(getExpiration(giftWrap())).toBeUndefined();
  });
});

describe("MessageStore — 離線留言儲存與過期", () => {
  it("寫入後可依 #p 收件人查詢", () => {
    const store = new MessageStore();
    const e = giftWrap();
    expect(store.put(e, 100)).toBe(true);
    expect(store.query({ kinds: [1059], "#p": [recipient] }, 100)).toEqual([e]);
    expect(store.query({ "#p": ["ff".repeat(32)] }, 100)).toEqual([]);
  });

  it("已過期的事件不予寫入", () => {
    const store = new MessageStore();
    expect(store.put(giftWrap({ expiration: 50 }), 100)).toBe(false);
    expect(store.query({ "#p": [recipient] }, 100)).toEqual([]);
  });

  it("查詢時略過已過期、prune 會清除之", () => {
    const store = new MessageStore();
    const e = giftWrap({ expiration: 200 });
    store.put(e, 100);
    expect(store.query({ "#p": [recipient] }, 199)).toEqual([e]);
    expect(store.query({ "#p": [recipient] }, 201)).toEqual([]);
    store.prune(201);
    expect(store.query({ "#p": [recipient] }, 150)).toEqual([]);
  });

  it("超過每收件人上限時丟棄最舊", () => {
    const store = new MessageStore({ maxPerRecipient: 2 });
    const e1 = giftWrap({ created_at: 1 });
    const e2 = giftWrap({ created_at: 2 });
    const e3 = giftWrap({ created_at: 3 });
    store.put(e1, 0);
    store.put(e2, 0);
    store.put(e3, 0);
    const got = store.query({ "#p": [recipient] }, 0);
    expect(got).toHaveLength(2);
    expect(got.map((e) => e.created_at).sort()).toEqual([2, 3]);
  });
});
