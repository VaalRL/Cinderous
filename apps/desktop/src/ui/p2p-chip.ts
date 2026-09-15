// 桌面端的連線路徑晶片轉接（ADR-0213／0344）。
//
// 判定→呈現的規格住在 `@cinderous/theme`（`p2pPathChip`），與行動端共吃一份；這裡只把
// 語義角色（`tone`）翻成桌面的 CSS class 後綴，因為 CSS class 是桌面獨有的上色方式。

import { p2pPathChip, type P2pChipContext, type P2pPathTone } from "@cinderous/theme";
import type { MessageKey } from "@cinderous/i18n";
import type { IcePath } from "@cinderous/engine";

export type { P2pChipContext };

export interface P2pChipSpec {
  /** 附加在 `chip--p2p` 之後的 class（含前導空白；未連線為空字串）。 */
  mod: string;
  icon: string;
  label: MessageKey;
  hint: MessageKey;
}

/** 語義角色 → `msn.css` 的 class 後綴（`.chip--p2p.on` 等）。 */
const TONE_CLASS: Record<P2pPathTone, string> = {
  none: "",
  direct: " on",
  relay: " relay",
  unknown: " up",
};

/** 見 `@cinderous/theme` 的 `p2pPathChip`——尤其「未知不樂觀當成直連」那條。 */
export function p2pChipSpec(connected: boolean, path?: IcePath, context: P2pChipContext = "convo"): P2pChipSpec {
  const chip = p2pPathChip(connected, path, context);
  return { mod: TONE_CLASS[chip.tone], icon: chip.icon, label: chip.label, hint: chip.hint };
}
