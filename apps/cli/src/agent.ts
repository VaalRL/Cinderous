// agent 私人頻道的收發邏輯（ADR-0404）：白名單、等回覆、核准短碼。
//
// 與 I/O 分開：後端由呼叫端建好傳進來（真實中繼或測試的記憶體網路），輸出走 `AgentIo`。

import { npubEncode } from "@cinderous/core";
import type { ChatBackendEvents, ChatMessage, RelayChatBackend } from "@cinderous/engine";

/** CLI 只關心其中幾個事件；其餘的給空實作。 */
export const noopEvents: ChatBackendEvents = {
  onContacts() {},
  onMessage() {},
  onTyping() {},
  onNudge() {},
};

export interface AgentIo {
  /** stdout：一行一筆 JSON。 */
  out(line: string): void;
  /** stderr：狀態與警告。**不得**印出被丟掉的訊息內容——內容本身就可能是注入。 */
  err(line: string): void;
}

/** 啟動之後要做的設定（ADR-0404 §1、§7）：白名單的人加成聯絡人、切換前向保密。 */
export function applyAgentSetup(backend: RelayChatBackend, o: { from?: string[]; fs?: "on" | "off" }): void {
  // 加成聯絡人：引擎開機只回放聯絡人的歷史進去重集合，顯示名稱也只送給聯絡人。
  for (const npub of o.from ?? []) backend.addContact(npub);
  if (o.fs === "on") backend.enableFs();
  else if (o.fs === "off") backend.disableFs(); // ADR-0314：明示退場，不是把宣告拿掉
}

/** 訊息的寄件人：群訊看 `sender`，一對一就是對話對象。 */
const senderOf = (contact: string, m: ChatMessage): string => m.sender ?? contact;

/** listen 的輸出格式（JSON Lines）。 */
function line(contact: string, m: ChatMessage): string {
  return JSON.stringify({
    id: m.id,
    from: npubEncode(senderOf(contact, m)),
    at: m.at,
    text: m.text,
    ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    ...(m.file ? { file: { name: m.file.name, size: m.file.size } } : {}),
  });
}

/**
 * listen 的事件處理：只輸出白名單（hex 公鑰）內的人；`allow` 未給＝全部輸出（舊行為）。
 * 重開不重複輸出靠的是引擎的去重——持久儲存下，已處理過的訊息走 `onHistory`，不會再進 `onMessage`。
 */
export function listenEvents(io: AgentIo, allow?: ReadonlySet<string>): ChatBackendEvents {
  return {
    ...noopEvents,
    onMessage: (contact, m) => {
      if (m.outgoing) return; // 只印收到的
      if (allow && !allow.has(senderOf(contact, m))) {
        io.err("… 丟掉一則白名單以外的訊息");
        return;
      }
      io.out(line(contact, m));
    },
    onConnection: (state) => io.err(`… 中繼狀態：${state}`),
  };
}

/** 核准短碼：4 位數。作用是**綁定**這一個請求，不是保密（能回覆的本來就只有白名單內的人）。 */
export function approvalCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 10_000;
  return String(n).padStart(4, "0");
}

/** 附上回覆方式的問題本文。 */
export function questionWithCode(text: string, code: string): string {
  return `${text}\n\n（回覆「yes ${code}」核准，「no ${code}」拒絕）`;
}

const YES = new Set(["yes", "y", "ok", "核准", "同意", "好"]);
const NO = new Set(["no", "n", "拒絕", "不要", "不"]);

/**
 * 解讀核准回覆：第一個詞是 yes／no 類、第二個詞是短碼。短碼對不上＝不算（回 undefined，繼續等）。
 * 全形英數與大小寫都先正規化——手機輸入法常打出全形。
 */
export function parseApproval(text: string, code: string): "approved" | "denied" | undefined {
  const words = text.normalize("NFKC").trim().toLowerCase().split(/\s+/);
  if (words.length !== 2 || words[1] !== code) return undefined;
  if (YES.has(words[0]!)) return "approved";
  if (NO.has(words[0]!)) return "denied";
  return undefined;
}

export type AskResult =
  | { decision: "reply"; text: string; at: number }
  | { decision: "approved" | "denied"; text: string; at: number }
  | { decision: "timeout" }
  /** `not-sent`＝等到逾時，問題都還沒被中繼收下（連不上）；`rejected`＝中繼拒收或重試耗盡。 */
  | { decision: "failed"; reason: "not-sent" | "rejected" };

export interface AskOptions {
  /** 收件人＝唯一被接受的回覆者（hex 公鑰）。 */
  to: string;
  text: string;
  timeoutMs: number;
  approve: boolean;
  ttl?: number;
  /** 回覆的時戳最多可以比送出時間早多少（對方時鐘慢）。預設 30 秒。 */
  skewMs?: number;
  /** 拿到短碼時通知呼叫端（測試用；CLI 會印到 stderr）。 */
  onCode?: (code: string) => void;
  /** 狀態記錄（連線狀態、短碼對不上）；CLI 印到 stderr。**不含**訊息內容。 */
  onLog?: (line: string) => void;
}

/**
 * 送出並等回覆（ADR-0404 §3）。會呼叫 `backend.start`；結束後**不** stop，由呼叫端收尾。
 *
 * 接受的回覆：寄件人是 `to`，而且「送出之後」（容許 `skewMs` 的時鐘誤差）或「引用了這則問題」。
 * `approve` 時再加一條：短碼要對得上，對不上的回覆不算、繼續等。
 */
export function ask(backend: RelayChatBackend, o: AskOptions, setup: { from?: string[]; fs?: "on" | "off" } = {}): Promise<AskResult> {
  const skew = o.skewMs ?? 30_000;
  const code = o.approve ? approvalCode() : undefined;
  if (code) o.onCode?.(code);
  const body = code ? questionWithCode(o.text, code) : o.text;
  let sentAt = 0;
  let askId: string | undefined;

  return new Promise<AskResult>((resolve) => {
    let done = false;
    const finish = (r: AskResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    let sent = false;
    // 問題沒送出去就等到逾時＝「沒問到你」，不是「你沒回」——agent 要能分辨、才知道要不要重試。
    const timer = setTimeout(
      () => finish(sent ? { decision: "timeout" } : { decision: "failed", reason: "not-sent" }),
      o.timeoutMs,
    );

    backend.start({
      ...noopEvents,
      onMessageStatus: (contact, id, status) => {
        if (contact !== o.to) return;
        askId ??= id;
        if (id !== askId) return;
        if (status === "failed") finish({ decision: "failed", reason: "rejected" });
        else if (status !== "sending") sent = true; // sent／delivered／read 都代表中繼收下了
      },
      onMessage: (contact, m) => {
        if (m.outgoing || senderOf(contact, m) !== o.to || sentAt === 0) return;
        const quotesUs = askId !== undefined && m.replyTo === askId;
        if (!quotesUs && m.at < sentAt - skew) return; // 問之前就在的訊息
        if (!code) {
          finish({ decision: "reply", text: m.text, at: m.at });
          return;
        }
        const d = parseApproval(m.text, code);
        if (d) finish({ decision: d, text: m.text, at: m.at });
        else o.onLog?.("… 收到一則回覆，但不是「yes／no＋短碼」，繼續等");
      },
      onConnection: (state) => o.onLog?.(`… 中繼狀態：${state}`),
    });
    applyAgentSetup(backend, { ...setup, from: [...(setup.from ?? []), npubEncode(o.to)] });
    sentAt = Date.now();
    backend.sendMessage(o.to, body, o.ttl);
  });
}
