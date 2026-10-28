// 協定的唯一來源已搬到 Cinderous SDK（ADR-0370；SDK ADR 0009）：`@cinderous/client/protocol`。
// 這裡照原名轉出，App 其他程式的 import 不必改。要改協定：先改 SDK、發版，再升這裡的相依。
export {
  PQ_PUBLIC_KEY_BYTES,
  PQ_SECRET_KEY_BYTES,
  PQ_CIPHERTEXT_BYTES,
  PQ_SEED_BYTES,
  generatePqSeed,
  pqKeyFromSeed,
  pqEncapsulate,
  pqDecapsulate,
  hybridConversationKey,
  encodePqSeed,
  pqKeyFromStored,
  decodePqPublicKey,
  encodePqPublicKey,
  type PqKeyPair,
} from "@cinderous/client/protocol";
