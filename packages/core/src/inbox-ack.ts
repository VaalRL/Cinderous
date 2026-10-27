// 協定的唯一來源已搬到 Cinderous SDK（ADR-0370；SDK ADR 0007）：`@cinderous/client/protocol`。
// 這裡照原名轉出，App 其他程式的 import 不必改。要改協定：先改 SDK、發版，再升這裡的相依。
// 收件確認（ADR-0380；SDK ADR 0067）：SDK 版的 `buildInboxAck` 另外接受 `NostrSigner`，傳私鑰時行為相同。
export {
  INBOX_ACK_KIND,
  INBOX_ACK_MAX_IDS,
  buildInboxAck,
  inboxAckIdsOf,
} from "@cinderous/client/protocol";
