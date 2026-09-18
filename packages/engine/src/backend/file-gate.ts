// 大檔走 TURN 的把關（ADR-0344 §後續行動 1）。
//
// ## 這是 ADR-0344 的目的，不是附帶功能
//
// ADR-0243 核可公共 TURN 的成本論證是**以通話為基礎**的（雙向 ~80 kbps，10 分鐘語音
// ≈ 6 MB）。但檔案與通話**共用同一組 ICE 設定**（`webrtc.ts` 的 `rtcConfig`，內含 TURN
// 伺服器），檔案因此走得上同一條管子，而檔案沒有「頻寬很低」
// 這回事——一個 500 MB 的檔就是 500 MB 的計費流量，一次。ADR-0342 §2 已自承「真正把
// 上限釘死的只有帳單警示」⇒ 這條路徑在客戶端**零閘門**。
//
// ADR-0344 先做到「分辨得出自己在哪條路上」；這裡是把那個判定真正用起來的地方。
//
// ## 提示，不是封鎖
//
// 門檻到了只**提示**並讓使用者決定，不擋。理由與 ADR-0210／0213 同一條：這不是錯誤，
// 檔案真的送得出去，只是慢且耗中繼流量——把它做成阻擋，就是替使用者決定他的檔案不重要。
//
// ## `unknown` 保守當成 relay，但**話要說得不一樣**
//
// 判不出來時仍然提示（把關情境保守，見 ADR-0344 §決策二）。但提示的文案必須誠實區分
// 「確定在中繼上」與「不知道在哪」——把後者說成前者就是假警報，而 ADR-0210 拿掉全域
// P2P 錯誤提示正是因為假警報會讓使用者不再相信提示。故 `path` 隨警告一起回傳。

import type { IcePath } from "./ice-path.js";

/**
 * 走中繼時提示的檔案大小門檻（位元組）。
 *
 * 50 MB 的取捨：低於既有的 `DEFAULT_MAX_FILE_SIZE`（100 MiB）故兩者不打架；而日常的
 * 照片、語音、文件都遠在門檻之下 ⇒ 一般使用者不會看到這個提示，看到就代表真的是大檔。
 */
export const RELAY_FILE_WARN_BYTES = 50 * 1024 * 1024;

export interface RelayFileWarning {
  /** 觸發提示的檔案大小（位元組）；由 UI 自行格式化。 */
  sizeBytes: number;
  /**
   * 為什麼提示：
   * - `relay`＝**確定**位元組正經 TURN 中繼轉送。
   * - `unknown`＝判不出來（尚未探測、舊 webview、或通道還沒開）。保守提示，但文案要
   *   說成「無法確認」而非「正在中繼上」——見檔頭。
   */
  path: "relay" | "unknown";
}

/**
 * 一個收件對象的路徑是否值得提示。`direct` 一律不提示（多大都不關中繼的事）。
 */
export function relayFileWarning(
  sizeBytes: number,
  path: IcePath,
  threshold = RELAY_FILE_WARN_BYTES,
): RelayFileWarning | null {
  if (path === "direct") return null;
  if (sizeBytes <= threshold) return null;
  return { sizeBytes, path };
}

/**
 * 多個收件對象（群組扇出，ADR-0124）合議出一個提示。
 *
 * **任一對象走中繼就提示**——群組是逐一扇出的，一個成員在 TURN 上就是一份完整的計費
 * 流量。`relay` 優先於 `unknown`：確定的事實比「不知道」更值得拿來說。
 */
export function relayFileWarningFor(
  sizeBytes: number,
  paths: readonly IcePath[],
  threshold = RELAY_FILE_WARN_BYTES,
): RelayFileWarning | null {
  const warnings = paths
    .map((p) => relayFileWarning(sizeBytes, p, threshold))
    .filter((w): w is RelayFileWarning => w !== null);
  if (warnings.length === 0) return null;
  return warnings.find((w) => w.path === "relay") ?? warnings[0]!;
}

/**
 * 位元組的人類可讀大小。放在引擎是因為**桌面與行動端各有一份一模一樣的實作**，
 * 而這裡的提示文案又要用同一個格式——三份會漂移。
 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
