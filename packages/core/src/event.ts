// 協定的唯一來源已搬到 Cinderous SDK（ADR-0370；SDK ADR 0007）：`@cinderous/client/protocol`。
// 這裡照原名轉出，App 其他程式的 import 不必改。要改協定：先改 SDK、發版，再升這裡的相依。
export {
  serializeEvent,
  getEventHash,
  contentHash,
  type EventTemplate,
  type UnsignedEvent,
  type NostrEvent,
} from "@cinderous/client/protocol";
