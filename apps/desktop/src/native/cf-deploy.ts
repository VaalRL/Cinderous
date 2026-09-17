// 一鍵部署自有 relay 的前端接線（ADR-0356）。
//
// ## 這一層刻意很薄
//
// 部署流程、錯誤分型與 metadata 產生全部住在 Rust（`cfdeploy.rs`，有測試）。
// 這裡只負責三件事：呼叫那些 command、**驗證部署出來的 relay 真的活著**、把錯誤翻成句子。
//
// ## 🔴 token 的誠實範圍
//
// 使用者是在 App 的輸入框裡貼上 token 的，所以它**必然經過這一層一次**。做得到的保證是
// 「不留在這裡、之後也讀不回來」：`saveToken` 把它送進 OS 金鑰庫之後，呼叫端必須清掉自己的
// 狀態，而**沒有任何 command 會把 token 回傳**。與 AI 金鑰的處境完全相同。

import { invoke, isTauri } from "@tauri-apps/api/core";

/** 這個平台能不能一鍵部署。瀏覽器不行——`api.cloudflare.com` 不送 CORS 標頭。 */
export function canDeployHere(): boolean {
  return isTauri();
}

/** 部署失敗：一個 i18n 鍵 ＋ 可選細節。 */
export interface DeployFail {
  key: string;
  detail: string;
}

/** 一個 Cloudflare 帳號。 */
export interface CfAccount {
  id: string;
  name: string;
}

/** 部署結果。 */
export interface CfDeployed {
  relay_url: string;
  account_id: string;
  subdomain: string;
}

/** 把 invoke 拋出的東西收斂成 {@link DeployFail}。 */
function asFail(e: unknown): DeployFail {
  if (e && typeof e === "object" && "key" in e) return e as DeployFail;
  return { key: "deploy_errMalformed", detail: e instanceof Error ? e.message : String(e) };
}

/** 建立 API token 的預填連結（最小權限：Workers Scripts 編輯 ＋ 帳號讀取）。 */
export async function tokenUrl(): Promise<string> {
  return await invoke<string>("cf_token_url");
}

/** 收下使用者貼上的 token。成功之後**呼叫端要清掉自己手上那份**。 */
export async function saveToken(token: string): Promise<void> {
  await invoke("cf_set_token", { token });
}

/** 有沒有存著 token（只回布林；值永遠不出金鑰庫）。 */
export async function hasToken(): Promise<boolean> {
  try {
    return await invoke<boolean>("cf_has_token");
  } catch {
    return false;
  }
}

/** 忘掉 token（「用完即丟」，或想換一把）。 */
export async function forgetToken(): Promise<void> {
  try {
    await invoke("cf_forget_token");
  } catch {
    /* 它可能本來就不在——刪不掉不算錯 */
  }
}

/**
 * 拆除自己部署的那座 relay（ADR-0356 §4）。
 *
 * 使用者在精靈中途放棄時呼叫。**不接受腳本名參數**——Rust 那側只會拆我們自己會建的
 * 那一個，否則這會變成「用使用者的 token 刪掉他任何 Worker」的指令。
 * 拆不掉不算錯：留一座孤兒總比讓使用者卡在關不掉的視窗好。
 */
export async function teardown(): Promise<void> {
  try {
    await invoke("cf_teardown");
  } catch {
    /* 拆不掉就算了——冪等的腳本名讓下次部署直接覆寫它 */
  }
}

/**
 * 統一模式的健康檢查（ADR-0354）：`GET <站>/healthz` 要回純文字 `ok`。
 *
 * 🔴 **走 Rust**，不走前端 fetch。前端打那個網址需要放寬 `connect-src`，
 * 而 ADR-0356 §1 的「CSP 一個字都不用動」就會不成立。reqwest 不受 CSP 管。
 */
export async function verifyHealthz(relayUrl: string): Promise<boolean> {
  try {
    return await invoke<boolean>("cf_verify_healthz", { relayUrl });
  } catch {
    return false;
  }
}

/** 列出這把 token 看得到的帳號。 */
export async function listAccounts(): Promise<CfAccount[]> {
  try {
    return await invoke<CfAccount[]>("cf_list_accounts");
  } catch (e) {
    throw asFail(e);
  }
}

/**
 * 部署。`subdomain` 只在帳號**還沒命名** workers.dev 子網域時會被用到。
 *
 * `unified`＝順便把網頁版部署成同一座 Worker（ADR-0354）。⚠ 那是信任降級：該伺服器
 * 會同時送出客戶端程式。預設 false，UI 上也預設不勾。
 */
export async function deploy(
  accountId: string,
  subdomain?: string,
  unified?: boolean,
): Promise<CfDeployed> {
  try {
    return await invoke<CfDeployed>("cf_deploy", {
      accountId,
      ...(subdomain ? { subdomain } : {}),
      ...(unified ? { unified: true } : {}),
    });
  } catch (e) {
    throw asFail(e);
  }
}

// ── 驗證：部署 API 回 200 不等於 relay 活著 ─────────────────────────────────────

/** 驗證的等待上限。Worker 冷啟動加上 TLS 握手，五秒很寬裕了。 */
const VERIFY_TIMEOUT_MS = 8000;

/** 可注入的 WebSocket 建構子（測試用）。 */
export type SocketFactory = (url: string) => {
  addEventListener(type: string, fn: (ev: { data?: unknown }) => void): void;
  close(): void;
};

/**
 * 連上去，等一則 NIP-42 的 `["AUTH", challenge]`。
 *
 * 🔴 **為什麼不能只信部署 API 的 200**：那只說明腳本被接受了。腳本存在但路由沒開，
 * 網址是 404；路由開了但 Durable Object 綁定錯了，連線會立刻斷。這兩種情況下
 * 使用者會拿到一座「部署成功」但打不開的節點，然後我們還把 home 切過去。
 *
 * 選 AUTH 挑戰而不是隨便一個回應，是因為它證明的東西最多：TLS 通了、WebSocket 升級成功、
 * Worker 真的在跑、而且跑的是**我們這份**程式碼（`RelayCore` 的 `requireAuth: true`）。
 */
export async function verifyRelay(url: string, makeSocket?: SocketFactory): Promise<boolean> {
  const factory: SocketFactory =
    makeSocket ?? ((u) => new WebSocket(u) as unknown as ReturnType<SocketFactory>);
  return await new Promise<boolean>((resolve) => {
    let done = false;
    let ws: ReturnType<SocketFactory> | undefined;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* 已經關了 */
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), VERIFY_TIMEOUT_MS);
    try {
      ws = factory(url);
    } catch {
      finish(false);
      return;
    }
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as unknown;
        if (Array.isArray(msg) && msg[0] === "AUTH" && typeof msg[1] === "string") finish(true);
      } catch {
        /* 不是 JSON：不是我們要的那一則，繼續等 */
      }
    });
    ws.addEventListener("error", () => finish(false));
    ws.addEventListener("close", () => finish(false));
  });
}

