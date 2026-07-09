import { useEffect, useState } from "react";
import { ACCENT_PRESETS, useAccent } from "../accent.js";
import { useI18n } from "../i18n.js";
import {
  type AiProvider,
  hasApiKey,
  isLocalEndpoint,
  ollamaModels,
  PROVIDER_DEFAULTS,
  setApiKey,
} from "../native/ollama.js";

/** AI 改寫設定（ADR-0060/0062）。 */
export interface OllamaSettingsValue {
  provider?: AiProvider;
  endpoint: string;
  model: string;
  enabled: boolean;
  /** 僅允許 localhost 端點（預設 true）。 */
  localOnly?: boolean;
}

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
  /** 本機 AI 改寫設定（ADR-0060）；未提供則不顯示該區塊。 */
  ollama?: OllamaSettingsValue;
  onOllamaChange?: (next: OllamaSettingsValue) => void;
  /** 貼上時清除網址追蹤參數（ADR-0038）；未提供則不顯示該區塊。 */
  cleanOnPaste?: boolean;
  onToggleCleanOnPaste?: () => void;
  onClose: () => void;
  /** 清除指向某座 stale relay 的聯絡人 hint（ADR-0036）。 */
  onRelayClear?: (url: string) => void;
  /** 確認保留某座 stale relay（暫時隱藏警告）。 */
  onRelayKeep?: (url: string) => void;
  /** 更換 home relay（ADR-0066 H2）；未提供且非 relayLocked 則唯讀（示範模式）。 */
  onRelayChange?: (url: string) => void;
  /** 工作身分鎖定漫遊（ADR-0044/0048）：顯示鎖定說明而非更換鈕。 */
  relayLocked?: boolean;
  /** 進行中的舊站排水（ADR-0066 H3）：顯示舊站與截止時間。 */
  drain?: { url: string; until: number };
  /** 提前完成排水（確認後）。 */
  onDrainComplete?: () => void;
}

const STATE_DOT: Record<RelayPoolEntry["state"], string> = {
  online: "🟢",
  connecting: "🟡",
  offline: "🔴",
};

/** 主題色設定（ADR-0064）：預設色票 + 自訂色 + 重設；即時套用、只存本機。 */
function AccentSettings(): JSX.Element {
  const { t } = useI18n();
  const { accent, setAccent } = useAccent();
  const cur = accent?.toLowerCase();
  return (
    <section className="settings__sec">
      <h4>{t("settings_accent")}</h4>
      <div className="accent__row">
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`accent__sw${cur === p.hex.toLowerCase() ? " on" : ""}`}
            style={{ background: p.hex }}
            aria-label={p.key}
            title={p.key}
            onClick={() => setAccent(p.hex)}
          />
        ))}
        <label className="accent__custom" title={t("settings_accentCustom")}>
          <span aria-hidden="true">🎨</span>
          <input
            type="color"
            value={accent ?? "#2f6cd6"}
            aria-label={t("settings_accentCustom")}
            onChange={(e) => setAccent(e.target.value)}
          />
        </label>
        <button type="button" className="accent__reset" onClick={() => setAccent(null)} disabled={!accent}>
          {t("settings_accentReset")}
        </button>
      </div>
      <p className="settings__hint">{t("settings_accentHint")}</p>
    </section>
  );
}

/** 更換 relay 的輸入驗證（純函式可測）：ws(s):// 且與現值不同才可套用。 */
export function relayChangeReady(input: string, current: string): boolean {
  const v = input.trim();
  return /^wss?:\/\/./i.test(v) && v !== current;
}

/** 更換 home relay（ADR-0066 H2）：顯示＋更換；套用前確認，App 層再做正規化與守門。 */
function RelayChange({ current, onApply }: { current: string; onApply: (url: string) => void }): JSX.Element {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(current);
  if (!editing) {
    return (
      <button
        type="button"
        className="settings__reveal"
        data-testid="relay-change"
        onClick={() => {
          setUrl(current);
          setEditing(true);
        }}
      >
        {t("settings_relayChange")}
      </button>
    );
  }
  const target = url.trim();
  return (
    <div className="settings__key">
      <input
        aria-label={t("settings_relayUrl")}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="wss://"
      />
      <p className="hint">{t("settings_relayChangeHint")}</p>
      <div className="settings__keyrow">
        <button
          type="button"
          disabled={!relayChangeReady(url, current)}
          onClick={() => {
            if (window.confirm(t("settings_relayChangeConfirm", { url: target }))) onApply(target);
          }}
        >
          {t("settings_relayChangeApply")}
        </button>
        <button type="button" onClick={() => setEditing(false)}>
          {t("settings_relayChangeCancel")}
        </button>
      </div>
    </div>
  );
}

