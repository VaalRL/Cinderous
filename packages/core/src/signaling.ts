// 協定的唯一來源已搬到 Cinderous SDK（ADR-0370；SDK ADR 0009）：`@cinderous/client/protocol`。
// 這裡照原名轉出，App 其他程式的 import 不必改。要改協定：先改 SDK、發版，再升這裡的相依。
export {
  SDP_SIGNAL_KIND,
  createSignal,
  readSignal,
  parseSignal,
  CandidateBatch,
  type OfferAnswerSignal,
  type IceCandidateData,
  type CandidateSignal,
  type CandidatesSignal,
  type Signal,
  type ReceivedSignal,
} from "@cinderous/client/protocol";
