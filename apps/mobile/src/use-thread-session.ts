// 對話這一簇（ADR-0331／Phase P4 階段 1，第 6 簇 b）。
//
// 8 個 state：訊息／未讀／封存／回應／已收回／無痕收回／作用中對話／正在輸入
// ——**「說了什麼、現在看著哪一則」**。與名冊（`use-roster-session.ts`）的差別見那個檔頭。
//
// ## 這一簇為什麼保留 updater 形式
//
// 名冊全部由後端整批推送；這裡不是——樂觀送出、加回應、標收回、記封存塊數，
// 都是**針對某一條對話的區域性修改**，而且大多寫成 `setConvos((c) => …)`。
//
// 🔴 **不硬包成「語意方法」**（`addMessage`／`markUnsent`⋯⋯）：那會把十處各自不同的
// 合併邏輯搬進 hook，變成一個什麼都懂的物件——而它們真正該去的地方是引擎，不是另一個 UI hook。
// 階段 1 的目標是**搬家**，不是順手重新設計；能少改一處語意就少改一處
// （Fix First：ADR-0331 §1 已為此否決過 `useIdentityState`）。
//
// 有兩個例外值得包：`activeId` 的清除與 `typingFrom` 的自動逾時——它們有明確的生命週期，
// 而生命週期正是散在元件裡最容易忘記收尾的東西。

import { useEffect, useRef, useState } from "react";
import type { BlockedContact, ChatMessage } from "@cinderous/engine";

/** 「正在輸入」的顯示時間（ADR-0120）：對方停止打字後這麼久自動消失。 */
const TYPING_TIMEOUT_MS = 6000;

export interface ThreadSession {
  /** 對話 id → 訊息。 */
  convos: Record<string, ChatMessage[]>;
  unread: Record<string, number>;
  /** 有封存的對話（ADR-0111）：只有真的有封存才顯示「歷史紀錄」入口。 */
  archived: Record<string, number>;
  /** emoji 回應（NIP-25）：訊息 id → emoji 清單。 */
  reactions: Record<string, string[]>;
  /** 已收回（NIP-09）：留佔位「（已收回）」。 */
  unsent: Set<string>;
  /** 無痕收回（ADR-0234）：整行移除、不留佔位。 */
  purged: Set<string>;
  /** 目前開著的對話；`null`＝在清單。 */
  activeId: string | null;
  /** 對方正在輸入（ADR-0120）：來源 pubkey；逾時自動清。 */
  typingFrom: string | null;

  setConvos(fn: (c: Record<string, ChatMessage[]>) => Record<string, ChatMessage[]>): void;
  setUnread(v: Record<string, number>): void;
  setArchived(fn: (a: Record<string, number>) => Record<string, number>): void;
  setReactions(fn: (r: Record<string, string[]>) => Record<string, string[]>): void;
  setUnsent(fn: (prev: Set<string>) => Set<string>): void;
  setPurged(fn: (prev: Set<string>) => Set<string>): void;
  open(id: string): void;
  /** 回到清單（關對話／登出／切身分都會用到）。 */
  close(): void;
  /** 對方在打字；`TYPING_TIMEOUT_MS` 後自動消失。 */
  markTyping(pk: string): void;

}

export function useThreadSession(): ThreadSession {
  const [convos, setConvos] = useState<Record<string, ChatMessage[]>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [archived, setArchived] = useState<Record<string, number>>({});
  const [reactions, setReactions] = useState<Record<string, string[]>>({});
  const [unsent, setUnsent] = useState<Set<string>>(new Set());
  const [purged, setPurged] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [typingFrom, setTypingFrom] = useState<string | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸載時清掉待觸發的計時器（ADR-0169：避免洩漏／對已卸載元件動作）。
  // 計時器搬進來了，收尾也要一起搬——留在元件裡就會變成「誰負責」說不清楚的東西。
  useEffect(() => () => void (typingTimer.current && clearTimeout(typingTimer.current)), []);

  return {
    convos,
    unread,
    archived,
    reactions,
    unsent,
    purged,
    activeId,
    typingFrom,
    setConvos,
    setUnread,
    setArchived,
    setReactions,
    setUnsent,
    setPurged,
    open: setActiveId,
    close: () => setActiveId(null),
    markTyping: (pk) => {
      setTypingFrom(pk);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTypingFrom(null), TYPING_TIMEOUT_MS);
    },
  };
}
