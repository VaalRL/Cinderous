// 自繪視窗標題列（ADR-0150；雙帶模型與 ⚙/autoHide 於 ADR-0151）：`decorations: false` 後
// 這條就是視窗最外框。只在 Tauri 下掛載（瀏覽器版外框是瀏覽器的）；視窗動作經 `actions` 注入——
// 實機接 @tauri-apps/api/window，SSR 測試與設定頁預覽塞 no-op。
// `data-tauri-drag-region`：拖曳移動＋雙擊最大化皆 Tauri 內建（僅作用於掛該屬性的元素本身，
// 按鈕沒掛所以照常吃點擊）。⚙ 設定鈕（ADR-0151）：接了 `onOpenSettings` 才渲染。

import { useEffect, useState } from "react";
import { useI18n } from "../i18n.js";
import { DEFAULT_TITLEBAR_CONTROLS, type ControlId, type TitlebarControls } from "./titlebar-controls.js";

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
  /** 設定頁迷你預覽：加樣式類、整條不可互動。 */
  preview?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const controls = props.controls ?? DEFAULT_TITLEBAR_CONTROLS;
  const { actions, onOpenSettings } = props;
  const [maximized, setMaximized] = useState(false);
  useEffect(() => actions.onMaximized?.(setMaximized), [actions]);

  const meta: Record<ControlId, { glyph: string; label: string; onClick: () => void; cls: string }> = {
    settings: { glyph: "⚙", label: t("settings_open"), onClick: () => onOpenSettings?.(), cls: "" },
    min: { glyph: "─", label: t("titlebar_minimize"), onClick: () => actions.minimize(), cls: "" },
    max: { glyph: maximized ? "❐" : "□", label: t("titlebar_maximize"), onClick: () => actions.toggleMaximize(), cls: "" },
    close: { glyph: "✕", label: t("titlebar_close"), onClick: () => actions.close(), cls: " titlebar__btn--close" },
  };
  const strip = (ids: ControlId[]): JSX.Element | null => {
    const visible = ids.filter((id) => id !== "settings" || onOpenSettings);
    if (visible.length === 0) return null;
    return (
      <div className={`titlebar__controls${controls.autoHide ? " titlebar__controls--autohide" : ""}`}>
        {visible.map((id) => (
          <button
            key={id}
            type="button"
            className={`titlebar__btn${meta[id].cls}`}
            data-testid={`titlebar-${id}`}
            title={meta[id].label}
            aria-label={meta[id].label}
            tabIndex={-1}
            onClick={meta[id].onClick}
          >
            {meta[id].glyph}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className={`titlebar${props.preview ? " titlebar--preview" : ""}`} data-tauri-drag-region>
      {strip(controls.left)}
      <span className="titlebar__title" data-tauri-drag-region>
        Cinder
      </span>
      <span className="titlebar__spacer" data-tauri-drag-region />
      {strip(controls.right)}
    </div>
  );
}
