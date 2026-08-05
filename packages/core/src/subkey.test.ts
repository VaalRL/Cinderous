import { describe, expect, it } from "vitest";
import { wrapMessage } from "./giftwrap.js";
import { getPublicKey, generateSecretKey } from "./keys.js";
import { sealAndWrap } from "./nip59.js";
import {
  buildEkAnnounce,
  EK_ANNOUNCE_KIND,
  ekHintOf,
  FS_CAPABILITY,
  FS_CAPABILITY_MAX_LEN,
  FS_GRACE_MS,
  FS_RETIRED,
  generateEncryptionKey,
  openWrapWithEks,
  pruneFsKeys,
  shouldRotateFs,
  recordFsFailure,
  EMPTY_FS_FAILURE_LOG,
  FS_ROTATE_INTERVAL_MS,
  readEkAnnounce,
  readFsCapability,
  withEkHint,
} from "./subkey.js";

describe("EK 生成（ADR-0245 Phase 0）", () => {
  it("產生獨立隨機 secp256k1 金鑰對（pk＝getPublicKey(sk)）", () => {
    const ek = generateEncryptionKey();
    expect(ek.pk).toBe(getPublicKey(ek.sk));
    expect(ek.pk).toMatch(/^[0-9a-f]{64}$/);
    expect(generateEncryptionKey().pk).not.toBe(ek.pk); // 隨機、不重複
  });
});

describe("kind 10040 EK 公告（IK 簽章、可驗證）", () => {
  it("build → read 往返；帶當前＋下一把", () => {
    const ik = generateSecretKey();
    const cur = generateEncryptionKey();
    const nxt = generateEncryptionKey();
    const ev = buildEkAnnounce(ik, cur.pk, { next: nxt.pk, now: 1000 });
    expect(ev.kind).toBe(EK_ANNOUNCE_KIND);
    const read = readEkAnnounce(ev);
    expect(read).toEqual({ ik: getPublicKey(ik), ek: cur.pk, next: nxt.pk });
  });

  it("只帶當前（無 next）", () => {
    const ik = generateSecretKey();
    const cur = generateEncryptionKey();
    const read = readEkAnnounce(buildEkAnnounce(ik, cur.pk, { now: 1 }));
    expect(read).toEqual({ ik: getPublicKey(ik), ek: cur.pk });
  });

  it("竄改/錯 kind/壞簽章/畸形內容 → null（不信任網路來源）", () => {
    const ik = generateSecretKey();
    const cur = generateEncryptionKey();
    const ev = buildEkAnnounce(ik, cur.pk, { now: 1 });
    expect(readEkAnnounce({ ...ev, content: JSON.stringify({ v: 1, ek: "zz" }) })).toBeNull(); // 非法 pk（簽章也會不符）
    expect(readEkAnnounce({ ...ev, kind: 1 })).toBeNull(); // 錯 kind
    expect(readEkAnnounce({ ...ev, sig: "00".repeat(32) })).toBeNull(); // 壞簽章
    expect(readEkAnnounce({ ...ev, content: "not json" })).toBeNull();
  });
});

describe("rumor 內嵌 EK hint（對方即時學到我的 EK）", () => {
  it("withEkHint / ekHintOf 往返；重設不重複", () => {
    const ek = generateEncryptionKey();
    const tags = withEkHint([["p", "aa".repeat(32)]], ek.pk);
    expect(ekHintOf(tags)).toBe(ek.pk);
    // 再設一次 → 只留最新一個 ek tag
    const ek2 = generateEncryptionKey();
    const tags2 = withEkHint(tags, ek2.pk);
    expect(ekHintOf(tags2)).toBe(ek2.pk);
    expect(tags2.filter((t) => t[0] === "ek")).toHaveLength(1);
  });
  it("無 hint / 非法 hint → undefined", () => {
    expect(ekHintOf([["p", "x"]])).toBeUndefined();
    expect(ekHintOf([["ek", "zz"]])).toBeUndefined();
  });
});

