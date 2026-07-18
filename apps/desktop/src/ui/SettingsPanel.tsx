import { makeBackupCode } from "@cinderous/core";
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ACCENT_PRESETS, useAccent } from "../accent.js";
import { useLayout } from "../layout.js";
import { useI18n } from "../i18n.js";
import { useDialog } from "./Dialog.js";
import { CHIME_PRESETS, DEFAULT_CHIME_ID, playChime } from "./ringtone.js";
import type { SlotItem } from "./slot-queue.js";
import { placeControl, type ControlId, TITLEBAR_STYLES } from "./titlebar-controls.js";
import { useTitlebar } from "../titlebar.js";
import { qrSvg } from "../qr.js";
import type { CloudSyncMode } from "@cinderous/engine";
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
  /** 開啟時預設分頁（ADR-0142）；未指定＝外觀。供深連結與測試。 */
  initialTab?: SettingsTab;
  /** 組織資訊（ADR-0157，工作身分）：公司名稱/歡迎詞/班表的唯讀摘要；未採用名冊則不顯示。 */
  orgInfo?: { org: string; welcome?: string; workHours?: { start: string; end: string } };
  /** 自己的企業頭銜（ADR-0158）；與 onSetTitle 一起提供才顯示編輯欄（企業身分限定）。 */
  myTitle?: string;
  /** 設定/移除頭銜（空＝移除）；廣播給該身分的所有聯絡人（工作身分＝全組織同事）。 */
  onSetTitle?: (title: string) => void;
  /** 公司儲存槽佇列（ADR-0161，員工端）；提供才顯示佇列面板。 */
  slotQueue?: SlotItem[];
  onSlotRetry?: () => void;
  onSlotRemove?: (id: string) => void;
  /** 儲存槽目錄（ADR-0161，企業主端）；與 onPickSlotDir 一起提供才顯示。空＝appData 預設槽。 */
  slotDirValue?: string;
  onPickSlotDir?: () => void;
  /** 離職帳號接管（ADR-0163，企業主端）：託管中且已離職（不在現行名冊）的條目。 */
  offboarded?: { pubkey: string; name: string }[];
  /** 以託管金鑰匯入為本機離職身分（查看 relay 殘留）。 */
  onTakeover?: (pubkey: string) => void;
  /** 刪除該託管條目。 */
  onDeleteEscrow?: (pubkey: string) => void;
  /** 目前顯示名稱（ADR-0144）；與 onRename 一起提供才顯示改名欄。 */
  selfName?: string;
  /** 更改顯示名稱（ADR-0144）：落地本機並廣播給聯絡人（ADR-0061）。回 false＝撞本機同名（ADR-0146）。 */
  onRename?: (name: string) => boolean;
  /** 目前使用的中繼站網址；空字串表示示範模式。 */
  relayUrl: string;
  /** Relay pool 各座連線狀態（多中繼時才有；ADR-0034）。 */
  relays?: RelayPoolEntry[];
  /** 自己的 nsec 私鑰（僅本機備份用；示範模式為 undefined）。 */
  selfNsec?: string;
  /** 桌面通知是否啟用。 */
  notifications: boolean;
  onToggleNotifications: () => void;
  /** 通知提示音（ADR-0076）；未提供則不顯示該子開關。 */
  notifySound?: boolean;
  onToggleNotifySound?: () => void;
  /** 全域通知音效（ADR-0149）：合成預設集 id；與 onSelectNotifyChime 一起提供才顯示下拉。 */
  notifyChime?: string;
  onSelectNotifyChime?: (id: string) => void;
  /** 視窗外框設定（ADR-0150）：僅 Tauri（自繪標題列）顯示——App 以 `isTauri()` 決定。 */
  showTitlebarSettings?: boolean;
  /** 通知隱藏內文預覽（ADR-0076）；未提供則不顯示該子開關。 */
  notifyHidePreview?: boolean;
  onToggleNotifyHidePreview?: () => void;
  readReceipts?: boolean;
  onToggleReadReceipts?: () => void;
  /** 訊息保留上限（ADR-0094）；未提供則不顯示。`cap` 0＝無上限。 */
  retention?: { cap: number; onChange: (n: number) => void; full: boolean };
  /** 導出紀錄（ADR-0094）；未提供則不顯示。 */
  onExport?: () => void;
  /** 隱身（ADR-0088）：停止一切在線廣播（relay＋P2P）；未提供則不顯示該區塊。 */
  invisible?: boolean;
  onToggleInvisible?: () => void;
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
  /** 配對新裝置（ADR-0072 D4a）；未提供則不顯示（示範模式/企業身分）。 */
  onPairDevice?: () => void;
  /** 加密雲端快照（ADR-0071）：三檔模式；未提供則不顯示（示範模式/政策禁用）。 */
  cloud?: {
    mode: CloudSyncMode;
    onChange: (mode: CloudSyncMode) => void;
    /** 立即備份（已開啟時才提供）。 */
    onBackupNow?: () => void;
  };
  /** 本地密碼（H4，ADR-0067）：僅 Tauri 提供；未提供則不顯示安全區塊。回 false＝密碼錯誤。 */
  security?: {
    enabled: boolean;
    hidden: boolean;
    onEnable: (password: string) => Promise<boolean>;
    onChangePassword: (oldPw: string, newPw: string) => Promise<boolean>;
    onDisable: (password: string) => Promise<boolean>;
    /**
     * 瀏覽器模式（ADR-0122）：這裡的「停用」語意**與桌面不同**——
     * 桌面停用是把明文 nsec 交還 OS 金鑰庫（信任邊界移交給 OS 帳號）；
     * 瀏覽器沒有那個東西，所以停用＝**忘記這個身分**，下次開啟要重貼 nsec。必須講清楚。
     */
    browser?: boolean;
    onToggleHidden: () => void;
  };
}

