// 官網來源的**單一真實來源**（ADR-0235 SEO-6）。
//
// `update-check.ts` 與 `threat-db.ts` 各自硬寫了一份 `https://vaalrl.github.io/Cinderous/…`。
// 那是兩個很容易漏改的點：綁自訂網域時只要漏掉其中一個，該功能就會永遠指向舊網址
// ——而且**已安裝的舊版 app 永遠改不了**（endpoint 是編譯進去的常數）。
//
// ⚠️ 換網域時要一起改的地方：
//   1. 本檔的 `SITE_BASE`
//   2. `apps/website/src/routes.ts` 的 `SITE_ORIGIN` / `BASE_PATH`
//   3. `apps/website/vite.config.ts` 的 `base`
//   4. GitHub Pages 的自訂網域設定（CNAME）
//
// 自架者要指向自己的 endpoint 時，改這一行即可（同 ADR-0228 決策 1）。

/** 官網部署根位址（含尾斜線）。 */
export const SITE_BASE = "https://vaalrl.github.io/Cinderous/";

/** 官網上的靜態資料檔絕對網址。 */
export function siteFile(name: string): string {
  return `${SITE_BASE}${name}`;
}
