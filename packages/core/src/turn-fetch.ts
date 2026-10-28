// 唯一來源已搬到 Cinderous SDK（ADR-0370；SDK ADR 0017）：`@cinderous/client/protocol`。
// 這裡照原名轉出，呼叫端的 import 不必改。要改：先改 SDK、發版，再升相依。
export {
  TURN_TTL_FALLBACK_SEC,
  parseTurnResponse,
  parseTurnTtl,
  fetchTurnServers,
  turnRefreshDelayMs,
  turnEndpointFromRelay,
  turnEndpointCandidates,
  fetchTurnWithFallback,
  type IceServer,
  type TurnSigner,
  type TurnHttpResponse,
  type TurnFetch,
  type TurnResult,
  type TurnFallbackResult,
} from "@cinderous/client/protocol";
