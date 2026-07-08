import { useState } from "react";
import { useI18n } from "../i18n.js";
import { REWRITE_STYLES } from "../native/ollama.js";

/**
 * composer 的本機 AI 改寫入口（✨）：風格快選 + 自由指示 → 改寫 → **先預覽再採用**（ADR-0060）。
 * 不直接洗掉草稿；採用才 onAdopt 取代。onRewrite 由上層注入（Tauri 走 Rust IPC）。
 */
export function ComposerRewrite({
  text,
  onRewrite,
  onAdopt,
}: {
  text: string;
  onRewrite: (text: string, instruction: string) => Promise<string>;
  onAdopt: (rewritten: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");

  const run = async (instr: string): Promise<void> => {
    const trimmed = instr.trim();
    if (!text.trim() || !trimmed || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await onRewrite(text, trimmed));
    } catch {
      setError(t("ai_unavailable"));
    } finally {
      setBusy(false);
    }
  };

  const close = (): void => {
    setOpen(false);
    setResult(null);
    setError("");
  };

  return (
    <div className="rewrite">
      <button
        type="button"
        className="rewrite__btn"
        title={t("ai_rewrite")}
        aria-label={t("ai_rewrite")}
        data-testid="ai-rewrite-btn"
        disabled={!text.trim()}
        onClick={() => setOpen((o) => !o)}
      >
        ✨
      </button>
      {open ? (
        <div className="rewrite__panel" data-testid="ai-rewrite-panel">
          {result === null ? (
            <>
              <div className="rewrite__styles">
                {REWRITE_STYLES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className="rewrite__style"
                    disabled={busy}
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
                  disabled={busy}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void run(instruction);
                  }}
                />
                <button
                  type="button"
                  className="rewrite__go"
                  disabled={busy || !instruction.trim()}
                  onClick={() => void run(instruction)}
                >
                  {t("ai_rewrite")}
                </button>
              </div>
              {busy ? <div className="rewrite__busy">{t("ai_rewriting")}</div> : null}
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
