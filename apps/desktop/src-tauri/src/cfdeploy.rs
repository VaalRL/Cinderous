//! Cloudflare 一鍵部署自有 relay（ADR-0356）。
//!
//! ## 為什麼這一整個模組住在 Rust 而不是前端
//!
//! 使用者交給我們的那顆 API token，是**他整個 Cloudflare 帳號的信任根**。讓它進 webview，
//! 等於任何一個 XSS 都能把它偷走——而 ADR-0128 才剛花力氣不把路徑白名單的鑰匙交給 webview。
//!
//! 這個專案已經有一模一樣的正解：AI 金鑰走 `ai_set_key` 進 OS 金鑰庫、`ai_has_key` 只回布林、
//! 金鑰**永不回到前端**，實際的 HTTP 由 Rust 發。照抄它（Fix First）。附帶好處是
//! `tauri.conf.json` 的 `connect-src` 一個字都不用動。
//!
//! ## 為什麼邏輯住在 lib 而不是 `main.rs`
//!
//! ADR-0348 讓 CI 開始編譯 `main.rs`，但**仍然測不到它**。所以照 ADR-0119 的結論辦：
//! 可測邏輯住 lib（純 std＋serde_json，不依賴 Tauri），`main.rs` 只留薄殼。
//!
//! ## HTTP 怎麼抽開
//!
//! [`CfApi`] 是一層 trait：產線用 `reqwest`（住 `main.rs`），測試用記憶體假件。
//! 因此**部署流程本身**——先問帳號、沒有子網域要先命名、上傳、開路由、驗證——
//! 整套在 `cargo test --lib` 裡跑得到，不需要真的碰 Cloudflare。



/// Cloudflare API 的基底。
pub const API_BASE: &str = "https://api.cloudflare.com/client/v4";

/// 部署出來的 worker 名稱。**固定**——重跑流程＝對同名 worker 就地更新（冪等），
/// 使用者按兩次不會產生兩座孤兒節點。
pub const WORKER_NAME: &str = "cinder-relay";

/// 模組在 multipart 裡的 part 名稱；metadata 的 `main_module` 必須指向它。
pub const MODULE_PART: &str = "worker.js";

/// 授權憑證（ADR-0356 §1b）。
///
/// 兩種變體**後面那一段完全一樣**（都是一個 bearer 憑證打同一組 API），所以從第一天就抽開：
/// token 今天能動，OAuth 要等我方客戶端通過 Cloudflare 的網域驗證與審核。等它到位時
/// 只是多一個變體，不是重寫。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CfAuth {
    /// 使用者自己在儀表板建立、貼回 App 的 API token。
    Token(String),
    /// OAuth 授權碼流程換到的存取憑證（待我方客戶端過審）。
    OAuth(String),
}

impl CfAuth {
    /// `Authorization: Bearer` 要用的字串。兩種變體在這一層沒有差別——**這正是重點**。
    pub fn bearer(&self) -> &str {
        match self {
            CfAuth::Token(t) | CfAuth::OAuth(t) => t,
        }
    }
}

/// 部署失敗的分型。
///
/// 🔴 **分型的意義是讓 UI 說得出「你該做什麼」**。全部壓成一個字串的話，使用者看到的是
/// 「部署失敗：403」——那句話對他毫無用處，他不知道要回去改權限還是重建 token。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DeployError {
    /// 401：token 無效、打錯字，或已在 Cloudflare 後台被撤銷。
    Unauthorized,
    /// 403：token 有效但權限不足（多半是漏了 Workers Scripts:Edit）。
    Forbidden,
    /// token 有效，但這把 token 看不到任何帳號。
    NoAccount,
    /// 帳號還沒命名 workers.dev 子網域——首次使用 Workers 的帳號都會卡在這裡。
    NoSubdomain,
    /// 429：被限流，等一下再試。
    RateLimited,
    /// Cloudflare 回了結構化錯誤。
    Api { code: i64, message: String },
    /// 連不上、逾時、TLS 失敗。
    Network(String),
    /// 回應不是預期的形狀（API 漂移，或我們送錯東西）。
    Malformed(String),
}

impl DeployError {
    /// 由 HTTP 狀態碼與回應主體判斷型別。
    ///
    /// 先看狀態碼再看 body：Cloudflare 對同一種錯誤在不同端點回的 `code` 不一定一致，
    /// 但 401/403/429 是穩定的。
    pub fn from_response(status: u16, body: &str) -> DeployError {
        match status {
            401 => return DeployError::Unauthorized,
            403 => return DeployError::Forbidden,
            429 => return DeployError::RateLimited,
            _ => {}
        }
        match first_api_error(body) {
            Some((code, message)) => DeployError::Api { code, message },
            None => DeployError::Malformed(format!("HTTP {status}")),
        }
    }

    /// 給 UI 的訊息鍵——**不是**給使用者看的句子。句子在 i18n，那裡才翻譯得了。
    pub fn message_key(&self) -> &'static str {
        match self {
            DeployError::Unauthorized => "deploy_errUnauthorized",
            DeployError::Forbidden => "deploy_errForbidden",
            DeployError::NoAccount => "deploy_errNoAccount",
            DeployError::NoSubdomain => "deploy_errNoSubdomain",
            DeployError::RateLimited => "deploy_errRateLimited",
            DeployError::Api { .. } => "deploy_errApi",
            DeployError::Network(_) => "deploy_errNetwork",
            DeployError::Malformed(_) => "deploy_errMalformed",
        }
    }

    /// 補充細節（API 訊息、網路錯誤原文）；沒有就空字串。UI 顯示在訊息下方的小字。
    pub fn detail(&self) -> String {
        match self {
            DeployError::Api { code, message } => format!("{code}: {message}"),
            DeployError::Network(e) | DeployError::Malformed(e) => e.clone(),
            _ => String::new(),
        }
    }
}

/// 取回應裡第一個 `errors[]` 條目。
fn first_api_error(body: &str) -> Option<(i64, String)> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let e = v.get("errors")?.as_array()?.first()?;
    let code = e.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
    let message = e.get("message").and_then(|m| m.as_str()).unwrap_or("").to_string();
    Some((code, message))
}

/// 一個 Cloudflare 帳號。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Account {
    pub id: String,
    pub name: String,
}

// ── Worker 規格與 metadata ─────────────────────────────────────────────────────

/// 部署一座 relay 需要告訴 Cloudflare 的東西。
///
/// 這份規格的**真實來源是 `relay/wrangler.toml`**（ADR-0356 §2）。這裡看起來是手寫的，
/// 但它不是第二份真實來源——`tests::spec_matches_wrangler_toml` 會把真正的 `wrangler.toml`
/// 讀進來逐欄比對。改了 toml 卻沒改這裡，`cargo test` 就紅。
///
/// 🔴 手寫一份而不在執行期解析 TOML，是因為 metadata 漂移的症狀是**「部署成功但行為不對」**
/// ——那比失敗難查得多。與其在產線多一個會出錯的解析器，不如讓測試盯住一份常數。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkerSpec {
    pub name: String,
    pub compatibility_date: String,
    /// Durable Object 綁定：(繫結變數名, 類別名)。
    pub durable_objects: Vec<(String, String)>,
    /// migration 標籤（例 `v1`）。
    pub migration_tag: String,
    /// 以 **SQLite** 為後端的 DO 類別。
    ///
    /// 🔴 `new_sqlite_classes` ≠ `new_classes`：後者是 legacy-kv 後端。寫錯這個字，
    /// 部署**會成功**，但儲存後端是錯的——又是一次「成功但行為不對」。
    pub sqlite_classes: Vec<String>,
    /// 統一模式（ADR-0354）的靜態資產設定；純 relay 模式為 `None`。
    pub assets: Option<AssetsConfig>,
}

