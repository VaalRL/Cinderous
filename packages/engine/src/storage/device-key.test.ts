// 裝置金鑰的保管基質與遷移（ADR-0323）。
//
// 這支測試的重點不是「能不能存取金鑰」，而是**兩個會讓 ADR-0322 的撤銷變成演戲的失敗方向**：
//   1. 遷移把明文留在磁碟上（或反過來，先刪明文再存檔失敗 ⇒ 裝置身分蒸發）；
//   2. 金鑰庫打不開時靜默生一把新的**長期**金鑰——ADR-0122 在身分金鑰上禁止過的事。
import { beforeEach, describe, expect, it } from "vitest";
import { nsecDecode, nsecEncode, generateSecretKey, getPublicKey } from "@cinderous/core";
import { setKvBackend, type KvStore } from "../kv.js";
import {
  deviceKeyEverPlaintext,
  deviceKeyTier,
  getDeviceKey,
  openDeviceKey,
  setDeviceKeyVault,
  type DeviceKeyVault,
} from "./device-key.js";

const KEY = "nb.deviceKey";

function memKv(seed: Record<string, string> = {}): KvStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** 記憶體金鑰庫；`fail` 模擬 Linux 沒有 Secret Service 之類的情形。 */
function memVault(seed?: string, fail?: "load" | "save"): DeviceKeyVault & { held: string | null } {
  const v = {
    held: seed ?? null,
    async load() {
      if (fail === "load") throw new Error("keyring unavailable");
      return v.held;
    },
    async save(nsec: string) {
      if (fail === "save") throw new Error("keyring locked");
      v.held = nsec;
    },
  };
  return v;
}

