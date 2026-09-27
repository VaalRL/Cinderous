/**
 * 第三方開發文件的網址（ADR-0368）：錨點拒絕連線時，`NOTICE` 與關閉原因都指向這裡。
 *
 * SDK 的預設值改為中立之後（SDK ADR 0019），這個網址是 Cinderous 自己的事實，放回 Cinderous：
 * 由 `wrangler.toml` 的 `DEVELOPER_DOCS_URL` 交給中繼（`wrangler-vars.test.ts` 比對兩邊一致）。
 *
 * 英文版是官網的預設語言、走根路徑（ADR-0246），第三方開發者也以英文讀者為主。
 * ⚠ 官網換網域時要一起改（`apps/website/src/routes.ts` 的清單有列）；
 * 與官網路由由 `apps/website/src/developers-url.test.ts` 比對，漂移就會變紅。
 */
export const DEVELOPER_DOCS_URL = "https://vaalrl.github.io/Cinderous/developers/";
