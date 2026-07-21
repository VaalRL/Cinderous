import { ASSET_CHUNK_CHARS, contentHash, KIND, RelayClient, applyRosterRotations, generateSecretKey, getPublicKey, npubEncode, nsecDecode, nsecEncode, signOrgRoster, type NostrEvent, type RelayClientHandlers, wrapGroupControl, wrapGroupMessage, wrapMessage, wrapReceipt } from "@cinderous/core";
import { createInMemoryRelayNetwork, MessageStore } from "@cinderous/relay";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import type { ChatBackendEvents, ChatMessage } from "./types.js";
import {
  type CloseableRelayClient,
  IDENTITY_MISMATCH,
  IDENTITY_UNAVAILABLE,
  RelayChatBackend,
} from "./relay-backend.js";

const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };

describe("RelayChatBackend（真實後端 + 持久化）", () => {
  it("兩端經 relay 對話，收件端把寄件人放進**訊息請求**（ADR-0121）、雙方持久化", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");

    const bIncoming: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });

    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "嗨 Bob");

    // B 收到（真實 Gift Wrap 解密）
    expect(bIncoming.map((m) => m.text)).toContain("嗨 Bob");
    // A 端持久化 outgoing
    expect(storeA.loadMessages(b.self.pubkey).map((m) => m.text)).toEqual(["嗨 Bob"]);
    // ADR-0121：B 沒加過 A → A 進**請求區**，不是聯絡人清單（過去是自動加為聯絡人）。
    // 訊息本身照收並持久化——Nostr 上擋不掉，只是由使用者決定要不要理。
    expect(storeB.loadContacts()).toEqual([]);
    expect(storeB.loadRequests().map((c) => c.pubkey)).toContain(a.self.pubkey);
    expect(storeB.loadMessages(a.self.pubkey).map((m) => m.text)).toEqual(["嗨 Bob"]);

    a.stop();
    b.stop();
  });

  it("emoji blob backfill（ADR-0223）：A 索取 → B 回分塊 → A 驗整合性入快取＋onAssetCached", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const data = "data:image/gif;base64,R0lGODlhAQABAAAA" + "A".repeat(ASSET_CHUNK_CHARS + 500); // 合法 GIF 頭＋跨 2 塊
    const hash = contentHash(data);
    storeB.saveAssetBlobs([{ hash, data }]); // B 有 blob（emoji 寄件者）
    const cached: string[] = [];
    a.start({ ...noop, onAssetCached: (h) => cached.push(h) });
    b.start(noop);
    a.addContact(b.selfNpub);
    b.addContact(a.selfNpub); // 互為聯絡人（B 才回應）

    a.requestAsset(b.self.pubkey, hash);
    expect(cached).toContain(hash); // A 收齊＋整合性通過＋通知
    expect(storeA.loadAssetBlobs()).toEqual([{ hash, data }]); // 入快取

    a.stop();
    b.stop();
  });

  it("emoji blob backfill：B 沒有該 blob → A 快取仍空、不觸發 onAssetCached", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const cached: string[] = [];
    a.start({ ...noop, onAssetCached: (h) => cached.push(h) });
    b.start(noop);
    a.addContact(b.selfNpub);
    b.addContact(a.selfNpub);

    a.requestAsset(b.self.pubkey, "a".repeat(64));
    expect(cached).toEqual([]);
    expect(storeA.loadAssetBlobs()).toEqual([]);

    a.stop();
    b.stop();
  });

  it("emoji blob 首次推播（ADR-0223 P2b）：A 送含 ref 訊息 → B 主動收到 blob（不需索取）", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const data = "data:image/gif;base64,R0lGODlhAQABAAAA" + "A".repeat(ASSET_CHUNK_CHARS + 300); // 合法 GIF 頭
    const hash = contentHash(data);
    storeA.saveAssetBlobs([{ hash, data }]); // A 有 blob（emoji 作者）
    const cached: string[] = [];
    a.start(noop);
    b.start({ ...noop, onAssetCached: (h) => cached.push(h) });
    a.addContact(b.selfNpub);
    b.addContact(a.selfNpub);

    const text = `嗨 :dance:\nnb-assets:v1:${JSON.stringify({ dance: { label: "跳舞", ref: hash, format: "raster" } })}`;
    a.sendMessage(b.self.pubkey, text); // A 送含 ref 的訊息 → 主動推 blob

    expect(cached).toContain(hash); // B 主動收到（沒呼叫 requestAsset）
    expect(storeB.loadAssetBlobs()).toEqual([{ hash, data }]);

    a.stop();
    b.stop();
  });

  it("跨裝置 blob 自我 backfill（ADR-0224）：同身分另一台有 blob → requestAsset(self) 補齊", () => {
    const net = createInMemoryRelayNetwork();
    const sk = generateSecretKey();
    const nsec = nsecEncode(sk);
    const storeD1 = new MemoryStorage();
    storeD1.saveIdentity({ nsec, name: "我" });
    const storeD2 = new MemoryStorage();
    storeD2.saveIdentity({ nsec, name: "我" });
    const d1 = new RelayChatBackend(storeD1, (h) => net.connect("d1", h), "我");
    const d2 = new RelayChatBackend(storeD2, (h) => net.connect("d2", h), "我");
    const data = "data:image/gif;base64,R0lGODlhAQABAAAA" + "A".repeat(ASSET_CHUNK_CHARS + 400); // 合法 GIF 頭＋跨 2 塊
    const hash = contentHash(data);
    storeD1.saveAssetBlobs([{ hash, data }]); // 裝置 1 有 blob；裝置 2 沒有
    const cached: string[] = [];
    d1.start(noop);
    d2.start({ ...noop, onAssetCached: (h) => cached.push(h) });
    expect(d1.self.pubkey).toBe(d2.self.pubkey); // 同一身分＝兩台裝置

    d2.requestAsset(d2.self.pubkey, hash); // 向「自己」（＝其他裝置）索取
    expect(cached).toContain(hash); // 裝置 2 收齊＋整合性通過＋通知
    expect(storeD2.loadAssetBlobs()).toEqual([{ hash, data }]); // 入快取

    d1.stop();
    d2.stop();
  });

  it("超大像素 GIF blob（ADR-0226）：收端重組後不入快取", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const data = "data:image/gif;base64,R0lGODlh6APoAwAA"; // 1000x1000 GIF（超過 512）
    const hash = contentHash(data);
    storeA.saveAssetBlobs([{ hash, data }]);
    const cached: string[] = [];
    b.start({ ...noop, onAssetCached: (h) => cached.push(h) });
    a.start(noop);
    b.addContact(a.selfNpub);
    a.addContact(b.selfNpub);

    b.requestAsset(a.self.pubkey, hash);
    expect(cached).toEqual([]); // 收端像素超限、丟棄
    expect(storeB.loadAssetBlobs()).toEqual([]);

    a.stop();
    b.stop();
  });

  it("setSelfName（ADR-0144）：更新 self.name、落地本機、把新名廣播給聯絡人（ADR-0061）", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const bSawName: string[] = [];
    a.start(noop);
    b.start({ ...noop, onContacts: (cs) => cs.forEach((c) => c.pubkey === a.self.pubkey && bSawName.push(c.name)) });
    // 互為聯絡人：B 收下 A、A 收下 B（A 廣播 profile 的對象＝A 的聯絡人）。
    b.addContact(a.selfNpub);
    a.addContact(b.selfNpub);

    a.setSelfName("  Alicia  "); // 前後空白會被去除
    expect(a.self.name).toBe("Alicia"); // 記憶體更新
    expect(storeA.loadIdentity()?.name).toBe("Alicia"); // 落地本機（nsec 不動）
    expect(bSawName).toContain("Alicia"); // 廣播到聯絡人 → B 更新 A 的顯示名稱

    // 空白或未變動 → 忽略（不重複廣播）。
    const before = bSawName.length;
    a.setSelfName("   ");
    a.setSelfName("Alicia");
    expect(bSawName.length).toBe(before);

    a.stop();
    b.stop();
  });

  it("setContactAlias（ADR-0148）：本地暱稱純本地、不外送；對方廣播改名不覆寫暱稱；清除退回廣播名", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const aSawB: { name: string; alias: string | undefined }[] = [];
    a.start({ ...noop, onContacts: (cs) => cs.forEach((c) => c.pubkey === b.self.pubkey && aSawB.push({ name: c.name, alias: c.alias })) });
    b.start(noop);
    // 互為聯絡人。順序要點（ADR-0061）：A 先加 B（A 名冊有 B）→ B 再加 A 時把 B 的 profile
    // 送給 A，A 才會把 B 的顯示名更新成廣播名 "Bob"（否則 B 的 profile 早於 A 收下 B 就被忽略）。
    a.addContact(b.selfNpub);
    b.addContact(a.selfNpub);
    const last = () => aSawB[aSawB.length - 1]!;

    a.setContactAlias(b.self.pubkey, "  我叫他阿伯 "); // 前後空白去除
    expect(last()).toMatchObject({ name: "Bob", alias: "我叫他阿伯" }); // 廣播名保留、暱稱另存
    expect(storeA.loadContacts().find((c) => c.pubkey === b.self.pubkey)?.alias).toBe("我叫他阿伯"); // 落地本機
    // 🔴 純本地：暱稱**絕不外送**——B 對 A 的聯絡人紀錄沒有任何 alias。
    expect(storeB.loadContacts().find((c) => c.pubkey === a.self.pubkey)?.alias).toBeUndefined();

    // 對方廣播改名（ADR-0061）→ A 更新廣播名，但**暱稱不動**。
    b.setSelfName("Bobby");
    expect(last()).toMatchObject({ name: "Bobby", alias: "我叫他阿伯" });

    // 清除暱稱 → 退回廣播名。
    a.setContactAlias(b.self.pubkey, "");
    expect(last().alias).toBeUndefined();
    expect(last().name).toBe("Bobby");

    a.stop();
    b.stop();
  });

  it("setContactNotifySound（ADR-0149）：依聯絡人通知音效純本地、不外送；清除退回全域", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const aSawB: { notifySound: string | undefined }[] = [];
    a.start({ ...noop, onContacts: (cs) => cs.forEach((c) => c.pubkey === b.self.pubkey && aSawB.push({ notifySound: c.notifySound })) });
    b.start(noop);
    a.addContact(b.selfNpub);
    b.addContact(a.selfNpub);
    const last = () => aSawB[aSawB.length - 1]!;

    a.setContactNotifySound(b.self.pubkey, "bell");
    expect(last().notifySound).toBe("bell"); // DTO 帶出，UI 收訊時查表用
    expect(storeA.loadContacts().find((c) => c.pubkey === b.self.pubkey)?.notifySound).toBe("bell"); // 落地本機
    // 🔴 純本地：音效偏好**絕不外送**——B 對 A 的聯絡人紀錄沒有任何 notifySound。
    expect(storeB.loadContacts().find((c) => c.pubkey === a.self.pubkey)?.notifySound).toBeUndefined();

    // 清除 → 欄位移除，播放時退回全域預設。
    a.setContactNotifySound(b.self.pubkey, undefined);
    expect(last().notifySound).toBeUndefined();

    a.stop();
    b.stop();
  });

  it("setSelfAvatar（ADR-0154）：頭像隨加密個人檔廣播；移除記號讓對方清掉；壞格式拒絕", () => {
    const AVATAR = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const bSawA: (string | undefined)[] = [];
    a.start(noop);
    b.start({ ...noop, onContacts: (cs) => cs.forEach((c) => c.pubkey === a.self.pubkey && bSawA.push(c.avatar)) });
    b.addContact(a.selfNpub);
    a.addContact(b.selfNpub);

    // 壞格式（非白名單 data URI）→ 拒絕不套用
    expect(a.setSelfAvatar("https://evil.example/x.jpg")).toBe(false);
    expect(a.selfAvatar()).toBeUndefined();

    // 設定 → 落地本機、全量重播 → B 的聯絡人紀錄長出頭像
    expect(a.setSelfAvatar(AVATAR)).toBe(true);
    expect(a.selfAvatar()).toBe(AVATAR);
    expect(storeA.loadSelfAvatar()).toBe(AVATAR);
    expect(bSawA).toContain(AVATAR);
    expect(storeB.loadContacts().find((c) => c.pubkey === a.self.pubkey)?.avatar).toBe(AVATAR);

    // 移除 → 持久化 ""（持續廣播移除記號）→ B 端清掉
    expect(a.setSelfAvatar(undefined)).toBe(true);
    expect(a.selfAvatar()).toBeUndefined();
    expect(storeA.loadSelfAvatar()).toBe("");
    expect(storeB.loadContacts().find((c) => c.pubkey === a.self.pubkey)?.avatar).toBeUndefined();

    // 廣播頭像與名稱互不干擾；B 對 A 的頭像純收方持有，A 端不受 B 影響
    expect(a.self.name).toBe("Alice");
    a.stop();
    b.stop();
  });

  it("setSelfTitle（ADR-0158）：頭銜隨加密個人檔廣播、清洗截斷；移除記號讓對方清掉；隨儲存重啟仍在", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start(noop);
    b.addContact(a.selfNpub);
    a.addContact(b.selfNpub);

    a.setSelfTitle("  後端   工程師 "); // 清洗：收斂空白＋修剪
    expect(a.selfTitle()).toBe("後端 工程師");
    expect(storeA.loadSelfTitle()).toBe("後端 工程師");
    expect(storeB.loadContacts().find((c) => c.pubkey === a.self.pubkey)?.title).toBe("後端 工程師");

    // 重啟：持久化頭銜跟著回來（送給晚加入的聯絡人也帶）。
    a.stop();
    const a2 = new RelayChatBackend(storeA, (h) => net.connect("a2", h), "Alice");
    a2.start(noop);
    expect(a2.selfTitle()).toBe("後端 工程師");

    // 移除 → 持久化 ""，對方清掉。
    a2.setSelfTitle(undefined);
    expect(storeA.loadSelfTitle()).toBe("");
    expect(storeB.loadContacts().find((c) => c.pubkey === a2.self.pubkey)?.title).toBeUndefined();
    a2.stop();
    b.stop();
  });

  it("開機廣播帶頭像（ADR-0154）：重啟後的 backend 仍把持久化頭像送給晚加入的聯絡人", () => {
    const AVATAR = "data:image/png;base64,iVBORw0KGgo=";
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    storeA.saveSelfAvatar(AVATAR); // 模擬上次 session 設定過
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start(noop);
    b.addContact(a.selfNpub);
    a.addContact(b.selfNpub); // 加好友即送 profile（帶持久化頭像）
    expect(storeB.loadContacts().find((c) => c.pubkey === a.self.pubkey)?.avatar).toBe(AVATAR);
    a.stop();
    b.stop();
  });

  it("入職邀請自動核准（ADR-0156）：成員憑權杖入職 → 企業主自動併入名冊、互為聯絡人、同事自動同步；壞權杖忽略；重啟不失憶", () => {
    const net = createInMemoryRelayNetwork();
    const token = "tok-secret-123";
    const storeO = new MemoryStorage();
    const owner = new RelayChatBackend(storeO, (h) => net.connect("o", h), "老闆", {
      orgOwner: true,
      orgInviteToken: token,
    });
    owner.start(noop);
    // 企業主先發佈只有自己的首份名冊（0155 流程：建立身分即開名冊管理），
    // 含公司設定（ADR-0157）：歡迎詞＋表定上下班時間。
    owner.publishRoster("小公司", [{ pubkey: owner.self.pubkey, name: "老闆" }], undefined, undefined, {
      welcome: "歡迎加入小公司！",
      workHours: { start: "09:00", end: "18:00" },
    });

    // 成員 A 憑邀請碼建立（orgAdminPubkey＋orgJoinToken）→ 開機自動送入職請求。
    const storeA = new MemoryStorage();
    const aOrgInfo: { org: string; members: string[]; welcome?: string; workHours?: { start: string; end: string } }[] = [];
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "小美", {
      orgAdminPubkey: owner.self.pubkey,
      orgJoinToken: token,
    });
    a.start({ ...noop, onOrgInfo: (info) => aOrgInfo.push(info) });
    // 組織資訊（ADR-0157）：採用名冊即發出——公司名/歡迎詞/班表/在世成員。
    const lastInfo = () => aOrgInfo[aOrgInfo.length - 1]!;
    expect(lastInfo().org).toBe("小公司");
    expect(lastInfo().welcome).toBe("歡迎加入小公司！");
    expect(lastInfo().workHours).toEqual({ start: "09:00", end: "18:00" });
    expect(lastInfo().members).toContain(a.self.pubkey); // 自動核准後的名冊含自己
    // 自動核准：企業主名冊長出 A、A 成為企業主聯絡人（帶名冊名，不是 shortNpub）。
    expect(storeO.loadContacts().find((c) => c.pubkey === a.self.pubkey)?.name).toBe("小美");
    // A 端採用重發的名冊 → 老闆自動成為 A 的聯絡人。
    expect(storeA.loadContacts().map((c) => c.pubkey)).toContain(owner.self.pubkey);

    // 成員 B 加入 → A 不用做任何事，自動長出同事 B。
    const storeB = new MemoryStorage();
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "阿強", {
      orgAdminPubkey: owner.self.pubkey,
      orgJoinToken: token,
    });
    b.start(noop);
    expect(storeA.loadContacts().map((c) => c.pubkey)).toContain(b.self.pubkey);
    expect(storeB.loadContacts().map((c) => c.pubkey)).toContain(a.self.pubkey);
    // ADR-0157：自動核准重發**保留**公司設定（歡迎詞/班表不被洗掉）。
    expect(lastInfo().welcome).toBe("歡迎加入小公司！");
    expect(lastInfo().workHours).toEqual({ start: "09:00", end: "18:00" });
    // ADR-0157：企業主端 currentRoster 供名冊視窗預填。
    expect(owner.currentRoster()?.welcome).toBe("歡迎加入小公司！");
    expect(owner.currentRoster()?.members.map((m) => m.pubkey)).toContain(b.self.pubkey);

    // 壞權杖：不入冊、不成為聯絡人（撿到管理者 npub 不能憑空入冊）。
    const evil = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("e", h), "壞人", {
      orgAdminPubkey: owner.self.pubkey,
      orgJoinToken: "wrong-token",
    });
    evil.start(noop);
    expect(storeO.loadContacts().some((c) => c.pubkey === evil.self.pubkey)).toBe(false);

    // 企業主重啟（lastRoster 記憶體失憶）→ 從中繼站訂回自己的可取代名冊 → 仍能自動核准。
    owner.stop();
    const owner2 = new RelayChatBackend(storeO, (h) => net.connect("o2", h), "老闆", {
      orgOwner: true,
      orgInviteToken: token,
    });
    owner2.start(noop);
    const storeC = new MemoryStorage();
    const c = new RelayChatBackend(storeC, (h) => net.connect("c", h), "新人", {
      orgAdminPubkey: owner2.self.pubkey,
      orgJoinToken: token,
    });
    c.start(noop);
    expect(storeO.loadContacts().find((x) => x.pubkey === c.self.pubkey)?.name).toBe("新人");
    expect(storeC.loadContacts().map((x) => x.pubkey)).toContain(a.self.pubkey); // 新人也自動同步既有同事

    a.stop();
    b.stop();
    evil.stop();
    c.stop();
    owner2.stop();
  });

  it("封鎖時機一致（審查修正）：首發前才封鎖的待入職者，不進簽章名冊/allowlist", () => {
    const net = createInMemoryRelayNetwork();
    const token = "tok-blk";
    const storeO = new MemoryStorage();
    const owner = new RelayChatBackend(storeO, (h) => net.connect("o", h), "老闆", {
      orgOwner: true,
      orgInviteToken: token,
    });
    owner.start(noop);
    // 成員送入職（此時 owner 尚未發首份名冊 → 進 pendingJoins）。
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "小美", {
      orgAdminPubkey: owner.self.pubkey,
      orgJoinToken: token,
    });
    a.start(noop);
    // 管理者在首發前封鎖該成員。
    owner.blockContact(a.self.pubkey);
    // 首次發佈名冊 → pendingJoins 併入時應排除被封鎖者。
    owner.publishRoster("小公司", [{ pubkey: owner.self.pubkey, name: "老闆" }]);
    expect(owner.currentRoster()?.members.some((m) => m.pubkey === a.self.pubkey)).toBe(false);
    a.stop();
    owner.stop();
  });

  it("入職金鑰託管（ADR-0163）：公司帳號成員入職 → 管理者收 onOrgEscrow（nsec 對回成員）；未 escrow 不帶；一般身分不觸發", () => {
    const net = createInMemoryRelayNetwork();
    const token = "tok-escrow";
    const escrows: { pubkey: string; nsec: string; name: string }[] = [];
    const owner = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("o", h), "老闆", {
      orgOwner: true,
      orgInviteToken: token,
    });
    owner.start({ ...noop, onOrgEscrow: (e) => escrows.push({ pubkey: e.pubkey, nsec: e.nsec, name: e.name }) });
    owner.publishRoster("小公司", [{ pubkey: owner.self.pubkey, name: "老闆" }]);

    // 公司帳號成員（orgEscrow=true）→ 入職帶 nsec 託管。
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "小美", {
      orgAdminPubkey: owner.self.pubkey,
      orgJoinToken: token,
      orgEscrow: true,
    });
    a.start(noop);
    expect(escrows.length).toBe(1);
    expect(escrows[0]!.pubkey).toBe(a.self.pubkey);
    expect(escrows[0]!.name).toBe("小美");
    // 託管 nsec 必須對回成員 pubkey（防塞他人金鑰）。
    expect(getPublicKey(nsecDecode(escrows[0]!.nsec))).toBe(a.self.pubkey);

    // 一般工作身分（無 orgEscrow）入職 → 不託管。
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "阿強", {
      orgAdminPubkey: owner.self.pubkey,
      orgJoinToken: token,
    });
    b.start(noop);
    expect(escrows.length).toBe(1); // 沒有新增

    a.stop();
    b.stop();
    owner.stop();
  });

  it("NIP-42 AUTH（ADR-0057）：requireAuth 下兩端仍能對話（自動認證 + 認證後訂閱）", () => {
    const net = createInMemoryRelayNetwork({ requireAuth: true });
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const bIncoming: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });

    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "authed 嗨");

    // 認證透明完成：Bob 仍收到訊息、雙方持久化
    expect(bIncoming.map((m) => m.text)).toContain("authed 嗨");
    expect(storeB.loadMessages(a.self.pubkey).map((m) => m.text)).toEqual(["authed 嗨"]);
    a.stop();
    b.stop();
  });

  it("回應：Bob 對 Alice 的訊息按 emoji，Alice 收到 onReaction", () => {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const aReactions: { mid: string; emoji: string; mine: boolean }[] = [];
    const bIncoming: ChatMessage[] = [];
    a.start({ ...noop, onReaction: (mid, emoji, mine) => aReactions.push({ mid, emoji, mine }) });
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });

    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "hi");
    const mid = bIncoming[0]!.id;
    b.sendReaction(a.self.pubkey, mid, "👍");

    expect(aReactions).toContainEqual({ mid, emoji: "👍", mine: false });
    a.stop();
    b.stop();
  });

  it("群組（M9）：Alice 建群 + 送群訊，Bob 與 Carol 皆收到並帶 sender", () => {
    const net = createInMemoryRelayNetwork();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const c = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("c", h), "Carol");

    const bGroups: string[] = [];
    const cGroups: string[] = [];
    const bMsgs: { pk: string; m: ChatMessage }[] = [];
    const cMsgs: { pk: string; m: ChatMessage }[] = [];
    a.start(noop);
    b.start({ ...noop, onGroups: (gs) => bGroups.push(...gs.map((g) => g.id)), onMessage: (pk, m) => bMsgs.push({ pk, m }) });
    c.start({ ...noop, onGroups: (gs) => cGroups.push(...gs.map((g) => g.id)), onMessage: (pk, m) => cMsgs.push({ pk, m }) });

    a.createGroup("好友", [b.self.pubkey, c.self.pubkey]);
    // Bob、Carol 收到 group-create
    expect(bGroups.length).toBeGreaterThan(0);
    expect(cGroups.length).toBeGreaterThan(0);
    const gid = bGroups[0]!;

    a.sendGroupMessage(gid, "嗨大家");
    const bGot = bMsgs.find((x) => x.pk === gid && x.m.text === "嗨大家");
    const cGot = cMsgs.find((x) => x.pk === gid && x.m.text === "嗨大家");
    expect(bGot?.m.sender).toBe(a.self.pubkey);
    expect(cGot?.m.sender).toBe(a.self.pubkey);
    // Bob 端持久化群訊於 groupId 之下
    expect(storeB.loadMessages(gid).map((m) => m.text)).toContain("嗨大家");

    a.stop();
    b.stop();
    c.stop();
  });

  it("群組成員管理（M9）：管理者加入新成員→其實例化群；移除成員→該成員退群", () => {
    const net = createInMemoryRelayNetwork();
    const storeC = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const c = new RelayChatBackend(storeC, (h) => net.connect("c", h), "Carol");
    const bGroups: string[] = [];
    a.start(noop);
    b.start({ ...noop, onGroups: (gs) => bGroups.push(...gs.map((g) => g.id)) });
    c.start(noop);

    a.createGroup("小群", [b.self.pubkey]); // 僅 Alice、Bob
    const gid = bGroups[0]!;
    expect(storeC.loadGroups()).toEqual([]); // Carol 尚未在群

    // 加入 Carol → Carol 端實例化該群、成員含三人
    a.addGroupMember(gid, c.self.pubkey);
    const cg = storeC.loadGroups().find((g) => g.id === gid);
    expect(cg?.members).toContain(c.self.pubkey);
    expect(cg?.members).toContain(b.self.pubkey);

    // 移除 Carol → Carol 端退出該群
    a.removeGroupMember(gid, c.self.pubkey);
    expect(storeC.loadGroups().find((g) => g.id === gid)).toBeUndefined();

    a.stop();
    b.stop();
    c.stop();
  });

  it("群組成員管理：組織群（org）拒絕手動增/移成員（名冊權威，ADR-0049）", () => {
    const net = createInMemoryRelayNetwork();
    const adminSk = generateSecretKey();
    const admin = getPublicKey(adminSk);
    const store = new MemoryStorage();
    // 身分即為 orgAdmin；採用自己名冊的組織群（org:true）。
    store.saveIdentity({ nsec: nsecEncode(adminSk), name: "Admin" });
    const backend = new RelayChatBackend(store, (h) => net.connect("admin", h), "Admin", { orgAdminPubkey: admin });
    backend.start(noop);
    const other = getPublicKey(generateSecretKey());
    backend.publishRoster("Acme", [{ pubkey: admin, name: "Admin" }], undefined, [
      { id: "dept", name: "部門", members: [admin] },
    ]);
    expect(store.loadGroups().find((g) => g.id === "dept")?.org).toBe(true);

    // 手動加人/移人皆被拒（成員清單不變）。
    backend.addGroupMember("dept", other);
    expect(store.loadGroups().find((g) => g.id === "dept")?.members).not.toContain(other);
    backend.removeGroupMember("dept", admin);
    expect(store.loadGroups().find((g) => g.id === "dept")?.members).toContain(admin);
    backend.stop();
  });

  it("群組成員管理：非管理者呼叫 add 無效", () => {
    const net = createInMemoryRelayNetwork();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const bGroups: string[] = [];
    a.start(noop);
    b.start({ ...noop, onGroups: (gs) => bGroups.push(...gs.map((g) => g.id)) });
    a.createGroup("小群", [b.self.pubkey]);
    const gid = bGroups[0]!;
    const dave = getPublicKey(generateSecretKey());
    b.addGroupMember(gid, dave); // Bob 非管理者
    expect(storeB.loadGroups().find((g) => g.id === gid)?.members).not.toContain(dave);
    a.stop();
    b.stop();
  });

  it("對話串（ADR-0051）：Alice 對 Bob 的回覆帶 replyTo，Bob 收到並持久化", () => {
    const net = createInMemoryRelayNetwork();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const bMsgs: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bMsgs.push(m) });

    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "串回覆", undefined, undefined, "root-1");

    const got = bMsgs.find((m) => m.text === "串回覆");
    expect(got?.replyTo).toBe("root-1");
    expect(storeB.loadMessages(a.self.pubkey).find((m) => m.text === "串回覆")?.replyTo).toBe("root-1");
    a.stop();
    b.stop();
  });

  it("@提及（ADR-0050）：Alice 群訊提及 Bob，Bob 收到 mentionsMe，Carol 沒有", () => {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const c = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("c", h), "Carol");

    const bGroups: string[] = [];
    const bMsgs: ChatMessage[] = [];
    const cMsgs: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onGroups: (gs) => bGroups.push(...gs.map((g) => g.id)), onMessage: (_pk, m) => bMsgs.push(m) });
    c.start({ ...noop, onMessage: (_pk, m) => cMsgs.push(m) });

    a.createGroup("好友", [b.self.pubkey, c.self.pubkey]);
    const gid = bGroups[0]!;
    a.sendGroupMessage(gid, "@Bob 看這個", [b.self.pubkey]);

    expect(bMsgs.find((m) => m.text === "@Bob 看這個")?.mentionsMe).toBe(true);
    expect(cMsgs.find((m) => m.text === "@Bob 看這個")?.mentionsMe).toBeUndefined();

    a.stop();
    b.stop();
    c.stop();
  });

  it("群組授權：非成員（含陌生人）的群訊被拒收（#3）", () => {
    const net = createInMemoryRelayNetwork();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const bGroups: string[] = [];
    const bMsgs: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onGroups: (gs) => bGroups.push(...gs.map((g) => g.id)), onMessage: (_pk, m) => bMsgs.push(m) });

    a.createGroup("私群", [b.self.pubkey]); // 成員僅 Alice、Bob
    const gid = bGroups[0]!;

    // 陌生人 Dave（非成員）自組同 id 群、對 Bob 扇出群訊
    const daveSk = generateSecretKey();
    const davePk = getPublicKey(daveSk);
    const fake = { id: gid, name: "x", admin: davePk, members: [davePk, b.self.pubkey] };
    const daveClient = net.connect("dave", { onEvent: () => {} });
    for (const evt of wrapGroupMessage("惡意群訊", daveSk, davePk, fake).events) daveClient.publish(evt);

    // 合法成員 Alice 的群訊仍正常送達
    a.sendGroupMessage(gid, "正常");

    expect(bMsgs.some((m) => m.text === "正常")).toBe(true);
    expect(bMsgs.some((m) => m.text === "惡意群訊")).toBe(false); // Dave 非成員 → 被拒
    a.stop();
    b.stop();
  });

  it("群組授權：不在名單的 group-create 不會讓你入群（#1）", () => {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const bGroups: string[][] = [];
    a.start(noop);
    b.start({ ...noop, onGroups: (gs) => bGroups.push(gs.map((g) => g.id)) });

    // Alice 建一個「不含 Bob」的群 → Bob 不應被加入
    const cSk = generateSecretKey();
    a.createGroup("沒有Bob", [getPublicKey(cSk)]);
    const joined = bGroups.flat();
    expect(joined.length).toBe(0);
    a.stop();
    b.stop();
  });

  it("收回：Alice 收回訊息，Bob 收到 onUnsend 並持久化", () => {
    const net = createInMemoryRelayNetwork();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const bIncoming: ChatMessage[] = [];
    const bUnsent: string[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m), onUnsend: (mid) => bUnsent.push(mid) });

    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "誤傳");
    const mid = bIncoming[0]!.id;
    a.unsendMessage(b.self.pubkey, mid);

    expect(bUnsent).toContain(mid);
    expect(storeB.loadDeleted()).toContain(mid);
    a.stop();
    b.stop();
  });

  it("限時訊息：帶 ttl 送出，兩端訊息帶 expiresAt 且持久化", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const bIncoming: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });

    a.addContact(b.selfNpub);
    const before = Date.now();
    a.sendMessage(b.self.pubkey, "閱後即焚", 60);

    // Bob 收到並帶到期時間（約 60 秒後）
    const got = bIncoming.find((m) => m.text === "閱後即焚");
    expect(got?.expiresAt).toBeDefined();
    expect(got!.expiresAt!).toBeGreaterThanOrEqual(before + 60_000 - 2_000);
    // Alice 端持久化亦帶 expiresAt
    expect(storeA.loadMessages(b.self.pubkey)[0]?.expiresAt).toBeDefined();
    a.stop();
    b.stop();
  });

  it("封鎖：被封鎖者的訊息不再送達，且進入封鎖名單", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const aIncoming: ChatMessage[] = [];
    const aBlocked: string[] = [];
    a.start({ ...noop, onMessage: (_pk, m) => aIncoming.push(m), onBlocked: (list) => (aBlocked.length = 0, aBlocked.push(...list.map((x) => x.pubkey))) });
    b.start(noop);

    a.blockContact(b.self.pubkey);
    b.sendMessage(a.self.pubkey, "你看得到嗎");

    expect(aIncoming.find((m) => m.text === "你看得到嗎")).toBeUndefined();
    expect(aBlocked).toContain(b.self.pubkey);
    expect(storeA.loadContacts().some((c) => c.pubkey === b.self.pubkey)).toBe(false);

    a.unblockContact(b.self.pubkey);
    expect(aBlocked).not.toContain(b.self.pubkey);
    a.stop();
    b.stop();
  });

  it("刪除聯絡人：清單移除、對話清空", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "hi");
    expect(storeA.loadMessages(b.self.pubkey).length).toBe(1);

    a.removeContact(b.self.pubkey);
    expect(storeA.loadContacts().some((c) => c.pubkey === b.self.pubkey)).toBe(false);
    expect(storeA.loadMessages(b.self.pubkey)).toEqual([]);
    a.stop();
    b.stop();
  });

  it("身分持久化：以同一儲存重建後端 → npub 不變、歷史保留", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const a1 = new RelayChatBackend(store, (h) => net.connect("a1", h), "Alice");
    const npub1 = a1.selfNpub;
    a1.start(noop);
    a1.addContact(new RelayChatBackend(new MemoryStorage(), (h) => net.connect("x", h), "X").selfNpub);
    a1.stop();

    const a2 = new RelayChatBackend(store, (h) => net.connect("a2", h), "Alice");
    expect(a2.selfNpub).toBe(npub1);
    expect(store.loadContacts().length).toBe(1);
    a2.stop();
  });

  it("啟動回放：歷史以 onHistory 批次交付、回放期間不逐則 onMessage（P0-2）", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", h), "Bob");
    bob.start(noop);
    const a1 = new RelayChatBackend(store, (h) => net.connect("a1", h), "Alice");
    a1.start(noop);
    a1.addContact(bob.selfNpub);
    a1.sendMessage(bob.self.pubkey, "一");
    a1.sendMessage(bob.self.pubkey, "二");
    a1.stop();

    const history: { pk: string; ids: string[] }[] = [];
    const live: string[] = [];
    const a2 = new RelayChatBackend(store, (h) => net.connect("a2", h), "Alice");
    a2.start({
      ...noop,
      onHistory: (pk, msgs) => history.push({ pk, ids: msgs.map((m) => m.id) }),
      onMessage: (_pk, m) => live.push(m.id),
    });
    const conv = history.find((h) => h.pk === bob.self.pubkey);
    expect(conv?.ids.length).toBe(2); // 一次批次交付兩則
    expect(live).toEqual([]); // 回放不逐則 onMessage
    a2.stop();
    bob.stop();
  });

  it("工作身分自動採用管理者名冊、匯入通訊錄並撤銷離職者（ADR-0047）", () => {
    const net = createInMemoryRelayNetwork();
    const adminSk = generateSecretKey();
    const admin = getPublicKey(adminSk);
    const store = new MemoryStorage();
    const work = new RelayChatBackend(store, (h) => net.connect("work", h), "Worker", { orgAdminPubkey: admin });
    work.start(noop);
    const memberA = getPublicKey(generateSecretKey());
    const memberB = getPublicKey(generateSecretKey());

    net
      .connect("admin")
      .publish(signOrgRoster({ org: "Acme", members: [{ pubkey: memberA, name: "Alice" }, { pubkey: memberB, name: "Bob" }], updatedAt: 1000 }, adminSk));
    expect(store.loadContacts().map((c) => c.pubkey).sort()).toEqual([memberA, memberB].sort());

    // 較新名冊移除 Bob（離職）→ 撤銷聯絡人
    net.connect("admin2").publish(signOrgRoster({ org: "Acme", members: [{ pubkey: memberA, name: "Alice" }], updatedAt: 1001 }, adminSk));
    expect(store.loadContacts().map((c) => c.pubkey)).toEqual([memberA]);
    work.stop();
  });

  it("身分輪替（ADR-0052）：舊 npub→新 npub，歷史接續、通訊錄換人、觸發 onIdentityRotated", () => {
    const net = createInMemoryRelayNetwork();
    const adminSk = generateSecretKey();
    const admin = getPublicKey(adminSk);
    const store = new MemoryStorage();
    const rotations: { from: string; to: string; name: string }[] = [];
    const work = new RelayChatBackend(store, (h) => net.connect("work", h), "Worker", { orgAdminPubkey: admin });
    work.start({ ...noop, onIdentityRotated: (from, to, name) => rotations.push({ from, to, name }) });

    const aliceOld = getPublicKey(generateSecretKey());
    const aliceNew = getPublicKey(generateSecretKey());

    // v1：Alice 舊身分入通訊錄，並模擬既有對話歷史
    net.connect("admin").publish(signOrgRoster({ org: "Acme", members: [{ pubkey: aliceOld, name: "Alice" }], updatedAt: 1000 }, adminSk));
    expect(store.loadContacts().map((c) => c.pubkey)).toEqual([aliceOld]);
    store.appendMessage({ id: "m1", contact: aliceOld, outgoing: false, text: "早安", at: 1 });
    // 並模擬一個含 Alice 的群組與其群訊（驗證群成員與 sender 標籤一併 remap）
    store.saveGroup({ id: "grp", name: "研發", admin, members: [aliceOld, work.self.pubkey] });
    store.appendMessage({ id: "gm1", contact: "grp", outgoing: false, text: "群訊", at: 2, sender: aliceOld });

    // v2：Alice 輪替 aliceOld → aliceNew（舊標 supersededBy、新加入）
    net.connect("admin2").publish(
      signOrgRoster(
        {
          org: "Acme",
          members: [{ pubkey: aliceOld, name: "Alice", supersededBy: aliceNew }, { pubkey: aliceNew, name: "Alice" }],
          updatedAt: 1001,
        },
        adminSk,
      ),
    );

    expect(store.loadContacts().map((c) => c.pubkey)).toEqual([aliceNew]); // 通訊錄換成新 npub
    expect(store.loadMessages(aliceOld)).toEqual([]); // 舊對話已搬走
    expect(store.loadMessages(aliceNew).map((m) => m.id)).toEqual(["m1"]); // 歷史接續到新 npub
    expect(store.loadGroups().find((g) => g.id === "grp")?.members).toEqual([aliceNew, work.self.pubkey]); // 群成員 remap
    expect(store.loadMessages("grp").find((m) => m.id === "gm1")?.sender).toBe(aliceNew); // 群訊發送者標籤 remap
    expect(rotations).toEqual([{ from: aliceOld, to: aliceNew, name: "Alice" }]); // UI 通知
    work.stop();
  });

  it("佈建輪替（ADR-0052 #3）：管理者以 applyRosterRotations 發布、成員端接續、allowlist 只放行新 npub", () => {
    const net = createInMemoryRelayNetwork();
    const admin = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("admin", h), "Admin");
    admin.start(noop);

    const aliceOld = getPublicKey(generateSecretKey());
    const aliceNew = getPublicKey(generateSecretKey());

    // 成員端事先認得 Alice 舊身分（既有聯絡人＋歷史）——建構前先播種，建構子即載入。
    const memberStore = new MemoryStorage();
    memberStore.addContact({ pubkey: aliceOld, name: "Alice" });
    memberStore.appendMessage({ id: "m1", contact: aliceOld, outgoing: false, text: "hi", at: 1 });
    const rotations: { from: string; to: string }[] = [];
    const member = new RelayChatBackend(memberStore, (h) => net.connect("member", h), "Member", {
      orgAdminPubkey: admin.self.pubkey,
    });
    member.start({ ...noop, onIdentityRotated: (from, to) => rotations.push({ from, to }) });

    // 管理者用佈建輔助建立輪替名冊並發布；回傳 allowlist 只含新 npub。
    const rotated = applyRosterRotations([{ pubkey: aliceOld, name: "Alice" }], [{ from: aliceOld, to: aliceNew }]);
    const allow = admin.publishRoster("Acme", rotated);
    expect(allow).toContain(aliceNew);
    expect(allow).not.toContain(aliceOld); // 舊金鑰不再放行

    // 成員端接續：通訊錄換新、歷史搬移、觸發通知。
    expect(memberStore.loadContacts().map((c) => c.pubkey)).toEqual([aliceNew]);
    expect(memberStore.loadMessages(aliceNew).map((m) => m.id)).toEqual(["m1"]);
    expect(rotations).toEqual([{ from: aliceOld, to: aliceNew }]);
    admin.stop();
    member.stop();
  });

  it("addContact 擋加自己作用中身分（ADR-0055 self-guard）", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const backend = new RelayChatBackend(store, (h) => net.connect("me", h), "Me");
    backend.start(noop);
    backend.addContact(npubEncode(backend.self.pubkey)); // 加自己
    expect(store.loadContacts()).toEqual([]); // 未新增自己
    backend.stop();
  });
  it("管理者佈建：publishRoster 發布名冊、成員自動採用、回傳 allowlist（ADR-0047 收尾）", () => {
    const net = createInMemoryRelayNetwork();
    const admin = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("admin", h), "Admin");
    admin.start(noop);
    const memberStore = new MemoryStorage();
    const member = new RelayChatBackend(memberStore, (h) => net.connect("member", h), "Member", {
      orgAdminPubkey: admin.self.pubkey,
    });
    member.start(noop);

    const alice = getPublicKey(generateSecretKey());
    const allow = admin.publishRoster("Acme", [{ pubkey: alice, name: "Alice" }]);
    expect(allow).toContain(alice); // 回傳供 relay allowlist 佈建的 pubkey
    expect(memberStore.loadContacts().map((c) => c.pubkey)).toContain(alice); // 成員自動採用
    admin.stop();
    member.stop();
  });
  it("組織群組（ADR-0049）：名冊帶群→成員自動入群；公告群非管理者發文被擋", () => {
    const net = createInMemoryRelayNetwork();
    const adminSk = generateSecretKey();
    const admin = getPublicKey(adminSk);
    const store = new MemoryStorage();
    const member = new RelayChatBackend(store, (h) => net.connect("member", h), "Member", { orgAdminPubkey: admin });
    member.start(noop);
    const memberPk = member.self.pubkey;

    net.connect("admin").publish(
      signOrgRoster(
        {
          org: "Acme",
          members: [{ pubkey: memberPk, name: "M" }],
          groups: [{ id: "notice", name: "公告", members: [admin, memberPk], announce: true }],
          updatedAt: 1000,
        },
        adminSk,
      ),
    );

    // 成員自動入公告群
    expect(store.loadGroups().map((g) => g.id)).toContain("notice");
    expect(store.loadGroups().find((g) => g.id === "notice")?.announce).toBe(true);
    // 成員（非管理者）對公告群發文被擋 → 不持久化
    member.sendGroupMessage("notice", "我不該能發");
    expect(store.loadMessages("notice")).toEqual([]);
    member.stop();
  });
  it("企業政策（ADR-0048）：採用帶 forceTurn 的名冊 → onPolicy 收到 forceTurn（驅動 WebRTC relay-only）", () => {
    const net = createInMemoryRelayNetwork();
    const adminSk = generateSecretKey();
    const admin = getPublicKey(adminSk);
    let got: { forceTurn?: boolean } | undefined;
    const member = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("m", h), "M", { orgAdminPubkey: admin });
    member.start({ ...noop, onPolicy: (p) => { got = p; } });

    net.connect("admin").publish(
      signOrgRoster(
        {
          org: "Acme",
          members: [{ pubkey: member.self.pubkey, name: "M" }],
          policy: { forceTurn: true },
          updatedAt: 1000,
        },
        adminSk,
      ),
    );

    expect(got?.forceTurn).toBe(true);
    member.stop();
  });

  it("組織群組（ADR-0049）：管理者自建臨時群不因採用自己的名冊而被誤刪", () => {
    const net = createInMemoryRelayNetwork();
    const adminSk = generateSecretKey();
    const admin = getPublicKey(adminSk);
    const store = new MemoryStorage();
    // 讓後端身分即為管理者（self === orgAdminPubkey），重現管理者自身情境。
    store.saveIdentity({ nsec: nsecEncode(adminSk), name: "Admin" });
    const backend = new RelayChatBackend(store, (h) => net.connect("admin", h), "Admin", { orgAdminPubkey: admin });
    backend.start(noop);

    // 管理者自建一個臨時群（非組織名冊分發）。
    backend.createGroup("午餐團", [getPublicKey(generateSecretKey())]);
    const adhocId = store.loadGroups().find((g) => g.name === "午餐團")?.id;
    expect(adhocId).toBeTruthy();

    // 發布只含組織群「dept」的名冊——本機立即對帳。
    backend.publishRoster("Acme", [{ pubkey: admin, name: "Admin" }], undefined, [
      { id: "dept", name: "部門", members: [admin] },
    ]);

    const ids = store.loadGroups().map((g) => g.id);
    expect(ids).toContain("dept"); // 組織群已在本機生效
    expect(ids).toContain(adhocId); // 臨時群未被誤刪
    backend.stop();
  });
});

