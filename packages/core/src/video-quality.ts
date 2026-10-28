// 協定的唯一來源已搬到 Cinderous SDK（ADR-0370；SDK ADR 0016）：`@cinderous/client/protocol`。
// 這裡照原名轉出，App 其他程式的 import 不必改。要改協定：先改 SDK、發版，再升這裡的相依。
export {
  VIDEO_QUALITIES,
  DEFAULT_VIDEO_QUALITY,
  videoProfile,
  videoConstraints,
  flipFacing,
  shouldMirror,
  isVideoQuality,
  type VideoQuality,
  type VideoProfile,
  type CameraFacing,
  type CameraSelection,
  type VideoConstraints,
} from "@cinderous/client/protocol";
