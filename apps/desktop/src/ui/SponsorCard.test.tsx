import type { DonationLink } from "@cinderous/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { dismissSponsor, isSponsorDismissed } from "./sponsor-dismiss.js";
import { SponsorCard } from "./SponsorCard.js";

const links: DonationLink[] = [
  { channel: "github_sponsors", url: "https://github.com/sponsors/op" },
  { channel: "lightning", url: "lightning:op@example.com" },
];

function render(props: Partial<Parameters<typeof SponsorCard>[0]> = {}): string {
  return renderToStaticMarkup(
    <I18nProvider locale="zh-Hant">
      <SponsorCard donations={links} relayUrl="wss://relay.example" onDismiss={() => {}} {...props} />
    </I18nProvider>,
  );
}

describe("贊助此節點角落卡（ADR-0089／0262）", () => {
  it("列出每個管道，連結為外部開啟且不洩漏 referrer", () => {
    const html = render();
    expect(html).toContain('data-testid="sponsor-card"');
    expect(html).toContain('href="https://github.com/sponsors/op"');
    expect(html).toContain('href="lightning:op@example.com"'); // 交外部錢包處理
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("措辭：自報、無官方背書、永不自動付款——三者都要在", () => {
    const html = render();
    expect(html).toContain("自報"); // 這是此節點聲稱的
    expect(html).toContain("非官方背書");
    expect(html).toContain("永不自動付款");
    expect(html).toContain("完全自願");
  });

  it("有站名時標示站名，否則退回 URL（都要說得出是哪一座）", () => {
    expect(render({ relayName: "某某節點" })).toContain("某某節點");
    expect(render()).toContain("wss://relay.example");
  });

  it("提供關閉鈕（ADR-0089：可關閉）", () => {
    expect(render()).toContain('data-testid="sponsor-dismiss"');
  });

  it("沒有任何管道 → 不渲染（不留空卡）", () => {
    expect(render({ donations: [] })).toBe("");
  });
});

describe("贊助卡的「不再顯示」記憶（ADR-0262）", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("關閉後記住；只影響該座", () => {
    expect(isSponsorDismissed("wss://a.example")).toBe(false);
    dismissSponsor("wss://a.example");
    expect(isSponsorDismissed("wss://a.example")).toBe(true);
    expect(isSponsorDismissed("wss://b.example")).toBe(false); // 換座要重新問一次
  });

  it("URL 正規化：尾斜線與大小寫視為同一座", () => {
    dismissSponsor("wss://Relay.Example/");
    expect(isSponsorDismissed("wss://relay.example")).toBe(true);
  });

  it("localStorage 不可用時不炸，且當作沒關過（寧可多顯示一次也不永久隱藏）", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(isSponsorDismissed("wss://a.example")).toBe(false);
    expect(() => dismissSponsor("wss://a.example")).not.toThrow();
  });
});
