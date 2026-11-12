// 請求清單的 ref 要在 onRequests 裡**同步**更新（ADR-0420）。
//
// ## 為什麼需要這支測試
//
// 2026-11-12 在 Pixel 8a 上實測：陌生人傳來的第一則訊息**跳了通知**——ADR-0121 明定請求區
// 一律不跳（否則陌生人能推播到你的鎖定畫面）。
//
// 引擎先送 `onRequests`（已含這個陌生人），同一個呼叫堆疊裡緊接著送 `onMessage`
//（契約由 engine 的 relay-backend.test 鎖住）。兩端在 `onMessage` 裡用 `requestsRef.current`
// 判斷「這是不是請求」——但那個 ref 只在 **render** 時從 state 鏡像過來。`setRequests` 只是
// 排程一次 render，`onMessage` 跑的當下 ref 還是舊清單 ⇒ 第一則陌生訊息被當成聯絡人的。
// 桌面同一個寫法，連帶 ADR-0415 的離開摘要也會把那則算進去。
//
// 這裡沒有能真的觸發引擎回呼的 app 測試環境，所以照 handler-parity 的做法掃原始碼：
// 兩端的 onRequests 處理都必須直接寫 `requestsRef.current`，不能只交給 setState。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILES = {
  desktop: new URL("../../desktop/src/App.tsx", import.meta.url),
  mobile: new URL("./AppSession.tsx", import.meta.url),
} as const;

/** 取出 `onRequests` 處理器的原始碼：從 `onRequests:` 到下一個同層的 `onX:`。 */
function onRequestsHandler(src: string): string {
  const m = /^( +)onRequests:/m.exec(src);
  expect(m, "找不到 onRequests 的接線").not.toBeNull();
  const indent = m![1]!;
  const rest = src.slice(m!.index + m![0].length);
  const next = new RegExp(`^${indent}on[A-Z][A-Za-z]*[:(]`, "m").exec(rest);
  return rest.slice(0, next ? next.index : undefined);
}

describe("onRequests 同步更新 requestsRef（ADR-0420）", () => {
  for (const [app, file] of Object.entries(FILES)) {
    it(`${app}：onRequests 裡直接寫入 requestsRef.current`, () => {
      const body = onRequestsHandler(readFileSync(file, "utf8"));
      expect(body).toMatch(/requestsRef\.current\s*=/);
    });
  }
});