const STATE_DOT: Record<RelayPoolEntry["state"], string> = {
  online: "🟢",
  connecting: "🟡",
  offline: "🔴",
};

/** 主題色設定（ADR-0064）：預設色票 + 自訂色 + 重設；即時套用、只存本機。 */
/** 更改顯示名稱（ADR-0144）：輸入新名 → 落地本機＋廣播給聯絡人（ADR-0061）。 */
/** 企業頭銜編輯（ADR-0158）：≤24 字、留空套用＝移除；廣播給該身分的所有聯絡人。 */
function TitleEditor({ title, onSet }: { title: string; onSet: (t: string) => void }): JSX.Element {
  const { t } = useI18n();
  const [draft, setDraft] = useState(title);
  const [saved, setSaved] = useState(false);
  const dirty = draft.trim() !== title;
  const apply = (): void => {
    if (!dirty) return;
    onSet(draft.trim());
    setSaved(true);
  };
  return (
    <section className="settings__sec" data-testid="org-title">
      <h4>{t("settings_orgTitle")}</h4>
      <p className="hint">{t("settings_orgTitleHint")}</p>
      <div className="settings__keyrow">
        <input
          aria-label={t("settings_orgTitle")}
          data-testid="org-title-input"
          maxLength={24}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
          }}
        />
        <button type="button" data-testid="org-title-apply" disabled={!dirty} onClick={apply}>
          {t("settings_nameApply")}
        </button>
      </div>
      {saved ? (
        <p className="settings__hint" data-testid="org-title-ok">
          {t("settings_orgTitleUpdated")}
        </p>
      ) : null}
    </section>
  );
}

function NameEditor({ name, onRename }: { name: string; onRename: (n: string) => boolean }): JSX.Element {
  const { t } = useI18n();
  const [draft, setDraft] = useState(name);
  const [saved, setSaved] = useState(false);
  const [taken, setTaken] = useState(false); // ADR-0146：撞到本機同名身分
  const dirty = draft.trim().length > 0 && draft.trim() !== name;
  const apply = (): void => {
    if (!dirty) return;
    // onRename 回 false＝名稱已被本機另一身分佔用（ADR-0146）→ 不視為成功，顯示重名提示。
    if (onRename(draft.trim())) {
      setSaved(true);
      setTaken(false);
    } else {
      setTaken(true);
      setSaved(false);
    }
  };
  return (
    <section className="settings__sec">
      <h4>{t("settings_displayName")}</h4>
      <div className="settings__keyrow">
        <input
          aria-label={t("settings_displayName")}
          data-testid="rename-input"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
            setTaken(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
          }}
        />
        <button type="button" data-testid="rename-apply" disabled={!dirty} onClick={apply}>
          {t("settings_nameApply")}
        </button>
      </div>
      {taken ? (
        <p className="settings__warn" data-testid="rename-taken">
          {t("settings_nameTaken")}
        </p>
      ) : saved ? (
        <p className="settings__hint" data-testid="rename-ok">
          {t("settings_nameUpdated")}
        </p>
      ) : null}
    </section>
  );
}