/// 統一模式的資產路由設定（對應 `wrangler.toml` 的 `[env.unified.assets]`）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AssetsConfig {
    /// 🔴 **必須為 true**。Static Assets 預設「資產優先」——命中資產就直接回傳、
    /// **根本不執行 Worker**，而 `/` 有 `index.html`、又正是中繼站的入口。少了這一行，
    /// `wss://<站>/` 會拿到 HTML，relay 被靜默關掉（回 200，不是錯誤）。
    ///
    /// ADR-0354 整份存在的理由就是這個旗標；本欄位存在的理由是 App 內建部署曾經漏掉它，
    /// 而防漂移測試因為刻意跳過 `[env.*]` 而抓不到。
    pub run_worker_first: bool,
    /// 深層路由（`/chat/npub1…`）的回退處理。
    pub not_found_handling: String,
}

/// 產線用的 relay 規格。與 `relay/wrangler.toml` 的頂層（非 `[env.*]`）設定同構。
pub fn relay_spec() -> WorkerSpec {
    WorkerSpec {
        name: WORKER_NAME.to_string(),
        compatibility_date: "2024-12-01".to_string(),
        durable_objects: vec![("RELAY_ROOM".to_string(), "RelayRoom".to_string())],
        migration_tag: "v1".to_string(),
        sqlite_classes: vec!["RelayRoom".to_string()],
        assets: None,
    }
}

/// 統一模式的規格（ADR-0354）：同一座 Worker 既是 relay 也是網頁版。
pub fn unified_spec() -> WorkerSpec {
    WorkerSpec {
        assets: Some(AssetsConfig {
            run_worker_first: true,
            not_found_handling: "single-page-application".to_string(),
        }),
        ..relay_spec()
    }
}

/// 組出 multipart 的 `metadata` JSON。
///
/// **刻意不帶的東西**：`vars` 裡的 `TURN_KEY_ID` 與 `TURN_LIMIT` 速率限制綁定。
/// 那是**官方站的** TURN 設定，不該跟著使用者的節點跑。`Env` 裡這些欄位都是 optional，
/// 未設時 `GET /turn` 回 204、客戶端退回純 STUN——那是 ADR-0243 既有的安全降級路徑。
///
/// ⚠ 但那條降級會讓自架者的通話失去保底，所以 ADR-0356 §6 同時把 TURN 端點改成
/// 「home → 錨點」序列後備。兩件事必須一起做。
pub fn metadata_json(spec: &WorkerSpec, assets_jwt: Option<&str>) -> String {
    let bindings: Vec<serde_json::Value> = spec
        .durable_objects
        .iter()
        .map(|(name, class_name)| {
            serde_json::json!({
                "type": "durable_object_namespace",
                "name": name,
                "class_name": class_name,
            })
        })
        .collect();
    let mut meta = serde_json::json!({
        "main_module": MODULE_PART,
        "compatibility_date": spec.compatibility_date,
        "bindings": bindings,
        "migrations": [{
            "tag": spec.migration_tag,
            "new_sqlite_classes": spec.sqlite_classes,
        }],
    });
    // 統一模式（ADR-0354）：資產先走三步上傳，完成憑證在這裡交回去。
    // 🔴 **`config` 不能省**。只給 `jwt` 的話資產會上去、Worker 也會部署，但路由設定會是
    // Cloudflare 的預設值（資產優先）⇒ `/` 回 index.html、Worker 不執行 ⇒ 中繼站靜默死掉。
    // 那正是 ADR-0354 整份在防的事，而 App 內建部署一度就是這樣送出去的。
    if let (Some(jwt), Some(a)) = (assets_jwt, spec.assets.as_ref()) {
        meta["assets"] = serde_json::json!({
            "jwt": jwt,
            "config": {
                "run_worker_first": a.run_worker_first,
                "not_found_handling": a.not_found_handling,
            },
        });
    }
    meta.to_string()
}

/// 由子網域組出這座 relay 的 WebSocket 位址。
pub fn relay_url(subdomain: &str) -> String {
    format!("wss://{WORKER_NAME}.{subdomain}.workers.dev")
}

/// 建立 API token 的預填連結（ADR-0356 §1b）。
///
/// 把「建立一把權限正確的 token」從一頁表單壓成一次點擊。**只是預填**——使用者仍可能
/// 改成更寬的權限，App 無從阻止，只能在 UI 明示建議值。
pub fn token_template_url() -> String {
    // 最小權限：上傳腳本 ＋ 讀帳號。多一項都不需要。
    let perms = r#"[{"key":"workers_scripts","type":"edit"},{"key":"account_settings","type":"read"}]"#;
    format!(
        "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys={}&accountId=*&zoneId=all&name={}",
        urlencode(perms),
        urlencode("Cinderous Relay Deploy"),
    )
}

/// 最小的百分比編碼（query 值用）。
///
/// 刻意手寫而不引入 URL 函式庫：這裡只有兩個固定字串要編碼，而且這個模組必須在
/// **不開 `tauri-app` feature**（＝沒有 reqwest／url）時也編得起來、測得到。
/// 同 `aikey::endpoint_host` 的理由。
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// ── HTTP 接縫 ─────────────────────────────────────────────────────────────────

/// 一次 API 呼叫的結果：HTTP 狀態碼 ＋ 回應主體。
///
/// 刻意**不**在這一層判成敗——判斷要看端點（例如「子網域不存在」在某些端點是 404 但
/// 對我們是一個正常狀態，不是錯誤）。這裡只忠實回報。
pub struct CfResponse {
    pub status: u16,
    pub body: String,
}

