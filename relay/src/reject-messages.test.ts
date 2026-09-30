// 拒收訊息加詞元（ADR-0376；SDK ADR 0038 P0-R2、SDK ADR 0040）：
// 1. 每一句都是「NIP-01 前綴＋英文詞元＋說明」，而且與 SDK 中繼 v0.32.0 逐字相同（PR #9 切換時客戶端看到的不變）；
// 2. 🔴 已上線的 App（v0.0.18）只看前綴：每一句新舊版在 `classifyOk` 的判定必須一樣；
// 3. 可尋址被拒依原因拆開；`duplicate` 改回 OK true；store 丟例外不留在重放快取。
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { buildAuthEvent, classifyOk, finalizeEvent, generateSecretKey, type NostrEvent } from "@cinderous/core";
import { MessageStore, type MessageStoreOptions, type OfflineStore } from "./message-store.js";
import {
  ADDRESSABLE_REJECT,
  ADDRESSABLE_REJECT_GENERIC,
  EXPIRED_REJECT,
  malformedMessage,
  OFFLINE_CEILING_REJECT,
  powRejectMessage,
  REJECT,
} from "./reject-messages.js";
import { RelayCore } from "./relay-core.js";
import { SqlMessageStore } from "./sql-message-store.js";

/** SDK `classifyRelayMessage` 的前兩層（本 repo 還沒有依賴 SDK，這裡只驗形狀） */
function parse(message: string): { prefix?: string; token?: string } {
  const head = /^([a-z][a-z0-9-]*):\s*/.exec(message);
  if (!head) return {};
  const rest = message.slice(head[0].length);
  const next = /^([a-z][a-z0-9-]*):\s*/.exec(rest);
  return { prefix: head[1]!, ...(next ? { token: next[1]! } : {}) };
}

