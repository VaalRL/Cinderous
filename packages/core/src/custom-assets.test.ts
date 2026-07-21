import { describe, expect, it } from "vitest";
import { contentHash } from "./event.js";
import { ASSET_CHUNK_CHARS, ASSET_CHUNK_MAX_TOTAL, BLOB_MAX_BYTES, splitAssetChunks } from "./asset-relay.js";
import {
  ASSET_MANIFEST_MAX_COUNT,
  ASSET_MANIFEST_PREFIX,
  acquireAssets,
  activeEmojiQuery,
  blobHashOk,
  cacheBlobs,
  detectRasterType,
  gifDimensions,
  isValidRasterDataUri,
  rasterMagicOk,
  RASTER_MAX_EDGE,
  rasterWithinPixelBounds,
  resolveManifestEntry,
  appendAssetManifest,
  assetFromManifestEntry,
  assetManifestBytes,
  collectReferencedShortcodes,
  formatAssetManifest,
  isValidShortcode,
  parseAssetManifest,
  resolveInlineEmoji,
  mergeAssetLibrary,
  splitAssetManifest,
  type AssetManifest,
  type AssetTombstone,
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

describe("ADR-0221 審查修正", () => {
  const a = (id: string, extra: Partial<CustomAsset> = {}): CustomAsset => ({
    id,
    label: id,
    svg: smiley,
    kind: "emoji",
    ...extra,
  });

  it("H2：同 id 碰撞時，本地已自訂 shortcode 則保留本地版本", () => {
    const local = a("h", { shortcode: "celebrate", label: "本地" });
    const incoming = a("h", { shortcode: "party", label: "對端" });
    const out = acquireAssets([local], [incoming], { max: 10 });
    expect(out[0]?.shortcode).toBe("celebrate");
    expect(out[0]?.label).toBe("本地");
  });

  it("H2：本地無 shortcode 則採 incoming（維持刷新語意）", () => {
    const out = acquireAssets([a("h", { label: "舊" })], [a("h", { label: "新" })], { max: 10 });
    expect(out[0]?.label).toBe("新");
  });

  it("M1：mine（自建）可經 protect 保護不被淘汰", () => {
    const lib = [a("x"), a("y"), a("m", { mine: true })];
    const out = acquireAssets(lib, [a("d")], { max: 2, protect: (it) => it.mine === true });
    expect(out.map((it) => it.id)).toContain("m");
  });

  it("H3：resolveInlineEmoji 超過 maxEmoji 者留為字面文字", () => {
    const resolve = (): { label: string; svg: string } => ({ label: "x", svg: smiley });
    const segs = resolveInlineEmoji(":x: :x: :x: :x: :x:", resolve, 2);
    expect(segs.filter((s) => s.type === "emoji")).toHaveLength(2);
    expect(
      segs
        .filter((s) => s.type === "text")
        .map((s) => (s.type === "text" ? s.value : ""))
        .join(""),
    ).toContain(":x:");
  });

  it("L1：parseAssetManifest 收端擋總位元組上限", () => {
    const big = `<svg xmlns="http://www.w3.org/2000/svg">${"a".repeat(20 * 1024)}</svg>`;
    const raw =
      ASSET_MANIFEST_PREFIX + JSON.stringify({ a: { label: "a", svg: big }, b: { label: "b", svg: big }, c: { label: "c", svg: big } });
    expect(Object.keys(parseAssetManifest(raw)).length).toBeLessThan(3);
  });
});

describe("ADR-0222 raster 資產（動畫 GIF）", () => {
  const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=";

  it("detectRasterType / isValidRasterDataUri：只認允許的圖片型別", () => {
    expect(detectRasterType(gif)).toBe("gif");
    expect(detectRasterType("data:image/png;base64,AAAA")).toBe("png");
    expect(detectRasterType("data:text/html;base64,AAAA")).toBeNull(); // 非圖 MIME
    expect(isValidRasterDataUri(gif)).toBe(true);
    expect(isValidRasterDataUri("data:image/svg+xml,<svg/>")).toBe(false); // 非 base64 raster
    expect(isValidRasterDataUri("<svg></svg>")).toBe(false);
  });

  it("parseAssetManifest：raster 走型別＋尺寸驗證（不套 SVG 拒收制）", () => {
    const raw = ASSET_MANIFEST_PREFIX + JSON.stringify({ dance: { label: "跳舞", svg: gif, format: "raster" } });
    expect(parseAssetManifest(raw)).toEqual({ dance: { label: "跳舞", svg: gif, format: "raster" } });
  });

  it("parseAssetManifest：宣稱 raster 但非合法 data URI 者丟棄", () => {
    const raw = ASSET_MANIFEST_PREFIX + JSON.stringify({ bad: { label: "壞", svg: "<svg></svg>", format: "raster" } });
    expect(parseAssetManifest(raw)).toEqual({});
  });

  it("assetFromManifestEntry / resolveInlineEmoji 帶入 format=raster", () => {
    const a = assetFromManifestEntry("dance", { label: "跳舞", svg: gif, format: "raster" });
    expect(a.format).toBe("raster");
    const segs = resolveInlineEmoji("嗨 :dance:", (c) => (c === "dance" ? { label: "跳舞", svg: gif, format: "raster" } : undefined));
    const emoji = segs.find((s) => s.type === "emoji");
    expect(emoji && emoji.type === "emoji" && emoji.format).toBe("raster");
  });
});

describe("ADR-0225 raster magic-byte 內容嗅探", () => {
  const uri = (mime: string, b64: string): string => `data:image/${mime};base64,${b64}`;
  const GIF = "R0lGODlhAAA=";
  const PNG = "iVBORw0KGgo=";
  const JPEG = "/9j/4AAQSkY=";
  const WEBP = "UklGRhoAAABXRUJQ";

  it("宣告與實際 magic 一致 → 通過", () => {
    expect(isValidRasterDataUri(uri("gif", GIF))).toBe(true);
    expect(isValidRasterDataUri(uri("png", PNG))).toBe(true);
    expect(isValidRasterDataUri(uri("jpeg", JPEG))).toBe(true);
    expect(isValidRasterDataUri(uri("webp", WEBP))).toBe(true);
  });

  it("宣告 gif 但實際是 PNG 位元組 → 擋下（偽裝副檔名/MIME）", () => {
    expect(isValidRasterDataUri(uri("gif", PNG))).toBe(false);
    expect(rasterMagicOk(uri("gif", PNG))).toBe(false);
  });

  it("型別交叉錯配一律擋下", () => {
    expect(isValidRasterDataUri(uri("png", GIF))).toBe(false);
    expect(isValidRasterDataUri(uri("webp", JPEG))).toBe(false);
    expect(isValidRasterDataUri(uri("jpeg", WEBP))).toBe(false);
  });

  it("假 base64（decode 全 0）／非圖 MIME → 擋下", () => {
    expect(isValidRasterDataUri(uri("gif", "AAAAAAAA"))).toBe(false);
    expect(rasterMagicOk("data:text/html;base64,AAAA")).toBe(false);
  });

  it("detectRasterType 維持只看宣告（供渲染分流，不受 magic 影響）", () => {
    expect(detectRasterType(uri("gif", PNG))).toBe("gif");
  });
});

describe("ADR-0226 尺寸把關（blob 位元組＋GIF 像素）", () => {
  const G = (b64: string): string => `data:image/gif;base64,${b64}`;
  const GIF_1x1 = "R0lGODlhAQABAAAA";
  const GIF_1000 = "R0lGODlh6APoAwAA";
  const GIF_513 = "R0lGODlhAQIBAgAA";
  const PNG = "data:image/png;base64,iVBORw0KGgo=";

  it("BLOB_MAX_BYTES ＝ 傳輸能力上限（chunk 字元 × 塊數）", () => {
    expect(BLOB_MAX_BYTES).toBe(ASSET_CHUNK_CHARS * ASSET_CHUNK_MAX_TOTAL);
  });

  it("超過 BLOB_MAX_BYTES 即超過分塊上限（故產生/送端須擋，收端會拒）", () => {
    expect(splitAssetChunks("x".repeat(BLOB_MAX_BYTES + 1)).length).toBeGreaterThan(ASSET_CHUNK_MAX_TOTAL);
    expect(splitAssetChunks("x".repeat(BLOB_MAX_BYTES)).length).toBeLessThanOrEqual(ASSET_CHUNK_MAX_TOTAL);
  });

  it("gifDimensions 讀 GIF 寬高；非 GIF 回 null", () => {
    expect(gifDimensions(G(GIF_1x1))).toEqual({ w: 1, h: 1 });
    expect(gifDimensions(G(GIF_1000))).toEqual({ w: 1000, h: 1000 });
    expect(gifDimensions(PNG)).toBeNull();
  });

  it("rasterWithinPixelBounds：GIF 超過上限擋、界內/非 GIF 放行", () => {
    expect(RASTER_MAX_EDGE).toBe(512);
    expect(rasterWithinPixelBounds(G(GIF_1x1))).toBe(true);
    expect(rasterWithinPixelBounds(G(GIF_513))).toBe(false); // 剛超過 512
    expect(rasterWithinPixelBounds(G(GIF_1000))).toBe(false);
    expect(rasterWithinPixelBounds(PNG)).toBe(true); // 非 GIF 不適用
  });

  it("parseAssetManifest：行內超大像素 GIF 被擋、界內 GIF 通過", () => {
    const big = ASSET_MANIFEST_PREFIX + JSON.stringify({ big: { label: "大", svg: G(GIF_1000), format: "raster" } });
    expect(parseAssetManifest(big)).toEqual({});
    const ok = ASSET_MANIFEST_PREFIX + JSON.stringify({ ok: { label: "小", svg: G(GIF_1x1), format: "raster" } });
    expect(Object.keys(parseAssetManifest(ok))).toEqual(["ok"]);
  });
});

describe("ADR-0223 Model B（內容定址 blob）", () => {
  const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=";
  const hash = contentHash(gif);

  it("blobHashOk：整合性驗證", () => {
    expect(blobHashOk(hash, gif)).toBe(true);
    expect(blobHashOk("0".repeat(64), gif)).toBe(false);
  });

  it("cacheBlobs：置前、去重刷新、LRU 尾端淘汰", () => {
    const cache = [
      { hash: "a", data: "x" },
      { hash: "b", data: "y" },
    ];
    expect(cacheBlobs(cache, [{ hash: "c", data: "z" }], 2).map((b) => b.hash)).toEqual(["c", "a"]);
    const dedup = cacheBlobs(cache, [{ hash: "a", data: "x2" }], 5);
    expect(dedup.map((b) => b.hash)).toEqual(["a", "b"]);
    expect(dedup[0]?.data).toBe("x2");
  });

  it("parseAssetManifest：接受參照筆（ref＝hash＋raster、無 svg）", () => {
    const raw = ASSET_MANIFEST_PREFIX + JSON.stringify({ dance: { label: "跳舞", ref: hash, format: "raster" } });
    expect(parseAssetManifest(raw)).toEqual({ dance: { label: "跳舞", ref: hash, format: "raster" } });
  });

  it("parseAssetManifest：非法 ref（非 64hex 或無 raster）丟棄", () => {
    expect(parseAssetManifest(ASSET_MANIFEST_PREFIX + JSON.stringify({ x: { label: "x", ref: "zzz", format: "raster" } }))).toEqual({});
    expect(parseAssetManifest(ASSET_MANIFEST_PREFIX + JSON.stringify({ x: { label: "x", ref: hash } }))).toEqual({});
  });

  it("resolveManifestEntry：行內／參照有 blob／參照無 blob(pending)", () => {
    expect(resolveManifestEntry({ label: "a", svg: gif, format: "raster" }, () => undefined)).toEqual({
      label: "a",
      svg: gif,
      format: "raster",
    });
    expect(resolveManifestEntry({ label: "d", ref: hash, format: "raster" }, (h) => (h === hash ? gif : undefined))).toEqual({
      label: "d",
      svg: gif,
      format: "raster",
    });
    expect(resolveManifestEntry({ label: "d", ref: hash, format: "raster" }, () => undefined)).toEqual({
      label: "d",
      pending: true,
      ref: hash,
    });
  });

  it("assetFromManifestEntry：參照筆 id＝ref、format raster、svg 留空", () => {
    expect(assetFromManifestEntry("dance", { label: "跳舞", ref: hash, format: "raster" })).toEqual({
      id: hash,
      label: "跳舞",
      svg: "",
      kind: "emoji",
      shortcode: "dance",
      format: "raster",
      ref: hash,
    });
  });
});

describe("mergeAssetLibrary（跨裝置庫合併，ADR-0224）", () => {
  const mk = (id: string, extra: Partial<CustomAsset> = {}): CustomAsset => ({
    id,
    label: id,
    svg: `<svg>${id}</svg>`,
    kind: "emoji",
    ...extra,
  });
  const ids = (r: { assets: CustomAsset[] }): string[] => r.assets.map((a) => a.id).sort();
  const tids = (r: { tombstones: AssetTombstone[] }): string[] => r.tombstones.map((t) => t.id).sort();

  it("補缺聯集：兩台各有的都留下", () => {
    const r = mergeAssetLibrary([mk("a")], [mk("b")], [], [], { max: 50 });
    expect(ids(r)).toEqual(["a", "b"]);
    expect(r.tombstones).toEqual([]);
  });

  it("同 id 取較新 at 的內容", () => {
    const r = mergeAssetLibrary([mk("x", { label: "old", at: 1 })], [mk("x", { label: "new", at: 2 })], [], [], {
      max: 50,
    });
    expect(r.assets).toHaveLength(1);
    expect(r.assets[0]?.label).toBe("new");
    expect(r.assets[0]?.at).toBe(2);
  });

  it("墓碑刪除：對端墓碑較新 → 資產出局並保留墓碑", () => {
    const r = mergeAssetLibrary([mk("x", { at: 1 })], [], [], [{ id: "x", at: 2 }], { max: 50 });
    expect(ids(r)).toEqual([]);
    expect(tids(r)).toEqual(["x"]);
  });

  it("重匯自動復活：資產 at 大於舊墓碑 → 存活並丟棄墓碑", () => {
    const r = mergeAssetLibrary([], [mk("x", { at: 5 })], [{ id: "x", at: 1 }], [], { max: 50 });
    expect(ids(r)).toEqual(["x"]);
    expect(r.tombstones).toEqual([]);
  });

  it("平手＝墓碑優先（刪除優先）", () => {
    const r = mergeAssetLibrary([mk("x", { at: 3 })], [], [{ id: "x", at: 3 }], [], { max: 50 });
    expect(ids(r)).toEqual([]);
    expect(tids(r)).toEqual(["x"]);
  });

  it("本地 shortcode／mine 保留（別台不覆蓋），內容仍取較新", () => {
    const r = mergeAssetLibrary(
      [mk("x", { shortcode: "me", mine: true, at: 1 })],
      [mk("x", { shortcode: "them", label: "new", at: 9 })],
      [],
      [],
      { max: 50 },
    );
    const a = r.assets[0];
    expect(a?.label).toBe("new");
    expect(a?.shortcode).toBe("me");
    expect(a?.mine).toBe(true);
    expect(a?.at).toBe(9);
  });

  it("交換律：merge(A,B) 與 merge(B,A) 結果一致", () => {
    const A = [mk("a", { at: 2 }), mk("x", { at: 1 })];
    const B = [mk("b", { at: 3 }), mk("x", { at: 5, label: "newer" })];
    const ta: AssetTombstone[] = [{ id: "a", at: 10 }];
    const r1 = mergeAssetLibrary(A, B, ta, [], { max: 50 });
    const r2 = mergeAssetLibrary(B, A, [], ta, { max: 50 });
    expect(ids(r1)).toEqual(ids(r2));
    expect(tids(r1)).toEqual(tids(r2));
    expect(ids(r1)).toEqual(["b", "x"]); // a 被墓碑刪、x 取較新
    expect(r1.assets.find((z) => z.id === "x")?.label).toBe("newer");
  });

  it("max 淘汰未受保護者、protect 永不淘汰", () => {
    const local = [mk("keep", { mine: true, at: 1 }), mk("drop", { at: 2 }), mk("drop2", { at: 3 })];
    const r = mergeAssetLibrary(local, [], [], [], { max: 1, protect: (a) => a.mine === true });
    expect(r.assets.some((a) => a.id === "keep")).toBe(true);
    expect(r.assets.every((a) => a.mine === true)).toBe(true);
  });

  it("墓碑上限：取新到舊前 N", () => {
    const tomb: AssetTombstone[] = [
      { id: "old", at: 1 },
      { id: "mid", at: 2 },
      { id: "new", at: 3 },
    ];
    const r = mergeAssetLibrary([], [], tomb, [], { max: 50, tombstoneMax: 2 });
    expect(tids(r)).toEqual(["mid", "new"]);
  });
});
