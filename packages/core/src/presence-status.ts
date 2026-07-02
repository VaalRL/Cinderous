// 彙整式在線狀態負載（F5 心跳合併）。
//
// 把「上線狀態、個人狀態訊息、正在聆聽音樂」合併進單一心跳（kind 20000）的
// content，取代原本分開的音樂事件（kind 20002）與訂閱——減少中繼站的事件數與
// 訂閱數（容量模型見 docs/adr/0006）。

/** 對外廣播的在線狀態（不含 offline；offline＝停止心跳，不廣播）。 */
export type PresenceState = "online" | "away" | "busy";

/** 心跳所攜帶的彙整負載。 */
export interface PresencePayload {
  /** 在線狀態。 */
  s: PresenceState;
  /** 個人狀態訊息。 */
  m: string;
  /** 正在聆聽的音樂（空字串表示沒有）。 */
  np: string;
}

/** 編碼為心跳 content（JSON）。 */
export function encodePresence(payload: PresencePayload): string {
  return JSON.stringify(payload);
}

/** 容錯解碼心跳 content；非法時退回把整段視為狀態訊息。 */
export function decodePresence(content: string): PresencePayload {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && "s" in parsed) {
      const p = parsed as Record<string, unknown>;
      if (p.s === "online" || p.s === "away" || p.s === "busy") {
        return {
          s: p.s,
          m: typeof p.m === "string" ? p.m : "",
          np: typeof p.np === "string" ? p.np : "",
        };
      }
    }
  } catch {
    /* 視為純文字狀態訊息 */
  }
  return { s: "online", m: content, np: "" };
}