describe("逐字與 SDK 中繼 v0.32.0 相同（`src/relay/reject-messages.ts`）", () => {
  // 改任何一句都要兩邊一起改（SDK 有契約測試確認每一句的分類）。
  const golden: [string, string][] = [
    [OFFLINE_CEILING_REJECT, "blocked: ceiling: 本站離線留言空間已滿，這則未保存也未轉送；請改用其他中繼或稍後再試"],
    [EXPIRED_REJECT, "invalid: expired: 事件已過期（NIP-40），未保存也未轉送"],
    [ADDRESSABLE_REJECT.stale, "blocked: stale: 這個位址已有較新的事件，未取代"],
    [ADDRESSABLE_REJECT["too-large"], "blocked: too-large: 可尋址事件超過單顆大小上限"],
    [ADDRESSABLE_REJECT["address-quota"], "blocked: quota: 這個作者在這個 kind 的位址數已達上限"],
    [ADDRESSABLE_REJECT["byte-quota"], "blocked: quota: 這個作者的可尋址資料總量已達上限"],
    [ADDRESSABLE_REJECT.expired, "invalid: expired: 事件已過期（NIP-40），未保存也未轉送"],
    [ADDRESSABLE_REJECT.ceiling, "blocked: ceiling: 本站可尋址資料空間已滿，這則未保存也未轉送；請改用其他中繼或稍後再試"],
    [ADDRESSABLE_REJECT_GENERIC, "blocked: 取代事件遭拒（配額/大小/較舊）"],
    [REJECT.tooManyTags, "blocked: too-many-tags: tag 數超過上限"],
    [REJECT.tooManyRecipients, "blocked: too-many-recipients: 收件人數超過上限"],
    [REJECT.eventTooLarge, "blocked: too-large: 事件過大"],
    [REJECT.notAllowed, "blocked: not-allowed: 非本企業成員（allowlist）"],
    [REJECT.kindDisabled, "blocked: kind-disabled: 此事件類型已被政策停用"],
    [REJECT.filesDisabled, "blocked: files-disabled: 檔案事件未啟用（MAX_FILE_MB）"],
    [REJECT.fileChunkTooLarge, "blocked: too-large: 檔案塊過大"],
    [REJECT.badSignature, "invalid: bad-signature: 簽章驗證失敗"],
    [REJECT.clockSkew, "invalid: clock-skew: 時間戳超出允許範圍"],
    [REJECT.messageTooLarge, "invalid: too-large: 訊息過大"],
    [REJECT.vanishRelayTag, "invalid: relay-tag: relay tag 未指向本站（NIP-62）"],
    [REJECT.duplicate, "duplicate: seen: 事件重複"],
    [REJECT.eventsRateLimited, "rate-limited: events: 發送過於頻繁，請稍後再試"],
    [REJECT.messagesRateLimited, "rate-limited: messages: 訊息過於頻繁，連線將關閉（ADR-0366）"],
    [REJECT.subscriptionsLimit, "rate-limited: subscriptions: 訂閱數已達上限"],
    [REJECT.authRequired, "auth-required: nip42: 請先認證（NIP-42）"],
    [REJECT.scopeStrict, "restricted: scope: 訂閱必須指定 #p（自己）或 authors（ADR-0123）"],
    [
      REJECT.scopeLane,
      "restricted: scope: app lanes need a tag filter (e.g. #t, #d), authors, or #p set to yourself after NIP-42 AUTH (ADR-0366)",
    ],
    [REJECT.vanishSelfOnly, "restricted: self-only: 只能清除自己的資料（NIP-62）"],
    [REJECT.authNoChallenge, "auth-failed: no-challenge: 尚未發出挑戰"],
    [REJECT.authBadEvent, "auth-failed: bad-auth: 認證事件無效或挑戰不符"],
    [REJECT.authRelayTag, "auth-failed: relay-tag: relay tag 未指向本站"],
    [REJECT.authTooOld, "auth-failed: too-old: 認證事件已過期"],
    [REJECT.internal, "error: internal: 內部錯誤，請稍後再試"],
    [powRejectMessage(8), "pow: difficulty: 需要難度 8"],
    [malformedMessage("malformed event"), "invalid: malformed: malformed event"],
  ];
  it.each(golden)("%s", (actual, expected) => {
    expect(actual).toBe(expected);
  });

  it("除了說不出原因的舊句子，每一句都有前綴與詞元", () => {
    for (const [message] of golden) {
      if (message === ADDRESSABLE_REJECT_GENERIC) continue;
      const { prefix, token } = parse(message);
      expect(prefix, message).toBeDefined();
      expect(token, message).toBeDefined();
    }
  });
});

