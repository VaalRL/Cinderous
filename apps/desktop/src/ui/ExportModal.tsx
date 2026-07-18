import { useState } from "react";
import type { ExportFormat } from "@cinderous/engine";
import { useI18n } from "../i18n.js";

/** 可導出的對話（ADR-0094）。 */
export interface ExportConvoItem {
  key: string;
  name: string;
  kind: "contact" | "group";
}

const ALL_FORMATS: ExportFormat[] = ["txt", "md", "json"];

/**
 * 明文紀錄導出（ADR-0094）：勾選範圍（對話/群組）與格式（TXT/MD/JSON），導出成明文檔。
 * 明文離開加密邊界 → 頂部明確警告；僅使用者主動、寫本機。
 */
export function ExportModal({
  conversations,
  initialKeys,
  onExport,
  onClose,
}: {
  conversations: ExportConvoItem[];
  initialKeys?: string[];
  onExport: (keys: string[], formats: ExportFormat[]) => void;
  onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [keys, setKeys] = useState<Set<string>>(
    () => new Set(initialKeys && initialKeys.length > 0 ? initialKeys : conversations.map((c) => c.key)),
  );
  const [formats, setFormats] = useState<Set<ExportFormat>>(() => new Set(ALL_FORMATS));

  const toggleKey = (k: string) =>
    setKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const toggleFormat = (f: ExportFormat) =>
    setFormats((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  const allSelected = conversations.length > 0 && keys.size === conversations.length;
  const selectAll = () => setKeys(allSelected ? new Set() : new Set(conversations.map((c) => c.key)));

  const canExport = keys.size > 0 && formats.size > 0;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t("export_title")} onClick={onClose}>
      <div className="modal__box win" onClick={(e) => e.stopPropagation()}>
        <h3 className="export__title">{t("export_title")}</h3>
        <p className="export__warn">{t("export_warning")}</p>

        {conversations.length === 0 ? (
          <p className="export__empty">{t("export_empty")}</p>
        ) : (
          <>
            <div className="export__sect">
              <div className="export__head">
                <span>{t("export_scope")}</span>
                <button className="export__all" onClick={selectAll}>
                  {t("export_selectAll")}
                </button>
              </div>
              <div className="export__list">
                {conversations.map((c) => (
                  <label key={c.key} className="export__row">
                    <input type="checkbox" checked={keys.has(c.key)} onChange={() => toggleKey(c.key)} />
                    <span className="export__ic">{c.kind === "group" ? "👥" : "💬"}</span>
                    <span className="export__name">{c.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="export__sect">
              <div className="export__head">{t("export_format")}</div>
              <div className="export__fmts">
                {ALL_FORMATS.map((f) => (
                  <label key={f} className="export__fmt">
                    <input type="checkbox" checked={formats.has(f)} onChange={() => toggleFormat(f)} />
                    <span>{f.toUpperCase()}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="export__actions">
          <button className="export__cancel" onClick={onClose}>
            {t("settings_close")}
          </button>
          <button
            className="export__go"
            disabled={!canExport}
            onClick={() => onExport([...keys], [...formats])}
          >
            {t("export_run")}
          </button>
        </div>
      </div>
    </div>
  );
}
