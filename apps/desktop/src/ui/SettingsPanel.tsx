import { useState } from "react";
import { useI18n } from "../i18n.js";

/** Relay pool 一座的連線狀態（ADR-0034）。 */
export interface RelayPoolEntry {
  url: string;
  state: "connecting" | "online" | "offline";
  home: boolean;
  /** 連續離線過久，hint 可能過期（ADR-0036）。 */
  stale?: boolean;
}

export interface SettingsPanelProps {
  /** 目前使用的中繼站網址；空字串表示示範模式。 */
  relayUrl: string;
  /** Relay pool 各座連線狀態（多中繼時才有；ADR-0034）。 */
  relays?: RelayPoolEntry[];
  /** 自己的 nsec 私鑰（僅本機備份用；示範模式為 undefined）。 */
  selfNsec?: string;
  /** 桌面通知是否啟用。 */
  notifications: boolean;
  onToggleNotifications: () => void;
  onClose: () => void;
}

const STATE_DOT: Record<RelayPoolEntry["state"], string> = {
  online: "🟢",
  connecting: "🟡",
  offline: "🔴",
};

/** 設定面板：中繼站、身分備份（私鑰）、桌面通知。 */
export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const { t } = useI18n();
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!props.selfNsec) return;
    void navigator.clipboard?.writeText(props.selfNsec).then(
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
    <div className="modal" role="dialog" aria-modal="true" aria-label={t("settings_title")}>
      <div className="modal__box win">
        <div className="win__title">
          <span>{t("settings_title")}</span>
          <span className="spacer" />
          <span
            className="win__btn"
            role="button"
            aria-label={t("settings_close")}
            onClick={props.onClose}
          >
            ×
          </span>
        </div>
        <div className="settings__body">
          <section className="settings__sec">
            <h4>{t("settings_relayUrl")}</h4>
            {props.relays && props.relays.length > 0 ? (
              <ul className="settings__relays" data-testid="relay-pool">
                {props.relays.map((r) => {
                  const stateLabel = {
                    online: t("conn_state_online"),
                    connecting: t("conn_state_connecting"),
                    offline: t("conn_state_offline"),
                  }[r.state];
                  return (
                    <li key={r.url || "(home)"} className="settings__relayrow">
                      <span aria-label={stateLabel} title={stateLabel}>{STATE_DOT[r.state]}</span>{" "}
                      <code>{r.url || t("settings_relayDemo")}</code>
                      {r.home ? <em className="settings__home">{t("settings_relayHome")}</em> : null}
                      {r.stale ? (
                        <em className="settings__stale" title={t("settings_relayStale")}>
                          ⚠ {t("settings_relayStale")}
                        </em>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="settings__relay">{props.relayUrl || t("settings_relayDemo")}</div>
            )}
          </section>

          {props.selfNsec ? (
            <section className="settings__sec">
              <h4>{t("settings_identityBackup")}</h4>
              <p className="settings__warn">⚠️ {t("settings_identityWarning")}</p>
              {reveal ? (
                <div className="settings__key">
                  <code data-testid="nsec">{props.selfNsec}</code>
                  <div className="settings__keyrow">
                    <button onClick={copy}>{copied ? t("settings_copied") : t("settings_copyKey")}</button>
                    <button onClick={() => setReveal(false)}>{t("settings_hideKey")}</button>
                  </div>
                </div>
              ) : (
                <button className="settings__reveal" onClick={() => setReveal(true)}>
                  {t("settings_revealKey")}
                </button>
              )}
            </section>
          ) : null}

          <section className="settings__sec">
            <h4>{t("settings_notifications")}</h4>
            <label className="settings__toggle">
              <input
                type="checkbox"
                checked={props.notifications}
                onChange={props.onToggleNotifications}
              />
              <span>{t("settings_notificationsHint")}</span>
            </label>
          </section>
        </div>
      </div>
    </div>
  );
}