describe("🔴 v0.0.18 相容：已上線 App 的 classifyOk 對每一句的判定，新舊版一樣", () => {
  // [舊句子, 新句子]：App 的外送匣（core `classifyOk`）只看前綴；詞元加在前綴後面，判定不能變。
  const pairs: [string, string][] = [
    ["blocked: tag 數超過上限", REJECT.tooManyTags],
    ["blocked: 收件人數超過上限", REJECT.tooManyRecipients],
    ["blocked: 事件過大", REJECT.eventTooLarge],
    ["blocked: 非本企業成員（allowlist）", REJECT.notAllowed],
    ["blocked: 此事件類型已被政策停用", REJECT.kindDisabled],
    ["blocked: 檔案事件未啟用（MAX_FILE_MB）", REJECT.filesDisabled],
    ["blocked: 檔案塊過大", REJECT.fileChunkTooLarge],
    ["invalid: 簽章驗證失敗", REJECT.badSignature],
    ["invalid: 時間戳超出允許範圍", REJECT.clockSkew],
    ["invalid: relay tag 未指向本站（NIP-62）", REJECT.vanishRelayTag],
    ["rate-limited: 發送過於頻繁，請稍後再試", REJECT.eventsRateLimited],
    ["auth-required: 請先認證（NIP-42）", REJECT.authRequired],
    ["restricted: 只能清除自己的資料（NIP-62）", REJECT.vanishSelfOnly],
    ["pow: 需要難度 8", powRejectMessage(8)],
    ["blocked: 取代事件遭拒（配額/大小/較舊）", ADDRESSABLE_REJECT.stale],
    ["blocked: 取代事件遭拒（配額/大小/較舊）", ADDRESSABLE_REJECT["too-large"]],
    ["blocked: 取代事件遭拒（配額/大小/較舊）", ADDRESSABLE_REJECT["address-quota"]],
    ["blocked: 取代事件遭拒（配額/大小/較舊）", ADDRESSABLE_REJECT["byte-quota"]],
    ["blocked: 取代事件遭拒（配額/大小/較舊）", ADDRESSABLE_REJECT.ceiling],
  ];
  it.each(pairs)("%s → %s", (old, now) => {
    expect(classifyOk(false, now)).toBe(classifyOk(false, old));
  });

  it("可尋址「已過期」從 blocked 變成 invalid：App 兩者都判永久失敗", () => {
    expect(classifyOk(false, ADDRESSABLE_REJECT.expired)).toBe(classifyOk(false, "blocked: 取代事件遭拒（配額/大小/較舊）"));
  });

  it("duplicate：舊的 OK false 與新的 OK true，App 都判為已確認", () => {
    expect(classifyOk(false, "duplicate: 事件重複")).toBe("confirmed");
    expect(classifyOk(true, REJECT.duplicate)).toBe("confirmed");
  });

  it("App 配對信令只認 /auth-required/ 就重送：新句子照樣命中", () => {
    expect(/auth-required/i.test(REJECT.authRequired)).toBe(true);
  });
});

const NOW = 1_700_000_000;
const EVENT = (e: NostrEvent) => JSON.stringify(["EVENT", e]);
const okOf = (out: ReturnType<RelayCore["handle"]>, id: string) =>
  out.find((o) => o.message[0] === "OK" && o.message[1] === id)?.message;