describe("送達/已讀回條（ADR-0058）", () => {
  const pair = () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    return { storeA, a, b };
  };

  it("Tier1+2：送出 → sent → delivered（同步網路一次到位）", () => {
    const { storeA, a, b } = pair();
    const statuses: string[] = [];
    a.start({ ...noop, onMessageStatus: (_c, _id, s) => statuses.push(s) });
    b.start(noop);
    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "hi");
    expect(storeA.loadMessages(b.self.pubkey)[0]?.status).toBe("delivered");
    expect(statuses).toContain("sent");
    expect(statuses).toContain("delivered");
    a.stop();
    b.stop();
  });

  it("Tier3：雙方開啟已讀 → markRead 後升為 read", () => {
    const { storeA, a, b } = pair();
    a.start(noop);
    b.start(noop);
    a.setReadReceipts?.(true);
    b.setReadReceipts?.(true);
    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "hi");
    b.acceptRequest?.(a.self.pubkey); // ADR-0121：請求區的訊息不送已讀回條，接受後才送
    b.markRead?.(a.self.pubkey);
    expect(storeA.loadMessages(b.self.pubkey)[0]?.status).toBe("read");
    a.stop();
    b.stop();
  });

  it("Tier3 互惠：a 關閉已讀 → 對方 markRead 不會升為 read（停在 delivered）", () => {
    const { storeA, a, b } = pair();
    a.start(noop);
    b.start(noop);
    b.setReadReceipts?.(true); // 只有 b 開；a 預設關
    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "hi");
    b.markRead?.(a.self.pubkey);
    expect(storeA.loadMessages(b.self.pubkey)[0]?.status).toBe("delivered");
    a.stop();
    b.stop();
  });
});

