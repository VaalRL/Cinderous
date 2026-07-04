// 有界集合（審查 P1-4）：容量到頂時保留最近插入的一批，避免去重集合無界成長。
//
// 用於訊息/事件去重（seenMsg/seenEvt）：這些集合原本單調成長 → 長時間執行的記憶體洩漏。
// 逐出最舊項只是「去重快取失效」，被逐出的舊 id 若再現，仍有儲存層與 UI 層去重兜底。

/** 保留最近插入項的有界字串集合（Set 保序 → 逐出最舊）。 */
export class BoundedSet<T> {
  private set = new Set<T>();

  /**
   * @param max  容量上限（超過即修剪）。
   * @param keep 修剪後保留的最近項數（預設為 max 的一半）。
   */
  constructor(
    private readonly max: number,
    private readonly keep: number = Math.floor(max / 2),
  ) {}

  has(value: T): boolean {
    return this.set.has(value);
  }

  add(value: T): void {
    this.set.add(value);
    if (this.set.size > this.max) {
      const recent = [...this.set].slice(this.set.size - this.keep);
      this.set.clear();
      for (const v of recent) this.set.add(v);
    }
  }

  get size(): number {
    return this.set.size;
  }

  clear(): void {
    this.set.clear();
  }
}