/// Cloudflare API 的傳輸層。產線用 `reqwest`（住 `main.rs`），測試用記憶體假件。
///
/// ⚠ `async fn` in trait：只做靜態分派（泛型），不做 `dyn`，所以不需要 `async-trait`。
#[allow(async_fn_in_trait)]
pub trait CfApi {
    /// `GET <API_BASE><path>`。
    async fn get(&self, path: &str, auth: &CfAuth) -> Result<CfResponse, DeployError>;
    /// `PUT <API_BASE><path>`，JSON 主體。
    async fn put_json(&self, path: &str, auth: &CfAuth, body: String) -> Result<CfResponse, DeployError>;
    /// `POST <API_BASE><path>`，JSON 主體。
    async fn post_json(&self, path: &str, auth: &CfAuth, body: String) -> Result<CfResponse, DeployError>;
    /// `DELETE <API_BASE><path>`。
    async fn delete(&self, path: &str, auth: &CfAuth) -> Result<CfResponse, DeployError>;
    /// `POST <API_BASE><path>`，資產分桶上傳。
    ///
    /// ⚠ 授權用的是**上傳工作階段的 jwt**，不是帳號 token——所以這個方法不吃 [`CfAuth`]。
    /// `files` 是 (雜湊, base64 內容) 的列表。
    async fn post_assets(
        &self,
        path: &str,
        jwt: &str,
        files: Vec<(String, String)>,
    ) -> Result<CfResponse, DeployError>;
    /// `PUT <API_BASE><path>`，multipart：一個 `metadata` JSON 欄位 ＋ 一個模組檔欄位。
    async fn put_script(
        &self,
        path: &str,
        auth: &CfAuth,
        metadata: String,
        module: Vec<u8>,
    ) -> Result<CfResponse, DeployError>;
}

/// 成功時取出 `result`；失敗時轉成分型錯誤。
fn result_of(resp: CfResponse) -> Result<serde_json::Value, DeployError> {
    if !(200..300).contains(&resp.status) {
        return Err(DeployError::from_response(resp.status, &resp.body));
    }
    let v: serde_json::Value =
        serde_json::from_str(&resp.body).map_err(|e| DeployError::Malformed(e.to_string()))?;
    // Cloudflare 會在 HTTP 200 裡放 `success: false`——只看狀態碼會把失敗當成功。
    if v.get("success").and_then(|s| s.as_bool()) == Some(false) {
        return Err(match first_api_error(&resp.body) {
            Some((code, message)) => DeployError::Api { code, message },
            None => DeployError::Malformed("success:false 但沒有 errors".into()),
        });
    }
    v.get("result").cloned().ok_or_else(|| DeployError::Malformed("回應沒有 result".into()))
}

// ── 部署流程 ──────────────────────────────────────────────────────────────────

/// 列出這把憑證看得到的帳號。空的就是 `NoAccount`——那通常代表 token 權限沒勾到帳號讀取。
pub async fn list_accounts<A: CfApi>(api: &A, auth: &CfAuth) -> Result<Vec<Account>, DeployError> {
    let result = result_of(api.get("/accounts", auth).await?)?;
    let arr = result.as_array().ok_or_else(|| DeployError::Malformed("accounts 不是陣列".into()))?;
    let accounts: Vec<Account> = arr
        .iter()
        .filter_map(|a| {
            Some(Account {
                id: a.get("id")?.as_str()?.to_string(),
                name: a.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
            })
        })
        .collect();
    if accounts.is_empty() {
        return Err(DeployError::NoAccount);
    }
    Ok(accounts)
}

/// 讀帳號的 workers.dev 子網域；還沒命名回 `Ok(None)`。
///
/// **還沒命名不是錯誤**——首次使用 Workers 的帳號都是這樣，流程要能引導他取一個，
/// 而不是丟一個 404 給他看。
pub async fn get_subdomain<A: CfApi>(
    api: &A,
    auth: &CfAuth,
    account_id: &str,
) -> Result<Option<String>, DeployError> {
    let resp = api.get(&format!("/accounts/{account_id}/workers/subdomain"), auth).await?;
    if resp.status == 404 {
        return Ok(None);
    }
    let result = result_of(resp)?;
    match result.get("subdomain").and_then(|s| s.as_str()) {
        Some(s) if !s.is_empty() => Ok(Some(s.to_string())),
        // 端點回 200 但沒有名字＝一樣是還沒命名。
        _ => Ok(None),
    }
}

/// 替帳號命名 workers.dev 子網域（首次使用 Workers 才需要）。
pub async fn set_subdomain<A: CfApi>(
    api: &A,
    auth: &CfAuth,
    account_id: &str,
    subdomain: &str,
) -> Result<(), DeployError> {
    let body = serde_json::json!({ "subdomain": subdomain }).to_string();
    result_of(api.put_json(&format!("/accounts/{account_id}/workers/subdomain"), auth, body).await?)?;
    Ok(())
}

/// 上傳（或就地更新）worker 腳本。
pub async fn upload_script<A: CfApi>(
    api: &A,
    auth: &CfAuth,
    account_id: &str,
    spec: &WorkerSpec,
    module: Vec<u8>,
    assets_jwt: Option<&str>,
) -> Result<(), DeployError> {
    // 🔴 有資產憑證卻沒有資產設定＝呼叫端用了 `relay_spec()` 而非 `unified_spec()`。
    // 送出去的話會部署出一座「資產在、Worker 不執行」的站——寧可在這裡失敗。
    if assets_jwt.is_some() && spec.assets.is_none() {
        return Err(DeployError::Malformed("統一模式缺少資產設定（run_worker_first）".into()));
    }
    let path = format!("/accounts/{account_id}/workers/scripts/{}", spec.name);
    result_of(api.put_script(&path, auth, metadata_json(spec, assets_jwt), module).await?)?;
    Ok(())
}

/// 讓這座 worker 在 workers.dev 上可達。
///
/// **上傳完不等於連得到**：腳本存在但路由沒開，那個網址會是 404。少了這一步，
/// 使用者會拿到一個看起來部署成功、實際上打不開的節點。
pub async fn enable_route<A: CfApi>(
    api: &A,
    auth: &CfAuth,
    account_id: &str,
    script: &str,
) -> Result<(), DeployError> {
    let body = serde_json::json!({ "enabled": true }).to_string();
    let path = format!("/accounts/{account_id}/workers/scripts/{script}/subdomain");
    result_of(api.post_json(&path, auth, body).await?)?;
    Ok(())
}

/// 拆除一座部署到一半／不要了的 relay（ADR-0356 §4）。
///
/// 🔴 為什麼需要它：半成品的壞處不是佔空間，是**使用者下次重試時搞不清楚眼前這座是好是壞**。
/// 腳本名固定（冪等）已經避免了「一堆孤兒」，但「部署失敗後帳號上留著一座跑不起來的
/// `cinder-relay`」仍然會讓人以為自己有一座能用的節點。
///
/// 已經不存在（404）不算失敗——拆除要能重複呼叫。
pub async fn teardown<A: CfApi>(
    api: &A,
    auth: &CfAuth,
    account_id: &str,
    script: &str,
) -> Result<(), DeployError> {
    let resp = api.delete(&format!("/accounts/{account_id}/workers/scripts/{script}"), auth).await?;
    if resp.status == 404 {
        return Ok(());
    }
    result_of(resp)?;
    Ok(())
}

/// 部署的最終產物。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Deployed {
    /// `wss://cinder-relay.<子網域>.workers.dev`。
    pub relay_url: String,
    pub account_id: String,
    pub subdomain: String,
}