describe("群組快照廣播（ADR-0068）", () => {
  it("nsec 換機後：管理員重啟開機廣播，成員新裝置自動重建群組", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a1 = new RelayChatBackend(storeA, (h) => net.connect("a1", h), "Alice");
    const b1 = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b1", h), "Bob");
    a1.start(noop);
    b1.start(noop);
    a1.addContact(b1.selfNpub);
    a1.createGroup("讀書會", [b1.self.pubkey]);
    const gid = storeA.loadGroups()[0]!.id;
    a1.stop();
    b1.stop();

    // Bob 換機：全新儲存、同一把 nsec——群組不會自己長回來
    const storeB2 = new MemoryStorage();
    storeB2.saveIdentity({ nsec: b1.selfNsec, name: "Bob" });
    const b2 = new RelayChatBackend(storeB2, (h) => net.connect("b2", h), "Bob");
    b2.start(noop);
    expect(b2.self.pubkey).toBe(b1.self.pubkey);
    expect(storeB2.loadGroups()).toEqual([]);

    // 管理員重啟 → 開機快照廣播 → Bob 新裝置重建群組（名稱/成員/admin 正確）
    const a2 = new RelayChatBackend(storeA, (h) => net.connect("a2", h), "Alice");
    a2.start(noop);
    const restored = storeB2.loadGroups().find((g) => g.id === gid);
    expect(restored?.name).toBe("讀書會");
    expect(restored?.admin).toBe(a2.self.pubkey);
    expect(restored?.members).toContain(b2.self.pubkey);
    a2.stop();
    b2.stop();
  });

  it("假快照防護：前成員偽造快照不得改動既有群組（admin/名稱/成員不變）", () => {
    const net = createInMemoryRelayNetwork();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const c = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("c", h), "Carol");
    a.start(noop);
    b.start(noop);
    c.start(noop);
    a.addContact(b.selfNpub);
    a.addContact(c.selfNpub);
    a.createGroup("好友", [b.self.pubkey, c.self.pubkey]);
    const gid = storeB.loadGroups()[0]!.id;

    // Carol（知道群組 id 的成員）偽造快照：自立為 admin、踢掉 Alice
    const carolSk = (c as unknown as { sk: Uint8Array }).sk;
    const forged = wrapGroupControl(
      { type: "group-snapshot", id: gid, name: "被劫持", admin: c.self.pubkey, members: [c.self.pubkey, b.self.pubkey] },
      carolSk,
      [b.self.pubkey],
    );
    net.connect("forger", {}).publish(forged[0]!);

    const g = storeB.loadGroups().find((x) => x.id === gid)!;
    expect(g.admin).toBe(a.self.pubkey);
    expect(g.name).toBe("好友");
    expect(g.members).toContain(a.self.pubkey);
    a.stop();
    b.stop();
    c.stop();
  });
});

