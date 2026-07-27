// 自繪視窗標題列（ADR-0150；雙帶模型與 ⚙/autoHide 於 ADR-0151）：`decorations: false` 後
// 這條就是視窗最外框。只在 Tauri 下掛載（瀏覽器版外框是瀏覽器的）；視窗動作經 `actions` 注入——
// 實機接 @tauri-apps/api/window，SSR 測試與設定頁預覽塞 no-op。
// `data-tauri-drag-region`：拖曳移動＋雙擊最大化皆 Tauri 內建（僅作用於掛該屬性的元素本身，
// 按鈕沒掛所以照常吃點擊）。⚙ 設定鈕（ADR-0151）：接了 `onOpenSettings` 才渲染。

import { useEffect, useState } from "react";
import { useI18n } from "../i18n.js";
import { ThemeToggleButton } from "./ThemeToggleButton.js";
import {
  DEFAULT_TITLEBAR_CONTROLS,
  type ControlId,
  type IdentityControlsBundle,
  type TitlebarControls,
} from "./titlebar-controls.js";

type WindowControlId = "settings" | "min" | "max" | "close";
const isWindowControl = (id: ControlId): id is WindowControlId =>
  id === "settings" || id === "min" || id === "max" || id === "close";

export interface TitleBarActions {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  /** 訂閱最大化狀態（回傳解除函式）；提供時 □↔❐ 圖示跟著換。 */
  onMaximized?(cb: (max: boolean) => void): () => void;
}

export function TitleBar(props: {
  controls?: TitlebarControls;
  actions: TitleBarActions;
  /** 開啟設定面板（ADR-0151）；未提供＝不渲染 ⚙（例如 App 尚未註冊）。 */
  onOpenSettings?: () => void;
  /** 身分控制資料（ADR-0206）：App 於三欄＋Tauri 注入；未提供＝標題列不畫身分控制。 */
  identityControls?: IdentityControlsBundle | null;
  /** 設定頁迷你預覽：加樣式類、整條不可互動。 */
  preview?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const controls = props.controls ?? DEFAULT_TITLEBAR_CONTROLS;
  const { actions, onOpenSettings, identityControls } = props;
  const [maximized, setMaximized] = useState(false);
  useEffect(() => actions.onMaximized?.(setMaximized), [actions]);

  const meta: Record<WindowControlId, { glyph: string; label: string; onClick: () => void; cls: string }> = {
    settings: { glyph: "⚙", label: t("settings_open"), onClick: () => onOpenSettings?.(), cls: "" },
    min: { glyph: "─", label: t("titlebar_minimize"), onClick: () => actions.minimize(), cls: "" },
    max: { glyph: maximized ? "❐" : "□", label: t("titlebar_maximize"), onClick: () => actions.toggleMaximize(), cls: "" },
    close: { glyph: "✕", label: t("titlebar_close"), onClick: () => actions.close(), cls: " titlebar__btn--close" },
  };
  const idBtn = (id: ControlId, glyph: string, entry: { label: string; onClick: () => void }): JSX.Element => (
    <button
      key={id}
      type="button"
      className={`titlebar__btn titlebar__btn--${id}`}
      data-testid={`titlebar-${id}`}
      title={entry.label}
      aria-label={entry.label}
      tabIndex={-1}
      onClick={entry.onClick}
    >
      {glyph}
    </button>
  );
  // 渲染單一控制項；回 null＝該情境不顯示（⚙ 未註冊、或身分控制未註冊/條件不符）。
  const renderControl = (id: ControlId): JSX.Element | null => {
    if (isWindowControl(id)) {
      if (id === "settings" && !onOpenSettings) return null;
      const m = meta[id];
      return (
        <button
          key={id}
          type="button"
          className={`titlebar__btn titlebar__btn--${id}${m.cls}`}
          data-testid={`titlebar-${id}`}
          title={m.label}
          aria-label={m.label}
          tabIndex={-1}
          onClick={m.onClick}
        >
          {m.glyph}
        </button>
      );
    }
    // 身分控制（ADR-0206）：僅在 App 註冊了資料時渲染（三欄＋Tauri）。
    const ic = identityControls;
    if (!ic) return null;
    if (id === "identity") {
      return (
        <select
          key={id}
          className="titlebar__idselect"
          aria-label={ic.switchLabel}
          data-testid="titlebar-identity"
          value={ic.active}
          onChange={(e) => ic.onSwitch(e.target.value)}
        >
          {ic.options.map((o) => (
            <option key={o.pubkey} value={o.pubkey}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    if (id === "addid") return idBtn(id, "＋", { label: ic.addLabel, onClick: ic.onAdd });
    if (id === "unlockhidden") return ic.unlock ? idBtn(id, "🔒", ic.unlock) : null;
    if (id === "roster") return ic.roster ? idBtn(id, "🗂", ic.roster) : null;
    return null;
  };
  const strip = (ids: ControlId[]): JSX.Element | null => {
    const els = ids.map(renderControl).filter((x): x is JSX.Element => x !== null);
    if (els.length === 0) return null;
    return <div className="titlebar__controls">{els}</div>;
  };

  return (
    <div
      className={`titlebar titlebar--style-${controls.style ?? "flat"}${props.preview ? " titlebar--preview" : ""}`}
      data-tauri-drag-region
    >
      {strip(controls.left)}
      <span className="titlebar__title" data-tauri-drag-region>
        Cinderous
      </span>
      <span className="titlebar__spacer" data-tauri-drag-region />
      {/* 明暗切換（ADR-0249）：三欄＋Tauri 時 idbar 不畫（身分已上移標題列），這裡補上明暗鈕
          ——否則 Tauri 三欄同樣沒有快速切換。gate on identityControls＝僅三欄＋Tauri，不在經典重複。 */}
      {identityControls ? (
        <div className="titlebar__controls">
          <ThemeToggleButton className="titlebar__btn titlebar__btn--theme" testId="titlebar-theme" tabIndex={-1} />
        </div>
      ) : null}
      {strip(controls.right)}
    </div>
  );
}
