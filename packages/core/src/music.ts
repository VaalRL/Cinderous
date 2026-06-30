import { KIND } from "./constants.js";
import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import { finalizeEvent } from "./sign.js";
import { LatestPerKey } from "./tracker.js";

/**
 * 建立一筆「正在聆聽音樂」事件（Kind 20002，Ephemeral）。
 * `status` 為系統 API 取得的狀態字串；空字串代表停止播放。
 */
export function createMusicStatus(
  sk: SecretKey,
  status: string,
  opts: { created_at?: number } = {},
): NostrEvent {
  return finalizeEvent(
    {
      kind: KIND.MUSIC,
      created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
      tags: [],
      content: status,
    },
    sk,
  );
}

/** 讀取音樂狀態事件的狀態字串。 */
export function readMusicStatus(event: NostrEvent): string {
  return event.content;
}

/** 記錄各好友目前播放的音樂（取最新 created_at；空字串視為停止）。 */
export class NowPlayingStore {
  private readonly latest = new LatestPerKey<string>();

  observe(pubkey: PubkeyHex, status: string, createdAtSec: number): void {
    this.latest.observe(pubkey, createdAtSec, status);
  }

  /** 目前播放的狀態字串；停止或未知時回 undefined。 */
  statusOf(pubkey: PubkeyHex): string | undefined {
    const status = this.latest.value(pubkey);
    return status === undefined || status === "" ? undefined : status;
  }
}
