// `allowPublicTurn` 開關與在途請求的競態（ADR-0336 §4；審查發現 #4）。
//
// 🔴 這支測的是一件很容易寫對又很容易寫錯的事：`refreshPublicTurn` 在 `await` 之後
// **必須重新檢查旗標**。使用者可能在請求在途時把開關關掉——那時 `setAllowPublicTurn(false)`
// 已經清了憑證也清了計時器，若在途的結果回來又寫回去、又把計時器排上，開關就等於沒作用。

import { generateSecretKey, nsecEncode } from "@cinderous/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import { RelayChatBackend } from "./relay-backend.js";

/** 取出私有欄位做斷言——這條路徑沒有對外可觀察的出口（rtcConfig 也是私有）。 */
interface Peek {
  publicTurnServers: RTCIceServer[] | undefined;
  turnTimer: unknown;
  refreshPublicTurn(): Promise<void>;
}
const peek = (b: RelayChatBackend): Peek => b as unknown as Peek;

const CF_BODY = {
  iceServers: { urls: ["turn:turn.example:3478"], username: "u", credential: "p" },
  ttl: 300,
};

function makeBackend(): RelayChatBackend {
  return new RelayChatBackend(
    new MemoryStorage(),
    // 這支測試不連線，連接器不會被呼叫。
    () => ({ close: () => {}, send: () => {} }) as never,
    "Me",
    { nsec: nsecEncode(generateSecretKey()), turnEndpoint: "https://relay.example/turn" } as never,
  );
}

describe("公共 TURN 開關與在途請求（審查 #4）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("🔴 在途時關掉開關 → 結果不得寫回憑證，也不得把計時器排回來", async () => {
    let release!: (v: unknown) => void;
    const pending = new Promise((r) => (release = r));
    vi.stubGlobal("fetch", async () => {
      await pending;
      return { ok: true, status: 200, json: async () => CF_BODY };
    });

    const b = makeBackend();
    const inflight = peek(b).refreshPublicTurn(); // 不 await：讓它卡在 fetch

    b.setAllowPublicTurn(false); // 使用者在這一刻關掉
    release(null);
    await inflight;

    expect(peek(b).publicTurnServers, "關掉後不得又被在途結果寫回").toBeUndefined();
    expect(peek(b).turnTimer, "關掉後不得又被排回計時器").toBeUndefined();
  });

  it("開關沒被動過時，正常抓到就會套用並排下一次", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => CF_BODY }));
    const b = makeBackend();
    await peek(b).refreshPublicTurn();
    expect(peek(b).publicTurnServers).toHaveLength(1);
    expect(peek(b).turnTimer).toBeDefined();
    b.stop();
  });

  it("關掉後再呼叫 refresh 直接不動作（連請求都不發）", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return { ok: true, status: 200, json: async () => CF_BODY };
    });
    const b = makeBackend();
    b.setAllowPublicTurn(false);
    await peek(b).refreshPublicTurn();
    expect(calls, "關掉就不該再打 /turn").toBe(0);
  });

  it("重新打開 → 立刻重抓", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => CF_BODY }));
    const b = makeBackend();
    b.setAllowPublicTurn(false);
    b.setAllowPublicTurn(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(peek(b).publicTurnServers).toHaveLength(1);
    b.stop();
  });
});
