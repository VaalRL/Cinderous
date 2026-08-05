// 「我自己」這一簇（ADR-0331／Phase P4 階段 1，第 5 簇）。
//
// 9 個 state，分三組但同屬一件事——**這個身分的我**：
//
//   - 身分本體：`pubkey`／`name`／`npub`／`nsec`（登入時一次設定，改名時更新 `name`）。
//   - 上線狀態：`invisible`／`status`／`statusMessage`／`nowPlaying`（ADR-0114／0142／0088）。
//     前三個隨身分持久化（`loadPresence`），`nowPlaying` 純易失。
//   - 與中繼的連線（ADR-0034）：`connection`。
//
// ⚠ `connection` 原本被規劃成獨立的第 6 簇（見 ADR-0331 §11）。**那是把計畫切太細**——
// 一個 state、一行歸零，做成 hook 只有形式沒有內容。它併在這裡是因為語意對得上：
// 「我現在**看起來**在線」（`status`／`invisible`）與「我現在**實際上**連著嗎」（`connection`）
// 是同一個問題的兩面，而且歸零時機完全相同（切身分＝重連）。
//
// ## 🔴 關於 `nsec`
//
// 這裡持有的是**金鑰材料**。搬進來是**重新安置**，不是**增加持有者**——
// 它本來就在 `MobileApp` 的 state 裡（行動端從不持久化 nsec，ADR-0112；session 內必須在手，
// 因為儲存層的 DEK 由它導出）。
//
// ⚠ 故這個 hook **刻意不提供任何「順手」的密碼學便利**（不導金鑰、不簽章、不加解密）。
// 它只是個容器。多一個地方**做**金鑰運算，就多一個地方要證明沒外洩；
// 而多一個地方**放**同一份已存在的參照，沒有增加攻擊面。這條界線與第 2 簇（企業託管的 sk）一致。
//
// ## 登出時的 `nsec`
//
// 軟登出（ADR-0201）只結束 session、保留身分於本機。ADR-0331 收攏這一簇時發現登出路徑
// **沒有清掉 `nsec`／`pubkey`／`name`**——那是「session 結束了但金鑰還在記憶體」，
// 當時補了一個 `clear()`。
//
// 🔵 **ADR-0332 2c 起那個方法已刪除**：登出讓外殼的 key 變成 `none` ⇒ `AppSession` 重掛
// ⇒ 這裡的每一個 state 隨卸載消失。**結構性保證取代了手寫的抹除**——
// 而手寫的那種，正是會被下一個新增欄位的人漏掉的東西。

import { useState } from "react";
import type { ConnectionState, Status } from "@cinderous/engine";

/** 切身分時的種子。 */
export interface SelfSeed {
  pubkey: string;
  name: string;
  npub: string;
  nsec: string;
  /** 本機記住的上次手動狀態（ADR-0164）；沒有就用預設。 */
  status?: Status;
  statusMessage?: string;
  /** 接管離職身分時強制隱身（ADR-0180）。 */
  invisible?: boolean;
}

export interface SelfSession {
  pubkey: string;
  name: string;
  npub: string;
  /** ⚠ 金鑰材料。見檔頭：只放不用。 */
  nsec: string;
  invisible: boolean;
  status: Status;
  statusMessage: string;
  nowPlaying: string;
  /** 與中繼站的連線（ADR-0034）：非 online 時頂端顯示細條。 */
  connection: ConnectionState;

  /** 改名（ADR-0138 的身分改名，同步更新登錄檔由呼叫端負責）。 */
  setName(name: string): void;
  setInvisible(v: boolean): void;
  setStatus(s: Status): void;
  setStatusMessage(m: string): void;
  setNowPlaying(t: string): void;
  /** 後端 `onConnection`。 */
  setConnection(s: ConnectionState): void;

  /** 切身分：換成新身分的我。 */
  reset(seed: SelfSeed): void;
}

export function useSelfSession(): SelfSession {
  const [pubkey, setPubkey] = useState("");
  const [name, setName] = useState("");
  const [npub, setNpub] = useState("");
  const [nsec, setNsec] = useState("");
  const [invisible, setInvisible] = useState(false);
  const [status, setStatus] = useState<Status>("online");
  const [statusMessage, setStatusMessage] = useState("");
  const [nowPlaying, setNowPlaying] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  return {
    pubkey,
    name,
    npub,
    nsec,
    invisible,
    status,
    statusMessage,
    nowPlaying,
    connection,
    setName,
    setInvisible,
    setStatus,
    setStatusMessage,
    setNowPlaying,
    setConnection,
    reset: (seed) => {
      setPubkey(seed.pubkey);
      setName(seed.name);
      setNpub(seed.npub);
      setNsec(seed.nsec);
      setInvisible(!!seed.invisible);
      setStatus(seed.status ?? "online");
      setStatusMessage(seed.statusMessage ?? "");
      setNowPlaying(""); // 純易失，不跨身分也不跨 session
      setConnection("connecting"); // ADR-0169：換身分＝重連，先回連線中，待後端回報 online
    },
  };
}