/// 整套部署：確認子網域 → 上傳 → 開路由。
///
/// `subdomain_if_unset` 是「帳號還沒命名子網域時要用的名字」。傳 `None` 而帳號又沒命名時
/// 回 [`DeployError::NoSubdomain`]，讓 UI 先去問使用者要取什麼名字——**不自己編一個**，
/// 那個名字會永久出現在他的每一個 Worker 網址上。
///
/// ⚠ 這裡**不驗證 relay 活著**。驗證要真的開 WebSocket 並收 NIP-42 的 AUTH 挑戰，
/// 那是前端的事（它本來就有 relay 客戶端）。ADR-0356 §4：部署 API 回 200 不等於 relay 活著。
pub async fn deploy<A: CfApi>(
    api: &A,
    auth: &CfAuth,
    account_id: &str,
    spec: &WorkerSpec,
    module: Vec<u8>,
    subdomain_if_unset: Option<&str>,
) -> Result<Deployed, DeployError> {
    deploy_with_assets(api, auth, account_id, spec, module, subdomain_if_unset, None).await
}

/// 同 [`deploy`]，但可帶統一模式（ADR-0354）的資產完成憑證。
pub async fn deploy_with_assets<A: CfApi>(
    api: &A,
    auth: &CfAuth,
    account_id: &str,
    spec: &WorkerSpec,
    module: Vec<u8>,
    subdomain_if_unset: Option<&str>,
    assets_jwt: Option<&str>,
) -> Result<Deployed, DeployError> {
    let subdomain = match get_subdomain(api, auth, account_id).await? {
        Some(s) => s,
        None => {
            let want = subdomain_if_unset.ok_or(DeployError::NoSubdomain)?;
            set_subdomain(api, auth, account_id, want).await?;
            want.to_string()
        }
    };
    upload_script(api, auth, account_id, spec, module, assets_jwt).await?;
    enable_route(api, auth, account_id, &spec.name).await?;
    Ok(Deployed {
        relay_url: relay_url(&subdomain),
        account_id: account_id.to_string(),
        subdomain,
    })
}

#[cfg(feature = "encstore")]
mod assets_impl {
    use super::*;

    // ── 統一模式的資產上傳（ADR-0354 ＋ 0356 §5）──────────────────────────────────
    //
    // 統一模式讓同一座 Worker 既是 relay 也是網頁版。那些網頁資產走**三步上傳**：
    //   1. 送一份 manifest（路徑 → 雜湊＋大小），拿到 `jwt` 與要補傳的 `buckets`；
    //   2. 逐桶上傳；
    //   3. 把最後拿到的**完成憑證**放進腳本上傳的 metadata。
    //
    // ⚠ 只在 `encstore` feature 下編譯（它帶來 base64 與 sha2）。`default = ["passlock"]`
    // 已含 encstore，所以 CI 的 `cargo test` 照樣測得到這一段。

    /// 一個要上傳的資產。
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct Asset {
        /// 相對於資產根目錄的路徑，manifest 裡會補上前導斜線。
        pub path: String,
        pub bytes: Vec<u8>,
    }

    /// manifest 用的檔案雜湊。
    ///
    /// 🔴 **這個公式不能用猜的**：不是「檔案內容的 SHA-256」，而是
    /// `sha256(base64(內容) ++ 副檔名)` 的十六進位前 32 個字元，而且副檔名**不含點**。
    /// 猜錯的下場是上傳階段永遠對不上——Cloudflare 會一直說還有檔案沒傳。
    /// （來源：Workers Static Assets 直接上傳的官方範例，2026-09-17 查證。）
    pub fn asset_hash(bytes: &[u8], extension: &str) -> String {
        use base64::Engine as _;
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(base64::engine::general_purpose::STANDARD.encode(bytes).as_bytes());
        hasher.update(extension.as_bytes());
        let digest = hasher.finalize();
        digest.iter().map(|b| format!("{b:02x}")).collect::<String>()[..32].to_string()
    }

    /// 取副檔名（不含點）；沒有副檔名回空字串。
    pub fn extension_of(path: &str) -> String {
        let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
        match name.rfind('.') {
            Some(i) if i + 1 < name.len() => name[i + 1..].to_string(),
            _ => String::new(),
        }
    }

    /// manifest 的鍵：一律前導斜線、一律正斜線。
    pub fn manifest_key(path: &str) -> String {
        format!("/{}", path.replace('\\', "/").trim_start_matches('/'))
    }

    /// 組出 `assets-upload-session` 要的 manifest JSON。
    pub fn manifest_json(assets: &[Asset]) -> String {
        let mut map = serde_json::Map::new();
        for a in assets {
            map.insert(
                manifest_key(&a.path),
                serde_json::json!({
                    "hash": asset_hash(&a.bytes, &extension_of(&a.path)),
                    "size": a.bytes.len(),
                }),
            );
        }
        serde_json::Value::Object(map).to_string()
    }

    /// 上傳資產，回傳腳本上傳要用的**完成憑證**。
    ///
    /// **`buckets` 為空是正常且常見的**：代表這批檔案 Cloudflare 都已經有了（重複部署時幾乎
    /// 總是如此），這時第一步拿到的 `jwt` 直接就是完成憑證，一個位元組都不必再傳。
    pub async fn upload_assets<A: CfApi>(
        api: &A,
        auth: &CfAuth,
        account_id: &str,
        script: &str,
        assets: &[Asset],
    ) -> Result<String, DeployError> {
        let path = format!("/accounts/{account_id}/workers/scripts/{script}/assets-upload-session");
        let session = result_of(api.post_json(&path, auth, manifest_json(assets)).await?)?;
        let mut jwt = session
            .get("jwt")
            .and_then(|j| j.as_str())
            .ok_or_else(|| DeployError::Malformed("上傳工作階段沒有 jwt".into()))?
            .to_string();
        let buckets = session.get("buckets").and_then(|b| b.as_array()).cloned().unwrap_or_default();

        // 依雜湊查得到位元組——manifest 送的是雜湊，補傳時 Cloudflare 也只說雜湊。
        let by_hash: std::collections::HashMap<String, &Asset> = assets
            .iter()
            .map(|a| (asset_hash(&a.bytes, &extension_of(&a.path)), a))
            .collect();

        let upload_path = format!("/accounts/{account_id}/workers/assets/upload?base64=true");
        for bucket in buckets {
            let hashes: Vec<String> = bucket
                .as_array()
                .map(|entries| {
                    entries
                        .iter()
                        .filter_map(|e| {
                            e.as_str()
                                .map(str::to_string)
                                .or_else(|| e.get("hash").and_then(|h| h.as_str()).map(str::to_string))
                        })
                        .collect()
                })
                .unwrap_or_default();
            // 🔴 畸形形狀不靜默跳過：Cloudflare 說「這幾個要補傳」而我們一個都沒傳，
            // 結果是部署成功但網站缺檔。與本模組「不要默默造成缺檔」的原則一致。
            if hashes.is_empty() {
                if bucket.as_array().map(|b| b.is_empty()) == Some(true) {
                    continue; // 真的是空桶，合法
                }
                return Err(DeployError::Malformed("資產分桶的形狀無法解析".into()));
            }
            let mut files = Vec::with_capacity(hashes.len());
            for h in hashes {
                let asset = by_hash
                    .get(&h)
                    .ok_or_else(|| DeployError::Malformed(format!("要補傳的雜湊不在這批資產裡：{h}")))?;
                files.push((h, encode_base64(&asset.bytes)));
            }
            // 這一步的授權是**工作階段的 jwt**，不是帳號 token。
            let resp = api.post_assets(&upload_path, &jwt, files).await?;
            let result = result_of(resp)?;
            // 最後一桶傳完才會給完成憑證；中間的桶沒有，保留現有的繼續用。
            if let Some(next) = result.get("jwt").and_then(|j| j.as_str()) {
                jwt = next.to_string();
            }
        }
        Ok(jwt)
    }