describe("裝置金鑰保管基質（ADR-0323）", () => {
  beforeEach(() => {
    setDeviceKeyVault(null);
    setKvBackend(memKv());
  });

  it("沒裝金鑰庫＝今天的行為：存 KV、據實回報 plaintext", async () => {
    const kv = memKv();
    setKvBackend(kv);
    const key = await openDeviceKey();
    expect(kv.map.get(KEY)).toBeTruthy();
    expect(getPublicKey(nsecDecode(kv.map.get(KEY)!))).toBe(key.pk);
    expect(deviceKeyTier()).toBe("plaintext");
  });

  it("金鑰庫已有 → 直接用，且不落 KV", async () => {
    const sk = generateSecretKey();
    const kv = memKv();
    setKvBackend(kv);
    setDeviceKeyVault(memVault(nsecEncode(sk)));
    expect((await openDeviceKey()).pk).toBe(getPublicKey(sk));
    expect(kv.map.has(KEY)).toBe(false);
    expect(deviceKeyTier()).toBe("keystore");
    expect(deviceKeyEverPlaintext()).toBe(false);
  });

  it("金鑰庫空 → 生一把存進去，從未明文落盤", async () => {
    const kv = memKv();
    setKvBackend(kv);
    const vault = memVault();
    setDeviceKeyVault(vault);
    const key = await openDeviceKey();
    expect(getPublicKey(nsecDecode(vault.held!))).toBe(key.pk);
    expect(kv.map.has(KEY)).toBe(false);
    expect(deviceKeyEverPlaintext()).toBe(false);
  });

  describe("由明文遷入金鑰庫（同 ADR-0053 B5 對身分私鑰的做法）", () => {
    it("🔴 搬進金鑰庫、抹除 KV 明文，而且**裝置身分不變**（否則要重新授權）", async () => {
      const sk = generateSecretKey();
      const kv = memKv({ [KEY]: nsecEncode(sk) });
      setKvBackend(kv);
      const vault = memVault();
      setDeviceKeyVault(vault);

      expect((await openDeviceKey()).pk).toBe(getPublicKey(sk)); // 同一把 ⇒ 仍在裝置目錄裡
      expect(vault.held).toBe(nsecEncode(sk));
      expect(kv.map.has(KEY)).toBe(false); // 明文已抹除
      expect(deviceKeyTier()).toBe("keystore");
    });

    it("🔴 曾經明文躺過就要記著——設定頁不得宣稱它一直受金鑰庫保護", async () => {
      const kv = memKv({ [KEY]: nsecEncode(generateSecretKey()) });
      setKvBackend(kv);
      setDeviceKeyVault(memVault());
      await openDeviceKey();
      expect(deviceKeyEverPlaintext()).toBe(true);
    });

    it("🔴 存檔失敗時**不得**已經把明文刪掉——不然這台的裝置身分就蒸發了", async () => {
      const sk = generateSecretKey();
      const kv = memKv({ [KEY]: nsecEncode(sk) });
      setKvBackend(kv);
      setDeviceKeyVault(memVault(undefined, "save"));

      await openDeviceKey();
      expect(kv.map.get(KEY)).toBe(nsecEncode(sk)); // 還在 ⇒ 下次開機還救得回來
      expect(deviceKeyTier()).toBe("ephemeral"); // 而且這次開機的狀態是看得見的
    });
  });

  describe("金鑰庫打不開", () => {
    it("🔴 不靜默生一把新的長期金鑰落地（ADR-0122 在身分金鑰上禁止過的事）", async () => {
      const kv = memKv();
      setKvBackend(kv);
      setDeviceKeyVault(memVault(undefined, "load"));

      await openDeviceKey();
      expect(kv.map.has(KEY)).toBe(false); // 沒有偷偷退回明文落盤
      expect(deviceKeyTier()).toBe("ephemeral");
    });

    it("🔴 回報 ephemeral 時，同步取用必須拿到**同一把**（否則說明跟實際用的不是一回事）", async () => {
      setDeviceKeyVault(memVault(undefined, "load"));
      const key = await openDeviceKey();
      expect(getDeviceKey().pk).toBe(key.pk);
    });
  });

  describe("保管庫自報等級（Android 可能只有軟體 Keystore）", () => {
    it("🔴 保管庫說 encrypted 就是 encrypted——不得因為「有金鑰庫」就一律講 keystore", async () => {
      const v = memVault();
      setDeviceKeyVault({ ...v, tier: async () => "encrypted" });
      await openDeviceKey();
      expect(deviceKeyTier()).toBe("encrypted");
    });

    it("遷移路徑也套用自報等級（別只修其中一條分支）", async () => {
      setKvBackend(memKv({ [KEY]: nsecEncode(generateSecretKey()) }));
      const v = memVault();
      setDeviceKeyVault({ ...v, tier: async () => "encrypted" });
      await openDeviceKey();
      expect(deviceKeyTier()).toBe("encrypted");
    });

    it("不實作 tier() → 視為 keystore（桌面 OS 金鑰庫）", async () => {
      setDeviceKeyVault(memVault());
      await openDeviceKey();
      expect(deviceKeyTier()).toBe("keystore");
    });
  });

  it("openDeviceKey 可重入：第二次回同一把，不會再生一把", async () => {
    setDeviceKeyVault(memVault());
    const a = await openDeviceKey();
    expect((await openDeviceKey()).pk).toBe(a.pk);
    expect(getDeviceKey().pk).toBe(a.pk);
  });

  it("🔴 換基質必須清快取——否則會拿到上一個基質的金鑰", async () => {
    setDeviceKeyVault(memVault(nsecEncode(generateSecretKey())));
    const first = await openDeviceKey();
    setDeviceKeyVault(memVault(nsecEncode(generateSecretKey())));
    expect((await openDeviceKey()).pk).not.toBe(first.pk);
  });

  it("沒 await openDeviceKey 就同步取用 → 走 KV，而 tier 據實說 plaintext（不吹噓）", () => {
    const kv = memKv();
    setKvBackend(kv);
    setDeviceKeyVault(memVault(nsecEncode(generateSecretKey())));
    const key = getDeviceKey();
    expect(getPublicKey(nsecDecode(kv.map.get(KEY)!))).toBe(key.pk);
    expect(deviceKeyTier()).toBe("plaintext");
  });
});
