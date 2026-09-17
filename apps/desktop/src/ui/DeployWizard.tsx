// 一鍵部署自有 relay 的精靈（ADR-0356）。
//
// ## 為什麼是五個畫面而不是一顆按鈕
//
// 「一鍵」講的是**不必離開產品**，不是「不必做任何決定」。中間有三件事非問不可：
// 授權（Cloudflare 的第三方 OAuth 2026-06 才開放，而我方的客戶端還沒過網域驗證，
// 所以 token 目前仍得手動貼一次，見 ADR-0356 §1b）、帳號（一把 token 可能看得到好幾個）、
// 以及 workers.dev 名稱（它會永久出現在網址裡）。
// 把它們攤成五步，每一步只做一件事，比塞成一頁然後在中間跳對話框好。
//
// ## 這一層不碰 Cloudflare
//
// 所有 IO 走 {@link DeployApi}（產線＝`native/cf-deploy.ts` → Tauri command → Rust）。
// 因此整個狀態機在 jsdom 裡測得到，不需要真的部署一座節點。

import { useRef, useState } from "react";
import { useI18n } from "../i18n.js";
import * as cf from "../native/cf-deploy.js";
import type { CfAccount, DeployFail } from "../native/cf-deploy.js";

/** 精靈需要的能力（產線走 Tauri，測試走假件）。 */
export interface DeployApi {
  tokenUrl(): Promise<string>;
  saveToken(token: string): Promise<void>;
  listAccounts(): Promise<CfAccount[]>;
  deploy(accountId: string, subdomain?: string, unified?: boolean): Promise<{ relay_url: string; subdomain: string }>;
  verifyRelay(url: string): Promise<boolean>;
  forgetToken(): Promise<void>;
  /** 拆除部署到一半的 relay（使用者中途放棄時）。 */
  teardown(): Promise<void>;
  openUrl(url: string): void;
}

/** 產線實作。 */
export const tauriDeployApi: DeployApi = {
  tokenUrl: cf.tokenUrl,
  saveToken: cf.saveToken,
  listAccounts: cf.listAccounts,
  deploy: cf.deploy,
  verifyRelay: (url) => cf.verifyRelay(url),
  forgetToken: cf.forgetToken,
  teardown: cf.teardown,
  openUrl: (url) => {
    window.open(url, "_blank", "noopener");
  },
};

type Step = "intro" | "token" | "account" | "subdomain" | "working" | "done";