describe("加密雲端快照（ADR-0071）", () => {
  it("換機還原：舊機開啟完整模式重啟發佈快照，新裝置自動合併聯絡人/群組/訊息", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a1 = new RelayChatBackend(storeA, (h) => net.connect("a1", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const bIncoming: ChatMessage[] = [];
    a1.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });
    a1.addContact(b.selfNpub);
    a1.sendMessage(b.self.pubkey, "重要對話");
    a1.createGroup("讀書會", [b.self.pubkey]);
    a1.stop();

    // Alice 的新裝置（白紙）先上線訂閱自己的快照（接收合併恆開、不需設定）
    const storeA3 = new MemoryStorage();
    storeA3.saveIdentity({ nsec: a1.selfNsec, name: "Alice" });
    const a3 = new RelayChatBackend(storeA3, (h) => net.connect("a3", h), "Alice");
    const a3History: Record<string, ChatMessage[]> = {};
    let a3Mode: string | undefined;
    a3.start({ ...noop, onHistory: (pk, msgs) => (a3History[pk] = msgs), onCloudSyncMode: (m) => (a3Mode = m) });
    expect(storeA3.loadContacts()).toHaveLength(0);

    // 舊機開啟雲端快照（完整）重啟 → 開機發佈 → 新裝置即時合併
    const a2 = new RelayChatBackend(storeA, (h) => net.connect("a2", h), "Alice", {
      cloudSync: { mode: "full", deviceId: "desk" },
    });
    a2.start(noop);

    expect(storeA3.loadContacts().map((c) => c.pubkey)).toContain(b.self.pubkey);
    expect(storeA3.loadGroups().map((g) => g.name)).toContain("讀書會");
    expect(storeA3.loadMessages(b.self.pubkey).map((m) => m.text)).toContain("重要對話");
    expect(a3History[b.self.pubkey]?.map((m) => m.text)).toContain("重要對話"); // UI 歷史重放
    expect(a3Mode).toBe("full"); // 模式隨快照傳播（審查修正 #1：App 端於未設定時採用）
    a2.stop();
    a3.stop();
    b.stop();
  });

  it("關閉狀態對帳（審查修正 #6）：曾發佈快照、關閉後下次開機補發 purge", () => {
    const kv = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => kv.get(k) ?? null,
      setItem: (k: string, v: string) => void kv.set(k, v),
      removeItem: (k: string) => void kv.delete(k),
    };
    try {
      kv.set("nb.deviceId", "dev"); // 對帳與發佈使用同一裝置 id
      const net = createInMemoryRelayNetwork();
      const storeA = new MemoryStorage();
      const spied: NostrEvent[] = [];
      const spy = net.connect("spy", { onEvent: (_s, e) => spied.push(e) });
      spy.subscribe("s", [{ kinds: [30078] } as never]);

      const a1 = new RelayChatBackend(storeA, (h) => net.connect("a1", h), "Alice", {
        cloudSync: { mode: "basic", deviceId: "dev" },
      });
      a1.start(noop);
      a1.stop();
      expect(spied.filter((e) => e.content !== "")).toHaveLength(1); // 開機發佈（節流已記錄）

      // 使用者切關（假設 purge 因競態沒送出）→ 下次開機對帳補發
      const a2 = new RelayChatBackend(storeA, (h) => net.connect("a2", h), "Alice");
      a2.start(noop);
      a2.stop();
      expect(spied.some((e) => e.content === "")).toBe(true); // purge 補發
      expect([...kv.keys()].some((k) => k.startsWith("nb.snapPub."))).toBe(false); // 節流記錄清除
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it("基本模式不含訊息；快照事件對第三者只是密文", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a1 = new RelayChatBackend(storeA, (h) => net.connect("a1", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a1.start(noop);
    b.start(noop);
    a1.addContact(b.selfNpub);
    a1.sendMessage(b.self.pubkey, "祕密內容");
    a1.stop();

    // 側錄快照事件（開放模式無 AUTH——密文本身就是防線）
    const spied: NostrEvent[] = [];
    const spy = net.connect("spy", { onEvent: (_s, e) => spied.push(e) });
    spy.subscribe("s", [{ kinds: [30078] } as never]);

    const storeA3 = new MemoryStorage();
    storeA3.saveIdentity({ nsec: a1.selfNsec, name: "Alice" });
    const a3 = new RelayChatBackend(storeA3, (h) => net.connect("a3", h), "Alice");
    a3.start(noop);
    const a2 = new RelayChatBackend(storeA, (h) => net.connect("a2", h), "Alice", {
      cloudSync: { mode: "basic", deviceId: "desk" },
    });
    a2.start(noop);

    // 基本模式：聯絡人回來了、訊息沒有
    expect(storeA3.loadContacts().map((c) => c.pubkey)).toContain(b.self.pubkey);
    expect(storeA3.loadMessages(b.self.pubkey)).toHaveLength(0);
    // 第三者只見密文
    expect(spied.length).toBeGreaterThan(0);
    expect(JSON.stringify(spied)).not.toContain("祕密內容");
    expect(JSON.stringify(spied)).not.toContain(b.self.pubkey.slice(0, 16));
    a2.stop();
    a3.stop();
    b.stop();
  });
});

describe("顯示名稱個人檔（ADR-0061，加密廣播）", () => {
  it("單向加好友＝一則帶暱稱的請求；**B 接受後才回送個人檔**（ADR-0121）", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub); // 只有 A 主動加 B

    // B 學到「Alice」這個名字——但她停在**請求區**，還不是聯絡人。
    expect(storeB.loadContacts()).toEqual([]);
    expect(storeB.loadRequests().find((c) => c.pubkey === a.self.pubkey)?.name).toBe("Alice");

    // 而且 B **不回送**自己的個人檔：對還沒接受的陌生人回送，等於向他確認
    // 「這把金鑰是活的、有人在線上」——那正是垃圾訊息發送者最想要的回饋。
    expect(storeA.loadContacts().find((c) => c.pubkey === b.self.pubkey)?.name).not.toBe("Bob");

    // 接受之後才互換（ADR-0061 的效果回來了）。
    b.acceptRequest(a.self.pubkey);
    expect(storeB.loadContacts().find((c) => c.pubkey === a.self.pubkey)?.name).toBe("Alice");
    expect(storeA.loadContacts().find((c) => c.pubkey === b.self.pubkey)?.name).toBe("Bob");
    a.stop();
    b.stop();
  });
});

describe("群組送達/已讀分級（ADR-0095）", () => {
  it("小群（≤10）：成員收到群訊後回送達回條，發訊者記錄「誰送達」（每成員回條表）", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const c = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("c", h), "Carol");
    const bGroups: string[] = [];
    const aReceipts: { messageId: string; receipts: Record<string, string> }[] = [];
    a.start({ ...noop, onMessageReceipts: (_g, messageId, receipts) => aReceipts.push({ messageId, receipts }) });
    b.start({ ...noop, onGroups: (gs) => bGroups.push(...gs.map((g) => g.id)) });
    c.start(noop);

    a.createGroup("小群", [b.self.pubkey, c.self.pubkey]); // 3 人＝名單制
    const gid = bGroups[0]!;
    a.sendGroupMessage(gid, "嗨大家");

    // Bob、Carol 各自回一則送達回條 → Alice 端記錄兩位成員都已送達。
    const stored = storeA.loadMessages(gid).find((m) => m.outgoing);
    expect(stored?.receipts?.[b.self.pubkey]).toBe("delivered");
    expect(stored?.receipts?.[c.self.pubkey]).toBe("delivered");
    expect(aReceipts.length).toBeGreaterThan(0); // UI 有收到更新

    a.stop();
    b.stop();
    c.stop();
  });

  it("群訊 id 跨成員一致：收件端存的 id＝發訊者存的 id（回條才對得回來）", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const bGroups: string[] = [];
    a.start(noop);
    b.start({ ...noop, onGroups: (gs) => bGroups.push(...gs.map((g) => g.id)) });

    a.createGroup("兩人群", [b.self.pubkey]);
    const gid = bGroups[0]!;
    a.sendGroupMessage(gid, "同一則");

    const aId = storeA.loadMessages(gid).find((m) => m.outgoing)?.id;
    const bId = storeB.loadMessages(gid).find((m) => !m.outgoing)?.id;
    expect(aId).toBeDefined();
    expect(bId).toBe(aId); // 內層 rumor id（ADR-0095）

    a.stop();
    b.stop();
  });

  it("大群（>10）：完全不記——成員不回送達回條，發訊者沒有任何每成員回條", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    // 11 人群（含自己）→ mode = off
    const members: RelayChatBackend[] = [];
    for (let i = 0; i < 10; i++) {
      members.push(new RelayChatBackend(new MemoryStorage(), (h) => net.connect(`m${i}`, h), `M${i}`));
    }
    const firstGroups: string[] = [];
    a.start(noop);
    members.forEach((m, i) =>
      m.start(i === 0 ? { ...noop, onGroups: (gs) => firstGroups.push(...gs.map((g) => g.id)) } : noop),
    );

    a.createGroup("大群", members.map((m) => m.self.pubkey));
    const gid = firstGroups[0]!;
    a.sendGroupMessage(gid, "公告");

    const stored = storeA.loadMessages(gid).find((m) => m.outgoing);
    expect(stored?.text).toBe("公告"); // 訊息本身照常送達
    expect(stored?.receipts).toBeUndefined(); // 但完全不記回條（連送達都不送）

    a.stop();
    members.forEach((m) => m.stop());
  });
});

