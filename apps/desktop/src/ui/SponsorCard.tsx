// 「贊助此節點」角落卡（ADR-0089 決策 2／ADR-0262）：讓使用者自願回饋**目前所連中繼站**的
// 營運者。純導流——App 不碰錢、不托管、不追蹤、無站內付款。
//
// ## 措辭與框架是這個元件的重點，不是版面
//
// 贊助連結是**營運者自報**的（NIP-11 文件由 relay 自己提供，而威脅模型把 relay 當對手）。
// 所以 UI 必須把三件事講清楚，否則它就變成一個由不可信來源控制的釣魚面：
//
// 1. **這是此節點「聲稱」的**——無官方背書、不是慈善聲明（ADR-0089「後果」的釣魚風險）；
// 2. **完全自願、可關閉**，關掉就記住（不再騷擾）；
// 3. **永不自動付款**——點了只是用系統瀏覽器/錢包開啟外部連結。
//
// scheme 白名單在 engine 的 `relay-info.ts` 就擋掉了（`https:` 與 `lightning:` 以外一律丟棄），
// 這裡只負責誠實呈現。

import type { DonationLink } from "@cinderous/engine";
import type { JSX } from "react";
import { useI18n } from "../i18n.js";

/** 各管道的顯示標籤（品牌名不翻譯，前置圖示提供辨識）。 */
const CHANNEL_LABEL: Record<DonationLink["channel"], string> = {
  github_sponsors: "♡ GitHub Sponsors",
  buy_me_a_coffee: "☕ Buy Me a Coffee",
  liberapay: "⇄ Liberapay",
  lightning: "⚡ Lightning",
};

export interface SponsorCardProps {
  /** 已通過 scheme 白名單的贊助項目（空陣列時呼叫端不該渲染本元件）。 */
  donations: DonationLink[];
  /** 營運者自報的站名；無則以 relay URL 標示是哪一座。 */
  relayName?: string | undefined;
  relayUrl: string;
  /** 關閉（呼叫端負責記住，不再顯示）。 */
  onDismiss: () => void;
}

export function SponsorCard({ donations, relayName, relayUrl, onDismiss }: SponsorCardProps): JSX.Element | null {
  const { t } = useI18n();
  if (donations.length === 0) return null;

  return (
    <aside className="sponsor" data-testid="sponsor-card" aria-label={t("sponsor_title")}>
      <div className="sponsor__head">
        <span className="sponsor__title">{t("sponsor_title")}</span>
        <button
          type="button"
          className="sponsor__x"
          data-testid="sponsor-dismiss"
          aria-label={t("sponsor_dismiss")}
          title={t("sponsor_dismiss")}
          onClick={onDismiss}
        >
          ×
        </button>
      </div>
      {/* 「此節點聲稱」——自報、無背書。節點名也是營運者自報的，故與 URL 並陳。 */}
      <p className="sponsor__who">{t("sponsor_who", { relay: relayName ?? relayUrl })}</p>
      <ul className="sponsor__links">
        {donations.map((d) => (
          <li key={d.channel}>
            <a
              className="sponsor__link"
              data-testid={`sponsor-link-${d.channel}`}
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {CHANNEL_LABEL[d.channel]}
            </a>
          </li>
        ))}
      </ul>
      <p className="sponsor__note">{t("sponsor_note")}</p>
    </aside>
  );
}
