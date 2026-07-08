// composer 的快速插入選單（➕）：Obsidian 風 callout、程式碼區塊、清單模板。
// 點選後由父層插入游標處，並選取佔位字讓使用者直接打字替換。
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n.js";
import { CALLOUT_MENU, calloutSpec } from "./markdown.js";

export interface InsertTemplate {
  key: string;
  icon: string;
  /** 顯示名（callout 用型別名，不走 i18n）。 */
  label: string;
  /** 插入的文字。 */
  text: string;
  /** 相對插入起點、應選取的佔位字範圍。 */
  selStart: number;
  selEnd: number;
}

/** callout 模板：`> [!type] 標題\n> 內容`，選取「標題」。 */
export function calloutTemplate(type: string, title: string, body: string): InsertTemplate {
  const head = `> [!${type}] `;
  return {
    key: `co-${type}`,
    icon: calloutSpec(type).icon,
    label: type.charAt(0).toUpperCase() + type.slice(1),
    text: `${head}${title}\n> ${body}`,
    selStart: head.length,
    selEnd: head.length + title.length,
  };
}

/** 程式碼區塊模板：選取中間的佔位字。 */
export function codeTemplate(placeholder: string, label: string): InsertTemplate {
  return { key: "code", icon: "⌨", label, text: "```\n" + placeholder + "\n```", selStart: 4, selEnd: 4 + placeholder.length };
}

/** 清單模板：`- 項目`，選取「項目」。 */
export function listTemplate(placeholder: string, label: string): InsertTemplate {
  return { key: "list", icon: "•", label, text: `- ${placeholder}`, selStart: 2, selEnd: 2 + placeholder.length };
}

export function ComposerInsert({ onPick }: { onPick: (tpl: InsertTemplate) => void }): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 點面板外關閉（與 ComposerRewrite 一致）。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (tpl: InsertTemplate): void => {
    onPick(tpl);
    setOpen(false);
  };
  const blocks = [codeTemplate(t("insert_codePh"), t("insert_codeBlock")), listTemplate(t("insert_itemPh"), t("insert_list"))];

  return (
    <div className="insertm" ref={ref}>
      <button
        type="button"
        className="insertm__btn"
        title={t("insert_open")}
        aria-label={t("insert_open")}
        data-testid="insert-btn"
        onClick={() => setOpen((o) => !o)}
      >
        ➕
      </button>
      {open ? (
        <div className="insertm__panel" data-testid="insert-panel">
          <div className="insertm__grid">
            {CALLOUT_MENU.map((type) => {
              const tpl = calloutTemplate(type, t("insert_titlePh"), t("insert_bodyPh"));
              return (
                <button
                  key={type}
                  type="button"
                  className={`insertm__item insertm__item--${calloutSpec(type).hue}`}
                  onClick={() => pick(tpl)}
                >
                  <span aria-hidden="true">{tpl.icon}</span> {tpl.label}
                </button>
              );
            })}
          </div>
          <div className="insertm__grid insertm__grid--blocks">
            {blocks.map((tpl) => (
              <button key={tpl.key} type="button" className="insertm__item" onClick={() => pick(tpl)}>
                <span aria-hidden="true">{tpl.icon}</span> {tpl.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
