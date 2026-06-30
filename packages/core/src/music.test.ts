import { describe, expect, it } from "vitest";
import { KIND } from "./constants.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { createMusicStatus, NowPlayingStore, readMusicStatus } from "./music.js";
import { verifyEvent } from "./sign.js";

const sk = generateSecretKey();
const pk = getPublicKey(sk);

describe("正在聆聽音樂（Kind 20002 / Ephemeral）", () => {
  it("產生 kind 20002、content 為狀態字串、驗章通過", () => {
    const e = createMusicStatus(sk, "🎵 Daft Punk - Get Lucky", { created_at: 1 });
    expect(e.kind).toBe(KIND.MUSIC);
    expect(e.pubkey).toBe(pk);
    expect(readMusicStatus(e)).toBe("🎵 Daft Punk - Get Lucky");
    expect(verifyEvent(e)).toBe(true);
  });
});

describe("NowPlayingStore — 最新狀態", () => {
  it("記錄並更新某人的目前播放，亂序較舊忽略", () => {
    const store = new NowPlayingStore();
    store.observe(pk, "Song A", 100);
    expect(store.statusOf(pk)).toBe("Song A");
    store.observe(pk, "Song B", 200);
    expect(store.statusOf(pk)).toBe("Song B");
    store.observe(pk, "Song OLD", 50);
    expect(store.statusOf(pk)).toBe("Song B");
  });

  it("空字串代表停止播放（回 undefined）", () => {
    const store = new NowPlayingStore();
    store.observe(pk, "Song", 100);
    store.observe(pk, "", 200);
    expect(store.statusOf(pk)).toBeUndefined();
  });

  it("未知者回 undefined", () => {
    expect(new NowPlayingStore().statusOf(pk)).toBeUndefined();
  });
});
