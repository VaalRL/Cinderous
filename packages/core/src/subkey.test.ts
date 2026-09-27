// subkey 的純函式測試已搬到 Cinderous SDK（ADR-0370；SDK ADR 0010）；這裡只留與 App 私訊層（giftwrap）的整合。
import { describe, expect, it } from "vitest";
import { getPublicKey, generateSecretKey } from "./keys.js";
import { wrapMessage } from "./giftwrap.js";
import { ekHintOf, generateEncryptionKey, openWrapWithEks } from "./subkey.js";

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
