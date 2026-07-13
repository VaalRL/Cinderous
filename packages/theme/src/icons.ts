// 訊息狀態圖示幾何（ADR-0095）：桌面（React）與行動端（RN-web）共用的 SSOT。
//
// 這裡只放**幾何與語義色角色**，不含渲染——各前端用自己的原語畫，顏色走 currentColor，
// 由 CSS/style 依 `tone` 上色。放在 @cinder/theme 是因為它已是跨前端設計 token 的 SSOT（ADR-0080）。
//
// 視覺語言：以「眼睛的張合」表達**對方看到多少**——
//   閉眼＝已送出（還沒看到） → 半開眼＝已送達裝置 → 張開眼＝已讀（主色＋加粗）。
//   另兩個非眼睛狀態：沙漏＝傳送中；循環箭頭＝傳送失敗（紅色，示意可重試）。

export type MsgStatusIconName = "sending" | "failed" | "sent" | "delivered" | "read";

export interface MsgStatusIcon {
  /** SVG viewBox（統一 16×16）。 */
  viewBox: string;
  /** 描邊路徑（stroke=currentColor、fill=none、圓端點）。 */
  strokes: string[];
  /** 實心瞳孔 `[cx, cy, r]`（fill=currentColor）；閉眼/沙漏/失敗沒有。 */
  dot?: [number, number, number];
  /** 語義色角色：muted＝灰、accent＝主色、danger＝紅。 */
  tone: "muted" | "accent" | "danger";
  /** 線寬；`read` 較粗＝視覺上的「粗體」。 */
  strokeWidth: number;
}

export const MSG_STATUS_ICONS: Record<MsgStatusIconName, MsgStatusIcon> = {
  // 沙漏：上下橫槓 + 束腰。
  sending: {
    viewBox: "0 0 16 16",
    strokes: [
      "M4.5 2.5h7",
      "M4.5 13.5h7",
      "M5.5 2.5c0 2.5 2.5 3.6 2.5 5.5s-2.5 3-2.5 5.5",
      "M10.5 2.5c0 2.5-2.5 3.6-2.5 5.5s2.5 3 2.5 5.5",
    ],
    tone: "muted",
    strokeWidth: 1.3,
  },
  // 循環箭頭（重試）：開口圓弧 + 箭頭角。
  failed: {
    viewBox: "0 0 16 16",
    strokes: ["M13.2 8a5.2 5.2 0 1 1-1.6-3.75", "M12.9 1.6v3.1h-3.1"],
    tone: "danger",
    strokeWidth: 1.5,
  },
  // 閉眼：單一下弧（眼瞼閉合），無瞳孔。
  sent: {
    viewBox: "0 0 16 16",
    strokes: ["M2.2 8.4q5.8 4.4 11.6 0"],
    tone: "muted",
    strokeWidth: 1.3,
  },
  // 半開眼：下弧 + 壓低的上眼瞼（近直線）+ 小瞳孔。
  delivered: {
    viewBox: "0 0 16 16",
    strokes: ["M2.2 8.4h11.6", "M2.2 8.4q5.8 4.4 11.6 0"],
    dot: [8, 9.1, 1.15],
    tone: "muted",
    strokeWidth: 1.3,
  },
  // 張開眼：完整杏形 + 大瞳孔；主色 + 較粗線。
  read: {
    viewBox: "0 0 16 16",
    strokes: ["M1.6 8q6.4-5.6 12.8 0q-6.4 5.6-12.8 0"],
    dot: [8, 8, 2.1],
    tone: "accent",
    strokeWidth: 1.9,
  },
};
