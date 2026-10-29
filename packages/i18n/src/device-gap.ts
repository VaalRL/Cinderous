// 裝置能力缺口的提示文案（ADR-0397）：桌面與行動端共用。
import { translate } from "./index.js";
import type { Locale } from "./messages.js";

/** 與 `@cinderous/engine` 的 `CapabilityGap` 同形（i18n 不依賴引擎，只取用得到的欄位）。 */
export interface CapabilityGapInfo {
  required: string[];
  devices: { pk?: string; id?: string; label?: string; ver?: string; reported: boolean; missing: string[] }[];
  selfMissing: string[];
}

/** 常駐提示的文字；沒有缺口回 `undefined`。本機跟不上優先——那是使用者正在看的這台。 */
export function capabilityGapText(locale: Locale | string, gap: CapabilityGapInfo): string | undefined {
  if (gap.selfMissing.length > 0) return translate(locale, "devcap_self");
  if (gap.devices.length === 0) return undefined;
  if (gap.devices.length > 1) return translate(locale, "devcap_many", { n: gap.devices.length });
  const d = gap.devices[0]!;
  const base = d.label ?? translate(locale, "devcap_unnamed", { id: (d.id ?? d.pk ?? "").slice(0, 8) });
  if (!d.reported) return translate(locale, "devcap_unreported", { name: base });
  const name = d.ver ? translate(locale, "devcap_nameVer", { name: base, ver: d.ver }) : base;
  return translate(locale, "devcap_missing", { name });
}
