// Release notes（ADR-0227 P4）：build-time 由 vite `define` 注入（`__RELEASES__`），
// 源自 docs/releases.json（單一雙語來源）；供設定「關於」區依語系顯示本版更新記錄。
export interface ReleaseNote {
  version: string;
  date: string;
  /** 繁體中文條目。 */
  zh: string[];
  /** 英文條目。 */
  en: string[];
}

export const RELEASES: ReleaseNote[] = __RELEASES__;

/** 取指定版本的 note；找不到回最新（第一筆）。 */
export function releaseFor(version: string): ReleaseNote | undefined {
  return RELEASES.find((r) => r.version === version) ?? RELEASES[0];
}
