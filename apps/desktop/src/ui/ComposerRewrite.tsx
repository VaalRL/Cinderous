import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n.js";
import { REWRITE_STYLES, type RewriteStream } from "../native/ollama.js";

/**
 * composer 的本機 AI 改寫入口（✨）：風格快選 + 自由指示 → 改寫 → **先預覽再採用**（ADR-0060）。
 * 不直接洗掉草稿；採用才 onAdopt 取代。點面板外關閉、開啟時預偵測可用性、作廢過期結果。
 * 改寫中逐段顯示模型的輸出，可按取消中止；產生完才能採用（ADR-0416）。
 */
export function ComposerRewrite({
  text,
  onRewrite,
  onAdopt,
  onCheckAvailable,
}: {
  text: string;
  onRewrite: (text: string, instruction: string, stream?: RewriteStream) => Promise<string>;
  onAdopt: (rewritten: string) => void;
  /** 開啟時預先偵測 Ollama 是否可用（未提供則不預檢）。 */
  onCheckAvailable?: () => Promise<boolean>;
}): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [partial, setPartial] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const runId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  /** 作廢並中止進行中的改寫（不再耗用 provider 額度）。 */
  const stop = (): void => {
    runId.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setPartial("");
  };

  const close = (): void => {
    stop();
    setOpen(false);
    setResult(null);
    setError("");
  };

  const run = async (instr: string): Promise<void> => {
    const trimmed = instr.trim();
    if (!text.trim() || !trimmed || busy) return;
    const id = ++runId.current;
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError("");
    setResult(null);
    setPartial("");
    const onDelta = (delta: string): void => {
      if (id === runId.current) setPartial((p) => p + delta);
    };
    try {
      const out = await onRewrite(text, trimmed, { onDelta, signal: ac.signal });
      if (id === runId.current) setResult(out);
    } catch {
      if (id === runId.current) setError(t("ai_unavailable"));
    } finally {
      if (id === runId.current) {
        setBusy(false);
        setPartial("");
        abortRef.current = null;
      }
    }
  };

  // 卸載（換對話、關視窗）時中止進行中的改寫。
  useEffect(() => () => abortRef.current?.abort(), []);

  // 點面板外關閉（與 StatusPicker 一致）。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // 開啟時預偵測可用性（沒開 Ollama 就提示）。
  useEffect(() => {
    if (!open || !onCheckAvailable) return;
    let alive = true;
    setAvailable(null);
    void onCheckAvailable().then((ok) => {
      if (alive) setAvailable(ok);
    });
    return () => {
      alive = false;
    };
  }, [open, onCheckAvailable]);

  const disabled = busy || available === false;

  return (
    <div className="rewrite" ref={ref}>
      <button
        type="button"
        className="rewrite__btn"
        title={t("ai_rewrite")}
        aria-label={t("ai_rewrite")}
        data-testid="ai-rewrite-btn"
        disabled={!text.trim()}
        onClick={() => (open ? close() : setOpen(true))}
      >
        ✨
      </button>
      {open ? (
        <div className="rewrite__panel" data-testid="ai-rewrite-panel">
          {available === false ? <div className="rewrite__error">{t("ai_unavailable")}</div> : null}
          {result === null ? (
            <>
              <div className="rewrite__styles">
                {REWRITE_STYLES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className="rewrite__style"
                    disabled={disabled}
                    onClick={() => void run(s.instruction)}
                  >
                    {t(s.labelKey)}
                  </button>
                ))}
              </div>
              <div className="rewrite__custom">
                <input
                  aria-label={t("ai_rewrite")}
                  value={instruction}
                  placeholder={t("ai_rewriteHint")}
                  disabled={disabled}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void run(instruction);
                  }}
                />
                <button
                  type="button"
                  className="rewrite__go"
                  disabled={disabled || !instruction.trim()}
                  onClick={() => void run(instruction)}
                >
                  {t("ai_rewrite")}
                </button>
              </div>
              {busy ? (
                <div className="rewrite__busy">
                  {partial ? (
                    <div className="rewrite__result rewrite__result--streaming" data-testid="ai-rewrite-streaming">
                      {partial}
                    </div>
                  ) : (
                    t("ai_rewriting")
                  )}
                  <button type="button" className="rewrite__cancel" data-testid="ai-rewrite-stop" onClick={stop}>
                    {t("ai_cancel")}
                  </button>
                </div>
              ) : null}
              {error ? <div className="rewrite__error">{error}</div> : null}
            </>
          ) : (
            <div className="rewrite__preview" data-testid="ai-rewrite-preview">
              <div className="rewrite__result">{result}</div>
              <div className="rewrite__actions">
                <button
                  type="button"
                  className="rewrite__adopt"
                  onClick={() => {
                    onAdopt(result);
                    close();
                  }}
                >
                  {t("ai_adopt")}
                </button>
                <button type="button" className="rewrite__cancel" onClick={() => setResult(null)}>
                  {t("ai_cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