function AccentSettings(): JSX.Element {
  const { t } = useI18n();
  const { accent, setAccent, accent2, setAccent2 } = useAccent();
  const cur = accent?.toLowerCase();
  const cur2 = accent2?.toLowerCase();
  return (
    <section className="settings__sec">
      <h4>{t("settings_accent")}</h4>
      <div className="accent__label">{t("settings_accentPrimary")}</div>
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
      <div className="accent__label">{t("settings_accent2")}</div>
      <div className="accent__row">
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`accent__sw${cur2 === p.hex.toLowerCase() ? " on" : ""}`}
            style={{ background: p.hex }}
            aria-label={p.key}
            title={p.key}
            data-testid={`accent2-${p.key}`}
            onClick={() => setAccent2(p.hex)}
          />
        ))}
        <label className="accent__custom" title={t("settings_accentCustom")}>
          <span aria-hidden="true">🎨</span>
          <input
            type="color"
            value={accent2 ?? accent ?? "#2f6cd6"}
            aria-label={t("settings_accentCustom")}
            onChange={(e) => setAccent2(e.target.value)}
          />
        </label>
        <button type="button" className="accent__reset" onClick={() => setAccent2(null)} disabled={!accent2}>
          {t("settings_accent2Follow")}
        </button>
      </div>
      <p className="settings__hint">{t("settings_accentHint")}</p>
    </section>
  );
}

/** 佈局切換（ADR-0079）：經典浮動視窗 ↔ 新三欄整合，一鍵切換、本地儲存。 */
function LayoutSettings(): JSX.Element {
  const { t } = useI18n();
  const { layout, setLayout } = useLayout();
  return (
    <section className="settings__sec">
      <h4>{t("settings_layout")}</h4>
      <div className="layoutpick" role="radiogroup" aria-label={t("settings_layout")}>
        <button
          type="button"
          role="radio"
          aria-checked={layout === "classic"}
          className={`layoutpick__opt${layout === "classic" ? " on" : ""}`}
          data-testid="layout-classic"
          onClick={() => setLayout("classic")}
        >
          🪟 {t("settings_layoutClassic")}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={layout === "modern"}
          className={`layoutpick__opt${layout === "modern" ? " on" : ""}`}
          data-testid="layout-modern"
          onClick={() => setLayout("modern")}
        >
          ▤ {t("settings_layoutModern")}
        </button>
      </div>
      <p className="settings__hint">{t("settings_layoutHint")}</p>
    </section>
  );
}

/**
 * 視窗外框（ADR-0150/0151/0152）：拖曳編輯器——一條假標題列、左右兩個放置帶，四顆按鈕
 * （⚙ ─ □ ✕）用滑鼠拖到任一帶的任意位置（拖到某顆上＝插到它前面、拖到帶空白＝放帶尾）。
 * 另附「平時隱藏」勾選（滑鼠碰標題列才顯示按鈕）。
 *
 * 拖曳以 **pointer events** 實作（ADR-0152）：Tauri 的 `dragDropEnabled`（原生檔案拖放，
 * ADR-0104）在 Windows WebView2 會吞掉 HTML5 drag & drop，`draggable` 在桌面版根本拖不動——
 * 故以 setPointerCapture＋elementFromPoint 命中 `data-drop-side`/`data-piece` 自行實作。
 */
