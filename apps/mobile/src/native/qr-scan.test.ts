// QR 掃描平台縫（ADR-0280）：能力偵測與資源收拾。
//
// 真正的解碼由瀏覽器的 BarcodeDetector 負責（無法在 node 測），這裡鎖的是**我們自己的決策**：
// 不支援時要據實回報、以及**相機串流一定要關掉**——鏡頭亮著不熄是嚴重的隱私問題。
import { afterEach, describe, expect, it, vi } from "vitest";
import { qrScanSupported, scanQr } from "./qr-scan.js";

type G = {
  BarcodeDetector?: unknown;
  navigator?: { mediaDevices?: { getUserMedia?: unknown } };
};
const g = globalThis as G;
const orig = { bd: g.BarcodeDetector, nav: g.navigator };

function setEnv(bd: unknown, getUserMedia: unknown): void {
  if (bd === undefined) delete g.BarcodeDetector;
  else g.BarcodeDetector = bd;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: getUserMedia === undefined ? {} : { mediaDevices: { getUserMedia } },
  });
}

afterEach(() => {
  if (orig.bd === undefined) delete g.BarcodeDetector;
  else g.BarcodeDetector = orig.bd;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: orig.nav });
});

describe("qrScanSupported：據實回報，不假裝支援", () => {
  it("無 BarcodeDetector（iOS Safari／舊 WebView）＝false", () => {
    setEnv(undefined, vi.fn());
    expect(qrScanSupported()).toBe(false);
  });

  it("有 BarcodeDetector 但無相機 API＝false", () => {
    setEnv(class {}, undefined);
    expect(qrScanSupported()).toBe(false);
  });

  it("兩者都有＝true", () => {
    setEnv(class {}, vi.fn());
    expect(qrScanSupported()).toBe(true);
  });
});

describe("scanQr", () => {
  it("環境不支援 → failed（不丟例外、不卡住）", async () => {
    setEnv(undefined, undefined);
    const r = await scanQr({} as HTMLVideoElement, new AbortController().signal);
    expect(r).toEqual({ ok: false, reason: "failed" });
  });

  it("相機權限被拒 → failed", async () => {
    setEnv(class {}, vi.fn().mockRejectedValue(new Error("NotAllowedError")));
    const r = await scanQr({} as HTMLVideoElement, new AbortController().signal);
    expect(r).toEqual({ ok: false, reason: "failed" });
  });

  it("掃到 QR → 回傳內容，且**關掉所有相機軌道**（鏡頭指示燈要熄）", async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }, { stop }] };
    setEnv(
      class {
        detect = vi.fn().mockResolvedValue([{ rawValue: "  npub1abc  " }]);
      },
      vi.fn().mockResolvedValue(stream),
    );
    const video = { srcObject: null, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement;
    const r = await scanQr(video, new AbortController().signal);
    expect(r).toEqual({ ok: true, text: "npub1abc" }); // 去空白
    expect(stop).toHaveBeenCalledTimes(2); // 🔴 兩條軌道都關
    expect(video.srcObject).toBeNull();
  });

  it("🔴 中止（使用者取消）→ cancelled，且相機仍要關掉", async () => {
    const stop = vi.fn();
    setEnv(
      class {
        detect = vi.fn().mockResolvedValue([]); // 一直掃不到
      },
      vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
    );
    const video = { srcObject: null, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement;
    const ac = new AbortController();
    const p = scanQr(video, ac.signal);
    setTimeout(() => ac.abort(), 30);
    expect(await p).toEqual({ ok: false, reason: "cancelled" });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("解碼丟例外（畫面模糊／尚無 metadata）不算失敗——繼續掃到中止為止", async () => {
    const stop = vi.fn();
    setEnv(
      class {
        detect = vi.fn().mockRejectedValue(new Error("InvalidStateError"));
      },
      vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
    );
    const video = { srcObject: null, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement;
    const ac = new AbortController();
    const p = scanQr(video, ac.signal);
    setTimeout(() => ac.abort(), 30);
    expect(await p).toEqual({ ok: false, reason: "cancelled" }); // 不是 failed
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
