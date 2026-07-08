import { useI18n } from "../i18n.js";

/** 未讀對話的本機 AI 摘要視窗（點開對話前預覽；ADR-0060）。輸入為他人訊息，明確標示 AI 生成。 */
export function SummaryModal({
  status,
  text,
  contactName,
  onOpen,
  onClose,
}: {
  status: "busy" | "done" | "error" | "empty";
  text: string;
  contactName: string;
  onOpen: () => void;
  onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t("ai_summaryTitle")} onClick={onClose}>
      <div className="modal__box win summary" data-testid="summary-modal" onClick={(e) => e.stopPropagation()}>
        <div className="win__title">
          <span>🧠 {t("ai_summaryTitle")}：{contactName}</span>
          <span className="spacer" />
          <span className="win__btn" role="button" aria-label={t("convo_close")} onClick={onClose}>×</span>
        </div>
        <div className="summary__body">
          {status === "busy" ? <div className="summary__msg">{t("ai_summarizing")}</div> : null}
          {status === "empty" ? <div className="summary__msg">{t("ai_summaryEmpty")}</div> : null}
          {status === "error" ? <div className="summary__msg">{t("ai_unavailable")}</div> : null}
          {status === "done" ? (
            <>
              <div className="summary__text">{text}</div>
              <div className="summary__note">{t("ai_summaryDisclaimer")}</div>
            </>
          ) : null}
          <div className="summary__actions">
            <button type="button" className="pill" onClick={onOpen}>{t("ai_summaryOpen")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
