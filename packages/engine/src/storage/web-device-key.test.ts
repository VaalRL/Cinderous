// 瀏覽器裝置金鑰保管庫（ADR-0323 後續）。
//
// 這裡驗的是**加解密與失敗方向**；IndexedDB 那層是薄接線（`idbWrapStore`），
// Node 沒有 IDB，故不在單元測試範圍——這點已在 ADR 記為未自動測試的部分。
import { describe, expect, it } from "vitest";
import { generateSecretKey, nsecEncode } from "@cinderous/core";
import { openDeviceKey, setDeviceKeyVault, deviceKeyTier } from "./device-key.js";
import { setKvBackend, type KvStore } from "../kv.js";
import { webDeviceKeyVault, type WrapStore } from "./web-device-key.js";

/** 記憶體版 WrapStore；`sabotage` 用來模擬儲存壞掉。 */
function memStore(): WrapStore & { row: { key: CryptoKey; blob: ArrayBuffer } | null } {
  const s = {
    row: null as { key: CryptoKey; blob: ArrayBuffer } | null,
    async read() {
      return s.row;
    },
    async write(key: CryptoKey, blob: ArrayBuffer) {
      s.row = { key, blob };
    },
  };
  return s;
}

const memKv = (seed: Record<string, string> = {}): KvStore & { map: Map<string, string> } => {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
};

describe("瀏覽器裝置金鑰保管庫（ADR-0323 後續）", () => {
  it("尚未存過 → load 回 null（引擎據此生一把存進來）", async () => {
    expect(await webDeviceKeyVault(memStore())!.load()).toBeNull();
  });

  it("存了再讀＝原值往返", async () => {
    const vault = webDeviceKeyVault(memStore())!;
    const nsec = nsecEncode(generateSecretKey());
    await vault.save(nsec);
    expect(await vault.load()).toBe(nsec);
  });

  it("🔴 落地的是密文——nsec 不得以任何形式出現在儲存內容裡", async () => {
    const store = memStore();
    const nsec = nsecEncode(generateSecretKey());
    await webDeviceKeyVault(store)!.save(nsec);
    const raw = new Uint8Array(store.row!.blob);
    expect(new TextDecoder().decode(raw)).not.toContain(nsec);
    expect(Array.from(raw).some((b) => b !== 0)).toBe(true); // 不是一片空的（避免假性通過）
  });

  it("🔴 包裹金鑰必須是 extractable: false——可匯出＝XSS 一樣偷得走，等於白做", async () => {
    const store = memStore();
    await webDeviceKeyVault(store)!.save(nsecEncode(generateSecretKey()));
    expect(store.row!.key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", store.row!.key)).rejects.toThrow();
  });

  it("🔴 重存必須沿用同一把包裹金鑰——換一把會讓使用者的裝置身分解不開", async () => {
    const store = memStore();
    const vault = webDeviceKeyVault(store)!;
    await vault.save(nsecEncode(generateSecretKey()));
    const first = store.row!.key;
    const nsec = nsecEncode(generateSecretKey());
    await vault.save(nsec);
    expect(store.row!.key).toBe(first);
    expect(await vault.load()).toBe(nsec);
  });

  it("每次加密的密文不同（隨機 IV）", async () => {
    const store = memStore();
    const vault = webDeviceKeyVault(store)!;
    const nsec = nsecEncode(generateSecretKey());
    await vault.save(nsec);
    const a = new Uint8Array(store.row!.blob).join(",");
    await vault.save(nsec);
    expect(new Uint8Array(store.row!.blob).join(",")).not.toBe(a);
  });

  it("環境不支援（無 store）→ 回 null，呼叫端據此不注入、維持明文並如實顯示", () => {
    expect(webDeviceKeyVault(null)).toBeNull();
  });

  it("自報 encrypted——包裹金鑰由瀏覽器保管、沒有使用者祕密參與，不得講成 keystore", async () => {
    expect(await webDeviceKeyVault(memStore())!.tier!()).toBe("encrypted");
  });

  describe("接上引擎", () => {
    it("🔴 舊的明文金鑰會被包起來並抹除，而**裝置身分不變**（不必重新授權）", async () => {
      const sk = generateSecretKey();
      const kv = memKv({ "nb.deviceKey": nsecEncode(sk) });
      setKvBackend(kv);
      const store = memStore();
      setDeviceKeyVault(webDeviceKeyVault(store));

      const key = await openDeviceKey();
      expect(nsecEncode(key.sk)).toBe(nsecEncode(sk)); // 同一把
      expect(kv.map.has("nb.deviceKey")).toBe(false); // 明文已抹除
      expect(store.row).not.toBeNull();
      expect(deviceKeyTier()).toBe("encrypted"); // 不是 keystore
      setDeviceKeyVault(null);
      setKvBackend(null);
    });

    it("🔴 儲存壞掉時落到 ephemeral（看得見），不靜默生一把新的長期金鑰", async () => {
      setKvBackend(memKv());
      const store = memStore();
      setDeviceKeyVault(
        webDeviceKeyVault({
          read: () => Promise.reject(new Error("indexeddb-open-failed")),
          write: store.write,
        }),
      );
      await openDeviceKey();
      expect(deviceKeyTier()).toBe("ephemeral");
      setDeviceKeyVault(null);
      setKvBackend(null);
    });
  });
});
