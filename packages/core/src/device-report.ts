// 裝置報告（ADR-0397）：每台裝置自報「我是哪一版、讀得懂哪些機制」，只給自己的其他裝置看。
//
// 為什麼不寫進裝置目錄（kind 10041）：目錄是撤銷的承重結構，只有已在目錄內的裝置能授權別台
// （ADR-0322 S5），裝置不能改自己那一項。報告是可尋址事件、`d`＝裝置 id，每台只寫自己那一份。
//
// 🔴 這是**提示**，不是安全邊界：任何持有 nsec 的人都偽造得出來。撤銷仍以裝置目錄為準。

import type { NostrEvent } from "./event.js";
import { getPublicKey, type PubkeyHex, type SecretKey } from "./keys.js";
import { decryptDM, encryptDM } from "./nip44.js";
import { finalizeEvent, verifyEvent } from "./sign.js";

/** 裝置報告的可尋址 kind（App 專用；`d`＝裝置 id）。 */
export const DEVICE_REPORT_KIND = 30079;

/** 能力字串長度上限（同 `FS_CAPABILITY_MAX_LEN`）。 */
const CAP_MAX_LEN = 16;
/** 一份報告最多帶幾個能力（防畸形內容撐爆）。 */
const CAPS_MAX = 32;
const ID_MAX_LEN = 40;
const VER_MAX_LEN = 32;
const PK_RE = /^[0-9a-f]{64}$/;

export interface DeviceReport {
  /** `getDeviceId()`（同雲端快照的 `d` tag）。 */
  id: string;
  /** 裝置公鑰（ADR-0322）。 */
  pk: PubkeyHex;
  /** App 版號；不知道就省略。 */
  ver?: string;
  /** 這一版讀得懂的機制（例如 `ek-v1`、`ek-pq-v1`）。 */
  caps: string[];
  /** 報告時間（unix 秒）。 */
  at: number;
}

/** 打包裝置報告：身分金鑰簽章、內容 NIP-44 加密給自己。 */
export function buildDeviceReport(sk: SecretKey, report: DeviceReport): NostrEvent {
  return finalizeEvent(
    { kind: DEVICE_REPORT_KIND, created_at: report.at, tags: [["d", report.id]], content: encryptDM(JSON.stringify(report), sk, getPublicKey(sk)) },
    sk,
  );
}

/** 解開並驗證自己的裝置報告。不是自己發的、壞簽章、解不開、畸形、`d` 與 id 不符一律回 null。 */
export function readDeviceReport(event: NostrEvent, sk: SecretKey): DeviceReport | null {
  if (event.kind !== DEVICE_REPORT_KIND) return null;
  const me = getPublicKey(sk);
  if (event.pubkey !== me || !verifyEvent(event)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(decryptDM(event.content, sk, me));
  } catch {
    return null;
  }
  const report = parseReport(raw);
  if (!report) return null;
  const d = event.tags.find((t) => t[0] === "d")?.[1];
  return d === report.id ? report : null;
}

function parseReport(raw: unknown): DeviceReport | null {
  if (!raw || typeof raw !== "object") return null;
  const { id, pk, ver, caps, at } = raw as Record<string, unknown>;
  if (typeof id !== "string" || id.length === 0 || id.length > ID_MAX_LEN) return null;
  if (typeof pk !== "string" || !PK_RE.test(pk)) return null;
  if (ver !== undefined && (typeof ver !== "string" || ver.length > VER_MAX_LEN)) return null;
  if (!Array.isArray(caps) || caps.length > CAPS_MAX) return null;
  if (!caps.every((c): c is string => typeof c === "string" && c.length > 0 && c.length <= CAP_MAX_LEN)) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return { id, pk, ...(ver !== undefined ? { ver } : {}), caps: [...caps], at };
}