/** 設定面板：主題色、中繼站、身分備份（私鑰）、桌面通知。 */
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
          <AccentSettings />
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
            {props.onRelayChange ? (
              <RelayChange current={props.relayUrl} onApply={props.onRelayChange} />
            ) : null}
            {props.relayLocked ? (
              <p className="hint" data-testid="relay-locked">
                {t("settings_relayLocked")}
              </p>
            ) : null}
            {props.drain && props.onDrainComplete ? (
              <div className="settings__key" data-testid="relay-drain">
                <p className="hint">
                  {t("settings_relayDrain", {
                    url: props.drain.url,
                    date: new Date(props.drain.until).toLocaleString(),
                  })}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t("settings_relayDrainDoneConfirm"))) props.onDrainComplete?.();
                  }}
                >
                  {t("settings_relayDrainDone")}
                </button>
              </div>
            ) : null}
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
          {props.ollama && props.onOllamaChange ? (
            <OllamaSettings value={props.ollama} onChange={props.onOllamaChange} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 本機 AI 改寫設定區塊：啟用開關、端點、以及「從已安裝模型下拉選擇」（ADR-0060）。 */
function OllamaSettings({
  value,
  onChange,
}: {
  value: OllamaSettingsValue;
  onChange: (next: OllamaSettingsValue) => void;
}): JSX.Element {
  const { t } = useI18n();
  const provider: AiProvider = value.provider ?? "ollama";
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKeyInput] = useState("");
  const [keySet, setKeySet] = useState(false);
  const local = isLocalEndpoint(value.endpoint);

  const loadModels = async (): Promise<void> => {
    setLoading(true);
    try {
      setModels(await ollamaModels(value));
    } catch {
      setModels([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (value.enabled) void loadModels();
    if (provider === "openai") void hasApiKey("openai").then(setKeySet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.enabled, value.endpoint, provider]);

  // 切換 provider 帶入預設端點/模型；線上服務預設關「僅本機」（否則會被硬守則擋）。
  const switchProvider = (p: AiProvider): void =>
    onChange({ ...value, provider: p, ...PROVIDER_DEFAULTS[p], localOnly: p === "ollama" });
  const saveKey = async (): Promise<void> => {
    if (!apiKey.trim()) return;
    await setApiKey(provider, apiKey.trim());
    setApiKeyInput("");
    setKeySet(true);
  };

  // 下拉一定包含目前選的模型（即使尚未載到清單），避免顯示空白。
  const options = models.includes(value.model) ? models : [value.model, ...models].filter(Boolean);

  return (
    <section className="settings__sec">
      <h4>{t("settings_ollama")}</h4>
      <label className="settings__toggle">
        <input type="checkbox" checked={value.enabled} onChange={() => onChange({ ...value, enabled: !value.enabled })} />
        <span>{t("ai_rewrite")}</span>
      </label>
      {value.enabled ? (
        <div className="settings__ollama">
          <label className="settings__field">
            <span>{t("settings_aiProvider")}</span>
            <select
              value={provider}
              onChange={(e) => switchProvider(e.target.value as AiProvider)}
              data-testid="ai-provider"
            >
              <option value="ollama">{t("settings_aiProviderOllama")}</option>
              <option value="openai">{t("settings_aiProviderOpenai")}</option>
            </select>
          </label>
          <label className="settings__field">
            <span>{t("settings_ollamaEndpoint")}</span>
            <input value={value.endpoint} onChange={(e) => onChange({ ...value, endpoint: e.target.value })} />
          </label>
          {provider === "openai" ? (
            <label className="settings__field">
              <span>
                {t("settings_aiApiKey")}
                {keySet ? " ✓" : ""}
              </span>
              <span className="settings__modelrow">
                <input
                  type="password"
                  value={apiKey}
                  placeholder={keySet ? "••••••" : ""}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                />
                <button type="button" disabled={!apiKey.trim()} onClick={() => void saveKey()}>
                  {t("settings_aiSaveKey")}
                </button>
              </span>
            </label>
          ) : null}
          <label className="settings__toggle">
            <input
              type="checkbox"
              checked={value.localOnly !== false}
              onChange={() => onChange({ ...value, localOnly: !(value.localOnly !== false) })}
            />
            <span>{t("settings_ollamaLocalOnly")}</span>
          </label>
          {value.localOnly === false && !local ? <div className="settings__warn">{t("ai_nonLocalWarn")}</div> : null}
          {value.localOnly !== false && !local ? <div className="settings__warn">{t("ai_localOnlyBlocks")}</div> : null}
          <label className="settings__field">
            <span>{t("settings_ollamaModel")}</span>
            <span className="settings__modelrow">
              <select value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })} data-testid="ollama-model">
                {options.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <button type="button" title={t("settings_ollamaModel")} disabled={loading} onClick={() => void loadModels()}>
                {loading ? "…" : "↻"}
              </button>
            </span>
          </label>
          {!loading && models.length === 0 ? <div className="settings__warn">{t("ai_unavailable")}</div> : null}
        </div>
      ) : null}
    </section>
  );
}
