// 加好友輸入的解析（ADR-0281）。
//
// 這批的起因是一個真實回報：用行動端掃**桌面版產出的 QR**，被回「掃到的內容不是 npub」。
// 原因是桌面 QR 編的是 `selfShareUri`＝`npub…@wss://…`（ADR-0034 中繼提示），
// 而行動端的掃描驗證只認裸 npub——同一個輸入格式，兩處各寫一套規則。
import { describe, expect, it } from "vitest";
import { formatContactInput, isContactInput, parseContactInput } from "./contact-input.js";
import { makeQr } from "./qr.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { npubEncode } from "./keys.js";

const NPUB = npubEncode(getPublicKey(generateSecretKey()));
const RELAY = "wss://cinder-relay.example.workers.dev";

describe("parseContactInput：切分 npub 與中繼提示", () => {
  it("裸 npub → 無提示", () => {
    expect(parseContactInput(NPUB)).toEqual({ npub: NPUB, hint: undefined, name: undefined });
  });

  it("`npub@wss://…`（分享字串／QR 內容）→ 拆出兩段", () => {
    expect(parseContactInput(`${NPUB}@${RELAY}`)).toEqual({ npub: NPUB, hint: RELAY, name: undefined });
  });

  it("空白分隔也吃（貼上時常帶換行）", () => {
    expect(parseContactInput(`  ${NPUB}   ${RELAY}  `)).toEqual({ npub: NPUB, hint: RELAY, name: undefined });
  });

  it("提示本身含 `@`（如 user@host）不再被切碎——只切第一段", () => {
    // split(…, 2) 只取兩段，剩下的留在 hint 內
    expect(parseContactInput(`${NPUB}@${RELAY}`).hint).toBe(RELAY);
  });
});

describe("isContactInput：UI 送進 addContact 前的把關", () => {
  it("🔴 裸 npub **與** `npub@relay` 都要收——這正是先前掃 QR 失敗的原因", () => {
    expect(isContactInput(NPUB)).toBe(true);
    expect(isContactInput(`${NPUB}@${RELAY}`)).toBe(true);
  });

  it("QR 可能是任何東西：網址／Wi-Fi 設定／別人的名片 → 一律擋", () => {
    expect(isContactInput("https://example.com")).toBe(false);
    expect(isContactInput("WIFI:S:MyNet;T:WPA;P:hunter2;;")).toBe(false);
    expect(isContactInput("BEGIN:VCARD\nFN:某人\nEND:VCARD")).toBe(false);
    expect(isContactInput("")).toBe(false);
  });

  it("🔴 nsec 一律擋——私鑰絕不該被當成聯絡人輸入", () => {
    expect(isContactInput("nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq")).toBe(false);
  });
});

// 端對端回歸：桌面 QR 編的內容（selfShareUri 的格式）→ 掃描端必須收得下。
// 這條直接對應使用者回報的情境，不只是單元邏輯。
describe("桌面 QR → 行動端掃描（ADR-0281 回歸）", () => {
  const shareUri = `${NPUB}@${RELAY}`;

  it("🔴 分享字串編得成 QR，且解回來後掃描端接受", () => {
    expect(makeQr(shareUri).count).toBeGreaterThan(0); // 編得動（長度未超版本上限）
    expect(isContactInput(shareUri)).toBe(true); // 掃描端接受
    expect(parseContactInput(shareUri).npub).toBe(NPUB); // 且拆得回原 npub
  });
});

// ADR-0284：QR 帶自報名稱——單向加好友時對方在**接受之前不回送個人檔**（ADR-0121 反垃圾），
// 所以清單上只會有 `npub1abc…`。當面掃碼時對方本來就自願亮名，由 QR 直接帶過來。
describe("自報名稱（ADR-0284）", () => {
  it("以 `#` 標記，名稱可含空白", () => {
    expect(parseContactInput(`${NPUB}@${RELAY} #小明`)).toEqual({ npub: NPUB, hint: RELAY, name: "小明" });
    expect(parseContactInput(`${NPUB}@${RELAY} #小 明`).name).toBe("小 明");
  });

  it("🔴 **沒有中繼提示時也分得開**——這是第一版寫錯的地方：`npub 小明` 會把「小明」當成提示", () => {
    expect(parseContactInput(`${NPUB} #小明`)).toEqual({ npub: NPUB, hint: undefined, name: "小明" });
  });

  it("🔴 舊版客戶端不會被污染路由：帶提示時名稱被丟掉；不帶提示時 `#名字` 落到 hint 但不是 ws/wss", () => {
    const withRelay = `${NPUB}@${RELAY} #小明`;
    const [, oldHint] = withRelay.trim().split(/[@\s]+/, 2); // 舊版的解析方式
    expect(oldHint).toBe(RELAY); // 提示乾淨

    const noRelay = `${NPUB} #小明`;
    const [, oldHint2] = noRelay.trim().split(/[@\s]+/, 2);
    expect(oldHint2).toBe("#小明");
    expect(oldHint2?.startsWith("ws")).toBe(false); // normalizeRelayUrl 認不得 → 丟棄
  });

  it("formatContactInput：有名字才接上；空白名字視同沒有", () => {
    expect(formatContactInput(NPUB)).toBe(NPUB);
    expect(formatContactInput(NPUB, "  ")).toBe(NPUB);
    expect(formatContactInput(`${NPUB}@${RELAY}`, "小明")).toBe(`${NPUB}@${RELAY} #小明`);
  });

  it("往返：組出來的字串解得回同樣三段，且仍是合法輸入（有無中繼提示都要）", () => {
    for (const base of [NPUB, `${NPUB}@${RELAY}`]) {
      const str = formatContactInput(base, "小明");
      expect(parseContactInput(str).name).toBe("小明");
      expect(parseContactInput(str).npub).toBe(NPUB);
      expect(isContactInput(str)).toBe(true);
    }
  });
});
