// ⚠⚠ 這是一份**特徵化測試（characterization test）**：它斷言的是**目前的錯誤行為**，
// 不是規格。ADR-0294 §1 記錄了它證實的兩個缺陷；**修好之後這裡會紅**，屆時應把斷言
// 改成正確行為（重開不重收、缺塊要報錯），而不是把測試刪掉。
//
// 檔案塊訂閱的重取行為（ADR-0288 §2.2／§2.3 的查證）：那份研究只做靜態閱讀、明載
// 「未寫測試重現」。本檔把它變成事實。
//
// ⚠ 兩個把前兩次嘗試導向錯誤結論的測試環境預設值，寫在這裡免得下次再踩：
//   1. `createInMemoryRelayNetwork` **預設不收檔案塊**（企業限定，ADR-0162）→ 要 `acceptFileEvents: true`；
//   2. 它**預設沒有離線留言庫** → 不給 `store` 就沒有東西可重放，測不到重取行為。
//
// 待驗的斷言：檔案塊訂閱 `{kinds:[FILE_WRAP], "#p": me}` **沒有 `since` 水位**
// （同一個 subscribe 呼叫裡，離線私訊那條有 `inboxSince(url)`），加上
// 中繼不因送達而刪、`seenEvt` 純記憶體不持久化
// ⇒ **重開 App 會把 TTL 內收過的檔案整份重收、重組，並再交一次給 App**。

import { generateSecretKey, getPublicKey, npubEncode, nsecEncode, wrapFileChunk } from "@cinderous/core";
import { createInMemoryRelayNetwork, MessageStore } from "@cinderous/relay";
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import { RelayChatBackend } from "./relay-backend.js";
import type { ChatBackendEvents } from "./types.js";

const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };

/** 把一個 3 塊的小檔以寄件人身分直接發到中繼（繞過送端的組織政策設定）。 */
function publishFile(
  net: ReturnType<typeof createInMemoryRelayNetwork>,
  senderSk: Uint8Array,
  toPk: string,
  tid: string,
): void {
  const pub = net.connect(`sender-${tid}`, {});
  const parts = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]), new Uint8Array([7, 8])];
  for (let seq = 0; seq < parts.length; seq++) {
    pub.publish(
      wrapFileChunk(
        { tid, seq, total: parts.length, name: "報表.bin", mime: "application/octet-stream", data: parts[seq]! },
        senderSk,
        toPk,
      ),
    );
  }
}

describe("檔案塊訂閱缺少水位的後果（ADR-0288 §2.3）", () => {
  it("⚠ 重開 App → TTL 內收過的檔案被整份重收並**再交一次**給 App", () => {
    // ⚠ 中繼預設整類拒收檔案塊（企業限定，ADR-0162）——測試要明示開啟。
    // ⚠ 記憶體網路預設**沒有離線留言庫**——不給 store 就沒有東西可重放，測不到重取行為。
    const net = createInMemoryRelayNetwork({ acceptFileEvents: true, store: new MessageStore() });
    const senderSk = generateSecretKey();
    const senderPk = getPublicKey(senderSk);

    const store = new MemoryStorage();
    const bobSk = generateSecretKey();
    const bobNsec = nsecEncode(bobSk);

    // 第一次開機：Bob 上線、把寄件人加為聯絡人（收檔要求對方是聯絡人）。
    const first: string[] = [];
    const bob = new RelayChatBackend(store, (h) => net.connect("bob1", h), "Bob", { nsecOverride: bobNsec });
    bob.start({ ...noop, onFileBytes: (_pk, _mid, f) => first.push(f.id) });
    bob.addContact(npubEncode(senderPk));

    publishFile(net, senderSk, bob.self.pubkey, "tid-1");
    expect(first).toEqual(["tid-1"]); // 正常收到一次
    bob.stop();

    // 第二次開機：同一份儲存、同一座中繼。中繼上的檔案塊還在（沒到 TTL、也沒被送達刪除）。
    const second: string[] = [];
    const bob2 = new RelayChatBackend(store, (h) => net.connect("bob2", h), "Bob", { nsecOverride: bobNsec });
    bob2.start({ ...noop, onFileBytes: (_pk, _mid, f) => second.push(f.id) });

    // ⚠ 這一行斷言的是**缺陷**：檔案被重新交付了一次。修好後應改為 `toEqual([])`。
    expect(second).toEqual(["tid-1"]);
    bob2.stop();
  });

  it("對照組：離線私訊有水位（`inboxSince`）→ 重開不重收", () => {
    const net = createInMemoryRelayNetwork();
    const aliceSk = generateSecretKey();
    const store = new MemoryStorage();
    const bobSk = generateSecretKey();
    const bobNsec = nsecEncode(bobSk);

    const alice = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("alice", h), "Alice", {
      nsecOverride: nsecEncode(aliceSk),
    });
    const bob = new RelayChatBackend(store, (h) => net.connect("bob1", h), "Bob", { nsecOverride: bobNsec });
    const firstMsgs: string[] = [];
    alice.start(noop);
    bob.start({ ...noop, onMessage: (_pk, m) => firstMsgs.push(m.id) });
    alice.addContact(bob.selfNpub);
    alice.sendMessage(bob.self.pubkey, "午安");
    expect(firstMsgs).toHaveLength(1);
    bob.stop();

    const again: string[] = [];
    const bob2 = new RelayChatBackend(store, (h) => net.connect("bob2", h), "Bob", { nsecOverride: bobNsec });
    bob2.start({ ...noop, onMessage: (_pk, m) => again.push(m.id) });
    // 訊息這條路徑有水位＋歷史回放走 onHistory，不該再以「新訊息」交付一次。
    expect(again).toEqual([]);
    alice.stop();
    bob2.stop();
  });
});

describe("截斷後的靜默失敗（ADR-0288 §2.2）", () => {
  it("⚠ 缺一塊 → **永遠不重組、也沒有任何錯誤訊號**（寄件者卻已看到「已送出」）", () => {
    const net = createInMemoryRelayNetwork({ acceptFileEvents: true, store: new MessageStore() });
    const senderSk = generateSecretKey();
    const senderPk = getPublicKey(senderSk);
    const bobSk = generateSecretKey();

    const got: string[] = [];
    const errors: string[] = [];
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", h), "Bob", {
      nsecOverride: nsecEncode(bobSk),
    });
    bob.start({ ...noop, onFileBytes: (_pk, _mid, f) => got.push(f.id), onFileError: (_pk, r) => errors.push(r) });
    bob.addContact(npubEncode(senderPk));

    // 模擬中繼在 MAX_QUERY_ROWS 截斷後的結果：最舊那一塊沒送到（seq 0 缺席）。
    const pub = net.connect("sender", {});
    const parts = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];
    for (let seq = 1; seq < parts.length; seq++) {
      pub.publish(
        wrapFileChunk(
          { tid: "cut", seq, total: parts.length, name: "報表.bin", mime: "application/octet-stream", data: parts[seq]! },
          senderSk,
          bob.self.pubkey,
        ),
      );
    }

    expect(got).toEqual([]); // 檔案永遠交付不出來
    expect(errors).toEqual([]); // ⚠ 而且**一個錯誤都沒有**——這才是問題所在
    bob.stop();
  });
});