describe("retarget Gift Wrap 到 EK＋多鑰解封（FS 核心，ADR-0245）", () => {
  it("以收件人 EK 加密：EK sk 解得開、驗證寄件人、學到寄件人 EK；#p 仍為收件人身分（路由）", () => {
    const senderIk = generateSecretKey();
    const recipIk = generateSecretKey();
    const recipEk = generateEncryptionKey();
    const senderEk = generateEncryptionKey();

    // A 送 B：rumor 夾 A 自己的 EK hint；加密到 B 的 EK；外層 #p 仍指 B 的身分（供中繼路由/收件匣）。
    const rumor = { kind: 14, created_at: 1000, tags: withEkHint([], senderEk.pk), content: "嗨 Bob" };
    const wrap = sealAndWrap(rumor, senderIk, recipEk.pk, { kind: 1059, tags: [["p", getPublicKey(recipIk)]] });

    const opened = openWrapWithEks(wrap, [recipEk.sk]);
    expect(opened.sender).toBe(getPublicKey(senderIk)); // 認證不變：seal 由 sender IK 簽
    expect(opened.rumor.content).toBe("嗨 Bob");
    expect(ekHintOf(opened.rumor.tags)).toBe(senderEk.pk); // B 學到 A 的 EK
    expect(wrap.tags).toContainEqual(["p", getPublicKey(recipIk)]); // #p＝身分、非 EK
  });

  it("🔴 FS 核心：EK 刪掉（不在候選）後，即使拿收件人 IK 也解不開被側錄的密文", () => {
    const senderIk = generateSecretKey();
    const recipIk = generateSecretKey();
    const recipEk = generateEncryptionKey();
    const wrap = sealAndWrap({ kind: 14, created_at: 1, tags: [], content: "秘密" }, senderIk, recipEk.pk, {
      kind: 1059,
      tags: [["p", getPublicKey(recipIk)]],
    });
    // EK sk 還在 → 解得開（訊息到達時解一次）。
    expect(openWrapWithEks(wrap, [recipEk.sk]).rumor.content).toBe("秘密");
    // grace 後刪掉 EK sk → 候選只剩 IK（身分永久金鑰）→ 仍解不開（前向保密）。
    expect(() => openWrapWithEks(wrap, [recipIk])).toThrow();
  });

  it("向後相容：非 FS 寄件人加密到收件人 IK → 候選含 IK 時解得開（EK 失敗自動退回 IK）", () => {
    const senderIk = generateSecretKey();
    const recipIk = generateSecretKey();
    const recipEk = generateEncryptionKey();
    const wrap = sealAndWrap({ kind: 14, created_at: 1, tags: [], content: "靜態訊息" }, senderIk, getPublicKey(recipIk), {
      kind: 1059,
      tags: [],
    });
    const opened = openWrapWithEks(wrap, [recipEk.sk, recipIk]); // 先試 EK（失敗）→ 退回 IK
    expect(opened.rumor.content).toBe("靜態訊息");
  });

  it("多把 EK 候選：用正確那把（grace 內舊 EK）解得開，順序無妨", () => {
    const senderIk = generateSecretKey();
    const recipIk = generateSecretKey();
    const oldEk = generateEncryptionKey();
    const curEk = generateEncryptionKey();
    // 對方還在用「上一把」EK 加密（尚未學到新的）。
    const wrap = sealAndWrap({ kind: 14, created_at: 1, tags: [], content: "用舊鑰" }, senderIk, oldEk.pk, {
      kind: 1059,
      tags: [["p", getPublicKey(recipIk)]],
    });
    expect(openWrapWithEks(wrap, [curEk.sk, oldEk.sk, recipIk]).rumor.content).toBe("用舊鑰");
  });

  it("全部候選皆錯 → 拋（呼叫端據此顯示未解、待同步重試）", () => {
    const senderIk = generateSecretKey();
    const recipEk = generateEncryptionKey();
    const wrap = sealAndWrap({ kind: 14, created_at: 1, tags: [], content: "x" }, senderIk, recipEk.pk, {
      kind: 1059,
      tags: [],
    });
    expect(() => openWrapWithEks(wrap, [generateSecretKey(), generateSecretKey()])).toThrow();
  });
});

describe("pruneFsKeys（grace 刪除紀律，ADR-0245）", () => {
  it("保留 current＋grace 內被取代者；逾 grace 的舊 EK 回收", () => {
    const g = FS_GRACE_MS;
    const now = 100 * g;
    const keys = [
      { at: now - 3 * g, id: "oldest" }, // 被 mid 取代（於 now-2g）→ 逾 grace → 刪
      { at: now - 2 * g, id: "mid" }, // 被 cur 取代（於 now-0.5g）→ 未逾 grace → 留
      { at: now - 0.5 * g, id: "cur" }, // current → 留
    ];
    expect(pruneFsKeys(keys, now).map((k) => k.id).sort()).toEqual(["cur", "mid"]);
  });
  it("只有一把（current）→ 永不刪", () => {
    expect(pruneFsKeys([{ at: 1 }], 1e15)).toEqual([{ at: 1 }]);
  });
  it("剛換（都在 grace 內）→ 全留", () => {
    const now = 1000;
    expect(pruneFsKeys([{ at: now - 10 }, { at: now }], now)).toHaveLength(2);
  });
});

