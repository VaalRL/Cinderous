import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentTypeOf, HOST, portBusyMessage, resolveAsset, startServer } from "./serve.js";

/** 建一個假的「已建置 App」目錄。 */
function fakeBuild(): string {
  const root = mkdtempSync(join(tmpdir(), "cinder-serve-"));
  writeFileSync(join(root, "index.html"), "<h1>cinder</h1>");
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "assets", "app.js"), "export const x = 1;");
  return root;
}

const servers: { close(cb: () => void): void }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe("resolveAsset：路徑穿越防護（ADR-0113）", () => {
  const root = fakeBuild();

  it("正常路徑解析得到檔案", () => {
    expect(resolveAsset(root, "/index.html")).toBe(join(root, "index.html"));
    expect(resolveAsset(root, "/assets/app.js")).toBe(join(root, "assets", "app.js"));
    expect(resolveAsset(root, "/assets/app.js?v=1#x")).toBe(join(root, "assets", "app.js")); // 去掉 query/hash
  });

  it("**`..` 穿越被擋下**", () => {
    expect(resolveAsset(root, "/../../../etc/passwd")).toBeNull();
    expect(resolveAsset(root, "/assets/../../secret")).toBeNull();
  });

  it("**URL 編碼的穿越被擋下**（`%2e%2e` = `..`）", () => {
    expect(resolveAsset(root, "/%2e%2e/%2e%2e/etc/passwd")).toBeNull();
    expect(resolveAsset(root, "/assets/%2e%2e%2f%2e%2e%2fsecret")).toBeNull();
  });

  it("絕對路徑不會逃出 root（前導 `/` 一律當成相對於 root）", () => {
    expect(resolveAsset(root, "/etc/passwd")).toBeNull(); // root 底下沒有 etc/passwd
  });

  it("反斜線（Windows 分隔符）也不能逃出去", () => {
    expect(resolveAsset(root, "\\..\\..\\secret")).toBeNull();
  });

  it("非法百分號編碼與 NUL 位元組回 null（不丟例外）", () => {
    expect(resolveAsset(root, "/%zz")).toBeNull();
    expect(resolveAsset(root, "/a%00.js")).toBeNull();
  });

  it("目錄不算檔案（不列目錄）", () => {
    expect(resolveAsset(root, "/assets")).toBeNull();
    expect(resolveAsset(root, "/")).toBeNull();
  });
});

describe("contentTypeOf", () => {
  it("常見型別；未知 → octet-stream（不嗅探）", () => {
    expect(contentTypeOf("/a/app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeOf("/a/x.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeOf("/a/x.unknown")).toBe("application/octet-stream");
  });
});

describe("靜態伺服器（ADR-0113）", () => {
  it("送出資源；未知路徑退回 index.html（SPA）", async () => {
    const root = fakeBuild();
    const server = await startServer({ root, port: 0 });
    servers.push(server);
    const port = (server.address() as { port: number }).port;

    const asset = await fetch(`http://${HOST}:${port}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("javascript");
    expect(await asset.text()).toContain("export const x");

    const spa = await fetch(`http://${HOST}:${port}/some/client/route`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain("cinder"); // index.html
  });

  it("路徑穿越在 HTTP 層也擋得住（退回 index，不會吐出 root 外的檔案）", async () => {
    const root = fakeBuild();
    writeFileSync(join(root, "..", "cinder-secret.txt"), "TOP SECRET");
    const server = await startServer({ root, port: 0 });
    servers.push(server);
    const port = (server.address() as { port: number }).port;

    const res = await fetch(`http://${HOST}:${port}/../cinder-secret.txt`);
    expect(await res.text()).not.toContain("TOP SECRET");
  });

  it("不設任何 CORS 標頭（其他 origin 不得讀取），且不嗅探型別", async () => {
    const root = fakeBuild();
    const server = await startServer({ root, port: 0 });
    servers.push(server);
    const port = (server.address() as { port: number }).port;

    const res = await fetch(`http://${HOST}:${port}/index.html`);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("非 GET/HEAD → 405", async () => {
    const root = fakeBuild();
    const server = await startServer({ root, port: 0 });
    servers.push(server);
    const port = (server.address() as { port: number }).port;
    expect((await fetch(`http://${HOST}:${port}/`, { method: "POST" })).status).toBe(405);
  });

  it("**撞埠時 reject，不自動換一個**——自動換 port 會把使用者帶進空白的 App", async () => {
    const root = fakeBuild();
    const first = await startServer({ root, port: 0 });
    servers.push(first);
    const port = (first.address() as { port: number }).port;

    await expect(startServer({ root, port })).rejects.toMatchObject({ code: "EADDRINUSE" });
  });

  it("撞埠訊息說明「為什麼不換 port」（origin ＝ 資料的身分）", () => {
    const msg = portBusyMessage(7847);
    expect(msg).toContain("7847");
    expect(msg).toContain("origin");
  });
});
