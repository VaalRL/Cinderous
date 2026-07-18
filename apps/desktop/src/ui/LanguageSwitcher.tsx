import { useEffect, useId, useRef, useState } from "react";
import { LOCALE_LABELS, LOCALES, type Locale } from "@cinderous/i18n";
import { useI18n } from "../i18n.js";
import { menuKeydown, type MenuState } from "./lang-menu.js";

/**
 * 語言選擇下拉（WAI-ARIA listbox 模式）：🌐 觸發鈕開合，
 * 方向鍵移動高亮並環繞、Home/End 跳首尾、Enter/Space 選取、Escape 關閉，
 * 點擊外部亦關閉；關閉後焦點回到觸發鈕。
 */
export function LanguageSwitcher(): JSX.Element {
  const { locale, setLocale, t } = useI18n();
  const selectedIndex = Math.max(0, LOCALES.indexOf(locale));
  const [menu, setMenu] = useState<MenuState>({ open: false, active: selectedIndex });

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  // 開合時的焦點管理：展開聚焦清單、收合聚焦回觸發鈕。
  useEffect(() => {
    if (menu.open) listRef.current?.focus();
  }, [menu.open]);

  // 點擊元件外部即關閉。
  useEffect(() => {
    if (!menu.open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu((m) => ({ ...m, open: false }));
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu.open]);

  const openMenu = () => setMenu({ open: true, active: selectedIndex });
  const close = (returnFocus: boolean) => {
    setMenu((m) => ({ ...m, open: false }));
    if (returnFocus) triggerRef.current?.focus();
  };
  const choose = (l: Locale) => {
    setLocale(l);
    close(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const before = menu;
    const { state, select } = menuKeydown(before, e.key, LOCALES.length);
    if (state === before && !select) return; // 未處理的按鍵：交還瀏覽器
    e.preventDefault();
    if (select) {
      choose(LOCALES[before.active]!);
      return;
    }
    if (before.open && !state.open) {
      close(true); // Escape / Tab
      return;
    }
    setMenu(state);
  };

  return (
    <div className="langsw" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="langsw__trigger"
        aria-label={t("lang_label")}
        aria-haspopup="listbox"
        aria-expanded={menu.open}
        // 只留 🌐 圖示；懸停 tooltip 顯示「語言：<目前語言>」（原本外顯的語言名收進提示）。
        title={`${t("lang_label")}：${LOCALE_LABELS[locale]}`}
        onClick={() => (menu.open ? close(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span aria-hidden="true">🌐</span>
      </button>
      {menu.open && (
        <ul
          ref={listRef}
          className="langsw__menu"
          role="listbox"
          tabIndex={-1}
          aria-label={t("lang_label")}
          aria-activedescendant={optionId(menu.active)}
          onKeyDown={onKeyDown}
        >
          {LOCALES.map((l, i) => (
            <li
              key={l}
              id={optionId(i)}
              role="option"
              aria-selected={l === locale}
              className={`langsw__opt${i === menu.active ? " active" : ""}${l === locale ? " on" : ""}`}
              onMouseEnter={() => setMenu((m) => ({ ...m, active: i }))}
              onClick={() => choose(l)}
            >
              {LOCALE_LABELS[l]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
