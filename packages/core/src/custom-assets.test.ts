import { describe, expect, it } from "vitest";
import { contentHash } from "./event.js";
import {
  ASSET_MANIFEST_MAX_COUNT,
  ASSET_MANIFEST_PREFIX,
  acquireAssets,
  activeEmojiQuery,
  appendAssetManifest,
  assetFromManifestEntry,
  assetManifestBytes,
  collectReferencedShortcodes,
  formatAssetManifest,
  isValidShortcode,
  parseAssetManifest,
  resolveInlineEmoji,
  splitAssetManifest,
  type AssetManifest,
  type CustomAsset,
} from "./custom-assets.js";

const smiley =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#ffd84d"/></svg>';
const heart =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 82 C10 54 22 22 50 40 C78 22 90 54 50 82 Z" fill="#e8567a"/></svg>';

describe("短碼合法性（ADR-0220）", () => {
  it("接受 Slack 風格短碼", () => {
    for (const c of ["party", "party_blob", "a", "x1", "up-vote", "c+"]) {
      expect(isValidShortcode(c), c).toBe(true);
    }
  });
  it("拒收空白/含冒號/空格/開頭符號/超長/中文", () => {
    for (const c of ["", ":party:", "has space", "_lead", "-lead", "a".repeat(33), "派對"]) {
      expect(isValidShortcode(c), c).toBe(false);
    }
  });
});

describe("資產清單 format / parse（nb-assets:v1）", () => {
  it("round-trip 保留合法筆、夾住標籤", () => {
    const manifest: AssetManifest = {
      party: { label: "  派對  ", svg: smiley },
      love: { label: "愛心", svg: heart },
    };
    const s = formatAssetManifest(manifest);
    expect(s.startsWith(ASSET_MANIFEST_PREFIX)).toBe(true);
    expect(parseAssetManifest(s)).toEqual({
      party: { label: "派對", svg: smiley },
      love: { label: "愛心", svg: heart },
    });
  });

  it("丟棄非法 SVG 與非法短碼鍵，保留合法筆", () => {
    const raw =
      ASSET_MANIFEST_PREFIX +
      JSON.stringify({
        ok: { label: "好", svg: smiley },
        evil: { label: "壞", svg: '<svg onload="x()"></svg>' },
        "bad key": { label: "鍵不合法", svg: heart },
        missing: { label: "缺 svg" },
      });
    expect(parseAssetManifest(raw)).toEqual({ ok: { label: "好", svg: smiley } });
  });

  it("非法 JSON / 非物件回傳空清單", () => {
    expect(parseAssetManifest(ASSET_MANIFEST_PREFIX + "{壞")).toEqual({});
    expect(parseAssetManifest(ASSET_MANIFEST_PREFIX + "[1,2]")).toEqual({});
    expect(parseAssetManifest("不是清單")).toEqual({});
  });

  it("超過數量上限只保留前 N 筆", () => {
    const big: Record<string, { label: string; svg: string }> = {};
    for (let i = 0; i < ASSET_MANIFEST_MAX_COUNT + 5; i++) big[`e${i}`] = { label: `${i}`, svg: smiley };
    const parsed = parseAssetManifest(ASSET_MANIFEST_PREFIX + JSON.stringify(big));
    expect(Object.keys(parsed).length).toBe(ASSET_MANIFEST_MAX_COUNT);
  });
});

describe("文字 append / split 清單", () => {
  it("append 後可 split 還原（文字＋清單）", () => {
    const manifest: AssetManifest = { party: { label: "派對", svg: smiley } };
    const text = "嗨 :party: 你好";
    const content = appendAssetManifest(text, manifest);
    expect(content).toContain(`\n${ASSET_MANIFEST_PREFIX}`);
    expect(splitAssetManifest(content)).toEqual({ text, manifest });
  });

  it("空清單不留痕跡", () => {
    expect(appendAssetManifest("純文字", {})).toBe("純文字");
    expect(splitAssetManifest("純文字")).toEqual({ text: "純文字", manifest: {} });
  });

  it("尾端像清單但無效者整段視為文字", () => {
    const content = "看這個 nb-assets:v1:壞掉";
    expect(splitAssetManifest(content)).toEqual({ text: content, manifest: {} });
  });
});

