// 企業強制 TURN（ADR-0048/0051 收尾）：依政策建構 WebRTC ICE 設定。
//
// forceTurn 開啟時設 `iceTransportPolicy: "relay"`——只用 TURN relay 候選，
// 不揭露 host/srflx 內網 IP（隱私硬強制）。TURN 伺服器由企業佈建（turnServers）；
// 未配置 TURN 時 relay-only 會無候選、連線失敗，即「寧可不通也不外洩」的設計。

/** 依 forceTurn 與 TURN 伺服器清單建構 RTCConfiguration；無需求時回傳 undefined。 */
export function buildRtcConfig(
  forceTurn: boolean,
  turnServers?: RTCIceServer[],
): RTCConfiguration | undefined {
  const hasTurn = turnServers !== undefined && turnServers.length > 0;
  if (forceTurn) {
    return { iceTransportPolicy: "relay", ...(hasTurn ? { iceServers: turnServers } : {}) };
  }
  return hasTurn ? { iceServers: turnServers } : undefined;
}
