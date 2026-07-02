import { describe, expect, it } from "vitest";
import { assessUrl, cleanText, cleanUrl } from "./url-hygiene.js";

describe("追蹤參數清除 cleanUrl（ADR-0038）", () => {
  it("清除 utm_* 前綴與已知追蹤參數，保留功能參數", () => {
    expect(cleanUrl("https://ex.com/a?utm_source=x&utm_medium=y&q=貓&fbclid=abc&id=7")).toBe(
      "https://ex.com/a?q=%E8%B2%93&id=7",
    );
  });

  it("query 全為追蹤參數時去除殘留的 '?'", () => {
    expect(cleanUrl("https://ex.com/a?gclid=1")).toBe("https://ex.com/a");
    expect(cleanUrl("https://ex.com/a?gclid=1#frag")).toBe("https://ex.com/a#frag");
  });

  it("無可清除時原樣回傳（不做 URL 正規化改寫）", () => {
    expect(cleanUrl("https://ex.com")).toBe("https://ex.com"); // 不補尾斜線
    expect(cleanUrl("https://ex.com/a?q=1")).toBe("https://ex.com/a?q=1");
    expect(cleanUrl("不是網址")).toBe("不是網址");
  });

  it("站點範圍規則：si 只在 YouTube/Spotify 清、其他站保留", () => {
    expect(cleanUrl("https://youtu.be/xyz?si=AAA")).toBe("https://youtu.be/xyz");
    expect(cleanUrl("https://www.youtube.com/watch?v=xyz&si=AAA")).toBe("https://www.youtube.com/watch?v=xyz");
    expect(cleanUrl("https://open.spotify.com/track/1?si=BBB")).toBe("https://open.spotify.com/track/1");
    expect(cleanUrl("https://ex.com/a?si=keep")).toBe("https://ex.com/a?si=keep");
  });

  it("Amazon：/ref= 路徑段與 pd_rd_/pf_rd_ 前綴", () => {
    expect(cleanUrl("https://www.amazon.com/dp/B01/ref=sr_1_1?pd_rd_r=x&pf_rd_p=y&th=1")).toBe(
      "https://www.amazon.com/dp/B01?th=1",
    );
  });

  it("大小寫不敏感（FBCLID 也清）", () => {
    expect(cleanUrl("https://ex.com/a?FBCLID=1&q=2")).toBe("https://ex.com/a?q=2");
  });
});

describe("文字清理 cleanText", () => {
  it("清理文中多個網址、保留其他文字與尾隨標點", () => {
    const r = cleanText("看這個 https://a.com/x?utm_source=1，還有 https://b.com/y?fbclid=2!");
    expect(r.text).toBe("看這個 https://a.com/x，還有 https://b.com/y!");
    expect(r.cleaned).toBe(2);
  });

  it("沒有網址或無可清除：文字不變、count=0", () => {
    expect(cleanText("純文字")).toEqual({ text: "純文字", cleaned: 0 });
    expect(cleanText("乾淨 https://ex.com/a?q=1")).toEqual({ text: "乾淨 https://ex.com/a?q=1", cleaned: 0 });
  });
});

describe("高風險評估 assessUrl（ADR-0038）", () => {
  it("乾淨 https 連結：ok", () => {
    expect(assessUrl("https://example.com/page", "這裡")).toEqual({ level: "ok", reasons: [] });
  });

  it("連結文字偽裝（danger）：文字像網址但網域不符", () => {
    const r = assessUrl("https://evil.io/login", "https://bank.com");
    expect(r.level).toBe("danger");
    expect(r.reasons).toContain("text-mismatch");
    // 純網域文字（無 scheme）也偵測
    expect(assessUrl("https://evil.io", "bank.com/secure").reasons).toContain("text-mismatch");
  });

  it("文字與 href 同站（含 www 與子網域）不算偽裝", () => {
    expect(assessUrl("https://www.example.com/a", "example.com").level).toBe("ok");
    expect(assessUrl("https://docs.example.com/a", "https://example.com").level).toBe("ok");
    expect(assessUrl("https://example.com/a", "普通文字").level).toBe("ok");
  });

  it("userinfo 混淆 / punycode / IP 直連：danger", () => {
    expect(assessUrl("https://google.com@evil.io/").reasons).toContain("userinfo");
    expect(assessUrl("https://xn--80ak6aa92e.com/").reasons).toContain("punycode");
    expect(assessUrl("https://93.184.216.34/login").reasons).toContain("ip-host");
    for (const u of ["https://google.com@evil.io/", "https://xn--80ak6aa92e.com/", "https://93.184.216.34/x"]) {
      expect(assessUrl(u).level).toBe("danger");
    }
  });

  it("http / 非常規 port / 短網址：caution", () => {
    expect(assessUrl("http://example.com/")).toEqual({ level: "caution", reasons: ["http"] });
    expect(assessUrl("https://example.com:8443/").reasons).toContain("odd-port");
    expect(assessUrl("https://bit.ly/abc")).toEqual({ level: "caution", reasons: ["shortener"] });
    expect(assessUrl("https://example.com:443/").level).toBe("ok"); // 標準 port 正常
  });

  it("多信號並存時 danger 蓋過 caution", () => {
    const r = assessUrl("http://93.184.216.34:8080/", "https://bank.com");
    expect(r.level).toBe("danger");
    expect(r.reasons).toEqual(expect.arrayContaining(["text-mismatch", "ip-host", "odd-port", "http"]));
  });
});
