import { useEffect, useState } from "react";
import { useI18n } from "../i18n.js";
import { qrSvg } from "../qr.js";

/** 配對階段（舊機視角）：顯示載荷 → 等新機接上 → SAS 確認 → 傳送 → 完成/失敗。 */
export type PairPhase =
  | { kind: "offer"; code: string; expiresAt: number }
  | { kind: "sas"; sas: string }
  | { kind: "sending" }
  | { kind: "done" }
  | { kind: "error"; message: string };

/**
 * 配對新裝置（舊機／資料持有方，ADR-0072）：
 * 產生一次性載荷（QR＋字串）→ 新機接上後顯示 SAS 短碼 → 使用者確認相符才送出全量捆包。
 * 載荷短時效＋一次性房間＋SAS：即使載荷被剪貼簿竊取，沒有本人按下確認也拿不到資料。
 */
export function PairDeviceModal({
  phase,
  onConfirm,
  onReject,
  onClose,
}: {
  phase: PairPhase;
  onConfirm: () => void;
  onReject: () => void;
  onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [left, setLeft] = useState(0);

  const expiresAt = phase.kind === "offer" ? phase.expiresAt : 0;
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const copy = (code: string) => {
    void navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* 剪貼簿不可用時忽略 */
      },
    );
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t("pair_title")} onClick={onClose}>
      <div className="modal__box win" onClick={(e) => e.stopPropagation()}>
        <div className="win__title">
          <span>{t("pair_title")}</span>
          <span className="spacer" />
          <span className="win__btn" role="button" aria-label={t("settings_close")} onClick={onClose}>
            ×
          </span>
        </div>
        <div className="groupmodal">
          {phase.kind === "offer" ? (
            <div className="settings__key" data-testid="pair-offer">
              <p className="hint">{t("pair_offerHint")}</p>
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(qrSvg(phase.code))}`}
                alt="pairing QR"
                style={{ maxWidth: 180, alignSelf: "center" }}
              />
              <code style={{ wordBreak: "break-all", maxHeight: 80, overflowY: "auto" }}>{phase.code}</code>
              <div className="settings__keyrow">
                <button type="button" onClick={() => copy(phase.code)}>
                  {copied ? t("settings_copied") : t("settings_copyKey")}
                </button>
                <span className="hint" data-testid="pair-countdown">
                  {t("pair_expiresIn", { sec: String(left) })}
                </span>
              </div>
              <p className="settings__warn">⚠️ {t("pair_clipboardWarn")}</p>
            </div>
          ) : null}

          {phase.kind === "sas" ? (
            <div className="settings__key" data-testid="pair-sas">
              <p className="hint">{t("pair_sasHint")}</p>
              <code style={{ fontSize: 32, textAlign: "center", letterSpacing: 8 }}>{phase.sas}</code>
              <div className="settings__keyrow">
                <button type="button" data-testid="pair-confirm" onClick={onConfirm}>
                  {t("pair_sasMatch")}
                </button>
                <button type="button" className="settings__staleact--danger" data-testid="pair-reject" onClick={onReject}>
                  {t("pair_sasMismatch")}
                </button>
              </div>
            </div>
          ) : null}

          {phase.kind === "sending" ? <p className="hint" data-testid="pair-sending">{t("pair_sending")}</p> : null}
          {phase.kind === "done" ? <p className="hint" data-testid="pair-done">{t("pair_done")}</p> : null}
          {phase.kind === "error" ? (
            <p className="settings__warn" data-testid="pair-error">
              {phase.message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