    fn encode_base64(bytes: &[u8]) -> String {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

}
#[cfg(feature = "encstore")]
pub use assets_impl::*;

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// 記憶體假件：照順序吐出預先排好的回應，並記下收到的請求。
    struct FakeApi {
        replies: RefCell<Vec<CfResponse>>,
        seen: RefCell<Vec<(String, String, String)>>, // (method, path, body)
        module: RefCell<Vec<u8>>,                     // 最後一次腳本上傳帶的位元組
    }

    impl FakeApi {
        fn new(replies: Vec<(u16, &str)>) -> Self {
            FakeApi {
                replies: RefCell::new(
                    replies
                        .into_iter()
                        .rev()
                        .map(|(status, body)| CfResponse { status, body: body.to_string() })
                        .collect(),
                ),
                seen: RefCell::new(Vec::new()),
                module: RefCell::new(Vec::new()),
            }
        }
        fn next(&self, method: &str, path: &str, body: String) -> Result<CfResponse, DeployError> {
            self.seen.borrow_mut().push((method.to_string(), path.to_string(), body));
            self.replies.borrow_mut().pop().ok_or_else(|| DeployError::Network("沒有預備回應".into()))
        }
        fn paths(&self) -> Vec<String> {
            self.seen.borrow().iter().map(|(m, p, _)| format!("{m} {p}")).collect()
        }
    }

    impl CfApi for FakeApi {
        async fn get(&self, path: &str, _auth: &CfAuth) -> Result<CfResponse, DeployError> {
            self.next("GET", path, String::new())
        }
        async fn put_json(&self, path: &str, _auth: &CfAuth, body: String) -> Result<CfResponse, DeployError> {
            self.next("PUT", path, body)
        }
        async fn post_json(&self, path: &str, _auth: &CfAuth, body: String) -> Result<CfResponse, DeployError> {
            self.next("POST", path, body)
        }
        async fn delete(&self, path: &str, _auth: &CfAuth) -> Result<CfResponse, DeployError> {
            self.next("DELETE", path, String::new())
        }
        async fn post_assets(
            &self,
            path: &str,
            jwt: &str,
            files: Vec<(String, String)>,
        ) -> Result<CfResponse, DeployError> {
            // 記下帶的是哪把 jwt 與哪些雜湊——授權用錯（拿帳號 token）是這一步最容易犯的錯。
            let hashes: Vec<String> = files.into_iter().map(|(h, _)| h).collect();
            self.next("POST-ASSETS", path, format!("{jwt}|{}", hashes.join(",")))
        }
        async fn put_script(
            &self,
            path: &str,
            _auth: &CfAuth,
            metadata: String,
            module: Vec<u8>,
        ) -> Result<CfResponse, DeployError> {
            // 🔴 記下模組位元組。先前這裡是 `_module`（直接丟掉），於是「bundle 讀成空的、
            // 送出 0 位元組」這種 bug 可以通過全部測試，而使用者會部署出一座空的 Worker。
            *self.module.borrow_mut() = module;
            self.next("PUT-SCRIPT", path, metadata)
        }
    }

