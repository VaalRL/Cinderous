import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PairExportScreen } from "./PairExportScreen.js";

const base = {
  onStart: () => {},
  onConfirmSas: () => {},
  onCancel: () => {},
  onBack: () => {},
  locale: "en" as const,
};

describe("行動端配對搬家——送出端（ADR-0118）", () => {
  it("idle：只有「開始配對」", () => {
    const html = renderToStaticMarkup(<PairExportScreen {...base} phase={{ kind: "idle" }} />);
    expect(html).toContain('data-testid="pair-start"');
    expect(html).not.toContain('data-testid="pair-sas-ok"');
  });

  it("offer：顯示配對碼供新機貼上", () => {
    const html = renderToStaticMarkup(
      <PairExportScreen {...base} phase={{ kind: "offer", code: "PAIRCODE123", expiresAt: 0 }} />,
    );
    expect(html).toContain("PAIRCODE123");
    expect(html).toContain('data-testid="pair-code"');
  });

  it("**SAS 必須由使用者裁示**：相符/不符兩個鈕都在，且沒有自動通過的路徑", () => {
    const html = renderToStaticMarkup(<PairExportScreen {...base} phase={{ kind: "sas", sas: "7429" }} />);
    expect(html).toContain("7429");
    expect(html).toContain('data-testid="pair-sas-ok"');
    expect(html).toContain('data-testid="pair-sas-no"');
    // 警告必須在——SAS 不符代表有中間人，會把含 nsec 的整包資料騙走。
    expect(html).toContain("middle");
  });

  it("SAS 階段**不提供「重新開始」**（避免誤觸繞過驗證）", () => {
    const html = renderToStaticMarkup(<PairExportScreen {...base} phase={{ kind: "sas", sas: "7429" }} />);
    expect(html).not.toContain("Start over");
  });

  it("done / error 各自顯示", () => {
    expect(renderToStaticMarkup(<PairExportScreen {...base} phase={{ kind: "done" }} />)).toContain("Move complete");
    expect(
      renderToStaticMarkup(<PairExportScreen {...base} phase={{ kind: "error", message: "boom" }} />),
    ).toContain("boom");
  });
});
