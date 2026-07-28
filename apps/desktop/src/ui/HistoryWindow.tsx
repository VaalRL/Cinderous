// 歷史紀錄（ADR-0111）：讀**封存**的舊訊息。
//
// 主對話視窗只讀熱區（最近 5,000 則）——這是為了把每一條熱路徑的成本結構性地綁住。
// 更舊的訊息在封存裡（分塊、加密、獨立基質），由這個視窗**分頁**讀出，一次只載入一塊。
//
// 它是**非同步**的，而主視窗是同步的——這正是冷熱分離最漂亮的地方：非同步只存在於這裡，
// 完全不污染主視窗。
//
// 封存搜尋（ADR-0256 階段 3）：由新到舊**逐塊解密掃描、即掃即棄**——不建持久明文索引
// （那會在加密儲存旁放一份可搜明文，掏空 ADR-0054）。掃描進度即時回饋、可清除中止。

import { type MessageArchive, nextOlderChunk, prependChunk, type StoredMessage } from "@cinderous/engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n.js";
import { matchesStored } from "./msg-search.js";

interface Props {
  convo: string;
  name: string;
  archive: MessageArchive;
  selfLabel: string;
  onClose: () => void;
}

/** 決定性時間字串（本地時區）。 */
function fmtTime(atMs: number): string {
  const d = new Date(atMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function HistoryWindow(props: Props): JSX.Element {
  const { t } = useI18n();
  const [total, setTotal] = useState<number | null>(null);
  /** 已載入的最舊塊號 −1 表示還沒載入任何塊。 */
  const [loadedFrom, setLoadedFrom] = useState<number>(-1);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [busy, setBusy] = useState(false);
  // 封存搜尋（ADR-0256）：scanned=null＝非搜尋模式；scanGen 世代計數讓新搜尋/清除使舊掃描失效。
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StoredMessage[]>([]);
  const [scanned, setScanned] = useState<number | null>(null);
  const scanGen = useRef(0);
  const searching = scanned !== null;

  const loadOlder = useCallback(async () => {
    if (busy || total === null) return;
    const next = nextOlderChunk(total, loadedFrom); // 由新到舊（分頁邏輯在 engine，與行動端共用）
    if (next === null) return;
    setBusy(true);
    try {
      const chunk = await props.archive.loadChunk(props.convo, next);
      setMessages((prev) => prependChunk(prev, chunk)); // 以 id 去重（ADR-0111）
      setLoadedFrom(next);
    } finally {
      setBusy(false);
    }
  }, [busy, loadedFrom, props.archive, props.convo, total]);

  useEffect(() => {
    let cancelled = false;
    void props.archive.chunkCount(props.convo).then((n) => {
      if (!cancelled) setTotal(n);
    });
    return () => {
      cancelled = true;
      scanGen.current++; // 卸載＝中止進行中的掃描
    };
  }, [props.archive, props.convo]);

  // 取得塊數後自動載入最新的一塊。
  useEffect(() => {
    if (total !== null && total > 0 && loadedFrom === -1) void loadOlder();
  }, [total, loadedFrom, loadOlder]);

  /** 逐塊掃描（新→舊）：每塊解密→比對→丟棄；命中即時列出（新在上）。 */
  const runSearch = useCallback(async () => {
    const q = query.trim().toLowerCase();
    if (!q || total === null || total === 0) return;
    const gen = ++scanGen.current;
    setHits([]);
    setScanned(0);
    for (let i = total - 1; i >= 0; i--) {
      const chunk = await props.archive.loadChunk(props.convo, i);
      if (scanGen.current !== gen) return; // 已被新搜尋/清除/卸載取代
      const found = chunk.filter((m) => matchesStored(m, q)).reverse(); // 塊內新→舊
      if (found.length > 0) setHits((prev) => [...prev, ...found]);
      setScanned(total - i);
    }
  }, [query, total, props.archive, props.convo]);

  const clearSearch = (): void => {
    scanGen.current++;
    setScanned(null);
    setHits([]);
    setQuery("");
  };

  const hasMore = total !== null && loadedFrom > 0;
  const scanDone = searching && scanned === total;

  const row = (m: StoredMessage): JSX.Element => (
    <div key={m.id} className={`hist__msg${m.outgoing ? " hist__msg--out" : ""}`}>
      <span className="hist__meta">
        {fmtTime(m.at)} · {m.outgoing ? props.selfLabel : props.name}
      </span>
      <span className="hist__text">{m.file ? `📎 ${m.file.name}` : m.text}</span>
    </div>
  );

  return (
    <div className="win hist" data-testid="history-window">
      <div className="win__bar">
        <span className="win__title">
          {t("history_title")} — {props.name}
        </span>
        <span className="win__btn" role="button" aria-label={t("convo_close")} onClick={props.onClose}>
          ×
        </span>
      </div>
      <div className="hist__search">
        <input
          data-testid="history-search"
          aria-label={t("history_search")}
          placeholder={t("history_search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runSearch();
          }}
        />
        <button
          type="button"
          data-testid="history-search-go"
          aria-label={t("convo_search")}
          disabled={!query.trim() || total === null || total === 0}
          onClick={() => void runSearch()}
        >
          🔍
        </button>
        {searching ? (
          <button type="button" data-testid="history-search-clear" onClick={clearSearch}>
            {t("history_searchClear")}
          </button>
        ) : null}
      </div>
      <div className="hist__body">
        {searching ? (
          <>
            <p className="hist__scan" data-testid="history-scan">
              {t("history_scanning", { done: scanned ?? 0, total: total ?? 0 })}
            </p>
            {scanDone && hits.length === 0 ? <p className="hist__empty">{t("convo_searchNone")}</p> : null}
            {hits.map(row)}
          </>
        ) : (
          <>
            {total === 0 ? <p className="hist__empty">{t("history_empty")}</p> : null}
            {hasMore ? (
              <button className="hist__more" disabled={busy} onClick={() => void loadOlder()} data-testid="history-older">
                {busy ? t("history_loading") : t("history_older")}
              </button>
            ) : null}
            {messages.map(row)}
          </>
        )}
      </div>
    </div>
  );
}
