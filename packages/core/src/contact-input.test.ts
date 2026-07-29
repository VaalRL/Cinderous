// 加好友輸入的解析（ADR-0281）。
//
// 這批的起因是一個真實回報：用行動端掃**桌面版產出的 QR**，被回「掃到的內容不是 npub」。
// 原因是桌面 QR 編的是 `selfShareUri`＝`npub…@wss://…`（ADR-0034 中繼提示），
// 而行動端的掃描驗證只認裸 npub——同一個輸入格式，兩處各寫一套規則。
import { describe, expect, it } from "vitest";
import { isContactInput, parseContactInput } from "./contact-input.js";
import { makeQr } from "./qr.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { npubEncode } from "./keys.js";

const NPUB = npubEncode(getPublicKey(generateSecretKey()));
const RELAY = "wss://cinder-relay.example.workers.dev";

describe("parseContactInput：切分 npub 與中繼提示", () => {
  it("裸 npub → 無提示", () => {
    expect(parseContactInput(NPUB)).toEqual({ npub: NPUB, hint: undefined });
  });

  it("`npub@wss://…`（分享字串／QR 內容）→ 拆出兩段", () => {
    expect(parseContactInput(`${NPUB}@${RELAY}`)).toEqual({ npub: NPUB, hint: RELAY });
  });

  it("空白分隔也吃（貼上時常帶換行）", () => {
    expect(parseContactInput(`  ${NPUB}   ${RELAY}  `)).toEqual({ npub: NPUB, hint: RELAY });
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