describe("可尋址被拒依原因拆開", () => {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: typeof DatabaseSyncType };
  const sqlStore = (opts: MessageStoreOptions): OfflineStore => {
    const db = new DatabaseSync(":memory:");
    return new SqlMessageStore((query, ...bindings) => {
      const stmt = db.prepare(query);
      if (/^\s*select/i.test(query)) return stmt.all(...bindings) as Record<string, unknown>[];
      stmt.run(...bindings);
      return [];
    }, opts);
  };
  const stores: [string, (opts: MessageStoreOptions) => OfflineStore][] = [
    ["MessageStore", (opts) => new MessageStore(opts)],
    ["SqlMessageStore", sqlStore],
  ];
  const addressable = (sk: Uint8Array, opts: { d?: string; size?: number; createdAt?: number; tags?: string[][] } = {}) =>
    finalizeEvent(
      {
        kind: 30078,
        created_at: opts.createdAt ?? NOW,
        tags: [["d", opts.d ?? "a"], ...(opts.tags ?? [])],
        content: "x".repeat(opts.size ?? 10),
      },
      sk,
    );

  for (const [name, make] of stores) {
    describe(name, () => {
      const send = (store: OfflineStore, e: NostrEvent) => {
        const core = new RelayCore({ store, now: () => NOW });
        core.connect("c");
        return okOf(core.handle("c", EVENT(e)), e.id);
      };

      it("較舊 → stale", () => {
        const store = make({});
        const sk = generateSecretKey();
        expect(send(store, addressable(sk))?.[2]).toBe(true);
        const older = addressable(sk, { createdAt: NOW - 10 });
        expect(send(store, older)).toEqual(["OK", older.id, false, ADDRESSABLE_REJECT.stale]);
        expect(store.putAddressableResult!(older, NOW)).toEqual({ ok: false, reason: "stale" });
      });

      it("單顆太大 → too-large", () => {
        const e = addressable(generateSecretKey(), { size: 1000 });
        expect(send(make({ addressableMaxBytes: 500 }), e)).toEqual(["OK", e.id, false, ADDRESSABLE_REJECT["too-large"]]);
      });

      it("位址數滿 → quota（位址數）", () => {
        const store = make({ addressablePerAuthor: 1 });
        const sk = generateSecretKey();
        expect(send(store, addressable(sk, { d: "a" }))?.[2]).toBe(true);
        const second = addressable(sk, { d: "b" });
        expect(send(store, second)).toEqual(["OK", second.id, false, ADDRESSABLE_REJECT["address-quota"]]);
      });

      it("每作者總量滿 → quota（總量）", () => {
        const store = make({ addressableBytesPerAuthor: 800 });
        const sk = generateSecretKey();
        expect(send(store, addressable(sk, { d: "a", size: 300 }))?.[2]).toBe(true);
        const second = addressable(sk, { d: "b", size: 300 });
        expect(send(store, second)).toEqual(["OK", second.id, false, ADDRESSABLE_REJECT["byte-quota"]]);
      });

      it("自帶的 expiration 已過 → invalid: expired:", () => {
        const e = addressable(generateSecretKey(), { tags: [["expiration", String(NOW - 1)]] });
        expect(send(make({}), e)).toEqual(["OK", e.id, false, EXPIRED_REJECT]);
      });

      it("嚴格平面的 DO 天花板滿 → ceiling；車道淘汰則照收", () => {
        const strict = make({ addressableMaxTotalBytes: 1500 });
        expect(send(strict, addressable(generateSecretKey(), { size: 800 }))?.[2]).toBe(true);
        const e = addressable(generateSecretKey(), { size: 800 });
        expect(send(strict, e)).toEqual(["OK", e.id, false, ADDRESSABLE_REJECT.ceiling]);
        const lane = make({ addressableMaxTotalBytes: 1500, ceilingEvicts: true });
        expect(send(lane, addressable(generateSecretKey(), { size: 800 }))?.[2]).toBe(true);
        expect(send(lane, addressable(generateSecretKey(), { size: 800 }))?.[2]).toBe(true);
      });

      it("putAddressable（boolean）照舊可用", () => {
        const store = make({ addressablePerAuthor: 1 });
        const sk = generateSecretKey();
        expect(store.putAddressable(addressable(sk, { d: "a" }), NOW)).toBe(true);
        expect(store.putAddressable(addressable(sk, { d: "b" }), NOW)).toBe(false);
      });
    });
  }

  it("只實作 boolean 的 store：回舊句子", () => {
    const store: OfflineStore = { put: () => true, putAddressable: () => false, query: () => [], prune: () => {}, vanish: () => 0 };
    const e = addressable(generateSecretKey());
    const core = new RelayCore({ store, now: () => NOW });
    core.connect("c");
    expect(okOf(core.handle("c", EVENT(e)), e.id)).toEqual(["OK", e.id, false, ADDRESSABLE_REJECT_GENERIC]);
  });
});