    /// 這個模組沒有 async runtime 相依——用最小的手動輪詢跑完 future。
    /// 部署流程裡沒有任何真正的 pending（假件都是立刻回），所以第一次 poll 就會完成。
    fn block_on<F: std::future::Future>(mut fut: F) -> F::Output {
        use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};
        fn noop(_: *const ()) {}
        fn clone(p: *const ()) -> RawWaker {
            RawWaker::new(p, &VTABLE)
        }
        static VTABLE: RawWakerVTable = RawWakerVTable::new(clone, noop, noop, noop);
        let waker = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &VTABLE)) };
        let mut cx = Context::from_waker(&waker);
        // SAFETY: `fut` 在這個函式內不會被移動（之後只透過 pin 存取）。
        let mut fut = unsafe { std::pin::Pin::new_unchecked(&mut fut) };
        loop {
            if let Poll::Ready(v) = fut.as_mut().poll(&mut cx) {
                return v;
            }
        }
    }

    const OK_ACCOUNTS: &str = r#"{"success":true,"errors":[],"result":[{"id":"acc1","name":"我的帳號"}]}"#;
    const OK_SUBDOMAIN: &str = r#"{"success":true,"errors":[],"result":{"subdomain":"alice"}}"#;
    const OK_EMPTY: &str = r#"{"success":true,"errors":[],"result":{}}"#;
    const TOKEN: fn() -> CfAuth = || CfAuth::Token("t".into());

    // ── metadata ──────────────────────────────────────────────────────────────

    #[test]
    fn metadata_declares_sqlite_backed_durable_object() {
        let meta: serde_json::Value = serde_json::from_str(&metadata_json(&relay_spec(), None)).unwrap();
        assert_eq!(meta["main_module"], MODULE_PART);
        assert_eq!(meta["bindings"][0]["type"], "durable_object_namespace");
        assert_eq!(meta["bindings"][0]["name"], "RELAY_ROOM");
        assert_eq!(meta["bindings"][0]["class_name"], "RelayRoom");
        // 🔴 `new_sqlite_classes` 而不是 `new_classes`——後者是 legacy-kv 後端，
        // 寫錯會部署成功但儲存後端是錯的。
        assert_eq!(meta["migrations"][0]["new_sqlite_classes"][0], "RelayRoom");
        assert!(meta["migrations"][0].get("new_classes").is_none());
    }

    #[test]
    fn metadata_omits_official_turn_settings() {
        let meta: serde_json::Value = serde_json::from_str(&metadata_json(&relay_spec(), None)).unwrap();
        // 官方站的 TURN Key ID 不該跟著使用者的節點跑；未設＝`/turn` 回 204（ADR-0243 降級）。
        let text = meta.to_string();
        assert!(!text.contains("TURN_KEY_ID"), "不得帶官方 TURN 設定：{text}");
        assert!(!text.contains("TURN_LIMIT"));
    }

    #[test]
    fn metadata_carries_assets_jwt_only_in_unified_mode() {
        let plain: serde_json::Value = serde_json::from_str(&metadata_json(&relay_spec(), None)).unwrap();
        assert!(plain.get("assets").is_none());
        let unified: serde_json::Value =
            serde_json::from_str(&metadata_json(&unified_spec(), Some("jwt123"))).unwrap();
        assert_eq!(unified["assets"]["jwt"], "jwt123");
    }

    #[test]
    fn relay_url_is_built_from_the_subdomain() {
        assert_eq!(relay_url("alice"), "wss://cinder-relay.alice.workers.dev");
    }

    #[test]
    fn token_template_url_prefills_minimal_permissions() {
        let url = token_template_url();
        assert!(url.starts_with("https://dash.cloudflare.com/profile/api-tokens?"));
        assert!(url.contains("permissionGroupKeys="));
        // 百分比編碼過，所以比對編碼後的片段。
        assert!(url.contains("workers_scripts"), "{url}");
        assert!(url.contains("Cinderous"), "{url}");
    }
    // ── 防漂移：手寫的規格必須等於 wrangler.toml ───────────────────────────────

    /// 極小的 TOML 讀取器，**只認**這份規格用得到的那幾個鍵。
    ///
    /// 它存在的唯一目的是**證明 `relay_spec()` 沒有跟 `wrangler.toml` 漂移**，不在產線跑，
    /// 所以不需要完整的 TOML 語意。遇到 `[env.*]` 就停——那是統一模式（ADR-0354）的覆寫，
    /// 不是頂層設定。
    fn parse_wrangler(toml: &str) -> WorkerSpec {
        let unquote = |v: &str| v.trim().trim_matches('"').to_string();
        let mut spec = WorkerSpec {
            name: String::new(),
            compatibility_date: String::new(),
            durable_objects: Vec::new(),
            migration_tag: String::new(),
            sqlite_classes: Vec::new(),
            assets: None,
        };
        let mut section = String::new();
        let mut pending_do: (String, String) = (String::new(), String::new());
        for raw in toml.lines() {
            let line = raw.split('#').next().unwrap_or("").trim();
            if line.is_empty() {
                continue;
            }
            if line.starts_with('[') {
                let s = line.trim_matches(['[', ']'].as_slice()).to_string();
                if section == "durable_objects.bindings" && !pending_do.0.is_empty() {
                    spec.durable_objects.push(std::mem::take(&mut pending_do));
                }
                section = s;
                continue;
            }
            let Some((k, v)) = line.split_once('=') else { continue };
            let (k, v) = (k.trim(), v.trim());
            match (section.as_str(), k) {
                // 🔴 `[env.unified.assets]` 必須讀進來。先前這個解析器在第一個 `[env.*]`
                // 就 break，於是「防漂移測試」結構上抓不到統一模式那一半——而那一半裝著
                // `run_worker_first`，也就是 ADR-0354 稱為硬性前提的那一個設定。
                // 一個被寫成完整、實際只涵蓋一半的守衛，比沒有守衛更糟。
                ("env.unified.assets", "run_worker_first") => {
                    spec.assets.get_or_insert(AssetsConfig {
                        run_worker_first: false,
                        not_found_handling: String::new(),
                    })
                    .run_worker_first = v.trim() == "true";
                }
                ("env.unified.assets", "not_found_handling") => {
                    spec.assets.get_or_insert(AssetsConfig {
                        run_worker_first: false,
                        not_found_handling: String::new(),
                    })
                    .not_found_handling = unquote(v);
                }
                // 具名環境的其餘覆寫不算頂層設定。
                (sec, _) if sec.starts_with("env.") => {}
                ("", "name") => spec.name = unquote(v),
                ("", "compatibility_date") => spec.compatibility_date = unquote(v),
                ("durable_objects.bindings", "name") => pending_do.0 = unquote(v),
                ("durable_objects.bindings", "class_name") => pending_do.1 = unquote(v),
                ("migrations", "tag") => spec.migration_tag = unquote(v),
                ("migrations", "new_sqlite_classes") => {
                    spec.sqlite_classes = v
                        .trim_matches(['[', ']'].as_slice())
                        .split(',')
                        .map(unquote)
                        .filter(|s| !s.is_empty())
                        .collect();
                }
                _ => {}
            }
        }
        if !pending_do.0.is_empty() {
            spec.durable_objects.push(pending_do);
        }
        spec
    }

    #[test]
    fn spec_matches_wrangler_toml() {
        // 🔴 這一條是那兩份手寫常數為什麼可以存在的全部理由。改了 wrangler.toml 卻沒改
        // 常數，這裡就紅——而那種漂移的症狀是「部署成功但行為不對」，比失敗難查得多。
        //
        // ⚠ 比對的是 `unified_spec()` 而不是 `relay_spec()`：解析器讀完整份檔案，包含
        // `[env.unified.assets]`。先前它在第一個 `[env.*]` 就停，於是這個守衛**結構上**
        // 看不到統一模式那一半——而 `run_worker_first` 正好住在那裡，也就真的漏掉了。
        let toml = include_str!("../../../../relay/wrangler.toml");
        assert_eq!(parse_wrangler(toml), unified_spec());
        // 純 relay 就是同一份規格拿掉資產設定。
        assert_eq!(WorkerSpec { assets: None, ..unified_spec() }, relay_spec());
    }

    #[test]
    fn wrangler_toml_still_sets_run_worker_first() {
        // 單獨釘住它，因為它不是「一個設定」——它是統一模式能不能成立的前提。
        // 少了它，`/` 會回 index.html、Worker 根本不執行，中繼站靜默死掉（回 200，不是錯誤）。
        let parsed = parse_wrangler(include_str!("../../../../relay/wrangler.toml"));
        let a = parsed.assets.expect("wrangler.toml 應有 [env.unified.assets]");
        assert!(a.run_worker_first, "run_worker_first 必須為 true");
        assert_eq!(a.not_found_handling, "single-page-application");
    }

    #[test]
    fn unified_metadata_carries_run_worker_first_not_just_the_jwt() {
        // 🔴 這一條是 2026-09-17 審查抓到的那個 bug 的迴歸測試：先前只送 `jwt`，
        // 資產會上去、Worker 也會部署，但路由用 Cloudflare 的預設（資產優先）⇒ relay 死。
        let meta: serde_json::Value =
            serde_json::from_str(&metadata_json(&unified_spec(), Some("jwt123"))).unwrap();
        assert_eq!(meta["assets"]["jwt"], "jwt123");
        assert_eq!(meta["assets"]["config"]["run_worker_first"], true);
        assert_eq!(meta["assets"]["config"]["not_found_handling"], "single-page-application");
    }

    #[test]
    fn parser_ignores_the_unified_env_override() {
        // `[env.unified]` 也有 `name`，但它不是頂層設定；讀進來會讓比對看似通過卻是巧合。
        let toml = "name = \"a\"\n[env.unified]\nname = \"b\"\n";
        assert_eq!(parse_wrangler(toml).name, "a");
    }

    // ── 流程 ──────────────────────────────────────────────────────────────────

    #[test]
    fn deploy_happy_path_uploads_then_opens_the_route() {
        let api = FakeApi::new(vec![(200, OK_SUBDOMAIN), (200, OK_EMPTY), (200, OK_EMPTY)]);
        let got = block_on(deploy(&api, &TOKEN(), "acc1", &relay_spec(), b"code".to_vec(), None)).unwrap();
        assert_eq!(got.relay_url, "wss://cinder-relay.alice.workers.dev");
        assert_eq!(
            api.paths(),
            vec![
                "GET /accounts/acc1/workers/subdomain",
                "PUT-SCRIPT /accounts/acc1/workers/scripts/cinder-relay",
                "POST /accounts/acc1/workers/scripts/cinder-relay/subdomain",
            ]
        );
    }

    #[test]
    fn deploy_names_the_subdomain_first_when_the_account_has_none() {
        // 404＝還沒命名。這**不是錯誤**——首次用 Workers 的帳號都是這樣。
        let api = FakeApi::new(vec![(404, ""), (200, OK_EMPTY), (200, OK_EMPTY), (200, OK_EMPTY)]);
        let got =
            block_on(deploy(&api, &TOKEN(), "acc1", &relay_spec(), b"c".to_vec(), Some("bob"))).unwrap();
        assert_eq!(got.subdomain, "bob");
        assert_eq!(api.paths()[1], "PUT /accounts/acc1/workers/subdomain");
        assert!(api.seen.borrow()[1].2.contains("bob"));
    }

    #[test]
    fn deploy_refuses_to_invent_a_subdomain_and_uploads_nothing() {
        // 🔴 那個名字會永久出現在他每一個 Worker 的網址上——不能替他決定。
        let api = FakeApi::new(vec![(404, "")]);
        let err = block_on(deploy(&api, &TOKEN(), "acc1", &relay_spec(), b"c".to_vec(), None)).unwrap_err();
        assert_eq!(err, DeployError::NoSubdomain);
        // 失敗要乾淨：不能已經傳了腳本才說不行。
        assert_eq!(api.paths(), vec!["GET /accounts/acc1/workers/subdomain"]);
    }

    #[test]
    fn route_failure_is_reported_instead_of_a_false_success() {
        // 腳本上傳成功但路由沒開＝那個網址是 404。回報成功等於把一座打不開的節點交給使用者。
        let api = FakeApi::new(vec![
            (200, OK_SUBDOMAIN),
            (200, OK_EMPTY),
            (500, r#"{"success":false,"errors":[{"code":10001,"message":"boom"}]}"#),
        ]);
        let err = block_on(deploy(&api, &TOKEN(), "acc1", &relay_spec(), b"c".to_vec(), None)).unwrap_err();
        assert_eq!(err, DeployError::Api { code: 10001, message: "boom".into() });
    }

    #[test]
    fn http_200_with_success_false_is_still_a_failure() {
        // 🔴 Cloudflare 會在 HTTP 200 裡放 `success: false`。只看狀態碼就會把失敗當成功，
        // 然後拿著一座不存在的節點去切 home。
        let api = FakeApi::new(vec![(200, r#"{"success":false,"errors":[{"code":10015,"message":"nope"}]}"#)]);
        let err = block_on(list_accounts(&api, &TOKEN())).unwrap_err();
        assert_eq!(err, DeployError::Api { code: 10015, message: "nope".into() });
    }

    #[test]
    fn status_codes_map_to_actionable_errors() {
        for (status, want) in [
            (401, DeployError::Unauthorized),
            (403, DeployError::Forbidden),
            (429, DeployError::RateLimited),
        ] {
            let api = FakeApi::new(vec![(status, "")]);
            assert_eq!(block_on(list_accounts(&api, &TOKEN())).unwrap_err(), want, "HTTP {status}");
        }
    }

    #[test]
    fn every_error_has_its_own_message_key() {
        // 分型的意義是 UI 說得出「你該做什麼」。兩個不同的錯誤共用一個鍵＝白分型。
        let all = [
            DeployError::Unauthorized,
            DeployError::Forbidden,
            DeployError::NoAccount,
            DeployError::NoSubdomain,
            DeployError::RateLimited,
            DeployError::Api { code: 1, message: String::new() },
            DeployError::Network(String::new()),
            DeployError::Malformed(String::new()),
        ];
        let keys: std::collections::BTreeSet<&str> = all.iter().map(|e| e.message_key()).collect();
        assert_eq!(keys.len(), all.len());
    }

    #[test]
    fn list_accounts_parses_and_flags_an_empty_list() {
        let api = FakeApi::new(vec![(200, OK_ACCOUNTS)]);
        let got = block_on(list_accounts(&api, &TOKEN())).unwrap();
        assert_eq!(got, vec![Account { id: "acc1".into(), name: "我的帳號".into() }]);

        let empty = FakeApi::new(vec![(200, r#"{"success":true,"errors":[],"result":[]}"#)]);
        assert_eq!(block_on(list_accounts(&empty, &TOKEN())).unwrap_err(), DeployError::NoAccount);
    }

    #[test]
    fn subdomain_endpoint_returning_an_empty_name_counts_as_unnamed() {
        let api = FakeApi::new(vec![(200, r#"{"success":true,"errors":[],"result":{"subdomain":""}}"#)]);
        assert_eq!(block_on(get_subdomain(&api, &TOKEN(), "acc1")).unwrap(), None);
    }

    #[test]
    fn oauth_and_token_produce_the_same_bearer_shape() {
        // §1b：兩種授權在傳輸層沒有差別，OAuth 過審時不必動流程。
        assert_eq!(CfAuth::Token("x".into()).bearer(), "x");
        assert_eq!(CfAuth::OAuth("x".into()).bearer(), "x");
    }

    // ── 統一模式的資產上傳（ADR-0354 ＋ 0356 §5）──────────────────────────────

    fn asset(path: &str, body: &[u8]) -> Asset {
        Asset { path: path.to_string(), bytes: body.to_vec() }
    }

    #[test]
    fn extension_is_taken_without_the_dot() {
        assert_eq!(extension_of("a/b/index.html"), "html");
        assert_eq!(extension_of("assets/app.12ab.js"), "js");
        assert_eq!(extension_of("LICENSE"), "");
        assert_eq!(extension_of("weird."), ""); // 結尾是點＝沒有副檔名
        assert_eq!(extension_of("dir.with.dots/file"), "");
    }

    #[test]
    fn manifest_keys_are_slash_prefixed_and_forward_slashed() {
        assert_eq!(manifest_key("index.html"), "/index.html");
        assert_eq!(manifest_key("/index.html"), "/index.html"); // 不重複加
        assert_eq!(manifest_key("assets\\app.js"), "/assets/app.js");
    }

    #[test]
    fn asset_hash_is_32_hex_chars_and_depends_on_content_and_extension() {
        let h = asset_hash(b"hello", "html");
        assert_eq!(h.len(), 32);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()), "{h}");
        // 🔴 副檔名參與雜湊——這不是直覺，但官方範例就是這樣算的。把它拿掉會讓
        // 上傳階段永遠對不上，而症狀是「Cloudflare 一直說還有檔案沒傳」。
        assert_ne!(asset_hash(b"hello", "html"), asset_hash(b"hello", "js"));
        assert_ne!(asset_hash(b"hello", "html"), asset_hash(b"world", "html"));
        assert_eq!(asset_hash(b"hello", "html"), asset_hash(b"hello", "html"));
    }

    #[test]
    fn manifest_json_lists_every_asset_with_hash_and_size() {
        let assets = [asset("index.html", b"<html>"), asset("app.js", b"console.log(1)")];
        let m: serde_json::Value = serde_json::from_str(&manifest_json(&assets)).unwrap();
        assert_eq!(m["/index.html"]["size"], 6);
        assert_eq!(m["/app.js"]["size"], 14);
        assert_eq!(m["/index.html"]["hash"], asset_hash(b"<html>", "html"));
    }

    #[test]
    fn empty_buckets_means_everything_was_cached_and_nothing_is_uploaded() {
        // 重複部署時幾乎總是這個情形——第一步拿到的 jwt 直接就是完成憑證。
        let api = FakeApi::new(vec![(
            200,
            r#"{"success":true,"errors":[],"result":{"jwt":"done-token","buckets":[]}}"#,
        )]);
        let got = block_on(upload_assets(&api, &TOKEN(), "acc1", "w", &[asset("a.html", b"x")])).unwrap();
        assert_eq!(got, "done-token");
        assert_eq!(api.paths(), vec!["POST /accounts/acc1/workers/scripts/w/assets-upload-session"]);
    }

    #[test]
    fn buckets_are_uploaded_with_the_session_jwt_and_the_final_token_is_returned() {
        let a = asset("a.html", b"x");
        let h = asset_hash(b"x", "html");
        let session = format!(
            r#"{{"success":true,"errors":[],"result":{{"jwt":"sess","buckets":[["{h}"]]}}}}"#
        );
        let api = FakeApi::new(vec![
            (200, session.as_str()),
            (201, r#"{"success":true,"errors":[],"result":{"jwt":"final"}}"#),
        ]);
        let got = block_on(upload_assets(&api, &TOKEN(), "acc1", "w", &[a])).unwrap();
        assert_eq!(got, "final");
        let seen = api.seen.borrow();
        assert_eq!(seen[1].0, "POST-ASSETS");
        assert!(seen[1].1.contains("base64=true"));
        // 🔴 授權帶的是工作階段的 jwt，不是帳號 token。
        assert!(seen[1].2.starts_with("sess|"), "{}", seen[1].2);
        assert!(seen[1].2.contains(&h));
    }

    #[test]
    fn a_hash_we_do_not_have_is_an_error_rather_than_a_silent_gap() {
        // Cloudflare 要一個不在這批資產裡的雜湊＝我們算錯了或送錯了。默默跳過的話，
        // 部署會「成功」但網站缺檔。
        let api = FakeApi::new(vec![(
            200,
            r#"{"success":true,"errors":[],"result":{"jwt":"s","buckets":[["deadbeef"]]}}"#,
        )]);
        let err = block_on(upload_assets(&api, &TOKEN(), "acc1", "w", &[asset("a.html", b"x")]))
            .unwrap_err();
        assert!(matches!(err, DeployError::Malformed(_)), "{err:?}");
    }

    #[test]
    fn a_session_without_a_jwt_is_malformed() {
        let api = FakeApi::new(vec![(200, r#"{"success":true,"errors":[],"result":{"buckets":[]}}"#)]);
        assert!(matches!(
            block_on(upload_assets(&api, &TOKEN(), "acc1", "w", &[])).unwrap_err(),
            DeployError::Malformed(_)
        ));
    }

    #[test]
    fn buckets_may_be_objects_with_a_hash_field_too() {
        // 文件的回應形狀在不同版本出現過兩種寫法；兩種都吃得下，少一種就是整個統一模式壞掉。
        let h = asset_hash(b"x", "html");
        let session = format!(
            r#"{{"success":true,"errors":[],"result":{{"jwt":"sess","buckets":[[{{"hash":"{h}","size":1}}]]}}}}"#
        );
        let api = FakeApi::new(vec![
            (200, session.as_str()),
            (201, r#"{"success":true,"errors":[],"result":{"jwt":"final"}}"#),
        ]);
        assert_eq!(
            block_on(upload_assets(&api, &TOKEN(), "acc1", "w", &[asset("a.html", b"x")])).unwrap(),
            "final"
        );
    }

    #[test]
    fn the_worker_code_is_actually_uploaded() {
        // 🔴 先前假件直接丟掉模組參數，於是「送出 0 位元組」這種 bug 可以通過全部測試，
        // 而使用者會部署出一座空的 Worker——連線得上、但什麼都不做。
        let api = FakeApi::new(vec![(200, OK_SUBDOMAIN), (200, OK_EMPTY), (200, OK_EMPTY)]);
        let code = b"export default { fetch() {} }".to_vec();
        block_on(deploy(&api, &TOKEN(), "acc1", &relay_spec(), code.clone(), None)).unwrap();
        assert_eq!(*api.module.borrow(), code, "腳本位元組必須原樣送出");
        assert!(!api.module.borrow().is_empty());
    }

    #[test]
    fn uploading_assets_without_an_assets_config_is_refused() {
        // 🔴 用 `relay_spec()` 配上資產憑證＝會部署出「資產在、Worker 不執行」的站。
        // 寧可在這裡失敗，也不要送出去。
        let api = FakeApi::new(vec![(200, OK_EMPTY)]);
        let err = block_on(upload_script(
            &api,
            &TOKEN(),
            "acc1",
            &relay_spec(),
            b"code".to_vec(),
            Some("jwt"),
        ))
        .unwrap_err();
        assert!(matches!(err, DeployError::Malformed(_)), "{err:?}");
        assert_eq!(api.paths(), Vec::<String>::new(), "不得送出任何請求");
    }

    #[test]
    fn teardown_removes_the_script_and_tolerates_an_absent_one() {
        let api = FakeApi::new(vec![(200, OK_EMPTY)]);
        block_on(teardown(&api, &TOKEN(), "acc1", WORKER_NAME)).unwrap();
        assert_eq!(api.paths(), vec!["DELETE /accounts/acc1/workers/scripts/cinder-relay"]);

        // 已經不在＝拆除完成，不是失敗（拆除要能重複呼叫）。
        let gone = FakeApi::new(vec![(404, "")]);
        assert!(block_on(teardown(&gone, &TOKEN(), "acc1", WORKER_NAME)).is_ok());
    }

    #[test]
    fn teardown_reports_a_real_failure() {
        // 權限不足時要說出來——否則使用者以為拆乾淨了，帳號上其實還留著一座。
        let api = FakeApi::new(vec![(403, "")]);
        assert_eq!(
            block_on(teardown(&api, &TOKEN(), "acc1", WORKER_NAME)).unwrap_err(),
            DeployError::Forbidden
        );
    }

    #[test]
    fn a_malformed_bucket_is_an_error_rather_than_a_silent_skip() {
        // Cloudflare 說「這些要補傳」而我們一個都沒傳 ⇒ 部署成功但網站缺檔。
        let api = FakeApi::new(vec![(
            200,
            r#"{"success":true,"errors":[],"result":{"jwt":"s","buckets":[{"unexpected":"shape"}]}}"#,
        )]);
        let err = block_on(upload_assets(&api, &TOKEN(), "acc1", "w", &[asset("a.html", b"x")]))
            .unwrap_err();
        assert!(matches!(err, DeployError::Malformed(_)), "{err:?}");
    }

}