describe("wrapMessage FS 整合（ADR-0245 Phase 1a）", () => {
  it("FS 訊息：加密到收件人 EK、#p 仍身分、內嵌我的 EK；EK 解得開、認證正確、IK 解不開（FS）", () => {
    const aliceIk = generateSecretKey();
    const bobIk = generateSecretKey();
    const bobEk = generateEncryptionKey();
    const aliceEk = generateEncryptionKey();
    const alicePk = getPublicKey(aliceIk);
    const bobPk = getPublicKey(bobIk);
    const encryptToFor = (pk: string) => (pk === alicePk ? aliceEk.pk : bobEk.pk); // 自我副本→aliceEk、給 Bob→bobEk

    const w = wrapMessage("嗨 Bob", aliceIk, bobPk, { now: 1, fs: { encryptToFor, myEk: aliceEk.pk } });

    const ev = w.events[0]!;
    expect(ev.tags).toContainEqual(["p", bobPk]); // 外層 #p＝Bob 身分（路由）
    const opened = openWrapWithEks(ev, [bobEk.sk]); // Bob 用 EK 解
    expect(opened.sender).toBe(alicePk); // 認證不變
    expect(opened.rumor.content).toBe("嗨 Bob");
    expect(ekHintOf(opened.rumor.tags)).toBe(aliceEk.pk); // Bob 學到 Alice 的 EK
    expect(() => openWrapWithEks(ev, [bobIk])).toThrow(); // FS：Bob 刪 EK 後 IK 也解不開
    // 自我副本（多設備）加密到 Alice 自己的 EK，同樣具 FS
    expect(openWrapWithEks(w.selfCopy, [aliceEk.sk]).rumor.content).toBe("嗨 Bob");
    expect(() => openWrapWithEks(w.selfCopy, [aliceIk])).toThrow();
  });

  it("未帶 fs → 現況（加密到身分、IK 解得開、無 ek hint、向後相容）", () => {
    const aliceIk = generateSecretKey();
    const bobIk = generateSecretKey();
    const w = wrapMessage("靜態", aliceIk, getPublicKey(bobIk), { now: 1 });
    const opened = openWrapWithEks(w.events[0]!, [bobIk]);
    expect(opened.rumor.content).toBe("靜態");
    expect(ekHintOf(opened.rumor.tags)).toBeUndefined();
  });
});

describe("FS 能力宣告的解讀（ADR-0306 D3.3c）", () => {
  it("ek-v1 ＝正在做 FS", () => {
    expect(readFsCapability(FS_CAPABILITY)).toBe("fs");
  });

  it("缺席／空字串＝沒有宣告（＝今天絕大多數聯絡人）", () => {
    expect(readFsCapability(undefined)).toBe("absent");
    expect(readFsCapability("")).toBe("absent");
    expect(readFsCapability("   ")).toBe("absent");
  });

  it("明示退場值＝已停止，這是硬退用的（ADR-0306 D3.3）", () => {
    expect(readFsCapability(FS_RETIRED)).toBe("retired");
  });

  it("🔴 不認得的值＝unknown，不得與「缺席」混為一談", () => {
    // 這正是 ADR-0302 §2 指出的缺陷：舊碼把兩者都當成「沒有 FS」。
    expect(readFsCapability("ek-v2")).toBe("unknown");
    expect(readFsCapability("ratchet-v1")).toBe("unknown");
    expect(readFsCapability("subkey-only")).toBe("unknown");
  });

  it("非字串一律視為缺席（不信任網路來源）", () => {
    expect(readFsCapability(42)).toBe("absent");
    expect(readFsCapability(null)).toBe("absent");
    expect(readFsCapability({ fs: "ek-v1" })).toBe("absent");
  });

  it("前後空白不影響判定", () => {
    expect(readFsCapability(` ${FS_CAPABILITY} `)).toBe("fs");
    expect(readFsCapability(` ${FS_RETIRED} `)).toBe("retired");
  });

  it("退場值與能力值不得相同（否則硬退無法表達）", () => {
    expect(FS_RETIRED).not.toBe(FS_CAPABILITY);
  });
});