function TitlebarSettings(): JSX.Element {
  const { t } = useI18n();
  const { controls, setControls } = useTitlebar();
  const [dragId, setDragId] = useState<ControlId | null>(null);
  const [hover, setHover] = useState<{ side: "left" | "right"; before: ControlId | null } | null>(null);
  const glyph: Record<ControlId, string> = { settings: "⚙", min: "─", max: "□", close: "✕" };
  const label: Record<ControlId, string> = {
    settings: t("settings_open"),
    min: t("titlebar_minimize"),
    max: t("titlebar_maximize"),
    close: t("titlebar_close"),
  };
  /** 由座標找放置目標（pointer capture 下 pointerover 不會發到別的元素，只能用命中測試）。 */
  const targetAt = (x: number, y: number): { side: "left" | "right"; before: ControlId | null } | null => {
    if (typeof document === "undefined" || !document.elementFromPoint) return null;
    const el = document.elementFromPoint(x, y);
    const zoneEl = el?.closest?.("[data-drop-side]");
    if (!zoneEl) return null;
    const side = zoneEl.getAttribute("data-drop-side") === "left" ? "left" : "right";
    const before = (el?.closest?.("[data-piece]")?.getAttribute("data-piece") ?? null) as ControlId | null;
    return { side, before };
  };
  const beginDrag = (id: ControlId) => (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragId(id);
  };
  const moveDrag = (e: ReactPointerEvent<HTMLElement>): void => {
    if (dragId) setHover(targetAt(e.clientX, e.clientY));
  };
  const endDrag = (e: ReactPointerEvent<HTMLElement>): void => {
    if (dragId) {
      const tgt = targetAt(e.clientX, e.clientY);
      if (tgt) setControls(placeControl(controls, dragId, tgt.side, tgt.before));
    }
    setDragId(null);
    setHover(null);
  };
  const zone = (side: "left" | "right"): JSX.Element => (
    <div
      className={`titlebarset__zone${dragId ? " titlebarset__zone--target" : ""}${
        hover?.side === side && hover.before === null ? " titlebarset__zone--over" : ""
      }`}
      data-drop-side={side}
      data-testid={`titlebar-zone-${side}`}
    >
      {controls[side].map((id) => (
        <span
          key={id}
          className={`titlebarset__piece${dragId === id ? " titlebarset__piece--drag" : ""}${
            hover?.before === id ? " titlebarset__piece--over" : ""
          }`}
          data-piece={id}
          data-testid={`titlebar-piece-${id}`}
          title={label[id]}
          aria-label={label[id]}
          onPointerDown={beginDrag(id)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
        >
          {glyph[id]}
        </span>
      ))}
    </div>
  );
  return (
    <section className="settings__sec">
      <h4>{t("settings_titlebar")}</h4>
      {/* 按鈕風格（ADR-0167）：切換即時反映到真的外框（同一 Provider 狀態）。 */}
      <div className="titlebarset__styles" data-testid="titlebar-styles">
        {TITLEBAR_STYLES.map((s) => (
          <button
            key={s}
            type="button"
            className={`chip chip--filter${controls.style === s ? " chip--on" : ""}`}
            data-testid={`titlebar-style-${s}`}
            onClick={() => setControls({ ...controls, style: s })}
          >
            {t(`titlebarStyle_${s}` as "titlebarStyle_flat")}
          </button>
        ))}
      </div>
      {/* 編輯器即預覽：所見即所得，拖完真的外框立刻跟著變（同一個 Provider 狀態）。 */}
      <div className={`titlebarset__editor titlebar--style-${controls.style}`}>
        {zone("left")}
        <span className="titlebarset__title">Cinderous</span>
        <span className="titlebarset__gap" />
        {zone("right")}
      </div>
      <p className="settings__hint">{t("titlebar_dragHint")}</p>
      <label className="settings__toggle">
        <input
          type="checkbox"
          data-testid="titlebar-autohide"
          checked={controls.autoHide}
          onChange={() => setControls({ ...controls, autoHide: !controls.autoHide })}
        />
        <span>{t("titlebar_autoHide")}</span>
      </label>
    </section>
  );
}

/**
 * 加密備份碼（ADR-0070）：以備份密碼把 nsec 包成 NIP-49 ncryptsec＋relay 信封，
 * 輸出字串與 QR——使用者自持（列印/存自選位置），不上雲、不發佈。
 */
function BackupCode({ nsec, relayUrl }: { nsec: string; relayUrl: string }): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const make = () => {
    setBusy(true);
    // scrypt（N=2^16）約需一秒：先讓 UI 呈現產生中，再於下一輪事件圈執行。
    setTimeout(() => {
      try {
        setCode(makeBackupCode(nsec, relayUrl, pw));
      } finally {
        setBusy(false);
        setPw("");
        setPw2("");
      }
    }, 0);
  };
  const copy = () => {
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
  if (!open) {
    return (
      <button type="button" className="settings__reveal" data-testid="backup-code" onClick={() => setOpen(true)}>
        {t("settings_backupCode")}
      </button>
    );
  }
  if (code) {
    return (
      <div className="settings__key">
        <img
          src={`data:image/svg+xml;utf8,${encodeURIComponent(qrSvg(code))}`}
          alt="backup QR"
          style={{ maxWidth: 160, alignSelf: "center" }}
        />
        <code data-testid="backup-code-value" style={{ wordBreak: "break-all" }}>{code}</code>
        <div className="settings__keyrow">
          <button type="button" onClick={copy}>{copied ? t("settings_copied") : t("settings_copyKey")}</button>
          <button
            type="button"
            onClick={() => {
              setCode("");
              setOpen(false);
            }}
          >
            {t("settings_hideKey")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="settings__key">
      <p className="hint">{t("settings_backupCodeHint")}</p>
      <input
        type="password"
        aria-label={t("settings_backupCodePw")}
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder={t("settings_backupCodePw")}
      />
      <input
        type="password"
        aria-label={t("settings_backupCodePw2")}
        value={pw2}
        onChange={(e) => setPw2(e.target.value)}
        placeholder={t("settings_backupCodePw2")}
      />
      <div className="settings__keyrow">
        <button type="button" disabled={!pw || pw !== pw2 || busy} onClick={make}>
          {busy ? "…" : t("settings_backupCodeMake")}
        </button>
        <button type="button" onClick={() => setOpen(false)}>{t("settings_relayChangeCancel")}</button>
      </div>
    </div>
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
  const { confirm } = useDialog();
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
            void confirm(t("settings_relayChangeConfirm", { url: target })).then((ok) => {
              if (ok) onApply(target);
            });
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

/**
 * 加密雲端快照設定（ADR-0071）：三檔模式（關/基本/完整）。切到關＝確認後 purge
 * （「已關閉」必須立即為真）；文案誠實：快照由身分金鑰保護、relay 只見密文。
 */
function CloudSyncSettings({ value }: { value: NonNullable<SettingsPanelProps["cloud"]> }): JSX.Element {
  const { t } = useI18n();
  const { confirm } = useDialog();
  const modes: { key: CloudSyncMode; label: string }[] = [
    { key: "off", label: t("settings_cloudOff") },
    { key: "basic", label: t("settings_cloudBasic") },
    { key: "full", label: t("settings_cloudFull") },
  ];
  return (
    <section className="settings__sec" data-testid="cloud-sync">
      <h4>{t("settings_cloud")}</h4>
      <p className="hint">{t("settings_cloudHint")}</p>
      {modes.map((m) => (
        <label key={m.key} className="settings__toggle">
          <input
            type="radio"
            name="cloud-mode"
            data-testid={`cloud-${m.key}`}
            checked={value.mode === m.key}
            onChange={() => {
              if (m.key === value.mode) return;
              if (m.key !== "off") {
                value.onChange(m.key);
                return;
              }
              // 切到「關」＝立即 purge，先確認。
              void confirm(t("settings_cloudOffConfirm")).then((ok) => {
                if (ok) value.onChange("off");
              });
            }}
          />
          <span>{m.label}</span>
        </label>
      ))}
      {value.onBackupNow ? (
        <button type="button" data-testid="cloud-backup-now" onClick={() => value.onBackupNow?.()}>
          {t("settings_cloudBackupNow")}
        </button>
      ) : null}
    </section>
  );
}

/**
 * 本地密碼設定（H4，ADR-0067）：啟用（強制備份確認＋二次輸入）／改密碼＝重包裹／
 * 停用／隱藏身分。文案誠實：忘記密碼＝本機永久不可解，僅能憑 nsec 備份重建。
 */
function SecuritySettings({ value }: { value: NonNullable<SettingsPanelProps["security"]> }): JSX.Element {
  const { t } = useI18n();
  const [mode, setMode] = useState<"idle" | "enable" | "change" | "disable">("idle");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [backedUp, setBackedUp] = useState(false);
  const [error, setError] = useState(false);
  const reset = (m: "idle" | "enable" | "change" | "disable") => {
    setMode(m);
    setPw("");
    setPw2("");
    setBackedUp(false);
    setError(false);
  };
  const run = async (ok: Promise<boolean>) => {
    if (await ok) reset("idle");
    else setError(true);
  };
  return (
    <section className="settings__sec" data-testid="security">
      <h4>{t("settings_security")}</h4>
      {mode === "idle" ? (
        <div className="settings__key">
          {value.enabled ? (
            <>
              <p className="hint">{t("settings_passwordOn")}</p>
              <div className="settings__keyrow">
                <button type="button" data-testid="pass-change" onClick={() => reset("change")}>
                  {t("settings_passwordChange")}
                </button>
                <button type="button" data-testid="pass-disable" onClick={() => reset("disable")}>
                  {t("settings_passwordDisable")}
                </button>
              </div>
              <label className="settings__toggle">
                <input type="checkbox" data-testid="pass-hidden" checked={value.hidden} onChange={value.onToggleHidden} />
                <span>{t("settings_passwordHidden")}</span>
              </label>
            </>
          ) : (
            <>
              <p className="hint">{t("settings_passwordOffHint")}</p>
              <button type="button" data-testid="pass-enable" onClick={() => reset("enable")}>
                {t("settings_passwordEnable")}
              </button>
            </>
          )}
        </div>
      ) : null}
      {mode === "enable" ? (
        <div className="settings__key">
          <p className="settings__warn">⚠️ {t("settings_passwordForgetWarn")}</p>
          <input
            type="password"
            aria-label={t("settings_passwordNew")}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={t("settings_passwordNew")}
          />
          <input
            type="password"
            aria-label={t("settings_passwordRepeat")}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            placeholder={t("settings_passwordRepeat")}
          />
          <label className="settings__toggle">
            <input type="checkbox" checked={backedUp} onChange={() => setBackedUp(!backedUp)} />
            <span>{t("settings_passwordBackupConfirm")}</span>
          </label>
          {error ? <p className="settings__warn">{t("settings_passwordError")}</p> : null}
          <div className="settings__keyrow">
            <button
              type="button"
              disabled={!pw || pw !== pw2 || !backedUp}
              onClick={() => void run(value.onEnable(pw))}
            >
              {t("settings_passwordApply")}
            </button>
            <button type="button" onClick={() => reset("idle")}>{t("settings_relayChangeCancel")}</button>
          </div>
        </div>
      ) : null}
      {mode === "change" ? (
        <div className="settings__key">
          <input
            type="password"
            aria-label={t("settings_passwordOld")}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={t("settings_passwordOld")}
          />
          <input
            type="password"
            aria-label={t("settings_passwordNew")}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            placeholder={t("settings_passwordNew")}
          />
          {error ? <p className="settings__warn">{t("settings_passwordError")}</p> : null}
          <div className="settings__keyrow">
            <button
              type="button"
              disabled={!pw || !pw2}
              onClick={() => void run(value.onChangePassword(pw, pw2))}
            >
              {t("settings_passwordApply")}
            </button>
            <button type="button" onClick={() => reset("idle")}>{t("settings_relayChangeCancel")}</button>
          </div>
        </div>
      ) : null}
      {mode === "disable" ? (
        <div className="settings__key">
          {/* 瀏覽器的「停用」會清掉記住的身分——不能讓使用者以為只是「關掉密碼」（ADR-0122）。 */}
          {value.browser ? (
            <p className="settings__warn" data-testid="disable-browser-warn">
              {t("settings_passwordDisableBrowser")}
            </p>
          ) : null}
          <input
            type="password"
            aria-label={t("settings_passwordOld")}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={t("settings_passwordOld")}
          />
          {error ? <p className="settings__warn">{t("settings_passwordError")}</p> : null}
          <div className="settings__keyrow">
            <button type="button" disabled={!pw} onClick={() => void run(value.onDisable(pw))}>
              {t("settings_passwordDisableApply")}
            </button>
            <button type="button" onClick={() => reset("idle")}>{t("settings_relayChangeCancel")}</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** 設定面板：主題色、中繼站、身分備份（私鑰）、桌面通知。 */
/** 設定分頁（ADR-0142）：把長設定頁切成分頁，減少捲動。 */
type SettingsTab = "appearance" | "identity" | "relay" | "privacy" | "advanced";

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const { t } = useI18n();
  const { confirm } = useDialog();
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<SettingsTab>(props.initialTab ?? "appearance");

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

  // 只顯示有內容的分頁（身分/進階全條件式，可能為空）。
  const hasIdentity = !!props.onRename || !!props.selfNsec || !!props.security || !!props.onPairDevice;
  const hasAdvanced = !!props.retention || !!props.onExport || !!(props.ollama && props.onOllamaChange);
  const TABS: { key: SettingsTab; label: string }[] = [
    { key: "appearance", label: t("settingsTab_appearance") },
    ...(hasIdentity ? [{ key: "identity" as const, label: t("settingsTab_identity") }] : []),
    { key: "relay", label: t("settingsTab_relay") },
    { key: "privacy", label: t("settingsTab_privacy") },
    ...(hasAdvanced ? [{ key: "advanced" as const, label: t("settingsTab_advanced") }] : []),
  ];

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t("settings_title")}>
      <div className="modal__box win settings-modal">
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
        <div className="settings__tabs" role="tablist">
          {TABS.map((tb) => (
            <button
              key={tb.key}
              type="button"
              role="tab"
              aria-selected={tab === tb.key}
              className={`settings__tab${tab === tb.key ? " on" : ""}`}
              data-testid={`settings-tab-${tb.key}`}
              onClick={() => setTab(tb.key)}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <div className="settings__body">
          {tab === "appearance" ? (
            <>
              <LayoutSettings />
              <AccentSettings />
              {props.showTitlebarSettings ? <TitlebarSettings /> : null}
            </>
          ) : null}
          {tab === "relay" ? (
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
                                void confirm({
                                  message: t("settings_relayClearConfirm", { url: r.url }),
                                  danger: true,
                                }).then((ok) => {
                                  if (ok) props.onRelayClear?.(r.url);
                                });
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
          </section>
          ) : null}

          {tab === "identity" && props.onRename ? (
            <NameEditor name={props.selfName ?? ""} onRename={props.onRename} />
          ) : null}

          {/* 企業頭銜（ADR-0158）：自填、隨加密個人檔廣播給同事；chip--role 顯示。 */}
          {tab === "identity" && props.onSetTitle ? (
            <TitleEditor title={props.myTitle ?? ""} onSet={props.onSetTitle} />
          ) : null}

          {/* 公司儲存槽佇列（ADR-0161，員工端）：排隊中/傳輸中/已存放/失敗＋重試/移除。 */}
          {tab === "identity" && props.slotQueue ? (
            <section className="settings__sec" data-testid="settings-slot-queue">
              <h4>{t("settings_slot")}</h4>
              {props.slotQueue.length === 0 ? (
                <p className="hint">{t("slot_empty")}</p>
              ) : (
                <>
                  {props.slotQueue.map((q) => (
                    <div key={q.id} className="settings__keyrow slotrow" data-testid="slot-row">
                      <span className="slotrow__name" title={q.path}>{q.name}</span>
                      <span className={`slotrow__status slotrow__status--${q.status}`}>
                        {t(`slot_${q.status}` as "slot_pending")}
                      </span>
                      {props.onSlotRemove ? (
                        <button type="button" className="chip__x" aria-label={t("slot_remove")} onClick={() => props.onSlotRemove!(q.id)}>
                          ×
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {props.slotQueue.some((q) => q.status === "failed") && props.onSlotRetry ? (
                    <button type="button" className="settings__reveal" data-testid="slot-retry" onClick={props.onSlotRetry}>
                      {t("slot_retry")}
                    </button>
                  ) : null}
                </>
              )}
            </section>
          ) : null}

          {/* 儲存槽目錄（ADR-0161，企業主端）：同事存放的檔案落盤位置。 */}
          {tab === "identity" && props.onPickSlotDir ? (
            <section className="settings__sec" data-testid="settings-slot-dir">
              <h4>{t("settings_slotDir")}</h4>
              <p className="hint">{t("settings_slotDirHint")}</p>
              <p className="settings__desc" data-testid="slot-dir-value">
                {props.slotDirValue || t("settings_slotDirDefault")}
              </p>
              <button type="button" className="settings__reveal" data-testid="slot-dir-pick" onClick={props.onPickSlotDir}>
                {t("settings_slotDirPick")}
              </button>
            </section>
          ) : null}

          {/* 離職帳號接管（ADR-0163，企業主端）：託管中且已離職者，可接管查看或刪除。 */}
          {tab === "identity" && props.offboarded && props.offboarded.length > 0 ? (
            <section className="settings__sec" data-testid="settings-offboard">
              <h4>{t("settings_offboard")}</h4>
              <p className="hint">{t("settings_offboardHint")}</p>
              {props.offboarded.map((o) => (
                <div key={o.pubkey} className="settings__keyrow slotrow" data-testid="offboard-row">
                  <span className="slotrow__name">離職·{o.name}</span>
                  {props.onTakeover ? (
                    <button type="button" data-testid="offboard-takeover" onClick={() => props.onTakeover!(o.pubkey)}>
                      {t("offboard_takeover")}
                    </button>
                  ) : null}
                  {props.onDeleteEscrow ? (
                    <button type="button" className="chip__x" aria-label={t("offboard_delete")} onClick={() => props.onDeleteEscrow!(o.pubkey)}>
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}

          {/* 組織資訊（ADR-0157）：工作身分採用名冊後的公司設定摘要（唯讀）。 */}
          {tab === "identity" && props.orgInfo ? (
            <section className="settings__sec" data-testid="org-info">
              <h4>{t("orgInfo_title")}</h4>
              <p className="settings__desc">{props.orgInfo.org}</p>
              {props.orgInfo.welcome ? (
                <p className="hint" style={{ whiteSpace: "pre-wrap" }} data-testid="org-info-welcome">
                  {props.orgInfo.welcome}
                </p>
              ) : null}
              {props.orgInfo.workHours ? (
                <>
                  <p className="settings__desc" data-testid="org-info-hours">
                    {t("orgInfo_hours", { start: props.orgInfo.workHours.start, end: props.orgInfo.workHours.end })}
                  </p>
                  <p className="hint">{t("orgInfo_muteNote")}</p>
                </>
              ) : null}
            </section>
          ) : null}

          {tab === "identity" && props.selfNsec ? (
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
              <BackupCode nsec={props.selfNsec} relayUrl={props.relayUrl} />
            </section>
          ) : null}

          {tab === "identity" && props.onPairDevice ? (
            <section className="settings__sec" data-testid="pair-device">
              <h4>{t("pair_settingsButton")}</h4>
              <p className="hint">{t("pair_settingsHint")}</p>
              <button type="button" className="settings__reveal" data-testid="pair-device-btn" onClick={props.onPairDevice}>
                {t("pair_settingsButton")}
              </button>
            </section>
          ) : null}

          {tab === "relay" && props.cloud ? <CloudSyncSettings value={props.cloud} /> : null}

          {tab === "identity" && props.security ? <SecuritySettings value={props.security} /> : null}

          {tab === "privacy" && props.onToggleCleanOnPaste ? (
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

          {tab === "privacy" ? (
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
            {props.notifications && props.onToggleNotifySound ? (
              <label className="settings__toggle">
                <input type="checkbox" checked={props.notifySound ?? true} onChange={props.onToggleNotifySound} />
                <span>{t("settings_notifySound")}</span>
              </label>
            ) : null}
            {/* ADR-0149：全域通知音效（合成預設集）＋試聽；提示音開啟時才顯示。 */}
            {props.notifications && (props.notifySound ?? true) && props.onSelectNotifyChime ? (
              <label className="settings__field settings__chime">
                <span>{t("settings_notifyChime")}</span>
                <span className="settings__modelrow">
                  <select
                    data-testid="notify-chime-select"
                    value={props.notifyChime ?? DEFAULT_CHIME_ID}
                    onChange={(e) => props.onSelectNotifyChime!(e.target.value)}
                  >
                    {CHIME_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {t(p.nameKey)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    data-testid="notify-chime-preview"
                    title={t("sound_preview")}
                    onClick={() => playChime(props.notifyChime)}
                  >
                    {t("sound_preview")}
                  </button>
                </span>
              </label>
            ) : null}
            {props.notifications && props.onToggleNotifyHidePreview ? (
              <label className="settings__toggle">
                <input
                  type="checkbox"
                  checked={props.notifyHidePreview ?? false}
                  onChange={props.onToggleNotifyHidePreview}
                />
                <span>{t("settings_notifyHidePreview")}</span>
              </label>
            ) : null}
          </section>
          ) : null}

          {tab === "privacy" && props.onToggleReadReceipts ? (
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
          {tab === "privacy" && props.onToggleInvisible ? (
            <section className="settings__sec">
              <h4>{t("settings_invisible")}</h4>
              <label className="settings__toggle">
                <input type="checkbox" checked={props.invisible ?? false} onChange={props.onToggleInvisible} />
                <span>{t("settings_invisibleHint")}</span>
              </label>
            </section>
          ) : null}
          {tab === "advanced" && props.retention ? <RetentionSettings {...props.retention} /> : null}
          {tab === "advanced" && props.onExport ? (
            <section className="settings__sec">
              <h4>{t("settings_export")}</h4>
              <p className="settings__hint">{t("settings_exportHint")}</p>
              <button className="retention__opt" onClick={props.onExport}>{t("export_title")}…</button>
            </section>
          ) : null}
          {tab === "advanced" && props.ollama && props.onOllamaChange ? (
            <OllamaSettings value={props.ollama} onChange={props.onOllamaChange} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

const RETENTION_PRESETS = [0, 1000, 5000, 10000];

/** 訊息保留上限設定（ADR-0094）：預設無上限（0）；預設值或自訂 N；滿載時提示。 */
function RetentionSettings({ cap, onChange, full }: { cap: number; onChange: (n: number) => void; full: boolean }): JSX.Element {
  const { t } = useI18n();
  const isPreset = RETENTION_PRESETS.includes(cap);
  const [customOpen, setCustomOpen] = useState<boolean>(!isPreset && cap > 0);
  return (
    <section className="settings__sec">
      <h4>{t("settings_retention")}</h4>
      <p className="settings__hint">{t("settings_retentionHint")}</p>
      <div className="retention__row">
        {RETENTION_PRESETS.map((n) => (
          <button
            key={n}
            className={`retention__opt${!customOpen && cap === n ? " on" : ""}`}
            onClick={() => {
              setCustomOpen(false);
              onChange(n);
            }}
          >
            {n === 0 ? t("retention_unlimited") : n.toLocaleString()}
          </button>
        ))}
        <button className={`retention__opt${customOpen ? " on" : ""}`} onClick={() => setCustomOpen(true)}>
          {t("retention_custom")}
        </button>
        {customOpen ? (
          <input
            className="retention__custom"
            type="number"
            min={0}
            defaultValue={cap > 0 && !isPreset ? cap : ""}
            placeholder="1000"
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v) && v >= 0) onChange(v);
            }}
          />
        ) : null}
      </div>
      {full ? <div className="retention__full">{t("settings_storageFull")}</div> : null}
    </section>
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
