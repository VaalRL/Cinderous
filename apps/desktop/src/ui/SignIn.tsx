import { listEntries, type OrgInvite, parseOrgInvite, weightedOrder } from "@cinderous/core";
import { useEffect, useRef, useState } from "react";
import { ANCHOR_RELAYS } from "@cinderous/engine";
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
  lookupName = () => "create",
  onJoinOrg,
  initialName,
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
  /**
   * ADR-0146：以顯示名稱查詢本機是否已有同名身分。`"enter"`＝命中既有（改為登入該身分，不建新；
   * 密碼在重載後的解鎖畫面驗證）；`"ambiguous"`＝多個同名（擋下）；`"create"`＝建新。
   * 未提供（示範/無登錄）一律 `"create"`。
   */
  lookupName?: (name: string) => "create" | "enter" | "ambiguous";
  /**
   * 入職邀請（ADR-0156）：顯示名稱欄偵測到邀請碼時轉為「加入組織」面板，
   * 以邀請碼的 relay／管理者建立企業成員身分（建立後自動向管理者提出入職）。
   */
  onJoinOrg?: (invite: OrgInvite, name: string, password?: string) => void;
  /** 測試用：預填顯示名稱欄（SSR 測試無法打字；貼邀請碼情境）。 */
  initialName?: string;
}): JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState(initialName ?? "");
  const [relay, setRelay] = useState(initialRelay);
  // relay 欄預設收起（已自動填好預設站）；點「使用其他中繼站」才展開輸入（ADR-0069）。
  const [showRelay, setShowRelay] = useState(false);
  // 使用者已動過 relay 欄（展開或編輯）→ 自動選座的慢 probe 不再覆寫（審查 L2）。
  const relayTouched = useRef(false);
  // 自動選座進行中：顯示「挑選中…」而非誤導的狀態（審查 L3）。初值也 seed——
  // 有錨點且無預設 relay 時起始即 true，避免首個 render 閃過空狀態文字。
  const [probing, setProbing] = useState(() => !relay && ANCHOR_RELAYS.length > 0);
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

  // ADR-0146：輸入的名稱是否命中本機既有身分。命中＝改為「登入既有」，隱藏建新用的密碼/中繼站欄。
  const nameMatch = lookupName(name.trim());
  const entering = nameMatch !== "create";

  // 入職邀請（ADR-0156）：名稱欄貼入邀請碼（或含邀請碼的整封信）→ 轉為「加入組織」面板。
  const invite = onJoinOrg ? parseOrgInvite(name) : null;
  const [joinName, setJoinName] = useState("");
  const joinTaken = !!invite && joinName.trim().length > 0 && lookupName(joinName.trim()) !== "create";
  const submitJoin = (): void => {
    if (!invite || !joinName.trim() || joinTaken) return;
    if (requirePassword) {
      if (!password) {
        setPwErr(t("signIn_passwordRequired"));
        return;
      }
      if (password !== password2) {
        setPwErr(t("signIn_passwordMismatch"));
        return;
      }
    }
    setPwErr("");
    onJoinOrg?.(invite, joinName.trim(), requirePassword ? password : undefined);
  };

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    if (entering) {
      // ADR-0146：命中既有身分（或多個同名）→ 交給 App 切換為作用中並重載（有鎖則於解鎖畫面驗密碼），
      // 或多個同名時由 App 擋下提示。這裡不建新、不驗建新用的密碼。
      onSignIn(n, relay.trim());
      return;
    }
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
    <div className="desktop desktop--center">
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
            onKeyDown={(e) => e.key === "Enter" && (invite ? submitJoin() : submit())}
            placeholder={t("signIn_displayName")}
          />
          {/* 入職邀請（ADR-0156）：偵測到邀請碼 → 加入組織面板（其餘建新/登入區塊全收起）。 */}
          {invite ? (
            <div className="signin__join" data-testid="signin-join">
              <p className="hint">{t("signIn_joinHint", { host: hostOf(invite.relayUrl) })}</p>
              {/* 公司帳號金鑰託管揭露（ADR-0163）：貼碼帶 escrow 時明示，員工建立即同意。 */}
              {invite.escrow ? (
                <p className="settings__warn" data-testid="signin-join-escrow">{t("signIn_joinEscrow")}</p>
              ) : null}
              <input
                aria-label={t("signIn_joinName")}
                value={joinName}
                onChange={(e) => {
                  setJoinName(e.target.value);
                  setPwErr("");
                }}
                onKeyDown={(e) => e.key === "Enter" && submitJoin()}
                placeholder={t("signIn_joinName")}
                autoFocus
              />
              {joinTaken ? <p className="signin__err" data-testid="join-name-taken">{t("addId_nameTaken")}</p> : null}
              {requirePassword ? (
                <>
                  <p className="hint">{t("signIn_passwordWhy")}</p>
                  <input
                    type="password"
                    aria-label={t("signIn_password")}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setPwErr("");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && submitJoin()}
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
                    onKeyDown={(e) => e.key === "Enter" && submitJoin()}
                    placeholder={t("signIn_passwordAgain")}
                  />
                </>
              ) : null}
              {pwErr ? <p className="signin__err">{pwErr}</p> : null}
              <button data-testid="signin-join-submit" disabled={!joinName.trim() || joinTaken} onClick={submitJoin}>
                {t("signIn_joinButton")}
              </button>
            </div>
          ) : null}
          {/* ADR-0146：名稱命中本機既有身分 → 提示「將登入既有身分」，並收起建新用的中繼站/密碼欄。 */}
          {!invite && entering ? (
            <p className="hint signin__enterhint" data-testid="signin-enter-existing">
              {nameMatch === "ambiguous"
                ? t("signIn_ambiguousName")
                : t("signIn_enterExistingHint", { name: name.trim() })}
            </p>
          ) : null}
          {invite || entering ? null : showRelay ? (
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
            // 收合狀態：顯示將連線的主機 ＋ 一顆明確的「使用其他中繼站」鈕（點了才展開輸入）。
            <p className="hint signin__relayline">
              <span data-testid="relay-status">
                {relayHost
                  ? t("signIn_relayUsing", { host: relayHost })
                  : probing
                    ? t("signIn_relayProbing")
                    : t("signIn_relayDemo")}
              </span>{" "}
              <button
                type="button"
                className="signin__relaytoggle"
                data-testid="relay-change"
                onClick={() => {
                  relayTouched.current = true; // 展開＝有意自訂→鎖住自動選座覆寫
                  setShowRelay(true);
                }}
              >
                {t("signIn_relayChange")}
              </button>
            </p>
          )}
          {/* 瀏覽器（ADR-0122）：本地密碼**必填**——沒有它，重新整理一次身分就沒了。
              ADR-0146：命中既有身分時不在此設密碼（於重載後的解鎖畫面驗證既有密碼）。 */}
          {!invite && !entering && requirePassword ? (
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

          {invite ? null : (
            <button onClick={submit}>{entering ? t("signIn_enterExisting") : t("signIn_button")}</button>
          )}

          {/* 用既有 nsec 登入（ADR-0122）：忘記密碼、或在舊版被換掉身分的人的出路。 */}
          {!invite && onEnterNsec && !nsecOpen ? (
            <button className="settings__reveal" data-testid="nsec-open" onClick={() => setNsecOpen(true)}>
              {t("signIn_useNsec")}
            </button>
          ) : null}
          {!invite && onEnterNsec && nsecOpen ? (
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

          {!invite && onPair && !pairOpen ? (
            <button className="signin__secondary" data-testid="pair-import" onClick={() => setPairOpen(true)}>
              {t("pair_importButton")}
            </button>
          ) : null}
          {!invite && onPair && pairOpen ? (
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
        {/* 「使用其他中繼站」入口改到收合狀態列（明確文字鈕，ADR-0195）；此處不再放低調角落鈕。 */}
      </div>
    </div>
  );
}
