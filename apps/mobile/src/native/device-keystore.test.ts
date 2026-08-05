// 裝置金鑰保管庫的 Android 橋（ADR-0323）。
//
// 這支測試看守的是**兩個會讓保管庫白裝的方向**：
//   1. 環境不支援時卻注入 ⇒ `deviceKeyTier()` 說謊（而它存在的唯一理由就是不說謊）；
//   2. 外掛拋錯被吞掉 ⇒ 引擎以為「還沒有金鑰」而生一把新的覆蓋上去＝ADR-0122 禁止的靜默換人。
import { afterEach, describe, expect, it } from "vitest";
import { androidDeviceKeyVault, deviceKeyStoreSupported } from "./device-keystore.js";

type CapShape = { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> };

function setCap(c: CapShape | undefined): void {
  (globalThis as { Capacitor?: CapShape }).Capacitor = c as CapShape;
  if (!c) delete (globalThis as { Capacitor?: CapShape }).Capacitor;
}

const plugin = (over: Record<string, unknown> = {}) => ({
  load: async () => ({ value: "nsec1stored" }),
  save: async () => {},
  tier: async () => ({ tier: "keystore" }),
  ...over,
});

afterEach(() => setCap(undefined));

describe("Android 裝置金鑰保管庫橋（ADR-0323）", () => {
  it("非原生殼（瀏覽器預覽）→ 不支援、不注入", () => {
    setCap({ isNativePlatform: () => false, Plugins: { DeviceKeyStore: plugin() } });
    expect(deviceKeyStoreSupported()).toBe(false);
    expect(androidDeviceKeyVault()).toBeNull();
  });

  it("🔴 原生殼但外掛沒註冊 → 不注入（寧可維持明文並如實顯示，也不要假裝已保護）", () => {
    setCap({ isNativePlatform: () => true, Plugins: {} });
    expect(deviceKeyStoreSupported()).toBe(false);
    expect(androidDeviceKeyVault()).toBeNull();
  });

  it("原生殼＋外掛在 → 注入，load／save 直通", async () => {
    const saved: string[] = [];
    setCap({
      isNativePlatform: () => true,
      Plugins: { DeviceKeyStore: plugin({ save: async (o: { value: string }) => void saved.push(o.value) }) },
    });
    const vault = androidDeviceKeyVault()!;
    expect(await vault.load()).toBe("nsec1stored");
    await vault.save("nsec1new");
    expect(saved).toEqual(["nsec1new"]);
  });

  it("尚無金鑰時 load 回 null（引擎據此生一把存進來）", async () => {
    setCap({ isNativePlatform: () => true, Plugins: { DeviceKeyStore: plugin({ load: async () => ({ value: null }) }) } });
    expect(await androidDeviceKeyVault()!.load()).toBeNull();
  });

  it("🔴 外掛拋錯必須透出去，不得吞成 null——吞掉＝引擎生新金鑰把使用者換掉（ADR-0122）", async () => {
    setCap({
      isNativePlatform: () => true,
      Plugins: {
        DeviceKeyStore: plugin({
          load: async () => {
            throw new Error("device-key-undecryptable");
          },
        }),
      },
    });
    await expect(androidDeviceKeyVault()!.load()).rejects.toThrow("undecryptable");
  });

  it("🔴 等級由外掛自報——軟體 Keystore 的機型必須講 encrypted，不能一律 keystore", async () => {
    setCap({
      isNativePlatform: () => true,
      Plugins: { DeviceKeyStore: plugin({ tier: async () => ({ tier: "encrypted" }) }) },
    });
    expect(await androidDeviceKeyVault()!.tier!()).toBe("encrypted");
  });
});
