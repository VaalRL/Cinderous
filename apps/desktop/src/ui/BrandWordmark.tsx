import { useI18n } from "../i18n.js";
import { SITE_BASE } from "../site.js";

/**
 * 品牌字樣「Cinderous」（ADR-0250）：點擊外連官網（`SITE_BASE`，新分頁）。全 app 共用（SSOT）——
 * 登入/解鎖畫面與各視窗標題的 app 名稱皆用它，`className` 讓各處貼合既有標題樣式。
 */
export function BrandWordmark({ className = "win__brand" }: { className?: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <a className={className} href={SITE_BASE} target="_blank" rel="noopener noreferrer" title={t("brand_visitSite")}>
      {t("appName")}
    </a>
  );
}
