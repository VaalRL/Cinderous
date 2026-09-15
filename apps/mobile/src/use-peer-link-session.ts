// 與各聯絡人的 P2P 直連這一簇（ADR-0213／0344；行動端對齊）。
//
// ## 為什麼是自己一簇，而不是塞進名冊
//
// 名冊（`use-roster-session.ts`）是**後端推送的「誰」**，檔頭明講「元件端不自行改名冊」。
// 直連狀態不是名冊的一部分：它是**傳輸層**的事實，隨網路來去、與這個人是不是我的聯絡人
// 無關。塞進名冊會讓「誰」這個簇同時背負連線生命週期，正是 ADR-0331 §1 想避免的那種
// 「什麼都懂的物件」。
//
// 它與通話簇同型：小、只由後端事件驅動、只餵一個畫面元素（對話標頭的晶片）。
//
// ## 為什麼沒有 reset()
//
// ADR-0332 2c：`AppSession` 已掛 `key={身分+世代}`，換身分即重掛＝歸零。提供一個沒人呼叫的
// `reset()` 只會變成死程式碼（那條規則由 `AppSession.perIdentityState.test.ts` 把關）。

import { useState } from "react";
import type { ChatBackendEvents, IcePath } from "@cinderous/engine";

export interface PeerLinkSession {
  /** 已建立 P2P 資料通道的聯絡人。 */
  connected: Set<string>;
  /**
   * 各聯絡人的 ICE 路徑（ADR-0344）。只在 `connected` 含該聯絡人時有意義；
   * 斷線會一併移除，不留過期判定。
   */
  paths: Record<string, IcePath>;
  /** 掛給後端 `start()` 的事件（展開即可）。 */
  handlers: Pick<ChatBackendEvents, "onPeerConnection">;
}

export function usePeerLinkSession(): PeerLinkSession {
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [paths, setPaths] = useState<Record<string, IcePath>>({});

  return {
    connected,
    paths,
    handlers: {
      // ADR-0213：直連開/關 → 對話標頭晶片。
      // ADR-0344：同一條連線會先來 `unknown`、測出來再補一則 ⇒ 兩個 state 各自去重，
      // 不互相牽動重繪（會收到多次 `connected=true` 是預期，不是抖動）。
      onPeerConnection: (pk, isConnected, path) => {
        setConnected((prev) => {
          if (prev.has(pk) === isConnected) return prev;
          const next = new Set(prev);
          if (isConnected) next.add(pk);
          else next.delete(pk);
          return next;
        });
        setPaths((prev) => {
          const next = isConnected ? (path ?? "unknown") : undefined;
          if (prev[pk] === next) return prev;
          if (next === undefined) {
            if (!(pk in prev)) return prev;
            const { [pk]: _drop, ...rest } = prev;
            return rest;
          }
          return { ...prev, [pk]: next };
        });
      },
    },
  };
}
