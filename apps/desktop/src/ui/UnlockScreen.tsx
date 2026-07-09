import { useState } from "react";
import { useI18n } from "../i18n.js";
import { CinderMark } from "./Brand.js";
import { TitleControls } from "./TitleControls.js";

/**
 * 解鎖畫面（H4，ADR-0067）：作用中身分啟用本地密碼時，開機先驗密碼再建後端。
 * `onUnlock` 回 true＝解鎖成功（外層接手）；false＝密碼錯誤（顯示錯誤、清空輸入）。
 */
export function UnlockScreen({
  name,
  onUnlock,
}: {
  name: string;
  onUnlock: (password: string) => Promise<boolean>;
}): JSX.Element {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    const ok = await onUnlock(password);
    if (!ok) {
      setError(true);
      setPassword("");
      setBusy(false);
    }
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
          <h2 style={{ margin: "0 0 4px" }}>{t("unlock_title", { name })}</h2>
          <p className="hint">{t("unlock_hint")}</p>
          <input
            type="password"
            aria-label={t("unlock_password")}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder={t("unlock_password")}
            autoFocus
          />
          {error ? <p className="settings__warn">{t("unlock_error")}</p> : null}
          <button onClick={() => void submit()} disabled={!password || busy}>
            {t("unlock_button")}
          </button>
        </div>
      </div>
    </div>
  );
}
