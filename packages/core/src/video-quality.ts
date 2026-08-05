// 視訊通話畫質檔位（ADR-0337）。
//
// 這裡只有**數字與純函式**，沒有任何平台相依——桌面與行動端共用同一份，
// 因為畫質檔位是**產品決策**，不是各端各自調參。
//
// ## 為什麼需要它
//
// 在此之前 `getUserMedia({ video: true })` 拿相機預設（手機常見 720p 以上），
// 瀏覽器會推到 ~2 Mbps。使用者付行動數據、站方付 TURN egress（ADR-0336），
// 而**兩邊都無從得知也無從調整**。
//
// ## 預設是 medium，這是刻意的
//
// 預設值服務的是「行動數據上的中階手機」，不是「有線網路上的桌機」。
// 想要更好的人會自己去調；被預設值吃掉流量的人不會知道發生什麼事。

/** 畫質檔位（由省到清晰）。 */
export type VideoQuality = "low" | "medium" | "high";

/** 全部檔位，**順序即由省到清晰**（UI 依此排列，測試依此驗遞增）。 */
export const VIDEO_QUALITIES: readonly VideoQuality[] = ["low", "medium", "high"] as const;

/** 預設檔位。見檔頭：刻意不是 `high`。 */
export const DEFAULT_VIDEO_QUALITY: VideoQuality = "medium";

/** 一個檔位的具體參數。 */
export interface VideoProfile {
  width: number;
  height: number;
  frameRate: number;
  /** 視訊編碼位元率上限（bps）。**是上限不是保證**——網路差時實際會更低。 */
  maxBitrate: number;
}

const PROFILES: Record<VideoQuality, VideoProfile> = {
  // 經 TURN 的 egress（雙向、含音訊）約 180 MB/h
  low: { width: 320, height: 240, frameRate: 15, maxBitrate: 150_000 },
  // 約 585 MB/h
  medium: { width: 640, height: 480, frameRate: 24, maxBitrate: 600_000 },
  // 約 1.4 GB/h
  high: { width: 1280, height: 720, frameRate: 30, maxBitrate: 1_500_000 },
};

/** 取得某檔位的參數。 */
export function videoProfile(q: VideoQuality): VideoProfile {
  return PROFILES[q];
}

/**
 * 轉成 `getUserMedia` / `track.applyConstraints` 可用的約束。
 *
 * ⚠ 一律用 `ideal` 而非 `exact`：相機不支援該解析度時應**退而求其次**，
 * 而不是讓整個取媒體失敗——沒有畫面比畫面不夠漂亮嚴重得多。
 */
export function videoConstraints(q: VideoQuality): {
  width: { ideal: number };
  height: { ideal: number };
  frameRate: { ideal: number };
} {
  const p = PROFILES[q];
  return {
    width: { ideal: p.width },
    height: { ideal: p.height },
    frameRate: { ideal: p.frameRate },
  };
}

/** 型別守衛：偏好存在 localStorage，舊版或使用者可能塞進任何東西。 */
export function isVideoQuality(v: unknown): v is VideoQuality {
  return typeof v === "string" && (VIDEO_QUALITIES as readonly string[]).includes(v);
}
