// 訊息封存（ADR-0111）：冷熱分離。
//
// **熱區**（`AppStorage`，同步）只保留最近 {@link HOT_CAP} 則；更舊的移入**封存**（非同步、
// 分塊、獨立基質）。主視窗只讀熱區——於是每一條熱路徑的成本都被**結構性地綁住**，
// 與總歷史長度無關（ADR-0110 把常數壓下來了，但沒把 N 綁住；這裡才綁住）。
//
// 這同時修好一個既有的資料遺失：ADR-0094 的保留上限是 `list.splice()`——**直接刪掉**。
// 現在是「封存而非刪除」。

import type { MemoryStorage } from "./memory.js";
import { redactedCopy, type StoredMessage } from "./types.js";

/** 熱區每對話保留的訊息數（ADR-0111）。主視窗、未讀、回條水位都只碰這一段。 */
export const HOT_CAP = 5_000;

/** 每個封存塊的訊息數。塊＝分頁單位（歷史 UI 往回翻只讀需要的那塊）。 */
export const ARCHIVE_CHUNK = 1_000;

/**
 * 訊息封存（**非同步**）。
 *
 * 之所以能是非同步而不污染同步的 `AppStorage`：封存**只被兩個地方讀**——歷史紀錄 UI
 * 與匯出，兩者天生可以非同步。熱區（主視窗）完全不碰封存。
 *
 * 實作見：桌面 `TauriArchive`（加密檔，AES-256-GCM）、行動/網頁 `OpfsArchive`（OPFS）。
 */
export interface MessageArchive {
  /** 追加一塊（時間遞增；由 {@link ArchiveWriter} 保證每塊恰好 {@link ARCHIVE_CHUNK} 則）。 */
  append(convo: string, messages: StoredMessage[]): Promise<void>;
  /** 某對話的封存塊數（0＝無封存）。 */
  chunkCount(convo: string): Promise<number>;
  /** 讀第 `seq` 塊（`0`＝最舊）。不存在回空陣列。 */
  loadChunk(convo: string, seq: number): Promise<StoredMessage[]>;
  /** 移除某對話的**全部**封存（刪好友/封鎖/退群）。 */
  remove(convo: string): Promise<void>;
}

/**
 * 歷史紀錄分頁游標（ADR-0111）：由**新到舊**逐塊往回翻。
 *
 * `loadedFrom` 為已載入的最舊塊號，`-1` 表示尚未載入任何塊。回傳下一個該載入的塊號；
 * 已翻到最舊一塊時回 `null`。
 *
 * 抽成純函式是為了讓桌面（`HistoryWindow`）與行動（`HistoryScreen`）共用同一份邏輯
 * ——兩邊的 UI 都用 SSR 渲染測試（無 effect），這裡才測得到分頁的正確性。
 */
export function nextOlderChunk(total: number, loadedFrom: number): number | null {
  const next = loadedFrom < 0 ? total - 1 : loadedFrom - 1;
  return next >= 0 ? next : null;
}

/**
 * 把更舊的一塊併到前面，並以 id **去重**。
 *
 * 去重不是防呆——「先寫封存、後裁切熱區」的當機窗口**會**讓同一則訊息同時存在於封存與熱區
 * （刻意：寧可重複，絕不遺失）。讀取端必須自己收斂。
 */
export function prependChunk(prev: StoredMessage[], chunk: StoredMessage[]): StoredMessage[] {
  const seen = new Set(prev.map((m) => m.id));
  return [...chunk.filter((m) => !seen.has(m.id)), ...prev];
}

/** 讀出某對話的全部封存訊息（時間遞增）。匯出用——可能很大，呼叫端自負記憶體。 */
export async function loadAllArchived(archive: MessageArchive, convo: string): Promise<StoredMessage[]> {
  const total = await archive.chunkCount(convo);
  const out: StoredMessage[] = [];
  for (let seq = 0; seq < total; seq++) out.push(...(await archive.loadChunk(convo, seq)));
  return out;
}

/**
 * 把熱區的溢出訊息搬進封存。
 *
 * **順序是正確性紅線**：先寫封存 → 成功後才裁切熱區。若中間當機，訊息會**同時**存在於
 * 封存與熱區（重複），讀取端以 id 去重即可——**寧可重複，絕不遺失**。反過來做（先裁切
 * 再寫封存）一旦當機就是永久遺失。
 *
 * 搬移以 promise 鏈**序列化**：同一個對話不會有兩次搬移交錯（否則會重複封存或裁錯量）。
 */