export function DeployWizard({
  api = tauriDeployApi,
  onClose,
  onDeployed,
  onAdopt,
}: {
  api?: DeployApi;
  onClose: () => void;
  /** 部署成功（且驗證通過）時呼叫——**不論使用者要不要切 home**，網址都要記下來。 */
  onDeployed: (relayUrl: string) => void;
  /** 使用者選了「設為我的主要中繼站」。 */
  onAdopt: (relayUrl: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("intro");
  const [token, setToken] = useState("");
  const [keepToken, setKeepToken] = useState(true);
  const [accounts, setAccounts] = useState<CfAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [relayUrl, setRelayUrl] = useState("");
  const [setHome, setSetHome] = useState(true); // ADR-0356 §5：預設會切，但可取消
  // ADR-0354：統一模式**預設不勾**——它讓同一台伺服器同時送出客戶端程式，是信任降級。
  const [unified, setUnified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<DeployFail | null>(null);
  /**
   * 使用者是否已經放棄這次流程。
   *
   * 🔴 「取消」按鈕在**每一個**畫面都在，包含「部署中」。它只是關掉精靈——飛行中的
   * `deploy()`／`verifyRelay()` 還在跑。少了這個旗標，晚到的成功結果照樣呼叫 `onDeployed`，
   * 把一座使用者明明已經取消的節點記下來，而畫面早就關了，他不會知道。
   */
  const abandoned = useRef(false);

  const fold = (e: unknown): void => {
    const f = e as DeployFail;
    setFail(f?.key ? f : { key: "deploy_errMalformed", detail: String(e) });
  };

  /** 貼上 token → 存進金鑰庫 → 列帳號。**存完立刻把前端這份清掉**（ADR-0356 §1）。 */
  const submitToken = (): void => {
    setBusy(true);
    setFail(null);
    void api
      .saveToken(token.trim())
      .then(() => {
        setToken(""); // 🔴 不留在 webview
        return api.listAccounts();
      })
      .then((list) => {
        setAccounts(list);
        setAccountId(list[0]?.id ?? "");
        setStep("account");
      })
      .catch(fold)
      .finally(() => setBusy(false));
  };

  /** 部署 → 驗證。驗證沒過**不算成功**，也就不會讓使用者去切 home。 */
  const runDeploy = (sub?: string): void => {
    setStep("working");
    setFail(null);
    void api
      .deploy(accountId, sub, unified)
      .then(async (out) => {
        if (abandoned.current) return; // 使用者已放棄：在途的結果不得落地
        const ok = await api.verifyRelay(out.relay_url);
        if (abandoned.current) return;
        if (!ok) throw { key: "deploy_errVerify", detail: out.relay_url } satisfies DeployFail;
        setRelayUrl(out.relay_url);
        onDeployed(out.relay_url); // 不論切不切 home 都記下來（§5 的回頭路）
        setStep("done");
        // 🔴 收尾動作**不能**共用判斷部署成敗的 catch：`onDeployed` 已經通知父層成功了，
        // 這裡再拋就會讓精靈顯示「失敗，請重試」而父層認為已成功，兩邊狀態互相矛盾。
        if (!keepToken) {
          try {
            await api.forgetToken();
          } catch {
            /* 忘不掉 token 不影響部署結果；使用者仍可在 Cloudflare 後台撤銷 */
          }
        }
      })
      .catch((e: unknown) => {
        if (abandoned.current) return;
        fold(e);
        // 「帳號還沒命名子網域」不是失敗，是還缺一個答案——回去問他。
        if ((e as DeployFail)?.key === "deploy_errNoSubdomain") {
          setFail(null);
          setStep("subdomain");
        } else {
          setStep("account");
        }
      });
  };

  /** 放棄：標記起來讓在途的結果不再落地，並拆掉可能已經建好的半成品（ADR-0356 §4）。 */
  const abandon = (): void => {
    abandoned.current = true;
    // 已經部署到一半才取消 ⇒ 帳號上可能留著一座跑不起來的 relay。拆掉它，
    // 失敗不擋關閉——留一座孤兒總比讓使用者卡在關不掉的視窗好。
    if (step === "working") void api.teardown().catch(() => {});
    onClose();
  };

  const finish = (): void => {
    if (setHome && relayUrl) onAdopt(relayUrl);
    onClose();
  };

  const err = fail ? (
    <div className="deploy__err" data-testid="deploy-error" role="alert">
      <div>{t(fail.key as Parameters<typeof t>[0])}</div>
      {fail.detail ? <div className="hint">{fail.detail}</div> : null}
    </div>
  ) : null;

  return (
    <div className="deploy" data-testid="deploy-wizard">
      {step === "intro" ? (
        <section data-testid="deploy-intro">
          <h3>{t("deploy_introTitle")}</h3>
          <p>{t("deploy_introBody")}</p>
          <p className="hint">{t("deploy_introCost")}</p>
          <button type="button" data-testid="deploy-start" onClick={() => setStep("token")}>
            {t("deploy_start")}
          </button>
        </section>
      ) : null}

      {step === "token" ? (
        <section data-testid="deploy-token">
          <h3>{t("deploy_tokenTitle")}</h3>
          <p>{t("deploy_tokenBody")}</p>
          <button
            type="button"
            data-testid="deploy-open-token"
            onClick={() => void api.tokenUrl().then(api.openUrl)}
          >
            {t("deploy_tokenOpen")}
          </button>
          <input
            type="password"
            data-testid="deploy-token-input"
            placeholder={t("deploy_tokenPlaceholder")}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <label>
            <input
              type="checkbox"
              data-testid="deploy-keep-token"
              checked={keepToken}
              onChange={(e) => setKeepToken(e.target.checked)}
            />
            {t("deploy_tokenKeep")}
          </label>
          <p className="hint">{t("deploy_tokenKeepHint")}</p>
          {err}
          <button
            type="button"
            data-testid="deploy-token-next"
            disabled={busy || token.trim() === ""}
            onClick={submitToken}
          >
            {t("deploy_next")}
          </button>
        </section>
      ) : null}

      {step === "account" ? (
        <section data-testid="deploy-account">
          <h3>{t("deploy_accountTitle")}</h3>
          <select
            data-testid="deploy-account-select"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id}
              </option>
            ))}
          </select>
          {/* ADR-0354 的信任取捨：預設不勾，且把那句話原樣講出來。 */}
          <label>
            <input
              type="checkbox"
              data-testid="deploy-unified"
              checked={unified}
              onChange={(e) => setUnified(e.target.checked)}
            />
            {t("deploy_unified")}
          </label>
          <p className="hint">{t("deploy_unifiedWarn")}</p>
          {err}
          <button
            type="button"
            data-testid="deploy-run"
            disabled={!accountId}
            onClick={() => runDeploy()}
          >
            {fail ? t("deploy_retry") : t("deploy_next")}
          </button>
        </section>
      ) : null}

      {step === "subdomain" ? (
        <section data-testid="deploy-subdomain">
          <h3>{t("deploy_subdomainTitle")}</h3>
          {/* 🔴 這個名字之後改不了，所以不替他編一個。 */}
          <p>{t("deploy_subdomainBody")}</p>
          <input
            data-testid="deploy-subdomain-input"
            placeholder={t("deploy_subdomainPlaceholder")}
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value)}
          />
          {err}
          <button
            type="button"
            data-testid="deploy-subdomain-next"
            disabled={subdomain.trim() === ""}
            onClick={() => runDeploy(subdomain.trim())}
          >
            {t("deploy_next")}
          </button>
        </section>
      ) : null}

      {step === "working" ? (
        <section data-testid="deploy-working">
          <h3>{t("deploy_working")}</h3>
          <ul>
            <li>{t("deploy_stepUpload")}</li>
            <li>{t("deploy_stepVerify")}</li>
          </ul>
        </section>
      ) : null}

      {step === "done" ? (
        <section data-testid="deploy-done">
          <h3>{t("deploy_doneTitle")}</h3>
          <p>{t("deploy_doneBody")}</p>
          <code data-testid="deploy-url">{relayUrl}</code>
          <label>
            <input
              type="checkbox"
              data-testid="deploy-set-home"
              checked={setHome}
              onChange={(e) => setSetHome(e.target.checked)}
            />
            {t("deploy_setHome")}
          </label>
          <p className="hint">{t("deploy_setHomeHint")}</p>
          <button type="button" data-testid="deploy-finish" onClick={finish}>
            {t("deploy_finish")}
          </button>
        </section>
      ) : null}

      <button type="button" data-testid="deploy-cancel" onClick={abandon}>
        {t("deploy_cancel")}
      </button>
    </div>
  );
}
