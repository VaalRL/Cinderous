// 雲端備份的範圍：裝置層 → 身分層（ADR-0327）。
//
// 修的是一個**兩端語意不一致**：桌面一向把 `cloudSync` 存在該身分的 profile 裡，
// 行動端卻是全域 `nb.cloudSync` ⇒ 在手機上，工作身分開了備份，個人身分也跟著開著，
// 而那正是「這個身分的資料要不要離開裝置」的開關。
import { beforeEach, describe, expect, it } from "vitest";
import { loadProfiles, saveProfiles, setKvBackend, type KvStore } from "@cinderous/engine";
import { cloudSyncOf, loadIdentities, migrateLegacyCloudSync, saveCloudSyncFor } from "./identities.js";

const memKv = (seed: Record<string, string> = {}): KvStore & { map: Map<string, string> } => {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
};

const profile = (pubkey: string) => ({ pubkey, name: pubkey, relayUrl: "wss://r", enterprise: false, namespace: pubkey });

/** 兩個身分的登錄檔，兩者都沒設過備份模式（＝升級前的狀態）。 */
function seedTwoIdentities(kv: KvStore): void {
  setKvBackend(kv);
  saveProfiles({ profiles: [profile("work"), profile("personal")], active: "work" });
}

describe("雲端備份範圍（ADR-0327）", () => {
  beforeEach(() => setKvBackend(null));

  it("每個身分各一份，互不影響", () => {
    const kv = memKv();
    seedTwoIdentities(kv);
    saveCloudSyncFor("work", "full");
    expect(cloudSyncOf("work")).toBe("full");
    expect(cloudSyncOf("personal")).toBe("off"); // 🔴 這正是修這件事的理由
  });

  it("沒設過＝off（安全側：不預設把資料送上雲）", () => {
    const kv = memKv();
    seedTwoIdentities(kv);
    expect(cloudSyncOf("personal")).toBe("off");
  });

  describe("由裝置層遷移", () => {
    it("🔴 舊值是 full → 兩個身分都接手，**沒有人的備份被靜默停掉**", () => {
      const kv = memKv({ "nb.cloudSync": "full" });
      seedTwoIdentities(kv);
      migrateLegacyCloudSync();
      expect(cloudSyncOf("work")).toBe("full");
      expect(cloudSyncOf("personal")).toBe("full"); // 遷移前它們本來就共用同一個值
      expect(kv.map.has("nb.cloudSync")).toBe(false); // 舊鍵已清，不留兩個真實來源
    });

    it("🔴 舊值是 off → **不寫入**，留 undefined 讓「還原時接續備份習慣」仍然有效", () => {
      const kv = memKv({ "nb.cloudSync": "off" });
      seedTwoIdentities(kv);
      migrateLegacyCloudSync();
      expect(loadProfiles().profiles.every((p) => p.cloudSync === undefined)).toBe(true);
      expect(kv.map.has("nb.cloudSync")).toBe(false);
    });

    it("已經設過的身分不被舊值覆蓋（使用者較新的選擇優先）", () => {
      const kv = memKv({ "nb.cloudSync": "full" });
      seedTwoIdentities(kv);
      saveCloudSyncFor("personal", "off");
      migrateLegacyCloudSync();
      expect(cloudSyncOf("work")).toBe("full");
      expect(cloudSyncOf("personal")).toBe("off");
    });

    it("遷移後新建立的身分預設 off——不再繼承上一個身分的選擇（這就是要修的東西）", () => {
      const kv = memKv({ "nb.cloudSync": "full" });
      seedTwoIdentities(kv);
      migrateLegacyCloudSync();
      saveProfiles({ ...loadProfiles(), profiles: [...loadProfiles().profiles, profile("new")] });
      expect(cloudSyncOf("new")).toBe("off");
    });

    it("可重入：跑第二次不會把已改成 off 的身分改回來", () => {
      const kv = memKv({ "nb.cloudSync": "full" });
      seedTwoIdentities(kv);
      migrateLegacyCloudSync();
      saveCloudSyncFor("work", "off");
      migrateLegacyCloudSync();
      expect(cloudSyncOf("work")).toBe("off");
    });

    it("🔴 `loadIdentities()` 會觸發遷移——同一件事只有一個入口，不必各處記得呼叫", () => {
      const kv = memKv({ "nb.cloudSync": "basic" });
      seedTwoIdentities(kv);
      loadIdentities("wss://r");
      expect(cloudSyncOf("work")).toBe("basic");
      expect(kv.map.has("nb.cloudSync")).toBe(false);
    });
  });
});