export class ArchiveWriter {
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly mem: MemoryStorage,
    private readonly archive: MessageArchive,
    /** 熱區被裁切後的落地回呼（讓持久層把縮短後的對話寫回）。 */
    private readonly onTrim: (convo: string) => void,
    private readonly hotCap: number = HOT_CAP,
  ) {}

  /** 排程一次搬移（收訊後呼叫；不足一塊則什麼都不做）。 */
  schedule(convo: string): void {
    this.chain = this.chain.then(() => this.run(convo)).catch((e: unknown) => {
      // 封存寫入失敗 → 熱區**不裁切**（訊息仍在，只是熱區暫時超過上限）。不可讓失敗變成遺失。
      console.warn("[archive] 搬移失敗，熱區保持不變：", e);
    });
  }

  /**
   * 移除某對話的全部封存——**排在在途搬移之後**（ADR-0413 審查）。
   *
   * 直接呼叫 `archive.remove` 會與正在寫的那一塊交錯：移除先列完目錄，那一塊之後才落地，
   * 於是「刪掉的對話」留下一塊讀得到的封存，重新加回同一個人就會出現在歷史裡。
   */
  remove(convo: string): void {
    this.chain = this.chain.then(() => this.archive.remove(convo)).catch((e: unknown) => {
      console.warn("[archive] 移除封存失敗：", e);
    });
  }

  /**
   * 身分輪替（ADR-0052）：把舊 npub 的封存搬到新 npub——**排在在途搬移之後**。
   *
   * 熱區由 `remapContact` 併過去了，封存沒有：不搬的話，新對話的歷史只看得到熱區那一段，
   * 更早的封存變成沒人讀、也永遠不會被刪的孤兒。
   *
   * 逐塊照原順序追加到新對話、全部寫完才移除舊的。寫到一半失敗＝**撤掉已寫進新對話的塊**、
   * 舊的原封保留——否則新對話留著半份重複歷史，而且之後也不會再搬（新對話已有封存就跳過）。
   * 撤得掉是因為：開始前確認過新對話是空的，而同一條佇列上不會有別的寫入插進來。
   * 新對話**已經有**封存時不搬（極少見）：搬過去會排在比它新的塊後面、歷史順序錯亂；
   * 舊的原封留著，不刪、不遺失，記一行警告。
   */
  remap(from: string, to: string): void {
    if (from === to) return;
    let wrote = false;
    this.chain = this.chain
      .then(async () => {
        const total = await this.archive.chunkCount(from);
        if (total === 0) return;
        if ((await this.archive.chunkCount(to)) > 0) {
          console.warn("[archive] 輪替後的新對話已有封存，舊封存保留在原處、沒有搬");
          return;
        }
        for (let seq = 0; seq < total; seq++) {
          const chunk = await this.archive.loadChunk(from, seq);
          wrote = true;
          await this.archive.append(
            to,
            chunk.map((m) => ({ ...m, contact: to })),
          );
        }
        await this.archive.remove(from);
      })
      .catch(async (e: unknown) => {
        console.warn("[archive] 輪替時搬移封存失敗（舊封存保留）：", e);
        if (!wrote) return;
        try {
          await this.archive.remove(to); // 撤掉寫了一半的（見上）
        } catch (e2: unknown) {
          console.warn("[archive] 撤回寫了一半的封存也失敗：", e2);
        }
      });
  }

  /** 等待所有在途搬移完成（關閉前 flush；測試亦用）。 */
  async flush(): Promise<void> {
    await this.chain;
  }

  private async run(convo: string): Promise<void> {
    // 有效熱區（ADR-0126）：使用者設了保留上限就用他的，否則用內部 HOT_CAP。
    // 於是「保留上限」與「熱區上限」收斂成同一個概念——溢出**封存**，不再有平行的刪除路徑。
    const hotCap = this.mem.retentionCap() > 0 ? this.mem.retentionCap() : this.hotCap;
    // 只在溢出滿一整塊時才搬 → 每塊大小固定，分頁單純。
    while (this.mem.loadMessages(convo).length >= hotCap + ARCHIVE_CHUNK) {
      const chunk = this.mem.oldest(convo, ARCHIVE_CHUNK);
      if (chunk.length < ARCHIVE_CHUNK) return;
      // ADR-0408：封存只能追加、事後改不了——限時訊息進封存前就拿掉原文，不等它到期。
      const archived = chunk.map((m) => (m.expiresAt !== undefined ? redactedCopy(m) : m));
      await this.archive.append(convo, archived); // ← 先寫封存
      this.mem.trimOldest(convo, chunk.length); // ← 成功後才裁切
      this.onTrim(convo);
    }
  }
}