describe("檔案投遞與另存（ADR-0093）", () => {
  // 最小 RTCPeerConnection 樁：讓 sendFile 的 P2P 建連不拋錯。本測試只驗**中繼 metadata** 流程，
  // 不驗實際 P2P 位元組傳輸（node 無真實 WebRTC）——故收件端會停在「metadata-only／在另一台裝置」。
  class FakeDataChannel {
    readyState = "connecting";
    binaryType = "";
    onmessage: unknown = null;
    onopen: unknown = null;
    onerror: unknown = null;
    send(): void {}
    close(): void {}
  }
  class FakePeerConnection {
    onicecandidate: unknown = null;
    onconnectionstatechange: unknown = null;
    ondatachannel: unknown = null;
    connectionState = "new";
    createDataChannel(): FakeDataChannel {
      return new FakeDataChannel();
    }
    async createOffer(): Promise<{ type: string; sdp: string }> {
      return { type: "offer", sdp: "" };
    }
    async createAnswer(): Promise<{ type: string; sdp: string }> {
      return { type: "answer", sdp: "" };
    }
    async setLocalDescription(): Promise<void> {}
    async setRemoteDescription(): Promise<void> {}
    async addIceCandidate(): Promise<void> {}
    close(): void {}
  }
  beforeEach(() => vi.stubGlobal("RTCPeerConnection", FakePeerConnection));
  afterEach(() => vi.unstubAllGlobals());

  it("relay 檔案暫存（ADR-0162）：政策啟用＋名冊成員 1:1 → 分塊經中繼；離線收件人上線後收齊位元組", () => {
    // 企業站：MAX_FILE_MB 已設（acceptFileEvents）；離線暫存需要持久層（store）。
    const net = createInMemoryRelayNetwork({ acceptFileEvents: true, store: new MessageStore() });
    const token = "tok-relay-file";
    const owner = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("o", h), "老闆", {
      orgOwner: true,
      orgInviteToken: token,
    });
    owner.start(noop);
    // 政策：relay 檔案上限 1MB（ADR-0162）。
    owner.publishRoster("小公司", [{ pubkey: owner.self.pubkey, name: "老闆" }], { relayFilesMaxMb: 1 });

    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "小美", {
      orgAdminPubkey: owner.self.pubkey,
      orgJoinToken: token,
    });
    a.start(noop);
    const storeB = new MemoryStorage();
    const bId = new RelayChatBackend(storeB, (h) => net.connect("b", h), "阿強", {
      orgAdminPubkey: owner.self.pubkey,
      orgJoinToken: token,
    });
    bId.start(noop);
    const bPk = bId.self.pubkey;
    bId.stop(); // 收件人離線——P2P 在此必然失敗，relay 暫存是唯一出路

    // A 送 100KB（> 1 塊）給離線的 B：政策啟用＋B 在名冊 → 走 relay 分塊（不碰 P2P，node 下無 RTC 也不炸）。
    const payload = new Uint8Array(100_000).map((_, i) => i % 251);
    a.sendFile(bPk, { name: "簡報.pdf", mime: "application/pdf", bytes: payload });

    // B 上線 → 從離線信箱收齊分塊 → 重組 → onFileBytes（走既有收檔路徑）。
    const gotBytes: { name: string; size: number; first: number; last: number }[] = [];
    const b2 = new RelayChatBackend(storeB, (h) => net.connect("b2", h), "阿強", {
      orgAdminPubkey: owner.self.pubkey,
      orgJoinToken: token,
    });
    b2.start({
      ...noop,
      onFileBytes: (_pk, _id, f) =>
        gotBytes.push({ name: f.name, size: f.bytes.length, first: f.bytes[0]!, last: f.bytes[f.bytes.length - 1]! }),
    });
    expect(gotBytes.length).toBe(1);
    expect(gotBytes[0]).toEqual({ name: "簡報.pdf", size: 100_000, first: 0, last: (100_000 - 1) % 251 });
    // metadata 訊息照舊入庫（檔案訊息存在、只存 metadata 無位元組）。
    expect(storeB.loadMessages(a.self.pubkey).some((m) => m.file?.name === "簡報.pdf")).toBe(true);

    a.stop();
    b2.stop();
    owner.stop();
  });

  it("公司儲存槽（ADR-0161）：存放不建聊天訊息、位元組到齊發 onSlotDeposit；非名冊成員拒收", () => {
    const net = createInMemoryRelayNetwork();
    const token = "tok-slot";
    const storeO = new MemoryStorage();
    const owner = new RelayChatBackend(storeO, (h) => net.connect("o", h), "老闆", {
      orgOwner: true,
      orgInviteToken: token,
    });
    const deposits: { sender: string; name: string; origin: string; bytes: Uint8Array }[] = [];
    owner.start({ ...noop, onSlotDeposit: (sender, d) => deposits.push({ sender, name: d.name, origin: d.origin, bytes: d.bytes }) });
    owner.publishRoster("小公司", [{ pubkey: owner.self.pubkey, name: "老闆" }]);

    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "小美", {
      orgAdminPubkey: owner.self.pubkey,
      orgJoinToken: token,
    });
    a.start(noop);

    // 審查修正：存放的 origin 隨 P2P file-begin 幀傳，不發 relay metadata → 兩端零聊天訊息。
    a.depositFile(owner.self.pubkey, { name: "報表.xlsx", mime: "application/x", bytes: new Uint8Array([1, 2, 3]) }, "與阿強的對話");
    expect(storeO.loadMessages(a.self.pubkey)).toEqual([]);
    expect(storeA.loadMessages(owner.self.pubkey).filter((m) => m.file)).toEqual([]);

    // P2P 位元組（帶 origin）到齊（node 無真實 WebRTC → 直接餵 onFileBytes 模擬）→ onSlotDeposit。
    type Feed = { onFileBytes(peer: string, file: { id: string; name: string; mime: string; bytes: Uint8Array; origin?: string }): void };
    (owner as unknown as Feed).onFileBytes(a.self.pubkey, {
      id: "t1", name: "報表.xlsx", mime: "application/x", bytes: new Uint8Array([1, 2, 3]), origin: "與阿強的對話",
    });
    expect(deposits.length).toBe(1);
    expect(deposits[0]).toMatchObject({ sender: a.self.pubkey, name: "報表.xlsx", origin: "與阿強的對話" });
    expect([...deposits[0]!.bytes]).toEqual([1, 2, 3]);
    expect(storeO.loadMessages(a.self.pubkey)).toEqual([]); // 位元組到齊也不建訊息

    // 非名冊成員（陌生人）帶 origin 的位元組 → 不入槽（onSlotDeposit 不觸發）。
    const evil = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("e", h), "壞人");
    evil.start(noop);
    (owner as unknown as Feed).onFileBytes(evil.self.pubkey, {
      id: "t2", name: "malware.exe", mime: "application/x", bytes: new Uint8Array([9]), origin: "x",
    });
    expect(deposits.length).toBe(1); // 不觸發 onSlotDeposit（非名冊成員）

    a.stop();
    evil.stop();
    owner.stop();
  });

  it("送檔另發加密 metadata 訊息：對方裝置知道有檔案（G1），雙方持久化 file metadata（無位元組）", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const aMsgs: ChatMessage[] = [];
    const bMsgs: ChatMessage[] = [];
    const bBytes: { messageId: string; name: string }[] = [];
    a.start({ ...noop, onMessage: (_pk, m) => aMsgs.push(m) });
    b.start({
      ...noop,
      onMessage: (_pk, m) => bMsgs.push(m),
      onFileBytes: (_pk, id, f) => bBytes.push({ messageId: id, name: f.name }),
    });

    a.addContact(b.selfNpub);
    const tid = a.sendFile(b.self.pubkey, { name: "report.pdf", mime: "application/pdf", bytes: new Uint8Array([1, 2, 3, 4]) });

    // 送出端：emit + 持久化 outgoing 檔案訊息（file.id=tid、無文字）。
    const aFile = aMsgs.find((m) => m.file);
    expect(aFile?.file).toMatchObject({ id: tid, name: "report.pdf", size: 4, incoming: false });
    expect(aFile?.text).toBe("");
    const aStored = storeA.loadMessages(b.self.pubkey).find((m) => m.file);
    expect(aStored?.file).toMatchObject({ tid, name: "report.pdf", size: 4, mime: "application/pdf" });

    // 收件端：B 收到加密 metadata → 知道有檔案（G1）；P2P 位元組未達 → sent=0（在另一台裝置）。
    const bFile = bMsgs.find((m) => m.file);
    expect(bFile?.file).toMatchObject({ name: "report.pdf", size: 4, incoming: true, sent: 0 });
    const bStored = storeB.loadMessages(a.self.pubkey).find((m) => m.file);
    expect(bStored?.file).toMatchObject({ tid, name: "report.pdf", size: 4 });
    expect(bStored?.file?.savedPath).toBeUndefined();
    expect(bBytes).toHaveLength(0); // 位元組未經 P2P 到達，onFileBytes 不觸發
    // 中繼看不到檔名（metadata 在加密內層）——比照一般訊息，此處僅確認 B 端解密後才有。
    a.stop();
    b.stop();
  });

  it("送出端原檔路徑（ADR-0103）：原生選檔帶入 savedPath → 自己送出的圖片重載後也讀得回原圖", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub);

    a.sendFile(
      b.self.pubkey,
      { name: "cat.png", mime: "image/png", bytes: new Uint8Array([1, 2]) },
      { thumb: "data:image/jpeg;base64,AAAA", savedPath: "D:/圖片/cat.png" },
    );

    const sent = storeA.loadMessages(b.self.pubkey).find((m) => m.outgoing && m.file);
    expect(sent?.file?.savedPath).toBe("D:/圖片/cat.png"); // 過去送出端永遠沒有路徑
    expect(sent?.file?.thumb).toBe("data:image/jpeg;base64,AAAA");
    a.stop();
    b.stop();
  });

  it("瀏覽器路徑（無 savedPath）：仍正常送出，只是沒有原檔路徑", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub);
    a.sendFile(b.self.pubkey, { name: "x.bin", mime: "application/octet-stream", bytes: new Uint8Array([9]) });
    const sent = storeA.loadMessages(b.self.pubkey).find((m) => m.outgoing && m.file);
    expect(sent?.file?.name).toBe("x.bin");
    expect(sent?.file?.savedPath).toBeUndefined();
    a.stop();
    b.stop();
  });

  it("setFileSavedPath：回填收檔路徑並持久化（重載後仍見路徑）", () => {
    const net = createInMemoryRelayNetwork();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const bMsgs: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bMsgs.push(m) });

    a.addContact(b.selfNpub);
    a.sendFile(b.self.pubkey, { name: "photo.jpg", mime: "image/jpeg", bytes: new Uint8Array([9, 9]) });
    const bFile = bMsgs.find((m) => m.file);
    expect(bFile).toBeDefined();

    b.setFileSavedPath(a.self.pubkey, bFile!.id, "/home/bob/photo.jpg");
    expect(storeB.loadMessages(a.self.pubkey).find((m) => m.file)?.file?.savedPath).toBe("/home/bob/photo.jpg");
    a.stop();
    b.stop();
  });

  it("🔴 **群組傳檔不再爆炸**（ADR-0124）：metadata 扇給每位成員，落在群組對話裡", () => {
    const net = createInMemoryRelayNetwork();
    const sa = new MemoryStorage();
    const sb = new MemoryStorage();
    const a = new RelayChatBackend(sa, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(sb, (h) => net.connect("b", h), "Bob");
    const bMsgs: { convo: string; m: ChatMessage }[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (convo, m) => bMsgs.push({ convo, m }) });
    a.addContact(b.selfNpub);
    b.addContact(a.selfNpub);
    a.createGroup("專案群", [b.self.pubkey]);
    const gid = sa.loadGroups()[0]!.id;

    // 修正前：`to` 是 groupId（32 字元）→ 丟進 NIP-44 → `second arg must be public key`。
    // 而 UI 從來沒擋過群組裡的 📎，所以這是使用者點得到的路徑。
    let tid = "";
    expect(() => {
      tid = a.sendFile(gid, { name: "spec.pdf", mime: "application/pdf", bytes: new Uint8Array([1, 2, 3, 4]) });
    }).not.toThrow();
    expect(tid).toBeTruthy();

    // 送出端：檔案訊息落在**群組**對話裡，且知道是誰發的。
    const aStored = sa.loadMessages(gid).find((m) => m.file);
    expect(aStored?.file).toMatchObject({ tid, name: "spec.pdf", size: 4 });
    expect(aStored?.sender).toBe(a.self.pubkey);

    // 收件端：Bob 收到 metadata，且它歸在**群組**（不是跟 Alice 的 1:1）。
    const got = bMsgs.find((x) => x.m.file);
    expect(got?.convo).toBe(gid);
    expect(got?.m.file).toMatchObject({ id: tid, name: "spec.pdf", incoming: true });
    expect(got?.m.sender).toBe(a.self.pubkey);
    expect(sb.loadMessages(gid).find((m) => m.file)?.file?.tid).toBe(tid);
    // 位元組不進中繼——metadata 只帶名稱/大小/類型（ADR-0093 的分工）。
    expect(sb.loadMessages(a.self.pubkey)).toEqual([]); // 沒有跑進 1:1 對話
    a.stop();
    b.stop();
  });

  it("群組的每位成員**共用同一個 tid**（否則位元組對不回同一則訊息）", () => {
    const net = createInMemoryRelayNetwork();
    const sa = new MemoryStorage();
    const sb = new MemoryStorage();
    const sc = new MemoryStorage();
    const a = new RelayChatBackend(sa, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(sb, (h) => net.connect("b", h), "Bob");
    const c = new RelayChatBackend(sc, (h) => net.connect("c", h), "Carol");
    a.start(noop);
    b.start(noop);
    c.start(noop);
    a.addContact(b.selfNpub);
    a.addContact(c.selfNpub);
    a.createGroup("三人群", [b.self.pubkey, c.self.pubkey]);
    const gid = sa.loadGroups()[0]!.id;

    const tid = a.sendFile(gid, { name: "x.bin", mime: "application/octet-stream", bytes: new Uint8Array([9]) });

    // rumor 跨成員共用 → 兩人看到的 tid 必須相同，也必須等於送出端的。
    expect(sb.loadMessages(gid).find((m) => m.file)?.file?.tid).toBe(tid);
    expect(sc.loadMessages(gid).find((m) => m.file)?.file?.tid).toBe(tid);
    a.stop();
    b.stop();
    c.stop();
  });
});

describe("自封副本：多裝置對話完整性（ADR-0107）", () => {
  /** 同一把 nsec、兩個 storage ＝ 同一個人的兩台裝置（例如手機與電腦）。 */
  function twoDevices(net: ReturnType<typeof createInMemoryRelayNetwork>, sk: Uint8Array) {
    const mk = (id: string) => {
      const store = new MemoryStorage();
      store.saveIdentity({ nsec: nsecEncode(sk), name: "Alice" });
      return { store, be: new RelayChatBackend(store, (h) => net.connect(id, h), "Alice") };
    };
    return { d1: mk("alice-phone"), d2: mk("alice-desktop") };
  }

  it("我在手機發的訊息，電腦也看得到（這正是 ADR-0107 要修的破損）", () => {
    const net = createInMemoryRelayNetwork();
    const aliceSk = generateSecretKey();
    const { d1, d2 } = twoDevices(net, aliceSk);
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", h), "Bob");
    d1.be.start(noop);
    d2.be.start(noop);
    bob.start(noop);

    d1.be.addContact(bob.selfNpub);
    d1.be.sendMessage(bob.self.pubkey, "我在手機上打的");

    // 修復前：電腦端這裡是空的（訊息定址給 Bob，永遠不會進 Alice 的收件箱）。
    const onDesktop = d2.store.loadMessages(bob.self.pubkey);
    expect(onDesktop.map((m) => m.text)).toEqual(["我在手機上打的"]);
    expect(onDesktop[0]!.outgoing).toBe(true); // 是「我發的」，不是「收到的」
    // 兩台裝置指涉同一則訊息（同一個 rumor.id）→ 回條/回應/收回才對得起來。
    expect(onDesktop[0]!.id).toBe(d1.store.loadMessages(bob.self.pubkey)[0]!.id);

    d1.be.stop();
    d2.be.stop();
    bob.stop();
  });

  it("對話在兩台裝置上都完整（來訊 + 自己發的都在）", () => {
    const net = createInMemoryRelayNetwork();
    const { d1, d2 } = twoDevices(net, generateSecretKey());
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", h), "Bob");
    d1.be.start(noop);
    d2.be.start(noop);
    bob.start(noop);

    d1.be.addContact(bob.selfNpub);
    d1.be.sendMessage(bob.self.pubkey, "在嗎");
    bob.sendMessage(d1.be.self.pubkey, "在");
    d2.be.sendMessage(bob.self.pubkey, "那我從電腦回你"); // 換一台裝置繼續講

    const expected = ["在嗎", "在", "那我從電腦回你"];
    expect(d1.store.loadMessages(bob.self.pubkey).map((m) => m.text)).toEqual(expected);
    expect(d2.store.loadMessages(bob.self.pubkey).map((m) => m.text)).toEqual(expected);

    d1.be.stop();
    d2.be.stop();
    bob.stop();
  });

  it("發送裝置收到自己的自封副本會丟棄（不重複顯示）", () => {
    const net = createInMemoryRelayNetwork();
    const { d1 } = twoDevices(net, generateSecretKey());
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", h), "Bob");
    const seen: ChatMessage[] = [];
    d1.be.start({ ...noop, onMessage: (_pk, m) => seen.push(m) });
    bob.start(noop);

    d1.be.addContact(bob.selfNpub);
    d1.be.sendMessage(bob.self.pubkey, "只該出現一次");

    // 自封副本也定址給自己 → 會回流到發送裝置；以 rumor.id 去重丟棄。
    expect(seen.filter((m) => m.text === "只該出現一次")).toHaveLength(1);
    expect(d1.store.loadMessages(bob.self.pubkey)).toHaveLength(1);

    d1.be.stop();
    bob.stop();
  });

  it("收到自封副本不會把「自己」加成聯絡人，而是學到收件人", () => {
    const net = createInMemoryRelayNetwork();
    const { d1, d2 } = twoDevices(net, generateSecretKey());
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", h), "Bob");
    d1.be.start(noop);
    d2.be.start(noop);
    bob.start(noop);

    d1.be.addContact(bob.selfNpub); // 只有手機加了 Bob
    d1.be.sendMessage(bob.self.pubkey, "嗨");

    const onDesktop = d2.store.loadContacts().map((c) => c.pubkey);
    expect(onDesktop).not.toContain(d2.be.self.pubkey); // 絕不可把自己列為聯絡人
    expect(onDesktop).toContain(bob.self.pubkey); // 電腦順帶學到這個聯絡人

    d1.be.stop();
    d2.be.stop();
    bob.stop();
  });

  it("狀態自動收斂：Bob 回送達 → 兩台裝置都標 delivered（回條本來就定址給我）", () => {
    const net = createInMemoryRelayNetwork();
    const { d1, d2 } = twoDevices(net, generateSecretKey());
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", h), "Bob");
    d1.be.start(noop);
    d2.be.start(noop);
    bob.start(noop);

    d1.be.addContact(bob.selfNpub);
    d1.be.sendMessage(bob.self.pubkey, "收到請回");

    // 這是 rumor.id 統一的紅利：不必為「狀態」另建同步機制。
    expect(d1.store.loadMessages(bob.self.pubkey)[0]!.status).toBe("delivered");
    expect(d2.store.loadMessages(bob.self.pubkey)[0]!.status).toBe("delivered");

    d1.be.stop();
    d2.be.stop();
    bob.stop();
  });

  it("在手機收回，電腦上也會消失（隱私不變式，非便利功能）", () => {
    const net = createInMemoryRelayNetwork();
    const { d1, d2 } = twoDevices(net, generateSecretKey());
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", h), "Bob");
    d1.be.start(noop);
    d2.be.start(noop);
    bob.start(noop);

    d1.be.addContact(bob.selfNpub);
    d1.be.sendMessage(bob.self.pubkey, "說錯話了");
    const id = d1.store.loadMessages(bob.self.pubkey)[0]!.id;
    d1.be.unsendMessage(bob.self.pubkey, id);

    expect(d1.store.loadDeleted()).toContain(id);
    expect(d2.store.loadDeleted()).toContain(id); // 不可留在自己的另一台裝置上
    d1.be.stop();
    d2.be.stop();
    bob.stop();
  });

  it("在手機按的回應，電腦上顯示為「我按的」（mine）", () => {
    const net = createInMemoryRelayNetwork();
    const { d1, d2 } = twoDevices(net, generateSecretKey());
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", h), "Bob");
    d1.be.start(noop);
    d2.be.start(noop);
    bob.start(noop);

    bob.addContact(d1.be.selfNpub);
    bob.sendMessage(d1.be.self.pubkey, "看這個");
    const id = d1.store.loadMessages(bob.self.pubkey)[0]!.id;
    d1.be.sendReaction(bob.self.pubkey, id, "🎉");

    const onDesktop = d2.store.loadReactions().filter((r) => r.messageId === id);
    expect(onDesktop.map((r) => r.emoji)).toEqual(["🎉"]);
    expect(onDesktop[0]!.mine).toBe(true); // 是我按的，不是 Bob 按的

    d1.be.stop();
    d2.be.stop();
    bob.stop();
  });

  it("群訊也有自封副本：在手機發的群訊，電腦看得到（標 outgoing）", () => {
    const net = createInMemoryRelayNetwork();
    const { d1, d2 } = twoDevices(net, generateSecretKey());
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", h), "Bob");
    d1.be.start(noop);
    d2.be.start(noop);
    bob.start(noop);

    d1.be.addContact(bob.selfNpub);
    d1.be.createGroup("專案群", [bob.self.pubkey]);
    const gid = d1.store.loadGroups()[0]!.id;

    // 群控也自封（ADR-0107）：否則電腦端根本不知道這個群存在，群訊自封副本會被
    // receiveGroup 以「未知群組」丟棄——群訊自封形同無效。
    expect(d2.store.loadGroups().map((g) => g.id)).toEqual([gid]);
    expect(d2.store.loadGroups()[0]!.admin).toBe(d1.be.self.pubkey); // 管理者仍是我

    d1.be.sendGroupMessage(gid, "大家好");

    // 群訊原本只扇出給**其他**成員 → 自己的另一台裝置本來看不到自己發的群訊。
    const onDesktop = d2.store.loadMessages(gid);
    expect(onDesktop.map((m) => m.text)).toEqual(["大家好"]);
    expect(onDesktop[0]!.outgoing).toBe(true);

    d1.be.stop();
    d2.be.stop();
    bob.stop();
  });

  it("早到的回條：中繼回放順序是亂的（NIP-59 時戳抖動）——回條先到仍不會漏標", () => {
    const net = createInMemoryRelayNetwork();
    const aliceSk = generateSecretKey();
    const bobSk = generateSecretKey();
    const bobPk = getPublicKey(bobSk);
    const { d2 } = twoDevices(net, aliceSk); // 只開電腦；手機的送出以原始事件模擬
    d2.be.start(noop);

    const w = wrapMessage("在手機發的", aliceSk, bobPk);
    const receipt = wrapReceipt("delivered", bobSk, getPublicKey(aliceSk), w.id);
    const pub = net.connect("raw", {});

    pub.publish(receipt); // ← 回條**先**到（目標訊息還不在本機）
    pub.publish(w.selfCopy); // ← 自封副本後到

    // 若不緩衝早到的回條，這則會永遠卡在 sent。
    expect(d2.store.loadMessages(bobPk)[0]!.status).toBe("delivered");
    d2.be.stop();
  });
});

