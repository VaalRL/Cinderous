import { listEntries, weightedOrder } from "@cinder/core";
import { useEffect, useRef, useState } from "react";
import { ANCHOR_RELAYS } from "@cinder/engine";
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

/**
 * 自動選座候選（ADR-0069 I4）：錨點物化營運預設後加權隨機排序——
 * 首選＋依序備援；無錨點（現況營運前提未備）回空、行為不變。
 */
export function autoRelayCandidates(anchors: readonly string[], rand: () => number): string[] {
  return weightedOrder(listEntries({ relays: [...anchors], updatedAt: 0 }), rand);
}

/** WebSocket 開啟探測（best-effort）；環境無 WebSocket 時視為可用（交給連線層退避）。 */
function probeRelay(url: string, timeoutMs: number): Promise<boolean> {
  if (typeof WebSocket === "undefined") return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    let ws: WebSocket | undefined;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        ws?.close();
      } catch {
        /* 忽略 */
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      ws = new WebSocket(url);
    } catch {
      clearTimeout(timer);
      resolve(false);
      return;
    }
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      finish(true);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

function initialRelay(): string {
  try {
    return initialRelayUrl(window.location.search, localStorage.getItem(RELAY_URL_KEY));
  } catch {
    return "";
  }
}

/** 取 relay 網址的主機名（去掉 wss:// 與路徑）供簡潔顯示；解析失敗回原字串。 */
export function hostOf(url: string): string {
  const u = url.trim();
  if (!u) return "";
  try {
    return new URL(u).host;
  } catch {
    return u.replace(/^wss?:\/\//i, "").replace(/\/.*$/, "");
  }
}

export function SignIn({
  onSignIn,
  onPair,
  requirePassword = false,
  onEnterNsec,
}: {
  /** `password` 只在 `requirePassword` 時有值（瀏覽器）。 */
  onSignIn: (name: string, relayUrl: string, password?: string) => void;
  /** 從舊裝置匯入（ADR-0072 D4a）；未提供＝不顯示入口（示範/瀏覽器）。 */
  onPair?: (code: string, onSas: (sas: string) => void) => Promise<void>;
  /**
   * 瀏覽器（ADR-0122）：**本地密碼必填**。
   *
   * 這裡產生的 nsec **使用者從沒看過**，而瀏覽器沒有 OS 金鑰庫——沒有密碼包裹它，
   * 使用者按一下重新整理，身分就永久消失（而且過去還會被靜默換成一把新金鑰）。
   * 桌面不需要（Tauri 有金鑰庫），故預設 false。
   */
  requirePassword?: boolean;
  /** 以既有 nsec 登入（ADR-0122）：忘記密碼、或在舊版卡住的瀏覽器使用者的出路。 */
  onEnterNsec?: (nsec: string) => Promise<boolean>;
}): JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [relay, setRelay] = useState(initialRelay);
  // relay 欄預設收起（已自動填好預設站）；點「使用其他中繼站」才展開輸入（ADR-0069）。
  const [showRelay, setShowRelay] = useState(false);
  // 使用者已動過 relay 欄（展開或編輯）→ 自動選座的慢 probe 不再覆寫（審查 L2）。
  const relayTouched = useRef(false);
  // 自動選座進行中：顯示「挑選中…」而非誤導的「示範模式」（審查 L3）。
  const [probing, setProbing] = useState(false);
  const relayHost = hostOf(relay);
  // 配對匯入（新機）：貼上載荷 → 顯示 SAS 供與舊機比對 → 舊機確認後自動完成。
  const [pairOpen, setPairOpen] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [pairSas, setPairSas] = useState("");
  const [pairErr, setPairErr] = useState("");
  const [pairBusy, setPairBusy] = useState(false);
  const startPair = () => {
    if (!onPair || !pairCode.trim() || pairBusy) return;
    setPairBusy(true);
    setPairErr("");
    void onPair(pairCode.trim(), setPairSas).catch((e: Error) => {
      setPairErr(e.message || "配對失敗");
      setPairSas("");
      setPairBusy(false);
    });
  };

  // 自動選座（ADR-0069 I4）：欄位無預設值時，自錨點加權隨機＋健康探測預填（可改可清）。
  useEffect(() => {
    if (relay) return;
    const candidates = autoRelayCandidates(ANCHOR_RELAYS, Math.random);
    if (candidates.length === 0) return;
    let cancelled = false;
    setProbing(true);
    void (async () => {
      try {
        for (const url of candidates) {
          const ok = await probeRelay(url, 3000);
          if (cancelled || relayTouched.current) return; // 使用者已動過欄位（含刻意清空）→ 不覆寫
          if (ok) {
            setRelay((cur) => cur || url);
            return;
          }
        }
        if (!cancelled && !relayTouched.current) setRelay((cur) => cur || candidates[0] || ""); // 全滅仍給首選
      } finally {
        if (!cancelled) setProbing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [nsecOpen, setNsecOpen] = useState(false);
  const [nsec, setNsec] = useState("");
  const [nsecErr, setNsecErr] = useState("");

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    if (!requirePassword) {
      onSignIn(n, relay.trim());
      return;
    }
    // 瀏覽器：沒有密碼就沒有任何方式把身分帶過重載 → 不給送出（ADR-0122）。
    if (!password) {
      setPwErr(t("signIn_passwordRequired"));
      return;
    }
    if (password !== password2) {
      setPwErr(t("signIn_passwordMismatch"));
      return;
    }
    setPwErr("");
    onSignIn(n, relay.trim(), password);
  };

  const submitNsec = (): void => {
    if (!nsec.trim() || !onEnterNsec) return;
    setNsecErr("");
    void onEnterNsec(nsec.trim()).then((ok) => {
      if (!ok) setNsecErr(t("signIn_nsecInvalid"));
    });
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
          {showRelay ? (
            <div className="signin__relay" data-testid="relay-field">
              <input
                aria-label={t("signIn_relayUrl")}
                value={relay}
                onChange={(e) => {
                  relayTouched.current = true; // 使用者編輯（含清空）→ 鎖住自動選座
                  setRelay(e.target.value);
                }}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={t("signIn_relayUrl")}
                autoFocus
              />
              <button type="button" className="signin__relaytoggle" data-testid="relay-hide" onClick={() => setShowRelay(false)}>
                {t("signIn_relayHide")}
              </button>
            </div>
          ) : (
            // 收合狀態只留「用哪個中繼站」的狀態文字；切換入口移到視窗右下角（不顯眼）。
            <p className="hint signin__relayline">
              <span data-testid="relay-status">
                {relayHost
                  ? t("signIn_relayUsing", { host: relayHost })
                  : probing
                    ? t("signIn_relayProbing")
                    : t("signIn_relayDemo")}
              </span>
            </p>
          )}
          {/* 瀏覽器（ADR-0122）：本地密碼**必填**——沒有它，重新整理一次身分就沒了。 */}
          {requirePassword ? (
            <div className="signin__pw" data-testid="signin-password">
              <p className="hint">{t("signIn_passwordWhy")}</p>
              <input
                type="password"
                aria-label={t("signIn_password")}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPwErr("");
                }}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={t("signIn_password")}
              />
              <input
                type="password"
                aria-label={t("signIn_passwordAgain")}
                value={password2}
                onChange={(e) => {
                  setPassword2(e.target.value);
                  setPwErr("");
                }}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={t("signIn_passwordAgain")}
              />
              {pwErr ? <p className="signin__err" data-testid="signin-pw-error">{pwErr}</p> : null}
            </div>
          ) : null}

          <button onClick={submit}>{t("signIn_button")}</button>
          <p className="hint">{t("signIn_hint2")}</p>

          {/* 用既有 nsec 登入（ADR-0122）：忘記密碼、或在舊版被換掉身分的人的出路。 */}
          {onEnterNsec && !nsecOpen ? (
            <button className="settings__reveal" data-testid="nsec-open" onClick={() => setNsecOpen(true)}>
              {t("signIn_useNsec")}
            </button>
          ) : null}
          {onEnterNsec && nsecOpen ? (
            <div className="settings__key" data-testid="nsec-panel">
              <p className="hint">{t("signIn_useNsecHint")}</p>
              <input
                type="password"
                aria-label={t("signIn_nsec")}
                value={nsec}
                onChange={(e) => {
                  setNsec(e.target.value);
                  setNsecErr("");
                }}
                onKeyDown={(e) => e.key === "Enter" && submitNsec()}
                placeholder="nsec1…"
              />
              {nsecErr ? <p className="signin__err" data-testid="nsec-error">{nsecErr}</p> : null}
              <button data-testid="nsec-submit" onClick={submitNsec}>
                {t("signIn_useNsecButton")}
              </button>
            </div>
          ) : null}

          {onPair && !pairOpen ? (
            <button className="settings__reveal" data-testid="pair-import" onClick={() => setPairOpen(true)}>
              {t("pair_importButton")}
            </button>
          ) : null}
          {onPair && pairOpen ? (
            <div className="settings__key" data-testid="pair-import-panel">
              <p className="hint">{t("pair_importHint")}</p>
              <input
                aria-label={t("pair_importCode")}
                value={pairCode}
                onChange={(e) => setPairCode(e.target.value)}
                placeholder={t("pair_importCode")}
                disabled={pairBusy}
              />
              {pairSas ? (
                <div data-testid="pair-import-sas">
                  <p className="hint">{t("pair_importSasHint")}</p>
                  <code style={{ fontSize: 32, textAlign: "center", letterSpacing: 8, display: "block" }}>{pairSas}</code>
                </div>
              ) : null}
              {pairErr ? <p className="settings__warn">{pairErr}</p> : null}
              <div className="settings__keyrow">
                <button onClick={startPair} disabled={!pairCode.trim() || pairBusy}>
                  {pairBusy ? t("pair_importBusy") : t("pair_importStart")}
                </button>
                <button onClick={() => setPairOpen(false)} disabled={pairBusy}>
                  {t("settings_relayChangeCancel")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {/* 「使用其他中繼站」移到模擬視窗右下角、低調呈現（ADR-0069：預設已自動選好站，換站是進階操作）。
            展開輸入時（showRelay）由內文的欄位＋收合鈕接手，這裡就不重複出現。 */}
        {!showRelay ? (
          <button
            type="button"
            className="signin__relaycorner"
            data-testid="relay-change"
            aria-label={t("signIn_relayChange")}
            title={t("signIn_relayChange")}
            onClick={() => {
              relayTouched.current = true; // 展開＝有意自訂→鎖住自動選座覆寫
              setShowRelay(true);
            }}
          >
            <span aria-hidden="true">📡</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
