// 行動端通訊後端選擇（ADR-0086）：真實 relay vs 示範。
// 真實 relay 走與桌面**同一套** RelayChatBackend＋webSocketConnector＋LocalStorage（重用 @cinder/engine）：
//   - 身分以 nsecOverride 注入（私鑰不落 localStorage；聯絡人/訊息仍持久化於 localStorage 命名空間＝pubkey）。
//   - anchors 帶入該 relay 供自動選座/回退。
// 正式行動版把 LocalStorage 換成 RN 安全儲存即可（同一 AppStorage 介面，見 ADR-0053/D2）。
import {
  ANCHOR_RELAYS,
  type AppStorage,
  type ChatBackend,
  type CloudSyncMode,
  getDeviceId,
  LocalStorage,
  MAINTAINER_PUBKEY,
  type PairBundleOrg,
  RelayChatBackend,
  type Status,
  webSocketConnector,
} from "@cinder/engine";
import type { MobileIdentity } from "./auth.js";
import { createDemoChat } from "./chat.js";

/** 預設生產中繼站（可於 UI 覆寫）。 */
export const DEFAULT_RELAY = "wss://cinder-relay.whoami885.workers.dev";

/** 建立後端的額外選項（ADR-0100 行動端補齊）。 */
export interface MobileBackendOptions {
  /** 與 App 共用的儲存（ADR-0094：保留上限/導出需同一份）。 */
  store?: AppStorage | undefined;
  /** 加密雲端備份模式（ADR-0071）；`off`／未提供＝不發佈快照。 */
  cloudSync?: CloudSyncMode | undefined;
  /** 上線時的初始狀態（ADR-0164／0168：本機記住的上次手動狀態）；未提供＝online。 */
  initialStatus?: Status | undefined;
  /** 上線時的初始自訂狀態文字（ADR-0164／0168）；未提供＝空。 */
  initialStatusMessage?: string | undefined;
  /** 建構即隱身（ADR-0180）：離職接管查看歷史時用——首拍心跳就靜默，不把離職身分廣播上線。 */
  initialInvisible?: boolean | undefined;
  /**
   * 企業身分精華（ADR-0172／0173／0176）：來自配對搬家捆包、已記住登錄，或邀請碼入職。
   * `adminPubkey` → 後端訂閱並採用公司名冊（同事、allowlist、政策、組織資訊）。
   * `orgJoinToken`（＋ `orgEscrow`）→ 開機自動向管理者提出入職（ADR-0156）／公司帳號託管私鑰
   * （ADR-0163）。入職與託管皆**冪等**（已在名冊/已託管者再送無副作用），故對搬入的成員亦帶——
   * 確保成員一定在名冊、且託管一致。（ADR-0173 原本保守排除，ADR-0176 起放開＝行動端入職所需。）
   */
  org?: PairBundleOrg | undefined;
}

/**
 * 以真實 relay 建立通訊後端（同帳號、持久化聯絡人/訊息）。
 *
 * ADR-0100：補上桌面早有、行動端缺的三項——
 *  - **錨點與簽章清單**：`anchors: ANCHOR_RELAYS` ＋ `maintainerPubkey`（過去只有 `[relayUrl]`
 *    一座、也不學帶內清單 → 該座掛掉就等於斷線、也吃不到自動改道/退役遷移）。
 *  - **多中繼路由**：`connectorFor` 讓引擎能對聯絡人的 relay hint 另開連線（ADR-0034）。
 *  - **加密雲端備份**：`cloudSync`（ADR-0071 換機還原）。
 */
export function createRelayChat(
  identity: MobileIdentity,
  relayUrl: string,
  opts: MobileBackendOptions = {},
): ChatBackend {
  const cloud =
    opts.cloudSync && opts.cloudSync !== "off"
      ? { cloudSync: { mode: opts.cloudSync, deviceId: getDeviceId() } }
      : {};
  return new RelayChatBackend(
    opts.store ?? new LocalStorage(identity.pubkey),
    webSocketConnector(relayUrl),
    identity.name,
    {
      relayUrl,
      connectorFor: webSocketConnector,
      // 錨點恆連保底：不再只綁使用者當下那一座（去重，避免同座重複）。
      anchors: [...new Set([relayUrl, ...ANCHOR_RELAYS])],
      ...(MAINTAINER_PUBKEY ? { maintainerPubkey: MAINTAINER_PUBKEY } : {}),
      ...cloud,
      // ADR-0164／0168：本機記住的上次手動狀態，讓 start() 的首次心跳就照這個廣播
      // （隱身時 App 另有攔截，不經此路徑）。缺省＝online、空文字。
      ...(opts.initialStatus ? { initialStatus: opts.initialStatus } : {}),
      ...(opts.initialStatusMessage ? { initialStatusMessage: opts.initialStatusMessage } : {}),
      ...(opts.initialInvisible ? { initialInvisible: true } : {}),
      // ADR-0173／0176：企業身分——訂閱管理者名冊＝同事/allowlist/政策/組織資訊（桌面 buildBackend 鏡像）。
      // ADR-0176：入職權杖／託管一併帶（冪等）：orgJoinToken → 開機自動入職（ADR-0156）；
      // orgEscrow → 公司帳號私鑰託管（ADR-0163，貼碼時已明示同意）。
      ...(opts.org?.adminPubkey ? { orgAdminPubkey: opts.org.adminPubkey } : {}),
      ...(opts.org?.orgJoinToken ? { orgJoinToken: opts.org.orgJoinToken } : {}),
      ...(opts.org?.orgEscrow ? { orgEscrow: true } : {}),
      // ADR-0178：企業主（orgOwner）＋核准權杖 → 後端訂自己的名冊找回狀態＋入職自動核准。
      ...(opts.org?.orgOwner ? { orgOwner: true } : {}),
      ...(opts.org?.orgInviteToken ? { orgInviteToken: opts.org.orgInviteToken } : {}),
      nsecOverride: identity.nsec,
      // ADR-0122 守衛：拿到的身分與期待不符（毀損捆包／錯 nsec）→ 大聲失敗，不靜默換人。
      // 桌面已接，行動端在 ADR-0125 補上。
      expectPubkey: identity.pubkey,
    },
  );
}

/** 依設定選後端：有 relayUrl＝真實 relay；否則示範後端（記憶體 relay＋機器人）。 */
export function createBackend(
  identity: MobileIdentity,
  relayUrl: string | null,
  opts: MobileBackendOptions = {},
): ChatBackend {
  return relayUrl ? createRelayChat(identity, relayUrl, opts) : createDemoChat(identity.name);
}
