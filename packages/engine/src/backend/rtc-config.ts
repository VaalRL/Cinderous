// 企業強制 TURN（ADR-0048/0051 收尾）：依政策建構 WebRTC ICE 設定。
//
// forceTurn 開啟時設 `iceTransportPolicy: "relay"`——只用 TURN relay 候選，
// 不揭露 host/srflx 內網 IP（隱私硬強制）。TURN 伺服器由企業佈建（turnServers）；
// 未配置 TURN 時 relay-only 會無候選、連線失敗，即「寧可不通也不外洩」的設計。

/**
 * 一般模式的預設 STUN（ADR-0210）：讓**跨網路** P2P 能蒐集 srflx 候選、真的連得起來
 * （無 STUN 時只有 host 候選＝僅同區網可連）。用 Cloudflare 公共 STUN，與既有 CF 依賴一致、
 * 少一個第三方。`forceTurn`（企業）**刻意不加**——relay-only 不外洩 host/srflx IP（ADR-0048/0051）。
 */
export const DEFAULT_STUN: readonly RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];

/** 依 forceTurn 與 TURN 伺服器清單建構 RTCConfiguration。一般模式帶預設 STUN。 */
export function buildRtcConfig(
  forceTurn: boolean,
  turnServers?: RTCIceServer[],
): RTCConfiguration | undefined {
  const hasTurn = turnServers !== undefined && turnServers.length > 0;
  if (forceTurn) {
    // 企業 relay-only：只用 TURN 候選，不加 STUN、不揭露內網/公網 IP（隱私硬強制）。
    return { iceTransportPolicy: "relay", ...(hasTurn ? { iceServers: turnServers } : {}) };
  }
  // 一般模式：預設 STUN ＋ 任何已配置的 TURN。
  return { iceServers: hasTurn ? [...DEFAULT_STUN, ...turnServers] : [...DEFAULT_STUN] };
}
