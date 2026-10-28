// 協定的唯一來源已搬到 Cinderous SDK（ADR-0370；SDK ADR 0010）：`@cinderous/client/protocol`。
// 這裡照原名轉出，App 其他程式的 import 不必改。要改協定：先改 SDK、發版，再升這裡的相依。
export {
  DEVICE_DIRECTORY_KIND,
  DEVICE_DIRECTORY_MAX,
  DEVICE_LABEL_MAX_LEN,
  buildDeviceDirectory,
  readDeviceDirectory,
  inDirectory,
  deviceIdInDirectory,
  withoutDevice,
  withDevice,
  classifyDirectory,
  incomingWins,
  directoryConflict,
  type DeviceEntry,
  type DeviceDirectory,
  type DirectoryDivergence,
} from "@cinderous/client/protocol";
