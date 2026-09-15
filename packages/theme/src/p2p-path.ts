// 連線路徑晶片的呈現規格（ADR-0213／0344）：桌面與行動端共吃的 SSOT。
//
// 放在 @cinderous/theme 的理由與 `icons.ts` 相同——兩端都要顯示「這條連線走直連還是經
// TURN 中繼」，不放在這裡就會各做一個，然後漂移。這裡只放**語義角色與色票**，不含渲染：
// 桌面用 CSS class 上色、行動端用 StyleSheet，各自畫各自的。
//
// ⚠ 判定本身不住在這裡（那是 `@cinderous/engine` 的 `classifyIcePath`）。theme 是設計 token
// 層，不依賴 engine，故下面重述一次那個字串聯集；兩者若不一致，呼叫端傳值時就會型別紅。

/**
 * 一條連線的位元組走哪。**結構上等同** `@cinderous/engine` 的 `IcePath`
 * （見檔頭：theme 不依賴 engine）。
 */
export type P2pPathValue = "direct" | "relay" | "unknown";

/** 晶片的語義角色。`none`＝未連線（只有對話視窗會遇到；通話斷了就沒有視窗）。 */
export type P2pPathTone = "none" | P2pPathValue;

/** 晶片出現在哪裡。tooltip 依情境換句話：對話講檔案，通話講延遲。 */
export type P2pChipContext = "convo" | "call";

/**
 * 標籤的 i18n 鍵。以字面聯集而非 `string`——這樣它可直接餵給 `t()`（`MessageKey` 的子集），
 * 且哪天 i18n 鍵改名，呼叫端會型別紅而不是靜默顯示鍵名。
 */
export type P2pChipLabelKey = "convo_p2pNone" | "convo_p2pDirect" | "convo_p2pRelay" | "convo_p2pUnknown";

/** 說明文字的 i18n 鍵（同上）。 */
export type P2pChipHintKey =
  | "convo_p2pNoneHint"
  | "convo_p2pDirectHint"
  | "convo_p2pRelayHint"
  | "convo_p2pUnknownHint"
  | "call_pathDirectHint"
  | "call_pathRelayHint"
  | "call_pathUnknownHint";

export interface P2pPathChip {
  tone: P2pPathTone;
  icon: string;
  label: P2pChipLabelKey;
  hint: P2pChipHintKey;
}

/**
 * 語義色（桌面 `msn.css` 的 `.chip--p2p.on/.relay/.up` 是視覺參考，值由 `p2p-path.test.ts` 對齊）。
 *
 * - `direct`＝上線綠（沿用 `STATUS_COLORS.online`，與「一切正常」同一套視覺語言）。
 * - `relay`＝琥珀。**刻意不是紅色**——經中繼不是錯誤，連線是好的、內容仍端到端加密，
 *   只是較慢且是計費路徑。紅色會把它讀成故障。
 * - `unknown`＝中性灰藍，不暗示好壞。
 */
export const P2P_PATH_COLORS: Record<P2pPathValue, string> = {
  direct: "#36c46b",
  relay: "#e6a23c",
  unknown: "#8ca0b4",
};

const HINTS: Record<P2pChipContext, Record<P2pPathValue, P2pChipHintKey>> = {
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
export function p2pPathChip(
  connected: boolean,
  path?: P2pPathValue,
  context: P2pChipContext = "convo",
): P2pPathChip {
  if (!connected) return { tone: "none", icon: "⚪", label: "convo_p2pNone", hint: "convo_p2pNoneHint" };
  const hints = HINTS[context];
  if (path === "relay") return { tone: "relay", icon: "🔁", label: "convo_p2pRelay", hint: hints.relay };
  if (path === "direct") return { tone: "direct", icon: "⚡", label: "convo_p2pDirect", hint: hints.direct };
  return { tone: "unknown", icon: "🔗", label: "convo_p2pUnknown", hint: hints.unknown };
}