describe("已讀水位的本機持久化（ADR-0108）", () => {
  it("**未讀在重新載入後仍在**——這正是本 ADR 要修的破損", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const sk = generateSecretKey();
    store.saveIdentity({ nsec: nsecEncode(sk), name: "Alice" });

    const a1 = new RelayChatBackend(store, (h) => net.connect("a1", h), "Alice");
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", h), "Bob");
    let unread: Record<string, number> = {};
    a1.start({ ...noop, onUnread: (u) => (unread = u) });
    bob.start(noop);

    bob.addContact(a1.selfNpub);
    a1.acceptRequest(bob.self.pubkey); // ADR-0121：請求區的訊息不點亮未讀徽章，接受後才算
    bob.sendMessage(a1.self.pubkey, "在嗎");
    bob.sendMessage(a1.self.pubkey, "？");
    expect(unread[bob.self.pubkey]).toBe(2);
    a1.stop();

    // 關掉 App 再開（同一個 storage）：過去 unread 只是 React state → 重載歸零。
    unread = {};
    const a2 = new RelayChatBackend(store, (h) => net.connect("a2", h), "Alice");
    a2.start({ ...noop, onUnread: (u) => (unread = u) });
    expect(unread[bob.self.pubkey]).toBe(2); // 紅點還在
    a2.stop();
    bob.stop();
  });

  it("開對話推進水位 → 未讀歸零，且重新載入後仍是零", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const sk = generateSecretKey();
    store.saveIdentity({ nsec: nsecEncode(sk), name: "Alice" });

    const a1 = new RelayChatBackend(store, (h) => net.connect("a1", h), "Alice");
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", h), "Bob");
    let unread: Record<string, number> = {};
    a1.start({ ...noop, onUnread: (u) => (unread = u) });
    bob.start(noop);

    bob.addContact(a1.selfNpub);
    a1.acceptRequest(bob.self.pubkey); // ADR-0121：接受後未讀才算數
    bob.sendMessage(a1.self.pubkey, "嗨");
    expect(unread[bob.self.pubkey]).toBe(1);

    a1.clearUnread(bob.self.pubkey);
    expect(unread[bob.self.pubkey]).toBeUndefined(); // 只回報 > 0 者
    a1.stop();

    unread = { sentinel: 1 };
    const a2 = new RelayChatBackend(store, (h) => net.connect("a2", h), "Alice");
    a2.start({ ...noop, onUnread: (u) => (unread = u) });
    expect(unread[bob.self.pubkey]).toBeUndefined(); // 水位已落地 → 不會又冒出來
    a2.stop();
    bob.stop();
  });

  it("**水位與已讀回條解耦**：回條預設關閉，但本機水位仍必須推進", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const sk = generateSecretKey();
    store.saveIdentity({ nsec: nsecEncode(sk), name: "Alice" });
    const a = new RelayChatBackend(store, (h) => net.connect("a", h), "Alice");
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", h), "Bob");
    let unread: Record<string, number> = {};
    a.start({ ...noop, onUnread: (u) => (unread = u) });
    bob.start(noop);

    bob.addContact(a.selfNpub);
    a.acceptRequest(bob.self.pubkey); // ADR-0121：接受後未讀才算數
    bob.sendMessage(a.self.pubkey, "嗨");
    expect(unread[bob.self.pubkey]).toBe(1);

    // readReceipts 預設 false。舊版 markRead() 第一行就 `if (!this.readReceipts) return;`
    // → 水位永遠不會被保存。已讀回條是**隱私選擇**；記得自己讀到哪是 **UX**，兩者不可綁一起。
    a.markRead(bob.self.pubkey);
    expect(store.loadReadAt()[bob.self.pubkey]).toBeGreaterThan(0);
    expect(unread[bob.self.pubkey]).toBeUndefined();

    a.stop();
    bob.stop();
  });

  it("訊息時間採**送出時間**（rumor.created_at），不是下載時間", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const aliceSk = generateSecretKey();
    store.saveIdentity({ nsec: nsecEncode(aliceSk), name: "Alice" });
    const a = new RelayChatBackend(store, (h) => net.connect("a", h), "Alice");
    a.start(noop);

    // 模擬「離線一天後補收」：這則是一小時前送出的，現在才抵達。
    const bobSk = generateSecretKey();
    const sentAt = Math.floor(Date.now() / 1000) - 3600;
    const w = wrapMessage("一小時前送的", bobSk, getPublicKey(aliceSk), { now: sentAt });
    net.connect("raw", {}).publish(w.events[0]!);

    const msg = store.loadMessages(getPublicKey(bobSk))[0]!;
    // 用 Date.now() 會把它蓋成「現在」→ 時間全錯、順序被壓平、且兩台裝置各不相同。
    expect(msg.at).toBe(sentAt * 1000);
    a.stop();
  });

  it("箝制未來時戳：壞掉/惡意的時鐘不得把訊息永遠釘在對話頂端", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const aliceSk = generateSecretKey();
    store.saveIdentity({ nsec: nsecEncode(aliceSk), name: "Alice" });
    const a = new RelayChatBackend(store, (h) => net.connect("a", h), "Alice");
    a.start(noop);

    const bobSk = generateSecretKey();
    const future = Math.floor(Date.now() / 1000) + 86_400 * 365; // 宣稱一年後送出
    const w = wrapMessage("我來自未來", bobSk, getPublicKey(aliceSk), { now: future });
    net.connect("raw", {}).publish(w.events[0]!);

    const msg = store.loadMessages(getPublicKey(bobSk))[0]!;
    expect(msg.at).toBeLessThanOrEqual(Date.now()); // 箝制到「現在」
    a.stop();
  });

  it("兩台裝置對同一則訊息算出**相同**的時間（水位才可跨裝置比較）", () => {
    const net = createInMemoryRelayNetwork();
    const aliceSk = generateSecretKey();
    const mk = (id: string) => {
      const store = new MemoryStorage();
      store.saveIdentity({ nsec: nsecEncode(aliceSk), name: "Alice" });
      const be = new RelayChatBackend(store, (h) => net.connect(id, h), "Alice");
      be.start(noop);
      return { store, be };
    };
    const phone = mk("phone");
    const desktop = mk("desktop");
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", h), "Bob");
    bob.start(noop);

    phone.be.addContact(bob.selfNpub);
    phone.be.sendMessage(bob.self.pubkey, "我發的"); // 自封副本 → 電腦也收到（ADR-0107）
    bob.sendMessage(phone.be.self.pubkey, "我回的");

    const onPhone = phone.store.loadMessages(bob.self.pubkey).map((m) => m.at);
    const onDesktop = desktop.store.loadMessages(bob.self.pubkey).map((m) => m.at);
    expect(onDesktop).toEqual(onPhone); // 同一組時間戳 → 順序一致、水位可比

    phone.be.stop();
    desktop.be.stop();
    bob.stop();
  });
});

describe("中繼流量削減（ADR-0109）", () => {
  /** 側錄某座 relay 上符合 filter 的事件。 */
  let spyN = 0;
  function spy(net: ReturnType<typeof createInMemoryRelayNetwork>, filter: object): NostrEvent[] {
    const got: NostrEvent[] = [];
    net.connect(`spy-${spyN++}`, { onEvent: (_s, e) => got.push(e) }).subscribe("spy", [filter as never]);
    return got;
  }
  const cadenceOf = (e: NostrEvent): string | undefined => e.tags.find((t) => t[0] === "hb")?.[1];

  it("初始狀態離線（ADR-0164 修正）：start() 首拍不漏任何心跳信標", () => {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice", {
      initialStatus: "offline",
    });
    const hb = spy(net, { kinds: [KIND.HEARTBEAT] });
    a.start(noop); // 以往：建構恆 online → start 的 beat() 漏一拍上線信標；修正後：seed 離線 → 靜默
    expect(hb.length).toBe(0);
    expect(a.self.status).toBe("offline");
    a.stop();
  });

  it("建構即隱身（ADR-0180 修正）：離職接管——start() 首拍不漏任何心跳（不把離職身分廣播上線）", () => {
    const net = createInMemoryRelayNetwork();
    // 模擬離職接管：以託管金鑰登入查看歷史，狀態預設 online 但**建構即隱身**。
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "離職·Eve", {
      initialInvisible: true,
    });
    const hb = spy(net, { kinds: [KIND.HEARTBEAT] });
    a.start(noop); // 修正前：start 首拍 beat() 已廣播一則存活信標 → 離職員工對同事短暫顯示在線
    expect(hb.length).toBe(0); // 修正後：建構就隱身 → 首拍靜默
    a.stop();
  });

  it("初始狀態忙碌（ADR-0164）：seed 進 self，start 首拍即以該狀態廣播（非事後補正）", () => {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice", {
      initialStatus: "busy",
      initialStatusMessage: "趕稿中",
    });
    a.start(noop);
    expect(a.self.status).toBe("busy");
    expect(a.self.statusMessage).toBe("趕稿中");
    a.stop();
  });

  it("沒有聯絡人在線 → 心跳自報 5 分鐘（IDLE）：閒置時的心跳是在對空氣廣播", () => {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const hb = spy(net, { kinds: [KIND.HEARTBEAT] });
    a.start(noop); // start 一律立刻發一次心跳（喚醒機制的不變式）

    expect(hb.length).toBeGreaterThanOrEqual(1);
    expect(cadenceOf(hb[0]!)).toBe("300"); // IDLE
    a.stop();
  });

  it("**喚醒握手**：對方一上線，雙方立刻補發心跳並切回 60 秒——「顯示上線」仍是即時的", () => {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub); // 送個人檔 → Alice 落在 Bob 的請求區（ADR-0121）
    b.acceptRequest(a.self.pubkey); // 接受後才訂閱彼此的心跳（請求者看不到你的上線狀態）

    const hbA = spy(net, { kinds: [KIND.HEARTBEAT], authors: [a.self.pubkey] });
    const hbB = spy(net, { kinds: [KIND.HEARTBEAT], authors: [b.self.pubkey] });
    a.setStatus("online"); // Alice 發一顆（此時她還沒看到 Bob → IDLE）

    // Bob 收到 → 從閒置轉活躍 → 立刻補發（ACTIVE）；Alice 收到 Bob 的 → 也轉活躍 → 補發。
    // 不比順序：同步的測試替身會在外層事件還在扇出時就把巢狀的握手心跳送達 spy
    //（真 WebSocket 是有序非同步的）。要驗的是「雙方都切到了 ACTIVE」。
    expect(hbB.map(cadenceOf)).toContain("60");
    expect(hbA.map(cadenceOf)).toContain("60");
    // 全部發生在同一個同步回合內——不需要等任何計時器，更不必等 5 分鐘。
    a.stop();
    b.stop();
  });

  it("**防風暴**：握手在一輪後停止——已是活躍就不再回發（否則兩端會互相觸發到爆）", () => {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub);

    const hb = spy(net, { kinds: [KIND.HEARTBEAT] });
    a.setStatus("online");
    const afterHandshake = hb.length;

    // 雙方都已是 ACTIVE：再發一顆不該再觸發任何補發（wasIdle === false）。
    a.setStatus("online");
    expect(hb.length).toBe(afterHandshake + 1); // 只有 Alice 自己那一顆，沒有連鎖
    a.stop();
    b.stop();
  });

  it("**P2P 卸載路徑同樣自報節奏**：allP2P 時完全不發 relay 心跳，P2P 是唯一信號——漏掉節奏就會被誤判離線", () => {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    a.start(noop);
    a.addContact(npubEncode(getPublicKey(generateSecretKey())));

    // 攔截 P2P 傳輸層：模擬「通道已開」，記錄送出的在線狀態 payload。
    const sent: { hb?: number }[] = [];
    const transfer = (a as unknown as { transfer: { sendPresence: unknown } }).transfer;
    transfer.sendPresence = (_pk: string, p: { hb?: number }) => {
      sent.push(p);
      return true; // 通道已開 → allP2P → beat() 不會再發 relay 心跳
    };
    (a as unknown as { beat: () => void }).beat();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.hb).toBe(300_000); // 沒有聯絡人在線 → IDLE 節奏，必須如實自報
    a.stop();
  });

  it("訂閱合併為單一 REQ（原本 9 個）——每次重連省 8 個中繼 request", () => {
    const reqs: unknown[][] = [];
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(
      new MemoryStorage(),
      (h) => {
        const c = net.connect("a", h);
        const orig = c.subscribe.bind(c);
        c.subscribe = (subId: string, filters: unknown[]) => {
          reqs.push(filters);
          orig(subId, filters as never);
        };
        return c;
      },
      "Alice",
    );
    a.start(noop);

    expect(reqs).toHaveLength(1); // 一個 REQ
    expect(reqs[0]!.length).toBeGreaterThanOrEqual(7); // 內含全部 filter（OR 語意，中繼早已支援）
    a.stop();
  });

  it("收件箱增量抓取的 since **退讓 2 天**——否則會漏掉時戳被 NIP-59 抖到過去的訊息", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const aliceSk = generateSecretKey();
    store.saveIdentity({ nsec: nsecEncode(aliceSk), name: "Alice" });
    const filtersOf: unknown[][] = [];
    const a = new RelayChatBackend(
      store,
      (h) => {
        const c = net.connect("a", h);
        const orig = c.subscribe.bind(c);
        c.subscribe = (subId: string, filters: unknown[]) => {
          filtersOf.push(filters);
          orig(subId, filters as never);
        };
        return c;
      },
      "Alice",
      { relayUrl: "wss://home" },
    );
    a.start(noop);

    // 首次連線：沒有水位 → 全量（無 since）
    const dmFilter = (fs: unknown[]) => fs.find((f) => (f as { kinds?: number[] }).kinds?.[0] === 1059) as { since?: number };
    expect(dmFilter(filtersOf[0]!).since).toBeUndefined();

    // 收到一則訊息 → 水位前進
    const bobSk = generateSecretKey();
    const sentAt = Math.floor(Date.now() / 1000);
    const w = wrapMessage("嗨", bobSk, getPublicKey(aliceSk), { now: sentAt });
    net.connect("raw", {}).publish(w.events[0]!);

    a.addContact(npubEncode(getPublicKey(bobSk))); // 觸發 resubscribe
    const latest = dmFilter(filtersOf[filtersOf.length - 1]!);
    expect(latest.since).toBeDefined();
    // 水位（外層 created_at）減去整整 2 天的 NIP-59 抖動窗。
    const outer = w.events[0]!.created_at;
    expect(latest.since).toBe(outer - 2 * 86_400);
    a.stop();
  });
});

