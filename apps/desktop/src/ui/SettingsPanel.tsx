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
  readReceipts?: boolean;
  onToggleReadReceipts?: () => void;
  /** 貼上時清除網址追蹤參數（ADR-0038）；未提供則不顯示該區塊。 */
  cleanOnPaste?: boolean;
  onToggleCleanOnPaste?: () => void;
  onClose: () => void;
  /** 清除指向某座 stale relay 的聯絡人 hint（ADR-0036）。 */
  onRelayClear?: (url: string) => void;
  /** 確認保留某座 stale relay（暫時隱藏警告）。 */
  onRelayKeep?: (url: string) => void;
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
                        <span className="settings__stalebox">
                          <em className="settings__stale" title={t("settings_relayStale")}>
                            ⚠ {t("settings_relayStale")}
                          </em>
                          {props.onRelayKeep ? (
                            <button
                              type="button"
                              className="settings__staleact"
                              title={t("settings_relayKeepTitle")}
                              onClick={() => props.onRelayKeep?.(r.url)}
                            >
                              {t("settings_relayKeep")}
                            </button>
                          ) : null}
                          {props.onRelayClear ? (
                            <button
                              type="button"
                              className="settings__staleact settings__staleact--danger"
                              title={t("settings_relayClear")}
                              onClick={() => {
                                if (window.confirm(t("settings_relayClearConfirm", { url: r.url }))) {
                                  props.onRelayClear?.(r.url);
                                }
                              }}
                            >
                              {t("settings_relayClear")}
                            </button>
                          ) : null}
                        </span>
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

          {props.onToggleCleanOnPaste ? (
            <section className="settings__sec">
              <h4>{t("settings_privacy")}</h4>
              <label className="settings__toggle">
                <input
                  type="checkbox"
                  data-testid="clean-on-paste"
                  checked={props.cleanOnPaste ?? true}
                  onChange={props.onToggleCleanOnPaste}
                />
                <span>{t("settings_cleanOnPaste")}</span>
              </label>
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

          {props.onToggleReadReceipts ? (
            <section className="settings__sec">
              <h4>{t("settings_readReceipts")}</h4>
              <label className="settings__toggle">
                <input
                  type="checkbox"
                  checked={props.readReceipts ?? false}
                  onChange={props.onToggleReadReceipts}
                />
                <span>{t("settings_readReceiptsHint")}</span>
              </label>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
