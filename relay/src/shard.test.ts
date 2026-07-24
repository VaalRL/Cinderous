import { describe, expect, it } from "vitest";
import {
  LEGACY_GLOBAL_NAME,
  messageShardName,
  PRESENCE_LAYER_NAME,
  shardNameForPath,
  shardPath,
  shardPrefix,
} from "./shard.js";

describe("分片路由計算（ADR-0241）", () => {
  it("shardPrefix：取 pubkey 高 nibble（16 片）", () => {
    expect(shardPrefix("ab".repeat(32))).toBe("a");
    expect(shardPrefix("00" + "ff".repeat(31))).toBe("0");
    expect(shardPrefix("F0".repeat(32))).toBe("f"); // 大寫正規化
  });

  it("shardPrefix：非法/空 → '0'（安全預設、不丟事件）", () => {
    expect(shardPrefix(undefined)).toBe("0");
    expect(shardPrefix("")).toBe("0");
    expect(shardPrefix("zz")).toBe("0"); // 非 hex
  });

  it("messageShardName / shardPath：由收件人 pubkey 直接算（免 hint）", () => {
    const pk = "3c".repeat(32);
    expect(messageShardName(pk)).toBe("shard-3");
    expect(shardPath(pk)).toBe("/s/3");
  });

  it("收件匣天然同片：同一 pubkey 的訊息片與訂閱片一致", () => {
    const me = "d4".repeat(32);
    // 我的訊息 #p:我 → shard(我)；我訂閱 #p:我 也連 shard(我)
    expect(messageShardName(me)).toBe(`shard-${shardPrefix(me)}`);
    expect(shardNameForPath(shardPath(me))).toBe(messageShardName(me));
  });

  describe("shardNameForPath：worker 依路徑選 DO", () => {
    it("/s/<prefix> → 訊息片", () => {
      expect(shardNameForPath("/s/a")).toBe("shard-a");
      expect(shardNameForPath("/s/0/")).toBe("shard-0"); // 容忍尾斜線
      expect(shardNameForPath("/s/F")).toBe("shard-f"); // 大寫正規化
    });
    it("/presence → presence 層", () => {
      expect(shardNameForPath("/presence")).toBe(PRESENCE_LAYER_NAME);
      expect(shardNameForPath("/presence/")).toBe(PRESENCE_LAYER_NAME);
    });
    it("/（及未知路徑）→ 舊全域（遷移回退）", () => {
      expect(shardNameForPath("/")).toBe(LEGACY_GLOBAL_NAME);
      expect(shardNameForPath("")).toBe(LEGACY_GLOBAL_NAME);
      expect(shardNameForPath("/s/zz")).toBe(LEGACY_GLOBAL_NAME); // 非法前綴不當分片
      expect(shardNameForPath("/s/ab")).toBe(LEGACY_GLOBAL_NAME); // 多字元非單 nibble
    });
  });
});
