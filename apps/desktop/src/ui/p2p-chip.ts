// 連線路徑晶片的呈現規格（ADR-0213 的兩態 → ADR-0344 的四態）。
//
// 抽成純函式是為了可測：「什麼連線狀態該顯示什麼」是產品判斷，不該埋在 JSX 裡才驗得到。
// 放在獨立檔案，是因為對話視窗與通話視窗都要用——通話視窗沒有理由去 import 一個三千行的
// 對話元件。

import type { MessageKey } from "@cinderous/i18n";
import type { IcePath } from "@cinderous/engine";

/** 晶片出現在哪裡。tooltip 依情境換句話：對話講檔案，通話講延遲。 */
export type P2pChipContext = "convo" | "call";

export interface P2pChipSpec {
  /** 附加在 `chip--p2p` 之後的 class（含前導空白；未連線為空字串）。 */
  mod: string;
  icon: string;
  label: MessageKey;
  hint: MessageKey;
}

const HINTS: Record<P2pChipContext, Record<"direct" | "relay" | "unknown", MessageKey>> = {
  convo: {
    direct: "convo_p2pDirectHint",
    relay: "convo_p2pRelayHint",
    unknown: "convo_p2pUnknownHint",
  },
  call: {
    direct: "call_pathDirectHint",
    relay: "call_pathRelayHint",
    unknown: "call_pathUnknownHint",
  },
};

/**
 * 依連線狀態與路徑決定晶片長什麼樣。
 *
 * ⚠ 已連線但 `path` 未知時**不會**沿用「⚡直連」——那是在沒測之前替使用者假設最好的情況。
 * 寧可先顯示中性的「🔗已連線」，等探測回來再轉正（ADR-0344 §後果：短暫轉場是刻意的）。
 */
export function p2pChipSpec(connected: boolean, path?: IcePath, context: P2pChipContext = "convo"): P2pChipSpec {
  // 未連線只有對話視窗會遇到（通話斷了就沒有視窗了），故不分情境。
  if (!connected) return { mod: "", icon: "⚪", label: "convo_p2pNone", hint: "convo_p2pNoneHint" };
  const hints = HINTS[context];
  if (path === "relay") return { mod: " relay", icon: "🔁", label: "convo_p2pRelay", hint: hints.relay };
  if (path === "direct") return { mod: " on", icon: "⚡", label: "convo_p2pDirect", hint: hints.direct };
  return { mod: " up", icon: "🔗", label: "convo_p2pUnknown", hint: hints.unknown };
}
