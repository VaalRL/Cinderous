// 協定的唯一來源已搬到 Cinderous SDK（ADR-0370；SDK ADR 0009）：`@cinderous/client/protocol`。
// 這裡照原名轉出，App 其他程式的 import 不必改。要改協定：先改 SDK、發版，再升這裡的相依。
export {
  TIMESTAMP_JITTER_SECONDS,
  PQ_CT_TAG,
  toRecipient,
  toRecipientKey,
  sealAndWrap,
  openWrap,
  type Recipient,
  type RecipientLike,
  type RecipientKey,
  type RecipientKeyLike,
  type RumorInput,
  type Rumor,
  type Opened,
  type WrapSpec,
} from "@cinderous/client/protocol";
