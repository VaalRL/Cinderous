import {
  KIND,
  PresenceTracker,
  type PresenceStatus,
  type PubkeyHex,
} from "@nostr-buddy/core";

export interface Friend {
  pubkey: PubkeyHex;
  name: string;
}

export interface FriendView extends Friend {
  status: PresenceStatus;
}

/** 心跳事件中與上線判定相關的最小欄位。 */
export interface HeartbeatLike {
  kind: number;
  pubkey: PubkeyHex;
  created_at: number;
}

/**
 * 桌面前端的上線狀態檢視來源：包裝 core 的 {@link PresenceTracker}，
 * 將收到的心跳對映成好友列表的上線/離線狀態（與 React 渲染解耦，方便測試）。
 */
export class PresenceStore {
  private readonly tracker = new PresenceTracker();
  private readonly friends: Friend[];

  constructor(friends: Friend[]) {
    this.friends = [...friends];
  }

  /** 直接記錄某好友的心跳（Nostr created_at，秒）。 */
  onHeartbeat(pubkey: PubkeyHex, createdAtSec: number): void {
    this.tracker.observe(pubkey, createdAtSec);
  }

  /** 由（已驗證的）事件擷取心跳；僅 Kind 20000 會更新上線狀態。 */
  ingestEvent(event: HeartbeatLike): void {
    if (event.kind === KIND.HEARTBEAT) {
      this.tracker.observe(event.pubkey, event.created_at);
    }
  }

  /** 取得指定時間點（毫秒）的好友列表檢視。 */
  view(nowMs: number): FriendView[] {
    return this.friends.map((f) => ({
      ...f,
      status: this.tracker.statusOf(f.pubkey, nowMs),
    }));
  }
}
