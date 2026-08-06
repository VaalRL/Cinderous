// NIP-98 風格的 HTTP 請求簽章（ADR-0342 §3.2）：用身分金鑰證明「這個請求是我發的」。
//
// ## 為什麼要有它
//
// relay Worker 的 `/turn` 端點在任何驗證之前——任何人 `GET` 就拿到 TURN 憑證，
// 而 **TURN 是通用中繼**，等於免費 proxy（ADR-0336 §2）。
//
// ## 它證明什麼、不證明什麼
//
// ✅ 「持有 `pubkey` 私鑰的人，在 `created_at` 前後的時間窗內，對**這個 URL＋method** 發了請求。」
//
// 🔴 **它不證明「你是這座 relay 的使用者」**，也擋不住有心人——產一把金鑰是微秒級的事。
// 買到的是**成本**與**可歸責性**（請求綁得上一個 pubkey，速率限制因此能以 pubkey 計數
// 而非 IP，避開行動網路共用 IP 的誤傷）。真正的執法把手見 ADR-0342 §3.3。
//
// ## 綁定的三件事，缺一不可
//
// - **URL**：否則對 A 端點簽的可以拿去打 B 端點。
// - **method**：否則 GET 的簽章可以拿去 POST。
// - **時間**：否則永久可重放。

import type { NostrEvent } from "./event.js";
import type { SecretKey } from "./keys.js";
import { finalizeEvent, verifyEvent } from "./sign.js";

/** NIP-98 HTTP Auth 事件 kind。 */
export const HTTP_AUTH_KIND = 27235;

/**
 * 允許的時鐘偏移（秒）。
 *
 * ⚠ 太嚴會擋掉時鐘不準的裝置（他們拿不到 TURN、退回純 STUN）；
 * 太鬆則放大重放窗口。60 秒是兩者的折衷。
 */
export const HTTP_AUTH_SKEW_SEC = 60;

/** 簽一個綁定 URL＋method＋時間的授權事件。 */
export function buildHttpAuthEvent(
  url: string,
  method: string,
  sk: SecretKey,
  nowSec: number = Math.floor(Date.now() / 1000),
): NostrEvent {
  return finalizeEvent(
    {
      kind: HTTP_AUTH_KIND,
      created_at: nowSec,
      // 大小寫正規化在**簽與驗兩側都做**，否則 "GET"／"get" 會驗不過。
      tags: [
        ["u", url],
        ["method", method.toUpperCase()],
      ],
      content: "",
    },
    sk,
  );
}

/** 包成 `Authorization` 標頭的值。 */
export function httpAuthHeader(event: NostrEvent): string {
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

/**
 * 事件結構驗證——**必須在 `verifyEvent` 之前**（ADR-0235 C1）。
 *
 * `verifyEvent` 只保證「`id` 是這串 JSON 的 sha256、`sig` 是 `pubkey` 對 `id` 的簽章」，
 * **完全不檢查欄位型別**。攻擊者可以對 `{tags:{}}` 這種形狀自己算 hash、自己簽，
 * `verifyEvent` 會回傳 true，接著 `tags.find(...)` 拋 `TypeError`。
 */
export function isValidAuthEventShape(e: unknown): boolean {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return false;
  const ev = e as Record<string, unknown>;
  if (!Number.isFinite(ev.kind) || !Number.isFinite(ev.created_at)) return false;
  for (const field of ["id", "pubkey", "sig", "content"]) {
    if (typeof ev[field] !== "string") return false;
  }
  if (!Array.isArray(ev.tags)) return false;
  for (const tag of ev.tags) {
    if (!Array.isArray(tag)) return false;
    for (const v of tag) if (typeof v !== "string") return false;
  }
  return true;
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

/**
 * 驗證 `Authorization` 標頭。回傳簽署者 pubkey，或 `null`（一律當作未授權）。
 *
 * ⚠ **回傳 `null` 不區分原因**——對外不說「是簽章壞了還是時間過期」，
 * 那對攻擊者是免費的偵錯資訊，對正常使用者也幫不上忙（他們的客戶端會自己重簽）。
 */
export function verifyHttpAuth(
  header: string | null,
  url: string,
  method: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): string | null {
  if (!header) return null;
  const m = /^Nostr\s+(.+)$/i.exec(header.trim());
  if (!m) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(m[1]!));
  } catch {
    return null;
  }
  // 🔴 順序不可調換：先結構、後簽章（見 isValidAuthEventShape 的說明）。
  if (!isValidAuthEventShape(parsed)) return null;
  const event = parsed as NostrEvent;

  if (event.kind !== HTTP_AUTH_KIND) return null;
  if (Math.abs(nowSec - event.created_at) > HTTP_AUTH_SKEW_SEC) return null;
  if (tagValue(event, "u") !== url) return null;
  if (tagValue(event, "method") !== method.toUpperCase()) return null;
  if (!verifyEvent(event)) return null;

  return event.pubkey;
}
