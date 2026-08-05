// 名冊這一簇（ADR-0331／Phase P4 階段 1，第 6 簇 a：核心通訊拆為「名冊」與「對話」）。
//
// 4 個 state：聯絡人／群組／封鎖名單／訊息請求——**「我可以跟誰講話」**。
//
// ## 為什麼把核心通訊拆成兩半
//
// 原計畫把 12 個核心通訊 state 當成一簇。實際看下來，它們沿著一條清楚的縫分成兩邊：
//
//   - **名冊**（本檔）：誰。全部由後端推送（`onContacts`／`onGroups`／`onBlocked`／`onRequests`），
//     元件端**只讀不寫**。
//   - **對話**（`use-thread-session.ts`）：說了什麼。有大量元件端的本機變更
//     （樂觀送出、回應、收回、封存⋯⋯）。
//
// 兩邊的寫入模式完全不同，合成一簇只會得到一個「什麼都有」的 hook。拆開之後，
// 這一簇的介面小到一眼看得完：四個唯讀欄位 ＋ 四個後端 setter。
//
// 🔵 **ADR-0332 2c 起沒有 `reset()`**：切身分＝`AppSession` 重掛，這四個 state 隨卸載消失。
// 它原本的單元測試（「切身分整組歸零」）也一併刪了——那個方法沒了，測它等於測一段死程式碼；
// 該保證改由互動測試「聯絡人不跨身分」承擔，那條測的是使用者真的看得到的東西。

import { useState } from "react";
import type { BlockedContact, Contact, ContactRequest, Group } from "@cinderous/engine";

export interface RosterSession {
  contacts: Contact[];
  groups: Group[];
  /** 封鎖名單（ADR-0014）。 */
  blocked: BlockedContact[];
  /** 訊息請求（ADR-0121）：陌生人傳來訊息但尚未接受。**不是聯絡人**。 */
  requests: ContactRequest[];

  /** 以下四個都是後端推送的入口（`onContacts` 等），元件端不自行改名冊。 */
  setContacts(list: Contact[]): void;
  setGroups(list: Group[]): void;
  setBlocked(list: BlockedContact[]): void;
  setRequests(list: ContactRequest[]): void;

}

export function useRosterSession(): RosterSession {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [blocked, setBlocked] = useState<BlockedContact[]>([]);
  const [requests, setRequests] = useState<ContactRequest[]>([]);

  return {
    contacts,
    groups,
    blocked,
    requests,
    setContacts,
    setGroups,
    setBlocked,
    setRequests,
  };
}
