// Tauri CSP 防回歸（ADR-0235 C4）。
//
// 桌面 webview 擁有整個原生橋：`key_get` 直接回傳 nsec 明文、`store_load` 回傳解密後的
// 全量狀態。Tauri v2 的 app-local commands **不受** `capabilities/*.json` 的權限清單管轄
// ——一旦 webview 有任何 XSS，就是私鑰外洩。CSP 是最後一道縱深防禦，不該缺席。
//
// 這份測試存在的理由：`"csp": null` 是 Tauri 的預設值，且完全不會有任何錯誤或警告
// ——沒有守門測試，它會在某次「清一清設定檔」時悄悄回來。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")) as {
  app?: { security?: { csp?: unknown; devCsp?: unknown } };
};

const csp = conf.app?.security?.csp;

describe("Tauri 安全設定（ADR-0235 C4）", () => {
  it("csp 必須設定，且不得為 null／空字串", () => {
    expect(typeof csp).toBe("string");
    expect(csp).not.toBe("");
  });

  it("必要指令齊備：預設收斂、禁用 inline script 與物件嵌入", () => {
    const policy = String(csp);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("script-src 不得放行 unsafe-inline／unsafe-eval（XSS＝私鑰外洩）", () => {
    const scriptSrc = /script-src([^;]*)/.exec(String(csp))?.[1] ?? "";
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("img-src 不放行任意遠端主機（遠端圖片＝IP 追蹤信標）", () => {
    const imgSrc = /img-src([^;]*)/.exec(String(csp))?.[1] ?? "";
    expect(imgSrc).not.toContain("https:");
    expect(imgSrc).not.toContain("http:");
    expect(imgSrc).not.toContain("*");
  });

  it("connect-src 必須含 Tauri IPC 與 relay（wss:），否則 App 直接失能", () => {
    const connectSrc = /connect-src([^;]*)/.exec(String(csp))?.[1] ?? "";
    expect(connectSrc).toContain("ipc:");
    expect(connectSrc).toContain("wss:");
  });

  it("connect-src 含 https:：連不上時探測 relay 的 NIP-11，才分得出額度用完與斷網（ADR-0401；SDK ADR 0125）", () => {
    for (const policy of [csp, conf.app?.security?.devCsp]) {
      const connectSrc = /connect-src([^;]*)/.exec(String(policy))?.[1] ?? "";
      expect(connectSrc.split(/\s+/)).toContain("https:");
    }
  });

  it("網頁版（Pages 的 _headers、自架的 Caddyfile）的 connect-src 也含 https:", () => {
    for (const file of ["../public/_headers", "../Caddyfile"]) {
      // 只看真正的標頭那一行（Caddyfile 的註解也提到 connect-src）
      const header = readFileSync(new URL(file, import.meta.url), "utf8")
        .split(/\r?\n/)
        .find((line) => line.includes("Content-Security-Policy"));
      const connectSrc = /connect-src([^;]*)/.exec(header ?? "")?.[1] ?? "";
      expect(connectSrc, file).toMatch(/(^|[\s:])https:(\s|\})/);
    }
  });
});