describe("duplicate 改回 OK true（NIP-01；SDK ADR 0038 決策 3）", () => {
  const wrap = () =>
    finalizeEvent({ kind: 1059, created_at: NOW, tags: [["p", "a".repeat(64)]], content: "x" }, generateSecretKey());

  it("重放窗內再送同一顆：OK true「duplicate: seen:」，不再扇出、不再寫庫", () => {
    const stored: string[] = [];
    const store: OfflineStore = {
      put: (e) => (stored.push(e.id), true),
      putAddressable: () => true,
      query: () => [],
      prune: () => {},
      vanish: () => 0,
    };
    const core = new RelayCore({ store, now: () => NOW, replayWindowSec: 3600 });
    core.connect("sender");
    core.connect("watcher");
    core.handle("watcher", JSON.stringify(["REQ", "s", { kinds: [1059] }]));
    const e = wrap();
    expect(core.handle("sender", EVENT(e))).toContainEqual({ to: "watcher", message: ["EVENT", "s", e] });
    expect(core.handle("sender", EVENT(e))).toEqual([{ to: "sender", message: ["OK", e.id, true, REJECT.duplicate] }]);
    expect(stored).toEqual([e.id]);
  });

  it("🔴 store 丟例外：這顆不留在重放快取（否則重送只會拿到 duplicate＝被當成送達）", () => {
    let explode = true;
    const store: OfflineStore = {
      put: () => {
        if (explode) throw new Error("SQLITE_FULL");
        return true;
      },
      putAddressable: () => true,
      query: () => [],
      prune: () => {},
      vanish: () => 0,
    };
    const core = new RelayCore({ store, now: () => NOW, replayWindowSec: 3600 });
    core.connect("sender");
    const e = wrap();
    expect(core.handle("sender", EVENT(e))).toEqual([{ to: "sender", message: ["NOTICE", REJECT.internal] }]);
    explode = false;
    expect(okOf(core.handle("sender", EVENT(e)), e.id)).toEqual(["OK", e.id, true, ""]);
  });

  it("被拒（ADR-0375）之後重送仍是收下；收下之後才是 duplicate", () => {
    let full = true;
    const store: OfflineStore = { put: () => !full, putAddressable: () => true, query: () => [], prune: () => {}, vanish: () => 0 };
    const core = new RelayCore({ store, now: () => NOW, replayWindowSec: 3600 });
    core.connect("sender");
    const e = wrap();
    expect(okOf(core.handle("sender", EVENT(e)), e.id)?.[3]).toBe(OFFLINE_CEILING_REJECT);
    full = false;
    expect(okOf(core.handle("sender", EVENT(e)), e.id)).toEqual(["OK", e.id, true, ""]);
    expect(okOf(core.handle("sender", EVENT(e)), e.id)).toEqual(["OK", e.id, true, REJECT.duplicate]);
  });
});

describe("RelayCore 送出的每一則拒收都帶詞元", () => {
  it("OK false、CLOSED、NOTICE 全部有前綴與詞元", () => {
    const core = new RelayCore({
      requireAuth: true,
      authChallenge: () => "ch",
      maxSubscriptions: 1,
      minPowDifficulty: 30,
      maxEventsPerMinute: 1000,
      now: () => NOW,
      store: new MessageStore(),
    });
    const sk = generateSecretKey();
    const messages: string[] = [];
    const collect = (out: ReturnType<RelayCore["handle"]>) => {
      for (const o of out) {
        const m = o.message;
        if (m[0] === "OK" && m[2] === false) messages.push(String(m[3]));
        if (m[0] === "CLOSED") messages.push(String(m[2]));
        if (m[0] === "NOTICE") messages.push(String(m[1]));
      }
    };
    core.connect("c", "relay.example");
    const e = finalizeEvent({ kind: 1, created_at: NOW, tags: [], content: "" }, sk);
    collect(core.handle("c", EVENT(e)));
    collect(core.handle("c", JSON.stringify(["REQ", "s", { kinds: [1] }])));
    collect(core.handle("c", JSON.stringify(["AUTH", buildAuthEvent("wrong", "wss://relay.example", sk)])));
    core.handle("c", JSON.stringify(["AUTH", buildAuthEvent("ch", "wss://relay.example", sk)]));
    collect(core.handle("c", JSON.stringify(["REQ", "s", { kinds: [1] }])));
    core.handle("c", JSON.stringify(["REQ", "ok", { authors: ["a".repeat(64)] }]));
    collect(core.handle("c", JSON.stringify(["REQ", "two", { authors: ["a".repeat(64)] }])));
    collect(core.handle("c", EVENT(e)));
    collect(core.handle("c", EVENT({ ...e, content: "tampered" })));
    collect(core.handle("c", "not json"));
    expect(messages.length).toBeGreaterThanOrEqual(8);
    for (const message of messages) expect(parse(message).token, message).toBeDefined();
  });
});