describe("行內 :shortcode: 解析為片段", () => {
  const resolve = (code: string) =>
    code === "party" ? { label: "派對", svg: smiley } : code === "love" ? { label: "愛心", svg: heart } : undefined;

  it("解析命中者為 emoji、相鄰文字合併、未命中留字面", () => {
    expect(resolveInlineEmoji("嗨 :party: 這個 :nope: 好", resolve)).toEqual([
      { type: "text", value: "嗨 " },
      { type: "emoji", shortcode: "party", label: "派對", svg: smiley },
      { type: "text", value: " 這個 :nope: 好" },
    ]);
  });

  it("相連兩顆 emoji 之間無空文字", () => {
    expect(resolveInlineEmoji(":party::love:", resolve)).toEqual([
      { type: "emoji", shortcode: "party", label: "派對", svg: smiley },
      { type: "emoji", shortcode: "love", label: "愛心", svg: heart },
    ]);
  });

  it("純文字（無短碼）單一片段", () => {
    expect(resolveInlineEmoji("完全沒有短碼", resolve)).toEqual([{ type: "text", value: "完全沒有短碼" }]);
  });

  it("收集引用短碼：依序、去重", () => {
    expect(collectReferencedShortcodes("a :party: b :love: c :party:")).toEqual(["party", "love"]);
  });
});

describe("由清單造 CustomAsset 與位元組計量", () => {
  it("assetFromManifestEntry：id＝內容雜湊、kind emoji、帶短碼、夾標籤", () => {
    const asset = assetFromManifestEntry("party", { label: "  派對 ", svg: smiley });
    expect(asset).toEqual({ id: contentHash(smiley), label: "派對", svg: smiley, kind: "emoji", shortcode: "party" });
  });

  it("assetManifestBytes 反映序列化長度", () => {
    const manifest: AssetManifest = { party: { label: "派對", svg: smiley } };
    expect(assetManifestBytes(manifest)).toBe(new TextEncoder().encode(formatAssetManifest(manifest)).length);
  });
});

describe("收到自動收藏＋LRU 淘汰（acquireAssets）", () => {
  const asset = (id: string, extra: Partial<CustomAsset> = {}): CustomAsset => ({
    id,
    label: id,
    svg: smiley,
    kind: "emoji",
    ...extra,
  });

  it("新資產置於前端（最新在前）", () => {
    const lib = [asset("a"), asset("b")];
    const out = acquireAssets(lib, [asset("c")], { max: 10 });
    expect(out.map((a) => a.id)).toEqual(["c", "a", "b"]);
  });

  it("同 id 移到最前並刷新、不重複", () => {
    const lib = [asset("a"), asset("b", { label: "舊" })];
    const out = acquireAssets(lib, [asset("b", { label: "新" })], { max: 10 });
    expect(out.map((a) => a.id)).toEqual(["b", "a"]);
    expect(out[0]?.label).toBe("新");
  });

  it("超過 max 從尾端淘汰未受保護者", () => {
    const lib = [asset("a"), asset("b"), asset("c")];
    const out = acquireAssets(lib, [asset("d")], { max: 3 });
    expect(out.map((a) => a.id)).toEqual(["d", "a", "b"]); // c（最舊）被淘汰
  });

  it("受保護者（最愛/自建）永不淘汰，即使超過 max", () => {
    const lib = [asset("a"), asset("b"), asset("fav", { kind: "sticker" })];
    const out = acquireAssets(lib, [asset("d")], {
      max: 2,
      protect: (a) => a.id === "fav",
    });
    expect(out.map((a) => a.id).sort()).toEqual(["d", "fav"].sort());
    expect(out.map((a) => a.id)).toContain("fav");
  });

  it("全受保護時可超過 max（不淘汰）", () => {
    const lib = [asset("a"), asset("b")];
    const out = acquireAssets(lib, [asset("c")], { max: 1, protect: () => true });
    expect(out).toHaveLength(3);
  });

  it("純函式：不變更輸入陣列", () => {
    const lib = [asset("a")];
    const snapshot = [...lib];
    acquireAssets(lib, [asset("b")], { max: 10 });
    expect(lib).toEqual(snapshot);
  });
});

describe("行內 : 自動補全的作用中短碼（activeEmojiQuery）", () => {
  it("抓文字尾端正在打的 :query", () => {
    expect(activeEmojiQuery("嗨 :par")).toEqual({ query: "par", start: 2 });
    expect(activeEmojiQuery(":smile")).toEqual({ query: "smile", start: 0 });
    expect(activeEmojiQuery("(:cat")).toEqual({ query: "cat", start: 1 });
  });

  it("結尾已是完整 :shortcode:（含結尾冒號）不再補全", () => {
    expect(activeEmojiQuery("嗨 :party:")).toBeNull();
  });

  it("避免誤觸：時間 10:30、單字內 a:b、空 : 皆不補全", () => {
    expect(activeEmojiQuery("時間 10:30")).toBeNull();
    expect(activeEmojiQuery("email a:b")).toBeNull();
    expect(activeEmojiQuery("嗨 :")).toBeNull();
  });

  it("只認尾端片段（前面已完成者不影響）", () => {
    expect(activeEmojiQuery(":done: 再打 :ne")).toEqual({ query: "ne", start: 10 });
  });
});
