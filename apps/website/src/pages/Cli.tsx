// CLI 使用說明與下載（ADR-0405）。
//
// ## 🔴 這一頁只教學、不動作（ADR-0090）
//
// 官網與 E2E 通訊平面完全分離：不收金鑰、不收 npub、沒有任何會回傳的表單。下載鈕是**純外連**到
// GitHub Release，官網不知道誰下載了什麼。
//
// 下載連結用 `releases/latest/download/<固定檔名>`：發版腳本（`scripts/cli-artifact.mjs`）
// 產出的檔名不帶版號，所以換版不用改網站。內容在 `cli-guide.ts`，區塊渲染沿用開發者文件的 `BlockView`。

import type { Locale } from "@cinderous/i18n";
import { cliGuideFor } from "../cli-guide.js";
import type { Route } from "../routes.js";
import { BlockView } from "./Developers.js";

/** 最新版 CLI 的單檔（`scripts/cli-artifact.mjs` 的 `ARTIFACT_NAME`；測試比對兩邊一致）。 */
// 不從 App.js 匯入 GITHUB_URL：App 匯入這一頁，反過來匯入會循環、常數在載入時是 undefined。測試比對兩邊一致。
export const CLI_DOWNLOAD_URL = "https://github.com/VaalRL/Cinderous/releases/latest/download/cinder.mjs";
/** 與它配對的 `sha256sum` 校驗檔。 */
export const CLI_CHECKSUM_URL = `${CLI_DOWNLOAD_URL}.sha256`;

export function Cli({ locale, onNavigate }: { locale: Locale; onNavigate?: (route: Route) => void }): JSX.Element {
  const g = cliGuideFor(locale);
  return (
    <section className="sec sec--plain" style={{ paddingTop: 56 }} data-testid="cli">
      <div className="wrap" style={{ maxWidth: 900 }}>
        <h2>{g.title}</h2>
        <p className="sec__lead">{g.lead}</p>

        <div className="cta" style={{ justifyContent: "flex-start", marginTop: 18 }}>
          <a className="btn btn--primary" href={CLI_DOWNLOAD_URL} rel="noreferrer">
            {g.downloadLabel}
          </a>
          <a className="btn" href={CLI_CHECKSUM_URL} rel="noreferrer">
            {g.checksumLabel}
          </a>
        </div>
        <p style={{ marginTop: 10 }}>{g.requirement}</p>

        <ul style={{ marginTop: 18 }}>
          {g.sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.title.replace(/`/g, "")}</a>
            </li>
          ))}
        </ul>

        {g.sections.map((s) => (
          <div key={s.id}>
            <h3 id={s.id} style={{ marginTop: 34 }}>
              {s.title.replace(/`/g, "")}
            </h3>
            {s.blocks.map((b, i) => (
              <BlockView key={i} block={b} locale={locale} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
