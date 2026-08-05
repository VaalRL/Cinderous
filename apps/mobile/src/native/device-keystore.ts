// 裝置金鑰保管庫的 Android 橋（ADR-0323）。
//
// ADR-0322 的撤銷要成立，前提是被移除那台的**裝置私鑰拿不到**。行動端在此之前把它明文放在
// KV 裡 ⇒ 磁碟被複製即可繞過撤銷。這裡把它接到 `DeviceKeyStorePlugin`（AndroidKeyStore）。
//
// 🔴 **不支援的環境（瀏覽器預覽、外掛沒註冊）就不要裝**——裝了會讓 `deviceKeyTier()` 說謊，
// 而它存在的唯一理由就是不說謊（ADR-0297 §6 紅線）。不裝＝維持明文 KV，設定頁如實顯示。

import type { DeviceKeyVault } from "@cinderous/engine";
import { capacitor, isNativeShell } from "./platform.js";

/** 本檔用到的外掛形狀（原生殼判斷共用 `platform.ts`，不在此重複一份）。 */
interface DeviceKeyStorePlugin {
  load(): Promise<{ value: string | null }>;
  save(o: { value: string }): Promise<void>;
  tier(): Promise<{ tier: "keystore" | "encrypted" }>;
}

function cap(): { Plugins?: { DeviceKeyStore?: DeviceKeyStorePlugin } } | undefined {
  return capacitor() as { Plugins?: { DeviceKeyStore?: DeviceKeyStorePlugin } } | undefined;
}

/** 此環境是否有硬體保管庫可用（＝Capacitor 原生殼且外掛在）。 */
export function deviceKeyStoreSupported(): boolean {
  return isNativeShell() && !!cap()?.Plugins?.DeviceKeyStore;
}

/**
 * 取 Android 保管庫；不支援的環境回 null（呼叫端據此**不注入**，維持明文並如實顯示）。
 *
 * ⚠ 這裡刻意**不 catch**：外掛拋錯（例如有密文卻解不開）必須讓 `openDeviceKey()` 收到，
 * 它會落到 `ephemeral`——看得見的失敗。吞掉會變成「靜默生一把新的把使用者換掉」（ADR-0122）。
 */
export function androidDeviceKeyVault(): DeviceKeyVault | null {
  const plugin = cap()?.Plugins?.DeviceKeyStore;
  if (!deviceKeyStoreSupported() || !plugin) return null;
  return {
    load: async () => (await plugin.load()).value,
    save: async (nsec) => void (await plugin.save({ value: nsec })),
    tier: async () => (await plugin.tier()).tier,
  };
}
