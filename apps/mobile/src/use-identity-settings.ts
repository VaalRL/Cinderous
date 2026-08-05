// 設定頁上的「身分層開關」這一簇（ADR-0331／Phase P4 階段 1，第 3 簇）。
//
// 5 個 state：前向保密開關／解封失敗計數／入群邀請閘門／觀測到的裝置／雲端備份模式。
// 它們的共同點不是「都在設定頁」——是**都屬於這個身分**：
//
//   - `fsEnabled`／`fsFailures`：EK 屬於身分（ADR-0245／0316）。
//   - `groupInviteAnyone`：每個身分各自的隱私決定（ADR-0317）。
//   - `devices`：裝置觀測存在該身分的加密儲存（ADR-0321）。
//   - `cloudSync`：「**這個身分**的資料要不要離開裝置」（ADR-0327 才剛把它從裝置層改過來）。
//
// ## 這一簇的 reset 是「重讀」，不是「歸零」
//
// 通話簇歸零成空；企業簇以捆包精華播種；**這一簇的值全部要從新身分的後端重讀**
// （`backend.fsEnabled()`／`fsFailures()`／`groupInviteFromAnyone()`／`devices()`）與
// 該身分的登錄檔（`cloudSyncOf()`）。
//
// 🔴 歸零成空在這裡是**錯的**：使用者開過 FS 的身分切回來會顯示「未啟用」，
// 而那正是 ADR-0327 抓到的失敗類別——「重設了但值是錯的」。
// 故 `reset()` **要求**傳入種子，沒有無參數版本。

import { useState } from "react";
import type { CloudSyncMode } from "@cinderous/engine";

/** 觀測到的裝置（ADR-0321）：只取設定頁用得到的欄位，其餘由後端型別帶過。 */
export type ObservedDevice = { id: string; firstSeen: number; source: string; inDirectory?: boolean };

/** 解封失敗計數（ADR-0316）：桶名帶著「可能」，這裡沿用其語意。 */
export interface FsFailureView {
  count: number;
  lastAt: number;
}

/** 切身分時從新身分的後端／登錄檔重讀出來的值。 */
export interface IdentitySettingsSeed {
  fsEnabled: boolean;
  fsFailures: FsFailureView;
  groupInviteAnyone: boolean;
  devices: ObservedDevice[];
  cloudSync: CloudSyncMode;
}

export interface IdentitySettings {
  fsEnabled: boolean;
  fsFailures: FsFailureView;
  groupInviteAnyone: boolean;
  devices: ObservedDevice[];
  cloudSync: CloudSyncMode;

  setFsEnabled(v: boolean): void;
  /** 後端 `onFsUndecryptable`：又有一則解不開。 */
  setFsFailures(v: FsFailureView): void;
  setGroupInviteAnyone(v: boolean): void;
  /** 後端 `onDevices`，以及移除／忘記裝置之後的重讀。 */
  setDevices(list: ObservedDevice[]): void;
  setCloudSync(mode: CloudSyncMode): void;

  /**
   * 切身分：以**新身分的值**重讀。
   *
   * ⚠ 種子是必填的——這一簇沒有「歸零成空」這個選項（見檔頭）。
   */
  reset(seed: IdentitySettingsSeed): void;
}

export function useIdentitySettings(): IdentitySettings {
  const [fsEnabled, setFsEnabled] = useState(false);
  const [fsFailures, setFsFailures] = useState<FsFailureView>({ count: 0, lastAt: 0 });
  const [groupInviteAnyone, setGroupInviteAnyone] = useState(false);
  const [devices, setDevices] = useState<ObservedDevice[]>([]);
  const [cloudSync, setCloudSync] = useState<CloudSyncMode>("off");

  return {
    fsEnabled,
    fsFailures,
    groupInviteAnyone,
    devices,
    cloudSync,
    setFsEnabled,
    setFsFailures,
    setGroupInviteAnyone,
    setDevices,
    setCloudSync,
    reset: (seed) => {
      setFsEnabled(seed.fsEnabled);
      setFsFailures(seed.fsFailures);
      setGroupInviteAnyone(seed.groupInviteAnyone);
      setDevices(seed.devices);
      setCloudSync(seed.cloudSync);
    },
  };
}