describe("能力字串的長度限制（審查發現：超長會靜默變成『沒有宣告』）", () => {
  it("🔴 現有能力值都必須在 parseProfile 的 16 字元上限內", () => {
    // `profile.ts` 只收 `fs.length <= 16`，超過即丟棄 ⇒ 對方會被當成 `absent`
    // 而不是 `unknown`——**靜默失效**，收件端完全看不出對方宣告過什麼。
    // 故新增能力值時必須先過這一關；這條測試就是那道門。
    expect(FS_CAPABILITY.length).toBeLessThanOrEqual(FS_CAPABILITY_MAX_LEN);
    expect(FS_RETIRED.length).toBeLessThanOrEqual(FS_CAPABILITY_MAX_LEN);
  });

  it("上限值必須與 profile.ts 的實際限制一致（改了一邊就會在這裡爆）", () => {
    expect(FS_CAPABILITY_MAX_LEN).toBe(16);
  });
});

describe("shouldRotateFs（ADR-0313 自動輪替）", () => {
  const t0 = 1_700_000_000_000;
  const day = 24 * 60 * 60 * 1000;

  it("尚未啟用（無金鑰）不輪替——生成第一把是 enableFs 的事", () => {
    expect(shouldRotateFs([], t0)).toBe(false);
  });

  it("剛生成不輪替；滿 7 天才輪替", () => {
    const keys = [{ at: t0 }];
    expect(shouldRotateFs(keys, t0)).toBe(false);
    expect(shouldRotateFs(keys, t0 + 6 * day)).toBe(false);
    expect(shouldRotateFs(keys, t0 + FS_ROTATE_INTERVAL_MS)).toBe(true);
  });

  it("看的是 current（最新那把）的年齡，不是最舊的", () => {
    // 舊把很老、current 剛生成 → 不該輪替（否則每次開機都換一把）
    const keys = [{ at: t0 - 30 * day }, { at: t0 }];
    expect(shouldRotateFs(keys, t0 + day)).toBe(false);
  });

  it("離線期間照算——年齡而非計時器（App 關著時間也累積）", () => {
    expect(shouldRotateFs([{ at: t0 }], t0 + 90 * day)).toBe(true);
  });

  it("穩態：每 7 天輪替 ＋ grace 7 天 ⇒ 手上 2–3 把，不會無限累積", () => {
    let keys = [{ at: t0 }];
    for (let week = 1; week <= 8; week++) {
      const now = t0 + week * FS_ROTATE_INTERVAL_MS;
      expect(shouldRotateFs(keys, now)).toBe(true);
      keys = pruneFsKeys([...keys, { at: now }], now);
      // 輪替**當下**是 3 把：grace 邊界是閉區間（`<=`），剛好滿 grace 的那把還留著。
      expect(keys).toHaveLength(week === 1 ? 2 : 3);
    }
    // 邊界過了就回到 2 把（current ＋ 一把 grace 內）。
    const later = t0 + 8 * FS_ROTATE_INTERVAL_MS + 1;
    expect(pruneFsKeys(keys, later)).toHaveLength(2);
  });
});

describe("recordFsFailure（ADR-0316 可觀測性）", () => {
  const t = 1_700_000_000_000;

  it("從未持有 EK → 記進 notFs（確定與 FS 無關），不動 maybeEkLoss", () => {
    const out = recordFsFailure(EMPTY_FS_FAILURE_LOG, t, false);
    expect(out).toEqual({ notFs: 1, maybeEkLoss: 0 });
    expect(out.lastEkLossAt).toBeUndefined();
  });

  it("有或曾有 EK → 記進 maybeEkLoss 並記時間", () => {
    const out = recordFsFailure(EMPTY_FS_FAILURE_LOG, t, true);
    expect(out.maybeEkLoss).toBe(1);
    expect(out.notFs).toBe(0);
    expect(out.lastEkLossAt).toBe(t);
  });

  it("累加並更新最後時間", () => {
    let log = recordFsFailure(EMPTY_FS_FAILURE_LOG, t, true);
    log = recordFsFailure(log, t + 1000, true);
    log = recordFsFailure(log, t + 2000, false);
    expect(log).toEqual({ notFs: 1, maybeEkLoss: 2, lastEkLossAt: t + 1000 });
  });

  it("純函式：不變更輸入", () => {
    const before = { ...EMPTY_FS_FAILURE_LOG };
    recordFsFailure(EMPTY_FS_FAILURE_LOG, t, true);
    expect(EMPTY_FS_FAILURE_LOG).toEqual(before);
  });
});
