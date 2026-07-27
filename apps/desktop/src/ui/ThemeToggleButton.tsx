import { useI18n } from "../i18n.js";
import { useTheme } from "../theme.js";

/**
 * 明/暗主題切換鈕（ADR-0249）：全 app 唯一的明暗切換 UI（SSOT）。
 * 由標題列（`TitleControls`）、經典聯絡人視窗、三欄 idbar／原生標題列共用——
 * `className` 讓各處貼合自身樣式（`themebtn`／`idbar__add`／`titlebar__btn`）。
 */
export function ThemeToggleButton({
  className = "themebtn",
  testId,
  tabIndex,
}: {
  className?: string;
  testId?: string;
  tabIndex?: number;
}): JSX.Element {
  const { t } = useI18n();
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className={className}
      aria-label={t("theme_toggle")}
      aria-pressed={theme === "dark"}
      title={t("theme_toggle")}
      onClick={toggle}
      {...(testId ? { "data-testid": testId } : {})}
      {...(tabIndex !== undefined ? { tabIndex } : {})}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
