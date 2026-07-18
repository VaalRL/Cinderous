// 配對會期編排（D4a，ADR-0072）：把「載荷／傳輸／協定／捆包」串成兩個高階入口，
// 讓 UI 只管顯示 SAS 與進度。傳輸以參數注入（產線＝WebRTC，測試＝記憶體對接）。

import {
  createPairing,
  encodePairing,
  type PairTransport,
  parsePairing,
  runPairingSource,
  runPairingTarget,
} from "@cinderous/core";
import { buildPairBundle, type PairBundle, type PairBundleOrg, parsePairBundle } from "../storage/pair-bundle.js";
import type { AppStorage, StoredIdentity } from "../storage/types.js";
import { openPairingTransport } from "./pairing-transport.js";
import type { RelayConnector } from "./relay-backend.js";

/** 配對載荷時效（ADR-0072）：短時效讓剪貼簿殘留失去利用價值。 */
export const PAIRING_TTL_MS = 120_000;

/** 傳輸工廠（可注入；產線走 WebRTC）。`relayUrl`＝雙方會合的中繼站。 */
export type PairTransportFactory = (
  role: "source" | "target",
  key: Uint8Array,
  relayUrl: string,
) => Promise<PairTransport>;

/** 產線傳輸工廠：WebRTC＋拋棄式信令會合（relay 只見拋棄 pubkey）。 */
export function webRtcPairTransport(
  connectorFor: (url: string) => RelayConnector,
  rtcConfig?: RTCConfiguration,
): PairTransportFactory {
  return (role, key, relayUrl) =>
    openPairingTransport({ key, role, relayUrl, connectorFor, ...(rtcConfig ? { rtcConfig } : {}) });
}

/** 已產生的配對載荷（舊機顯示 QR／字串）。 */
export interface PairingOffer {
  /** 貼給新機的字串（亦可畫成 QR）。 */
  code: string;
  /** 逾期時間（ms epoch）：到期即應停止等待、重新產生。 */
  expiresAt: number;
}

/**
 * 舊機：產生一次性載荷（`lan` 目前不使用；`relay`＝會合中繼站，新機尚無設定故由載荷告知）。
 */
export function createPairingOffer(relayUrl: string, now = Date.now()): { offer: PairingOffer; key: Uint8Array } {
  const { payload, key } = createPairing("", "webrtc", relayUrl);
  return { offer: { code: encodePairing(payload), expiresAt: now + PAIRING_TTL_MS }, key };
}

/**
 * 舊機（資料持有方）：等新機接上 → 顯示 SAS 供人工比對 → 使用者確認後送出全量捆包。
 * `confirmSas` 回 false＝拒絕（不送包）。回傳是否完成傳送。
 */
export async function runPairSource(opts: {
  key: Uint8Array;
  storage: AppStorage;
  profile: { relayUrl: string; cloudSync?: "off" | "basic" | "full"; org?: PairBundleOrg };
  /**
   * 來源身分（ADR-0118）。**私鑰不在 AppStorage 時必須傳**——Tauri 走 OS 金鑰庫、
   * 行動端不持久化 nsec、瀏覽器只存包裹過的 blob。不傳且 storage 裡也沒有 → `buildPairBundle` 拋錯。
   */
  identity?: StoredIdentity;
  transport: PairTransportFactory;
  confirmSas: (sas: string) => Promise<boolean>;
}): Promise<boolean> {
  // 先組包再連線：沒有身分就當場失敗，不要讓使用者比對完 SAS 才發現搬了個空殼。
  const bundle = buildPairBundle(opts.storage, opts.profile, opts.identity);
  const transport = await opts.transport("source", opts.key, opts.profile.relayUrl);
  return runPairingSource(transport, opts.key, bundle, opts.confirmSas);
}

/**
 * 新機（發起方）：以貼上的載荷連線 → 顯示 SAS 供使用者與舊機比對 → 收捆包並驗形狀。
 * 載荷非法、逾時、SAS 遭拒或捆包損毀皆拋錯。
 */
export async function runPairTarget(opts: {
  code: string;
  transport: PairTransportFactory;
  onSas?: (sas: string) => void;
}): Promise<PairBundle> {
  const { payload, key } = parsePairing(opts.code.trim()); // 非法載荷即拋
  // 會合中繼站由載荷指定：新機此時尚無身分與設定。
  const transport = await opts.transport("target", key, payload.relay ?? "");
  const json = await runPairingTarget(transport, key, opts.onSas);
  const bundle = parsePairBundle(json);
  if (!bundle) throw new Error("配對捆包格式不符");
  return bundle;
}
