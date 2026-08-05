// 通話這一簇的 state（ADR-0331／Phase P4 階段 1，第 1 簇）。
//
// ## 為什麼要抽出來
//
// `MobileApp.tsx` 有 55 個 `useState`，其中 41 個是 per-identity 的。治本解是把它們關進
// 以身分為 `key` 的子元件（重掛＝結構性重設），但那是一次性、不可分割的大動作。
// 階段 1 先做**可以分拆**的部分：按功能簇抽成 hook——純機械、不改任何順序、逐簇可回退，
// 之後子元件那一步才會是「移動」而不是「重寫」（ADR-0328／0330 的階段規劃）。
//
// 通話排第一簇的理由：**它最獨立**。5 個 state、只由後端事件驅動、只餵一個覆蓋層畫面
// （`CallScreen`），跟聯絡人／訊息／群組那一大團沒有耦合。
//
// ## 為什麼 reset 放在這裡而不是留在 `signInWith`
//
// 原本那 5 個歸零呼叫散在一份手寫清單裡，而**清單會漏**——ADR-0294 §2 抓到過三個漏網。
// 把「這一簇有哪些欄位」和「這一簇怎麼歸零」放在同一個檔案裡，新增欄位時漏掉的機會小得多。
// ⚠ 這**還不是**結構性保證（那要等子元件＋`key`）；它是把手寫清單從 5 行縮成 1 行，
// 並把責任移到看得見的地方。

import { useState } from "react";
import type { CallMedia, CallState } from "@cinderous/core";
import type { ChatBackendEvents } from "@cinderous/engine";

export interface CallSession {
  /** 通話中（來電／撥號／通話中皆算；`idle`／`ended` 不算）。 */
  active: boolean;
  peer: string | null;
  state: CallState;
  media: CallMedia | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  /** 掛給後端 `start()` 的通話事件（展開即可）。 */
  handlers: Pick<ChatBackendEvents, "onCallState" | "onCallLocalStream" | "onCallRemoteStream">;
}

export function useCallSession(): CallSession {
  const [peer, setPeer] = useState<string | null>(null);
  const [state, setState] = useState<CallState>("idle");
  const [media, setMedia] = useState<CallMedia | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  return {
    active: state !== "idle" && state !== "ended",
    peer,
    state,
    media,
    localStream,
    remoteStream,
    handlers: {
      // ADR-0101：來電自動開通話畫面；結束時把 peer 與兩條串流一起放掉
      //（只清 state 不清串流 ⇒ 畫面沒了但 MediaStream 還在，麥克風/鏡頭燈不會滅）。
      onCallState: (p, s, m) => {
        setState(s);
        setMedia(m);
        if (s === "idle" || s === "ended") {
          setPeer(null);
          setLocalStream(null);
          setRemoteStream(null);
        } else {
          setPeer(p);
        }
      },
      onCallLocalStream: setLocalStream,
      onCallRemoteStream: setRemoteStream,
    },
  };
}
