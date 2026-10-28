// 協定的唯一來源已搬到 Cinderous SDK（ADR-0370；SDK ADR 0016）：`@cinderous/client/protocol`。
// 這裡照原名轉出，App 其他程式的 import 不必改。要改協定：先改 SDK、發版，再升這裡的相依。
export {
  CALL_SIGNAL_KIND,
  CallSession,
  createCallSignal,
  readCallSignal,
  parseCallSignal,
  type CallMedia,
  type CallEndReason,
  type CallFailureReason,
  type CallInvite,
  type CallAccept,
  type CallReject,
  type CallHangup,
  type CallMediaChange,
  type CallCandidate,
  type CallSignal,
  type CallState,
  type CallAction,
} from "@cinderous/client/protocol";
