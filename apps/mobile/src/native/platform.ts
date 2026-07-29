// 執行環境判斷（ADR-0279）：這份程式碼同時跑在**瀏覽器預覽**與 **Capacitor 原生殼**裡，
// 有些說明與開關只在原生殼成立（例如 Android 系統備份的行為），得問得出來自己在哪。
//
// 偵測邏輯原本內嵌在 `foreground.ts`；備份說明也需要它，故抽到這裡共用——
// 同一件事不做兩份判斷，免得日後其中一份漏改。

/** Capacitor 執行期的最小型別（不引入 @capacitor/core 型別，以維持此檔可在純瀏覽器建置）。 */
export interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
}

/** 取執行期注入的 Capacitor 全域；非原生殼為 undefined。 */
export function capacitor(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** 是否跑在 Capacitor 原生殼裡（瀏覽器預覽／桌面皆為 false）。 */
export function isNativeShell(): boolean {
  return !!capacitor()?.isNativePlatform?.();
}
