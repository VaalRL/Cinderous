// 歷史紀錄（ADR-0111）：讀**封存**的舊訊息。
//
// 主對話視窗只讀熱區（最近 5,000 則）——這是為了把每一條熱路徑的成本結構性地綁住。
// 更舊的訊息在封存裡（分塊、加密、獨立基質），由這個視窗**分頁**讀出，一次只載入一塊。
//
// 它是**非同步**的，而主視窗是同步的——這正是冷熱分離最漂亮的地方：非同步只存在於這裡，
// 完全不污染主視窗。

import { type MessageArchive, type StoredMessage } from "@cinder/engine";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n.js";

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

  const loadOlder = useCallback(async () => {
    if (busy || total === null) return;
    const next = loadedFrom === -1 ? total - 1 : loadedFrom - 1; // 由新到舊
    if (next < 0) return;
    setBusy(true);
    try {
      const chunk = await props.archive.loadChunk(props.convo, next);
      // 以 id 去重：「先寫封存、後裁切熱區」的當機窗口可能讓同一則出現兩次（刻意：寧可重複，絕不遺失）。
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...chunk.filter((m) => !seen.has(m.id)), ...prev];
      });
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
    };
  }, [props.archive, props.convo]);

  // 取得塊數後自動載入最新的一塊。
  useEffect(() => {
    if (total !== null && total > 0 && loadedFrom === -1) void loadOlder();
  }, [total, loadedFrom, loadOlder]);

  const hasMore = total !== null && loadedFrom > 0;

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
      <div className="hist__body">
        {total === 0 ? <p className="hist__empty">{t("history_empty")}</p> : null}
        {hasMore ? (
          <button className="hist__more" disabled={busy} onClick={() => void loadOlder()} data-testid="history-older">
            {busy ? t("history_loading") : t("history_older")}
          </button>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={`hist__msg${m.outgoing ? " hist__msg--out" : ""}`}>
            <span className="hist__meta">
              {fmtTime(m.at)} · {m.outgoing ? props.selfLabel : props.name}
            </span>
            <span className="hist__text">{m.file ? `📎 ${m.file.name}` : m.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
