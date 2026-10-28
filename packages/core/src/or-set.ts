// 唯一來源已搬到 Cinderous SDK（ADR-0370；SDK ADR 0011）：`@cinderous/client/sync`。
// 這裡照原名轉出，App 其他程式的 import 不必改。要改：先改 SDK、發版，再升這裡的相依。
export {
  OR_SET_TOMBSTONE_MAX,
  OR_SET_TOMBSTONE_RETENTION_MS,
  pruneTombstonesByTime,
  mergeOrSet,
  isWellFormedOrSetTombstone,
  type OrSetTombstone,
  type MergeOrSetOpts,
} from "@cinderous/client/sync";
