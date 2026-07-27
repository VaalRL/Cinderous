import { LanguageSwitcher } from "./LanguageSwitcher.js";
import { ThemeToggleButton } from "./ThemeToggleButton.js";

/** 視窗標題列右側控制：主題切換 + 語言切換。 */
export function TitleControls(): JSX.Element {
  return (
    <span className="titlectl">
      <ThemeToggleButton />
      <LanguageSwitcher />
    </span>
  );
}