describe("群訊必須走 sendGroupMessage（不是 sendMessage）", () => {
  it("**groupId 不是 pubkey**——傳給 sendMessage() 會直接拋錯，而不是靜默送到虛空", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const a = new RelayChatBackend(store, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub);
    a.createGroup("專案群", [b.self.pubkey]);
    const gid = store.loadGroups()[0]!.id;

    // groupId 是 16 bytes hex（32 字元）；pubkey 是 32 bytes hex（64 字元）。
    expect(gid).toHaveLength(32);
    // 行動端曾把群組也丟給 sendMessage（群組會出現在聊天清單裡）→ 點進群組送訊直接爆。
    // 拋錯其實是好事：靜默送到一個不存在的 pubkey 會更難察覺。
    expect(() => a.sendMessage(gid, "會爆")).toThrow();
    expect(() => a.sendGroupMessage(gid, "正常送出")).not.toThrow();

    a.stop();
    b.stop();
  });
});

describe("健檢修正（ADR-0119）", () => {
  it("**群組上的 emoji 回應與收回不再拋錯**，且其他成員真的收得到", () => {
    const net = createInMemoryRelayNetwork();
    const sa = new MemoryStorage();
    const a = new RelayChatBackend(sa, (h) => net.connect("a", h), "Alice");
    const reacted: string[] = [];
    const unsent: string[] = [];
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start({ ...noop, onReaction: (id, e) => reacted.push(`${id}:${e}`), onUnsend: (id) => unsent.push(id) });
    a.addContact(b.selfNpub);
    a.createGroup("專案群", [b.self.pubkey]);
    const gid = sa.loadGroups()[0]!.id;
    a.sendGroupMessage(gid, "訊息");
    const mid = sa.loadMessages(gid)[0]!.id;

    // 修正前：groupId（32 字元）被當成 pubkey（64 字元）丟進 NIP-44 → `second arg must be
    // public key`。桌面與行動端**都會爆**。群組無共用金鑰 → 正確做法是扇給每位成員。
    expect(() => a.sendReaction(gid, mid, "👍")).not.toThrow();
    expect(() => a.unsendMessage(gid, mid)).not.toThrow();
    expect(reacted).toEqual([`${mid}:👍`]);
    expect(unsent).toEqual([mid]);

    a.stop();
    b.stop();
  });

  it("**`stop()` 要關閉所有中繼連線**——否則登出後那些 socket 會永遠自動重連", () => {
    const closed: string[] = [];
    const make = (url: string) => (h: RelayClientHandlers): CloseableRelayClient => {
      const c: CloseableRelayClient = new RelayClient({ send: () => {} }, h);
      c.close = () => closed.push(url);
      return c;
    };
    const a = new RelayChatBackend(new MemoryStorage(), make("home"), "Alice", {
      relayUrl: "wss://home",
      connectorFor: (url: string) => make(url),
    });
    a.start(noop);
    a.addContact(`${npubEncode(getPublicKey(generateSecretKey()))}@wss://other`);
    a.stop();

    // `close()` 是**唯一**會設 `stopped = true`（停止重連）的地方。
    expect(closed).toContain("home");
    expect(closed).toContain("wss://other");
  });

  it("在線判定用**對方自報的心跳節奏**——閒置聯絡人（5 分鐘一次）不該被判離線", () => {
    const net = createInMemoryRelayNetwork();
    const contacts: { pubkey: string; status: string }[][] = [];
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a.start({ ...noop, onContacts: (cs) => contacts.push(cs.map((c) => ({ pubkey: c.pubkey, status: c.status }))) });
    b.start(noop);
    a.addContact(b.selfNpub);
    b.setStatus("online"); // Bob 發心跳（自報節奏）
    // 收到心跳不會立刻 emitContacts（在線圓點只在 renderTimer 週期更新）→ 用一個會觸發
    // emitContacts 的動作把當下狀態逼出來。
    a.addContact(npubEncode(getPublicKey(generateSecretKey())));

    // 修正前：硬比 90 秒（＝3× 舊的 30 秒心跳）。ADR-0109 後閒置者每 300 秒才發一次
    // → 90 秒的窗會讓他每 5 分鐘只亮 90 秒，一直閃。
    const last = contacts[contacts.length - 1]!;
    expect(last.find((c) => c.pubkey === b.self.pubkey)?.status).toBe("online");
    a.stop();
    b.stop();
  });
});

describe("typing／nudge 封裝（ADR-0120）", () => {
  it("端到端：typing 與 nudge 仍然收得到（封裝不能把功能弄壞）", () => {
    const net = createInMemoryRelayNetwork();
    const typing: string[] = [];
    const nudged: string[] = [];
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start({ ...noop, onTyping: (pk) => typing.push(pk), onNudge: (pk) => nudged.push(pk) });
    a.addContact(b.selfNpub);
    b.addContact(a.selfNpub); // Bob 也要認得 Alice，否則會被「只收聯絡人」的把關擋下

    a.sendTyping(b.self.pubkey);
    a.sendNudge(b.self.pubkey);

    expect(typing).toEqual([a.self.pubkey]); // 解出來的是**真實**寄件人，不是外層臨時金鑰
    expect(nudged).toEqual([a.self.pubkey]);
    a.stop();
    b.stop();
  });

  it("🔴 **中繼看不到寄件人**——線上流量裡不含 Alice 的 pubkey", () => {
    const net = createInMemoryRelayNetwork();
    const seen: NostrEvent[] = [];
    // 攔在 client.publish：這就是**真正上線的位元組**，中繼看到什麼、這裡就是什麼。
    const wiretap = (h: RelayClientHandlers): CloseableRelayClient => {
      const c = net.connect("a", h) as CloseableRelayClient;
      const publish = c.publish.bind(c);
      c.publish = (e: NostrEvent) => {
        seen.push(e);
        publish(e);
      };
      return c;
    };
    const a = new RelayChatBackend(new MemoryStorage(), wiretap, "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub);
    seen.length = 0; // 忽略連線時的心跳與個人檔

    a.sendTyping(b.self.pubkey);
    a.sendNudge(b.self.pubkey);

    const evts = seen.filter((e) => e.kind === KIND.TYPING || e.kind === KIND.NUDGE);
    expect(evts).toHaveLength(2);
    for (const e of evts) {
      // 修正前：`e.pubkey === a.self.pubkey`，收件人在 tag 裡——一條已簽章、有時間戳的有向邊。
      // 中繼把它和兩秒後那則寄給 Bob 的 kind 1059 一關聯，就反推出 Gift Wrap 的寄件人。
      expect(e.pubkey).not.toBe(a.self.pubkey);
      expect(JSON.stringify(e)).not.toContain(a.self.pubkey);
      expect(e.tags).toContainEqual(["p", b.self.pubkey]); // 收件人仍明文——與 1059 一致
    }
    a.stop();
    b.stop();
  });

  it("🔴 **陌生人的 nudge 要丟掉**——過去是 `authors:` 過濾器在擋，拿掉後只剩程式碼把關", () => {
    const net = createInMemoryRelayNetwork();
    const nudged: string[] = [];
    const typing: string[] = [];
    const victim = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("v", h), "Victim");
    const stranger = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("s", h), "Stranger");
    victim.start({ ...noop, onNudge: (pk) => nudged.push(pk), onTyping: (pk) => typing.push(pk) });
    stranger.start(noop);

    // 直接對著 pubkey 開炮——不先加好友、不先傳訊。這正是騷擾者會做的事：
    // 掃到一個 pubkey 就狂發 nudge（震動裝置、跳通知）。
    //
    // 封裝前，`authors: [聯絡人們]` 這個過濾器讓這種攻擊在**中繼端**就被丟掉。封裝後外層作者
    // 是臨時金鑰，過濾器不能再帶 authors → 這一層防護只剩客戶端的 `senderOfSealed()`。
    stranger.sendNudge(victim.self.pubkey);
    stranger.sendTyping(victim.self.pubkey);

    expect(nudged).toEqual([]);
    expect(typing).toEqual([]);
    victim.stop();
    stranger.stop();
  });

  it("封鎖的人 nudge 不到你", () => {
    const net = createInMemoryRelayNetwork();
    const nudged: string[] = [];
    const me = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("m", h), "Me");
    const jerk = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("j", h), "Jerk");
    me.start({ ...noop, onNudge: (pk) => nudged.push(pk) });
    jerk.start(noop);
    me.addContact(jerk.selfNpub);
    jerk.addContact(me.selfNpub);
    me.blockContact(jerk.self.pubkey);

    jerk.sendNudge(me.self.pubkey);
    expect(nudged).toEqual([]);
    me.stop();
    jerk.stop();
  });
});

describe("訊息請求（ADR-0121）", () => {
  /** 陌生人（我從沒加過）直接對著我的 pubkey 發訊息。 */
  const strangerSends = (text = "哈囉，我是陌生人") => {
    const net = createInMemoryRelayNetwork();
    const sv = new MemoryStorage();
    const msgs: string[] = [];
    const requests: { pubkey: string; name: string }[][] = [];
    const nudged: string[] = [];
    const typed: string[] = [];
    const me = new RelayChatBackend(sv, (h) => net.connect("me", h), "我");
    const stranger = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("x", h), "陌生人");
    me.start({
      ...noop,
      onMessage: (_c, m) => msgs.push(m.text),
      onRequests: (r) => requests.push(r),
      onNudge: (pk) => nudged.push(pk),
      onTyping: (pk) => typed.push(pk),
    });
    stranger.start(noop);
    stranger.sendMessage(me.self.pubkey, text);
    return { me, stranger, sv, msgs, requests, nudged, typed };
  };

  it("🔴 陌生人的訊息**不會**讓他變成聯絡人——他停在請求區", () => {
    const { me, stranger, sv, msgs, requests } = strangerSends();

    // 修正前：`ensureContact(sender)` 讓他直接進聯絡人清單。沒有任何確認步驟——
    // 「好友請求」這個概念在專案裡根本不存在。
    expect(sv.loadContacts()).toEqual([]);
    expect(sv.loadRequests().map((r) => r.pubkey)).toEqual([stranger.self.pubkey]);
    expect(requests[requests.length - 1]?.map((r) => r.pubkey)).toEqual([stranger.self.pubkey]);

    // 訊息本身照收——Nostr 上擋不掉（中繼一定會轉發指名你的 1059），
    // 只是它歸在請求區，由使用者決定要不要理。
    expect(msgs).toEqual(["哈囉，我是陌生人"]);
    expect(sv.loadMessages(stranger.self.pubkey)).toHaveLength(1);
    me.stop();
    stranger.stop();
  });

  it("🔴 **請求者不能 nudge 你**——這正是 ADR-0120 那道把關被繞過的路", () => {
    const { me, stranger, nudged, typed } = strangerSends();

    // ADR-0120 的把關是「只收聯絡人的 nudge/typing」。但在此之前，只要先傳一則訊息就會
    // 自動變成聯絡人 → 把關形同虛設。現在他停在請求區＝**不是聯絡人** → 真的擋住了。
    stranger.sendNudge(me.self.pubkey);
    stranger.sendTyping(me.self.pubkey);

    expect(nudged).toEqual([]);
    expect(typed).toEqual([]);
    me.stop();
    stranger.stop();
  });

  it("**不回送個人檔給請求者**——那等於向垃圾訊息發送者確認「這把金鑰是活的」", () => {
    const net = createInMemoryRelayNetwork();
    const learned: { pubkey: string; name: string }[][] = [];
    const me = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("me", h), "我");
    const stranger = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("x", h), "垃圾");
    me.start(noop);
    stranger.start({ ...noop, onContacts: (cs) => learned.push(cs.map((c) => ({ pubkey: c.pubkey, name: c.name }))) });

    stranger.addContact(me.selfNpub); // 單方面加我 → 送出他的個人檔（ADR-0061）
    // 我不該回送我的暱稱 → 他的聯絡人清單裡我仍是 npub 縮寫，學不到「我」這個名字。
    const last = learned[learned.length - 1] ?? [];
    expect(last.find((c) => c.pubkey === me.self.pubkey)?.name).not.toBe("我");
    me.stop();
    stranger.stop();
  });

  it("接受請求 → 變成聯絡人，此後 nudge、上線狀態、通知都通了", () => {
    const { me, stranger, sv, nudged } = strangerSends();

    me.acceptRequest(stranger.self.pubkey);

    expect(sv.loadRequests()).toEqual([]);
    expect(sv.loadContacts().map((c) => c.pubkey)).toEqual([stranger.self.pubkey]);
    expect(sv.loadMessages(stranger.self.pubkey)).toHaveLength(1); // 訊息保留

    stranger.sendNudge(me.self.pubkey);
    expect(nudged).toEqual([stranger.self.pubkey]); // 現在收得到了
    me.stop();
    stranger.stop();
  });

  it("刪除請求 → 請求與他傳來的訊息一起清掉（但不封鎖，他還能再傳）", () => {
    const { me, stranger, sv } = strangerSends();

    me.declineRequest(stranger.self.pubkey);

    expect(sv.loadRequests()).toEqual([]);
    expect(sv.loadContacts()).toEqual([]);
    expect(sv.loadMessages(stranger.self.pubkey)).toEqual([]);
    expect(sv.loadBlocked()).toEqual([]); // 刪除 ≠ 封鎖
    me.stop();
    stranger.stop();
  });

  it("封鎖請求者 → 請求消失，且進封鎖名單", () => {
    const { me, stranger, sv } = strangerSends();

    me.blockContact(stranger.self.pubkey);

    expect(sv.loadRequests()).toEqual([]);
    expect(sv.loadBlocked().map((b) => b.pubkey)).toEqual([stranger.self.pubkey]);
    me.stop();
    stranger.stop();
  });

  it("**我主動加的好友**傳訊息 → 直接是聯絡人，不會掉進請求區", () => {
    const net = createInMemoryRelayNetwork();
    const sv = new MemoryStorage();
    const me = new RelayChatBackend(sv, (h) => net.connect("me", h), "我");
    const friend = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("f", h), "朋友");
    me.start(noop);
    friend.start(noop);
    me.addContact(friend.selfNpub); // 我主動加的
    friend.sendMessage(me.self.pubkey, "嗨");

    expect(sv.loadRequests()).toEqual([]);
    expect(sv.loadContacts().map((c) => c.pubkey)).toEqual([friend.self.pubkey]);
    me.stop();
    friend.stop();
  });

  it("**對方「把你加為好友」本身就是一則請求**——而且請求區顯示他自選的暱稱", () => {
    const net = createInMemoryRelayNetwork();
    const sv = new MemoryStorage();
    const me = new RelayChatBackend(sv, (h) => net.connect("me", h), "我");
    const stranger = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("x", h), "小明");
    me.start(noop);
    stranger.start(noop);

    // 「把你加為好友」＝送一份自己的個人檔給你（ADR-0061）。那份個人檔就是請求的載體：
    // 你會在請求區看到「小明」，而不是 `npub1abc…`——否則你根本無從判斷要不要接受。
    stranger.addContact(me.selfNpub);

    expect(sv.loadContacts()).toEqual([]); // 他還不是我的聯絡人
    expect(sv.loadRequests().map((r) => r.name)).toEqual(["小明"]);
    me.stop();
    stranger.stop();
  });

  it("重載後請求區還在（持久化 ＋ 開機時 emit）", () => {
    const { me, stranger, sv } = strangerSends();
    me.stop();

    const requests: { pubkey: string; name: string }[][] = [];
    const net2 = createInMemoryRelayNetwork();
    const again = new RelayChatBackend(sv, (h) => net2.connect("me", h), "我");
    again.start({ ...noop, onRequests: (r) => requests.push(r) });

    expect(requests[0]?.map((r) => r.pubkey)).toEqual([stranger.self.pubkey]);
    again.stop();
    stranger.stop();
  });
});

