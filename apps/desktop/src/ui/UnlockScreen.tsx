import { isBackupCode, parseBackupCode } from "@cinderous/core";
import { useState } from "react";
import { useI18n } from "../i18n.js";
import { CinderMark } from "./Brand.js";
import { TitleControls } from "./TitleControls.js";

/**
 * 救援結果（ADR-0073）：以 nsec 解開資料金鑰、設新密碼、救回舊本地資料。
 * 回 true＝成功（外層接手建後端）；回 false＝救援失敗（nsec 不符/無救援資料）；
 * throw `RESCUE_RESET_OK`＝密碼已重設成功但自動進入失敗（審查 F3，須提示重新登入而非報失敗）。
 */
export type RescueFn = (nsec: string, newPassword: string) => Promise<boolean>;

/** 密碼已重設、僅自動解鎖失敗的哨符錯誤訊息（App.rescue → RescuePanel 區分用）。 */
export const RESCUE_RESET_OK = "RESCUE_RESET_OK";

/**
 * 解鎖畫面（H4，ADR-0067）：作用中身分啟用本地密碼時，開機先驗密碼再建後端。
 * `onRescue`（ADR-0073）提供時顯示「忘記密碼？」逃生口——以 nsec／備份碼救回。
 */
export function UnlockScreen({
  name,
  onUnlock,
  onRescue,
}: {
  name: string;
  onUnlock: (password: string) => Promise<boolean>;
  onRescue?: RescueFn;
}): JSX.Element {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rescue, setRescue] = useState(false);
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
  if (rescue && onRescue) return <RescuePanel name={name} onRescue={onRescue} onBack={() => setRescue(false)} />;
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
          {onRescue ? (
            <button className="settings__reveal" data-testid="unlock-forgot" onClick={() => setRescue(true)}>
              {t("unlock_forgot")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 救援面板（ADR-0073）：輸入 nsec 或備份碼＋新密碼；備份碼需備份密碼先解出 nsec（重用 H6）。 */
function RescuePanel({ name, onRescue, onBack }: { name: string; onRescue: RescueFn; onBack: () => void }): JSX.Element {
  const { t } = useI18n();
  const [secret, setSecret] = useState(""); // nsec 或備份碼
  const [backupPw, setBackupPw] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isCode = isBackupCode(secret.trim());
  const ready = secret.trim() && pw && pw === pw2 && (!isCode || backupPw);
  const submit = () => {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    // scrypt 解備份碼約需一秒：讓 UI 先呈現忙碌再執行。
    setTimeout(async () => {
      try {
        const nsec = isCode ? parseBackupCode(secret.trim(), backupPw).nsec : secret.trim();
        const ok = await onRescue(nsec, pw);
        if (!ok) {
          setError(t("rescue_error"));
          setBusy(false);
        }
      } catch (e) {
        // 密碼已重設、僅自動進入失敗 → 提示重新登入，而非誤報救援失敗（審查 F3）。
        setError((e as Error)?.message === RESCUE_RESET_OK ? t("rescue_resetOk") : t("rescue_error"));
        setBusy(false);
      }
    }, 0);
  };
  return (
    <div className="desktop" style={{ justifyContent: "center" }}>
      <div className="win signin">
        <div className="win__title">
          <span>{t("appName")}</span>
          <span className="spacer" />
          <TitleControls />
        </div>
        <div className="signin__body" data-testid="rescue-panel">
          <h2 style={{ margin: "0 0 4px" }}>{t("rescue_title", { name })}</h2>
          <p className="hint">{t("rescue_hint")}</p>
          <input
            aria-label={t("rescue_secret")}
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
              setError("");
            }}
            placeholder={t("rescue_secret")}
          />
          {isCode ? (
            <input
              type="password"
              aria-label={t("rescue_backupPw")}
              value={backupPw}
              onChange={(e) => setBackupPw(e.target.value)}
              placeholder={t("rescue_backupPw")}
            />
          ) : null}
          <input
            type="password"
            aria-label={t("rescue_newPw")}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={t("rescue_newPw")}
          />
          <input
            type="password"
            aria-label={t("rescue_newPw2")}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            placeholder={t("rescue_newPw2")}
          />
          {error ? <p className="settings__warn">{error}</p> : null}
          <button data-testid="rescue-submit" onClick={submit} disabled={!ready || busy}>
            {busy ? t("rescue_busy") : t("rescue_submit")}
          </button>
          <button className="settings__reveal" onClick={onBack} disabled={busy}>
            {t("rescue_back")}
          </button>
        </div>
      </div>
    </div>
  );
}
