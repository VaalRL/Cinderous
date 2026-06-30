import { LOCALE_LABELS, LOCALES } from "@nostr-buddy/i18n";
import { useI18n } from "../i18n.js";

export function LanguageSwitcher(): JSX.Element {
  const { locale, setLocale } = useI18n();
  return (
    <span className="langsw">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          className={l === locale ? "on" : ""}
          aria-label={LOCALE_LABELS[l]}
          aria-pressed={l === locale}
          onClick={() => setLocale(l)}
        >
          {LOCALE_LABELS[l]}
        </button>
      ))}
    </span>
  );
}
