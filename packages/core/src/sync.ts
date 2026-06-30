/** 可變狀態的一筆值（last-writer-wins 以 updatedAt 比較）。 */
export interface MutableEntry {
  value: string;
  updatedAt: number;
}

/** 一次增量同步：新訊息（以 id 去重）與可變狀態變更（LWW）。 */
export interface SyncDelta {
  messages?: ReadonlyArray<{ id: string }>;
  state?: Record<string, MutableEntry>;
}

/**
 * 多設備同步的本機收斂狀態：
 * - 訊息以 event id 去重（集合語意，順序無關）。
 * - 可變狀態（已讀位置、暱稱、封鎖等）採 last-writer-wins。
 *
 * 兩者皆為交換律（commutative）：不同設備以任意順序套用相同的 delta，
 * 最終會收斂到一致狀態。
 */
export class DeviceSyncState {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];
  private readonly state = new Map<string, MutableEntry>();

  apply(delta: SyncDelta): void {
    for (const message of delta.messages ?? []) {
      if (!this.seen.has(message.id)) {
        this.seen.add(message.id);
        this.order.push(message.id);
      }
    }
    for (const [key, entry] of Object.entries(delta.state ?? {})) {
      const current = this.state.get(key);
      if (current === undefined || entry.updatedAt > current.updatedAt) {
        this.state.set(key, entry);
      }
    }
  }

  /** 目前已知的所有訊息 id（依首次出現順序）。 */
  messageIds(): string[] {
    return [...this.order];
  }

  /** 取得某可變狀態鍵的當前值。 */
  get(key: string): string | undefined {
    return this.state.get(key)?.value;
  }
}
