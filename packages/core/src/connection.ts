/** 可用的傳輸路徑。 */
export type Transport = "p2p" | "turn" | "relay";

/** 各傳輸路徑當前是否可用。 */
export interface Reachability {
  /** WebRTC 直連（同網/可打洞）。 */
  p2p: boolean;
  /** 經 TURN 中繼的 WebRTC（對稱 NAT 保底）。 */
  turn: boolean;
  /** 經 Nostr 中繼（非即時，延遲送達）。 */
  relay: boolean;
}

/**
 * 震動（Nudge）：優先 P2P 以求毫秒級同步感；不可用時退 TURN，
 * 最後退中繼（喪失即時性但不丟失意圖）。
 */
export const NUDGE_TRANSPORT_ORDER: Transport[] = ["p2p", "turn", "relay"];

/**
 * 檔案傳輸：僅走 P2P 或 TURN（對稱 NAT 保底），不經中繼，
 * 以免受 JSON 大小限制並維持頻寬效率。
 */
export const FILE_TRANSPORT_ORDER: Transport[] = ["p2p", "turn"];

/** 依偏好順序挑選第一個可用的傳輸路徑；皆不可用時回 undefined。 */
export function selectTransport(
  order: Transport[],
  reachability: Reachability,
): Transport | undefined {
  return order.find((t) => reachability[t]);
}
