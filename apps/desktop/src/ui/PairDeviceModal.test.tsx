import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { PairDeviceModal, type PairPhase } from "./PairDeviceModal.js";

function render(phase: PairPhase): string {
  return renderToStaticMarkup(
    <I18nProvider locale="zh-Hant">
      <PairDeviceModal phase={phase} onConfirm={() => {}} onReject={() => {}} onClose={() => {}} />
    </I18nProvider>,
  );
}

describe("PairDeviceModal（ADR-0072 舊機視角）", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).localStorage = { getItem: () => null };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it("offer 階段：顯示 QR＋配對碼＋倒數＋剪貼簿警語", () => {
    const out = render({ kind: "offer", code: '{"v":1,"key":"AAAA","lan":"","room":"webrtc"}', expiresAt: 0 });
    expect(out).toContain('data-testid="pair-offer"');
    expect(out).toContain("pairing QR");
    expect(out).toContain('data-testid="pair-countdown"');
    expect(out).toContain("剪貼簿");
  });

  it("sas 階段：顯示短碼與相符/不符雙鈕（拒絕路徑存在）", () => {
    const out = render({ kind: "sas", sas: "1234" });
    expect(out).toContain('data-testid="pair-sas"');
    expect(out).toContain("1234");
    expect(out).toContain('data-testid="pair-confirm"');
    expect(out).toContain('data-testid="pair-reject"');
    expect(out).not.toContain('data-testid="pair-offer"'); // 階段互斥
  });

  it("sending/done/error 階段各自呈現", () => {
    expect(render({ kind: "sending" })).toContain('data-testid="pair-sending"');
    expect(render({ kind: "done" })).toContain('data-testid="pair-done"');
    const err = render({ kind: "error", message: "配對逾時" });
    expect(err).toContain('data-testid="pair-error"');
    expect(err).toContain("配對逾時");
  });
});
