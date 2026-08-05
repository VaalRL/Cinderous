// 企業這一簇的 state（ADR-0331／Phase P4 階段 1，第 2 簇）。
//
// 8 個 state：是不是企業身分／企業主 pubkey／是不是企業主／核准權杖／託管清單／
// 儲存槽佇列／自報頭銜／公司政策。全部都是**「該身分的公司」**的東西——
// 切身分不歸零，個人身分就會看到工作身分的公司 UI（ADR-0294 §2 的病灶）。
//
// ## 邊界：state 在這裡，閉包留在呼叫端
//
// 這一簇比通話那簇糾纏：託管要用**企業主自己的 sk** 加密落盤、歡迎詞要 keyed by 身分。
// 那些值住在 `signInWith` 的閉包裡。
//
// 🔴 **刻意不把 sk 搬進來**：hook 只管「有哪些欄位、怎麼改、怎麼歸零」，
// 加密與落盤留在呼叫端。多一個地方持有金鑰材料，就多一個地方要證明它沒外洩——
// 為了整齊而搬，划不來。故託管與佇列以 **updater** 形式暴露（`updateEscrow`／`updateSlots`），
// 呼叫端在 updater 裡做自己的落盤。
//
// ## reset 帶種子，不是歸零
//
// 通話簇 `reset()` 是純歸零；這簇不是——切過去要**以新身分的 org 精華重新播種**
// （企業旗標、企業主 pubkey、核准權杖、該身分的託管清單、已廣播的頭銜）。
// ADR-0327 的教訓正是這個：「重設了但值是錯的」是獨立的一類失敗，
// 歸零成空與重讀成新身分的值，兩者不能混為一談。

import { useState } from "react";
import type { OrgPolicy, PairBundleOrg } from "@cinderous/engine";
import type { EscrowEntry } from "./org-escrow.js";
import type { MobileSlotItem } from "./slot-queue.js";

/** 切身分時用來播種的東西（皆可省略＝一般個人身分）。 */
export interface OrgSeed {
  /** 配對搬家捆包／登錄檔帶來的公司精華（ADR-0172／0176）。 */
  org?: PairBundleOrg | undefined;
  /** 這個身分已廣播過的頭銜（ADR-0170，供設定頁預填）。 */
  title?: string;
  /** 這個身分的託管清單（ADR-0179，企業主才有；解密由呼叫端負責）。 */
  escrow?: EscrowEntry[];
}

export interface OrgSession {
  /** 企業或企業主身分（ADR-0172）：決定要不要顯示企業專屬 UI。 */
  enterprise: boolean;
  /** 企業主 pubkey（ADR-0177）：公司儲存槽的存放對象。 */
  admin: string | null;
  /** 我就是企業主（ADR-0178）：設定頁顯示「組織名冊」入口。 */
  owner: boolean;
  /** 企業主的核准權杖（ADR-0156）：嵌入邀請碼給員工。 */
  inviteToken: string | null;
  /** 入職金鑰託管清單（ADR-0163／0179，企業主端）。 */
  escrow: EscrowEntry[];
  /** 公司儲存槽佇列（ADR-0161／0177，員工端）。 */
  slots: MobileSlotItem[];
  /** 企業自報頭銜（ADR-0158／0170）。 */
  title: string;
  /** 公司政策（ADR-0048／0311）：UI 閘門旗標。 */
  policy: OrgPolicy;

  /** 後端 `onPolicy`：引擎採用簽章名冊時送來。 */
  setPolicy(p: OrgPolicy): void;
  /**
   * 後端 `onOrgInfo`：**實際會員身分確認**（ADR-0173）——比捆包旗標更穩健的設閘訊號。
   * 只升不降：確認過就是企業身分，直到切身分才由 `reset()` 依新種子重來。
   */
  markEnterprise(): void;
  /** 改託管清單；**落盤（加密）由呼叫端在 updater 裡做**（見檔頭的邊界說明）。 */
  updateEscrow(fn: (list: EscrowEntry[]) => EscrowEntry[]): void;
  /** 改儲存槽佇列。 */
  updateSlots(fn: (queue: MobileSlotItem[]) => MobileSlotItem[]): void;
  setTitle(t: string): void;

  /**
   * 切身分：歸零並以新身分的種子重新播種。
   *
   * ⚠ 不是「全部設成空」——`escrow`／`title` 要換成**這個身分的**值。
   * 把它當純歸零用，會讓企業主切回來時看不到自己的託管清單。
   */
  reset(seed?: OrgSeed): void;
}

export function useOrgSession(): OrgSession {
  const [enterprise, setEnterprise] = useState(false);
  const [admin, setAdmin] = useState<string | null>(null);
  const [owner, setOwner] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [escrow, setEscrow] = useState<EscrowEntry[]>([]);
  const [slots, setSlots] = useState<MobileSlotItem[]>([]);
  const [title, setTitle] = useState("");
  const [policy, setPolicy] = useState<OrgPolicy>({});

  return {
    enterprise,
    admin,
    owner,
    inviteToken,
    escrow,
    slots,
    title,
    policy,
    setPolicy,
    markEnterprise: () => setEnterprise(true),
    updateEscrow: setEscrow,
    updateSlots: setSlots,
    setTitle,
    reset: (seed) => {
      const org = seed?.org;
      setEnterprise(!!(org?.enterprise || org?.orgOwner));
      setAdmin(org?.adminPubkey ?? null);
      setOwner(!!org?.orgOwner);
      setInviteToken(org?.orgInviteToken ?? null);
      setEscrow(seed?.escrow ?? []);
      setSlots([]); // session 內的待傳佇列，不跨身分也不跨重啟
      setTitle(seed?.title ?? "");
      setPolicy({});
    },
  };
}
