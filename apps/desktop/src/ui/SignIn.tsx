import { useState } from "react";
import { useI18n } from "../i18n.js";
import { CinderMark } from "./Brand.js";
import { TitleControls } from "./TitleControls.js";

/** 上次使用 relay 的本地記憶鍵（登入時由 App 寫入，此處讀回作為預設值）。 */
export const RELAY_URL_KEY = "nb.relayUrl";

/** relay 欄位預設值：`?relay=` 參數優先，其次上次使用的網址（純函式可測）。 */
export function initialRelayUrl(search: string, lastUsed: string | null): string {
  const param = new URLSearchParams(search).get("relay");
  return param ?? lastUsed ?? "";
}

function initialRelay(): string {
  try {
    return initialRelayUrl(window.location.search, localStorage.getItem(RELAY_URL_KEY));
  } catch {
    return "";
  }
}

export function SignIn({ onSignIn }: { onSignIn: (name: string, relayUrl: string) => void }): JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [relay, setRelay] = useState(initialRelay);
  const submit = () => {
    const n = name.trim();
    if (n) onSignIn(n, relay.trim());
  };
  return (
    <div className="desktop" style={{ justifyContent: "center" }}>
      <div className="win signin">
        <div className="win__title">
          <span>{t("appName")}</span>
          <span className="spacer" />
          <TitleControls />
        </div>
        <div className="signin__body">
          <div className="signin__logo"><CinderMark size={64} /></div>
          <h2 style={{ margin: "0 0 4px" }}>{t("signIn_title")}</h2>
          <p className="hint">{t("signIn_hint")}</p>
          <input
            aria-label={t("signIn_displayName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={t("signIn_displayName")}
          />
          <input
            aria-label={t("signIn_relayUrl")}
            value={relay}
            onChange={(e) => setRelay(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={t("signIn_relayUrl")}
          />
          <button onClick={submit}>{t("signIn_button")}</button>
          <p className="hint">{t("signIn_hint2")}</p>
        </div>
      </div>
    </div>
  );
}