describe("訊息請求：不給垃圾訊息發送者任何回饋（ADR-0121）", () => {
  it("🔴 預覽請求裡的訊息**不送已讀回條**——那等於回報「這個 npub 是活的」", () => {
    const net = createInMemoryRelayNetwork();
    const reads: string[] = [];
    const me = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("me", h), "我");
    const spammer = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("s", h), "垃圾");
    me.start(noop);
    spammer.start({ ...noop, onMessageStatus: (_c, id, st) => reads.push(`${id}:${st}`) });
    me.setReadReceipts(true); // 就算開了回條也一樣
    spammer.setReadReceipts(true); // 而且他也開了（ADR-0058 的互惠條件成立）→ 他看得到才對

    spammer.sendMessage(me.self.pubkey, "點這個連結");
    me.markRead(spammer.self.pubkey); // 使用者點開請求看了一眼

    expect(reads.filter((r) => r.endsWith(":read"))).toEqual([]);
    me.stop();
    spammer.stop();
  });

  it("接受之後，已讀回條才會送出（功能沒被弄壞）", () => {
    const net = createInMemoryRelayNetwork();
    const reads: string[] = [];
    const me = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("me", h), "我");
    const friend = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("f", h), "朋友");
    me.start(noop);
    friend.start({ ...noop, onMessageStatus: (_c, id, st) => reads.push(`${id}:${st}`) });
    me.setReadReceipts(true);
    friend.setReadReceipts(true);

    friend.sendMessage(me.self.pubkey, "嗨");
    me.acceptRequest(friend.self.pubkey);
    me.markRead(friend.self.pubkey);

    expect(reads.filter((r) => r.endsWith(":read"))).toHaveLength(1);
    me.stop();
    friend.stop();
  });

  it("**主動回覆一個請求＝接受他**（不然你在跟一個「請求」聊天）", () => {
    const net = createInMemoryRelayNetwork();
    const sv = new MemoryStorage();
    const me = new RelayChatBackend(sv, (h) => net.connect("me", h), "我");
    const stranger = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("x", h), "陌生人");
    me.start(noop);
    stranger.start(noop);
    stranger.sendMessage(me.self.pubkey, "哈囉");

    me.sendMessage(stranger.self.pubkey, "你是誰？");

    expect(sv.loadRequests()).toEqual([]);
    expect(sv.loadContacts().map((c) => c.pubkey)).toEqual([stranger.self.pubkey]);
    me.stop();
    stranger.stop();
  });
});

describe("身分守衛（ADR-0122）", () => {
  it("🔴 **拿不到金鑰時絕不產生新身分**——那會把使用者換成另一個人", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);

    // 瀏覽器版的實況：儲存是用 nsec 導出的 DEK 加密的，重載後拿不到 nsec →
    // `loadIdentity()` 回 null。過去這裡會走 `generateSecretKey()`：
    // **使用者按一下重新整理就變成另一個人**，舊資料全部讀不出來，
    // 而且新的明文 nsec 被寫進 localStorage。
    expect(store.loadIdentity()).toBeNull();

    expect(() => new RelayChatBackend(store, (h) => net.connect("x", h), "我", { expectPubkey: pubkey })).toThrow(
      IDENTITY_UNAVAILABLE,
    );
    // 而且**什麼都沒被寫進去**——不能留下一個半生不熟的新身分。
    expect(store.loadIdentity()).toBeNull();
  });

  it("解出來的 pubkey 與期待不符 → 拋錯（錯的金鑰／儲存毀損）", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const someoneElse = getPublicKey(generateSecretKey());

    expect(
      () =>
        new RelayChatBackend(store, (h) => net.connect("x", h), "我", {
          nsecOverride: nsecEncode(generateSecretKey()), // 另一把金鑰
          expectPubkey: someoneElse,
        }),
    ).toThrow(IDENTITY_MISMATCH);
  });

  it("金鑰對得上 → 照常建立（守衛不擋正常路徑）", () => {
    const net = createInMemoryRelayNetwork();
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("x", h), "我", {
      nsecOverride: nsecEncode(sk),
      expectPubkey: pubkey,
    });
    expect(b.self.pubkey).toBe(pubkey);
    b.stop();
  });

  it("沒傳 expectPubkey → 沿用舊行為（CLI／測試／首次登入仍可自動產生）", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const b = new RelayChatBackend(store, (h) => net.connect("x", h), "我");
    expect(store.loadIdentity()?.nsec).toBeTruthy();
    b.stop();
  });
});

describe("訊息請求防洪（ADR-0127）", () => {
  /** 讓 N 個不同的陌生人各對我發一則訊息（每個都是新 pubkey → 新請求）。 */
  const flood = (me: RelayChatBackend, net: ReturnType<typeof createInMemoryRelayNetwork>, n: number) => {
    for (let i = 0; i < n; i++) {
      const s = new RelayChatBackend(new MemoryStorage(), (h) => net.connect(`x${i}`, h), `S${i}`);
      s.start(noop);
      s.sendMessage(me.self.pubkey, `spam ${i}`);
      s.stop();
    }
  };

  it("🔴 **請求區有上限**——大量陌生人灌爆時 FIFO 逐出最舊，不無界成長", () => {
    const net = createInMemoryRelayNetwork();
    const sv = new MemoryStorage();
    const me = new RelayChatBackend(sv, (h) => net.connect("me", h), "我");
    me.start(noop);

    flood(me, net, 130); // > MAX_REQUESTS(100)

    // 修正前：請求區與儲存都會被撐到 130（無界）。現在封在 100。
    expect(sv.loadRequests().length).toBe(100);
    me.stop();
  });

  it("逐出的請求**連同訊息一起清掉**——儲存不被撐爆", () => {
    const net = createInMemoryRelayNetwork();
    const sv = new MemoryStorage();
    const me = new RelayChatBackend(sv, (h) => net.connect("me", h), "我");
    me.start(noop);

    // 記下第一個灌入者，稍後應被逐出。
    const first = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("first", h), "First");
    first.start(noop);
    first.sendMessage(me.self.pubkey, "我最早");
    first.stop();
    expect(sv.loadMessages(first.self.pubkey)).toHaveLength(1);

    flood(me, net, 105); // 把 first 擠出上限

    expect(sv.loadRequests().some((r) => r.pubkey === first.self.pubkey)).toBe(false); // 被逐出
    expect(sv.loadMessages(first.self.pubkey)).toEqual([]); // 訊息也清了
    me.stop();
  });

  it("**全部刪除**：一次清空請求區與所有訊息（被灌爆時的出路）", () => {
    const net = createInMemoryRelayNetwork();
    const sv = new MemoryStorage();
    const cleared: number[] = [];
    const me = new RelayChatBackend(sv, (h) => net.connect("me", h), "我");
    me.start({ ...noop, onRequests: (r) => cleared.push(r.length) });

    flood(me, net, 30);
    expect(sv.loadRequests().length).toBe(30);

    me.clearRequests();

    expect(sv.loadRequests()).toEqual([]);
    expect(cleared[cleared.length - 1]).toBe(0); // UI 收到空清單
    // 訊息也全清了。
    expect(Object.keys(sv.exportSnapshot().messages).every((k) => sv.loadMessages(k).length === 0)).toBe(true);
    me.stop();
  });

  it("全部刪除**不封鎖**——被清掉的人還能再傳（會變成新的請求）", () => {
    const net = createInMemoryRelayNetwork();
    const sv = new MemoryStorage();
    const me = new RelayChatBackend(sv, (h) => net.connect("me", h), "我");
    const s = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("s", h), "S");
    me.start(noop);
    s.start(noop);
    s.sendMessage(me.self.pubkey, "一");
    me.clearRequests();
    expect(sv.loadBlocked()).toEqual([]); // 沒被封鎖
    s.sendMessage(me.self.pubkey, "二"); // 又是一則新請求
    expect(sv.loadRequests().map((r) => r.pubkey)).toEqual([s.self.pubkey]);
    me.stop();
    s.stop();
  });
});

describe("在線狀態內容改走封裝（ADR-0129）", () => {
  const onContacts = (sink: { pubkey: string; status: string; statusMessage: string; nowPlaying: string }[][]) =>
    (cs: { pubkey: string; status: string; statusMessage: string; nowPlaying: string }[]) =>
      sink.push(cs.map((c) => ({ pubkey: c.pubkey, status: c.status, statusMessage: c.statusMessage, nowPlaying: c.nowPlaying })));

  /** Alice←→Bob 互為聯絡人、都在線。 */
  const pairOnline = (net: ReturnType<typeof createInMemoryRelayNetwork>) => {
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const bSees: { pubkey: string; status: string; statusMessage: string; nowPlaying: string }[][] = [];
    a.start(noop);
    b.start({ ...noop, onContacts: onContacts(bSees) });
    a.addContact(b.selfNpub);
    b.acceptRequest(a.self.pubkey);
    a.setStatus("online");
    b.setStatus("online");
    return { a, b, bSees };
  };
  const latest = (rows: { pubkey: string; status: string; statusMessage: string; nowPlaying: string }[][], pk: string) =>
    [...rows].reverse().flat().find((c) => c.pubkey === pk);

  it("🔴 **中繼的心跳不含 s/m/np**——relay 再也讀不到你的狀態文字與音樂", () => {
    const seen: NostrEvent[] = [];
    const net = createInMemoryRelayNetwork();
    const wiretap = (h: RelayClientHandlers): CloseableRelayClient => {
      const c = net.connect("a", h) as CloseableRelayClient;
      const publish = c.publish.bind(c);
      c.publish = (e: NostrEvent) => {
        seen.push(e);
        publish(e);
      };
      return c;
    };
    const a = new RelayChatBackend(new MemoryStorage(), wiretap, "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub);
    b.acceptRequest(a.self.pubkey);
    a.setStatus("online", "我在發呆");
    a.setNowPlaying("某首歌 - 某歌手");

    // 心跳（kind 20000）內容一律空——修正前這裡是明文 JSON {s,m,np}。
    const beacons = seen.filter((e) => e.kind === KIND.HEARTBEAT);
    expect(beacons.length).toBeGreaterThan(0);
    for (const beat of beacons) expect(beat.content).toBe("");
    // 而且整條上線流量裡，明文都找不到「我在發呆」或那首歌（封裝的是密文）。
    const wire = JSON.stringify(seen);
    expect(wire).not.toContain("我在發呆");
    expect(wire).not.toContain("某首歌");
    a.stop();
    b.stop();
  });

  it("狀態文字與音樂**仍送達聯絡人**（透過封裝，非 P2P 環境走 relay）", () => {
    const net = createInMemoryRelayNetwork();
    const { a, b, bSees } = pairOnline(net);
    a.setStatus("online", "我在發呆");
    a.setNowPlaying("某首歌");

    const seen = latest(bSees, a.self.pubkey);
    expect(seen?.statusMessage).toBe("我在發呆");
    expect(seen?.nowPlaying).toBe("某首歌");
    a.stop();
    b.stop();
  });


  it("🔴 **剛上線的聯絡人被補送我先前設好的狀態**——不需我再改一次（catch-up）", () => {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const bSees: { pubkey: string; status: string; statusMessage: string; nowPlaying: string }[][] = [];
    a.start(noop);
    b.start({ ...noop, onContacts: onContacts(bSees) });
    a.addContact(b.selfNpub);
    b.acceptRequest(a.self.pubkey);
    // Bob 隱身 → 對 Alice 完全不廣播（Alice 看不到 Bob 在線）。
    b.setInvisible(true);
    // Alice 設好狀態。Bob 此刻在 Alice 眼中是離線 → Alice **不會**封裝給他（他錯過這次改變）。
    a.setStatus("online", "我在發呆");
    a.setNowPlaying("某首歌");
    expect(latest(bSees, a.self.pubkey)?.statusMessage ?? "").toBe(""); // Bob 還沒拿到

    // Bob 復出上線 → 送信標 → Alice 偵測「Bob 離線→上線」→ **補送**當下狀態（Alice 沒再改一次）。
    b.setInvisible(false);
    b.setStatus("online");

    const seen = latest(bSees, a.self.pubkey);
    expect(seen?.statusMessage).toBe("我在發呆"); // 靠 catch-up 拿到
    expect(seen?.nowPlaying).toBe("某首歌");
    a.stop();
    b.stop();
  });

  it("**陌生人不能注入在線狀態**（封裝狀態只採用聯絡人的）", () => {
    const net = createInMemoryRelayNetwork();
    const sv = new MemoryStorage();
    const seen: { pubkey: string; status: string; statusMessage: string; nowPlaying: string }[][] = [];
    const me = new RelayChatBackend(sv, (h) => net.connect("me", h), "我");
    const stranger = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("x", h), "陌生人");
    me.start({ ...noop, onContacts: onContacts(seen) });
    stranger.start(noop);
    // 陌生人直接對我封裝一個在線狀態——我不是他的聯絡人關係，且他不是我的聯絡人。
    stranger.addContact(me.selfNpub); // 他把我當聯絡人，但我沒接受他
    stranger.setStatus("online", "假狀態");
    stranger.setNowPlaying("假音樂");

    // 我這邊：陌生人不在我的聯絡人清單（他在請求區）→ 不採用他的封裝狀態，也不顯示。
    expect(seen.flat().find((c) => c.statusMessage === "假狀態")).toBeUndefined();
    me.stop();
    stranger.stop();
  });
});

describe("早到的群訊：緩存＋加入後重放（ADR-0131）", () => {
  /** 用原始封裝直接送（控制 group-create 與群訊的抵達順序）。 */
  const setup = () => {
    const net = createInMemoryRelayNetwork();
    const aSk = generateSecretKey();
    const aPk = getPublicKey(aSk);
    const aClient = net.connect("a", { onEvent: () => {} });
    const bMsgs: ChatMessage[] = [];
    const unread: Record<string, number>[] = [];
    const sv = new MemoryStorage();
    const b = new RelayChatBackend(sv, (h) => net.connect("b", h), "Bob");
    b.start({ ...noop, onMessage: (_c, m) => bMsgs.push(m), onUnread: (u) => unread.push(u) });
    const gid = "aa".repeat(16); // groupId＝16 bytes hex
    const members = [aPk, b.self.pubkey];
    const group = { id: gid, name: "專案群", admin: aPk, members };
    const sendMsg = (text: string, now?: number) => {
      for (const evt of wrapGroupMessage(text, aSk, aPk, group, now !== undefined ? { now } : {}).events) aClient.publish(evt);
    };
    const sendCreate = () => {
      const control = { type: "group-create", id: gid, name: "專案群", admin: aPk, members } as const;
      for (const evt of wrapGroupControl(control, aSk, [b.self.pubkey])) aClient.publish(evt);
    };
    return { b, sv, bMsgs, unread, gid, sendMsg, sendCreate };
  };

  it("🔴 **群訊比 group-create 先到 → 緩存後重放**（不再一被加進群就漏掉開頭）", () => {
    const { b, bMsgs, gid, sendMsg, sendCreate } = setup();

    sendMsg("開頭第一則", 1000); // 群訊先到——Bob 還沒這個群
    sendMsg("開頭第二則", 1001);
    expect(bMsgs).toEqual([]); // 修正前：直接丟棄，永遠不見

    sendCreate(); // group-create 後到 → 實例化 → 重放緩存

    expect(bMsgs.map((m) => m.text)).toEqual(["開頭第一則", "開頭第二則"]); // 依送出時間補回來
    b.stop();
  });

  it("**假 `g` tag 的群訊只被緩存後逐出，從不入庫**（永遠沒有 group-create）", () => {
    const { b, sv, bMsgs, sendMsg } = setup();
    sendMsg("假群訊"); // 送了訊息，但**永不** sendCreate

    expect(bMsgs).toEqual([]); // 沒被建立的群 → 從不重放
    expect(sv.loadMessages("aa".repeat(16))).toEqual([]); // 也沒入庫
    b.stop();
  });

  it("**跨中繼重複不重複計數**——同 rumor.id 只緩存一次、重放一次", () => {
    const { b, sv, bMsgs, gid, sendMsg, sendCreate } = setup();
    // 同一則訊息送兩次、**釘同一個 now**（不同外層 wrap、相同內層 rumor.id）——模擬跨中繼重複。
    sendMsg("只算一次", 2000);
    sendMsg("只算一次", 2000);
    sendCreate();

    expect(bMsgs.filter((m) => m.text === "只算一次")).toHaveLength(1); // 去重
    expect(sv.loadMessages(gid).filter((m) => m.text === "只算一次")).toHaveLength(1);
    b.stop();
  });
});
