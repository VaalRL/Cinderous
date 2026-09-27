// 唯一來源已搬到 Cinderous SDK（ADR-0370；SDK ADR 0011）：`@cinderous/client/sync`。
// 這裡照原名轉出，App 其他程式的 import 不必改。要改：先改 SDK、發版，再升這裡的相依。
export {
  FILE_WRAP_KIND,
  FILE_CHUNK_KIND,
  FILE_CHUNK_BYTES,
  FILE_CHUNK_MAX_TOTAL,
  splitFileChunks,
  wrapFileChunk,
  parseFileChunk,
  type FileChunk,
} from "@cinderous/client/sync";
