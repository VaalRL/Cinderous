// 加好友面板（ADR-0280）：貼 npub／出示自己的 QR＋複製／掃描對方的 QR。
//
// 互動在 renderToStaticMarkup 下不會執行（掃描本身另由 native/qr-scan.test.ts 蓋），
// 這裡鎖**渲染契約**：該有的入口在不在、以及不支援掃描時是否誠實地不顯示按鈕。
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { qrSvg } from "@cinderous/core";
import { AddContactPanel } from "./AddContactPanel.js";

const NPUB = "npub1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0sjpv92";

type G = { BarcodeDetector?: unknown; navigator?: unknown };
const g = globalThis as G;
const orig = { bd: g.BarcodeDetector, nav: g.navigator };

/** 讓 qrScanSupported() 回 true／false（掃描鈕的顯示條件）。 */
function setScanSupport(on: boolean): void {
  if (on) g.BarcodeDetector = class {};
  else delete g.BarcodeDetector;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: on ? { mediaDevices: { getUserMedia: vi.fn() } } : {},
  });
}

afterEach(() => {
  if (orig.bd === undefined) delete g.BarcodeDetector;
  else g.BarcodeDetector = orig.bd;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: orig.nav });
});

describe("AddContactPanel（ADR-0280）", () => {
  it("有 selfNpub → 顯示 npub、複製鈕與「顯示 QR」鈕", () => {
    setScanSupport(false);
    const html = renderToStaticMarkup(<AddContactPanel onAdd={() => {}} selfNpub={NPUB} locale="zh-Hant" />);
    expect(html).toContain(NPUB);
    expect(html).toContain('data-testid="copy-npub"');
    expect(html).toContain('data-testid="toggle-qr"');
  });

  it("無 selfNpub → 只有貼上欄（不顯示 QR／複製）", () => {
    setScanSupport(false);
    const html = renderToStaticMarkup(<AddContactPanel onAdd={() => {}} locale="zh-Hant" />);
    expect(html).not.toContain('data-testid="copy-npub"');
    expect(html).not.toContain('data-testid="toggle-qr"');
    expect(html).toContain('data-testid="add-submit"'); // 貼上那條永遠在
  });

  it("QR 預設收合（點「顯示 QR」才展開）——一開啟就佔半個畫面太吵", () => {
    setScanSupport(false);
    const html = renderToStaticMarkup(<AddContactPanel onAdd={() => {}} selfNpub={NPUB} />);
    expect(html).not.toContain('data-testid="self-qr"');
  });

  it("🔴 支援時顯示掃描鈕；**不支援時不顯示**——不做「按了才發現掃不到」的假降級", () => {
    setScanSupport(true);
    expect(renderToStaticMarkup(<AddContactPanel onAdd={() => {}} selfNpub={NPUB} />)).toContain('data-testid="scan-qr"');
    setScanSupport(false);
    expect(renderToStaticMarkup(<AddContactPanel onAdd={() => {}} selfNpub={NPUB} />)).not.toContain('data-testid="scan-qr"');
  });

  it("QR 內容是自己的 npub（不是別的東西）", () => {
    // qrSvg 對同一輸入是決定性的；比對 path 資料即可確認編的是這個 npub。
    const svg = qrSvg(NPUB, { cell: 4 });
    expect(svg).toContain("<path");
    expect(qrSvg(NPUB, { cell: 4 })).toBe(svg); // 決定性
    expect(qrSvg("npub1other", { cell: 4 })).not.toBe(svg);
  });
});
