import { listEntries, weightedOrder } from "@cinder/core";
import { useEffect, useState } from "react";
import { ANCHOR_RELAYS } from "../bootstrap-config.js";
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
}: {
  onSignIn: (name: string, relayUrl: string) => void;
  /** 從舊裝置匯入（ADR-0072 D4a）；未提供＝不顯示入口（示範/瀏覽器）。 */
  onPair?: (code: string, onSas: (sas: string) => void) => Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [relay, setRelay] = useState(initialRelay);
  // relay 欄預設收起（已自動填好預設站）；點「使用其他中繼站」才展開輸入（ADR-0069）。
  const [showRelay, setShowRelay] = useState(false);
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
    void (async () => {
      for (const url of candidates) {
        const ok = await probeRelay(url, 3000);
        if (cancelled) return;
        if (ok) {
          setRelay((cur) => cur || url); // 使用者已手填則不覆蓋
          return;
        }
      }
      if (!cancelled) setRelay((cur) => cur || candidates[0] || ""); // 全滅仍給首選（清單機制會自癒）
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
          {showRelay ? (
            <div className="signin__relay" data-testid="relay-field">
              <input
                aria-label={t("signIn_relayUrl")}
                value={relay}
                onChange={(e) => setRelay(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={t("signIn_relayUrl")}
                autoFocus
              />
              <button type="button" className="signin__relaytoggle" data-testid="relay-hide" onClick={() => setShowRelay(false)}>
                {t("signIn_relayHide")}
              </button>
            </div>
          ) : (
            <p className="hint signin__relayline">
              <span data-testid="relay-status">
                {relayHost ? t("signIn_relayUsing", { host: relayHost }) : t("signIn_relayDemo")}
              </span>
              <button type="button" className="signin__relaytoggle" data-testid="relay-change" onClick={() => setShowRelay(true)}>
                {t("signIn_relayChange")}
              </button>
            </p>
          )}
          <button onClick={submit}>{t("signIn_button")}</button>
          <p className="hint">{t("signIn_hint2")}</p>

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
      </div>
    </div>
  );
}
