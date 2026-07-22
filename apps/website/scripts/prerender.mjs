// 建置後預渲染（ADR-0235 SEO-2）。
//
// 流程：`vite build`（客戶端）→ `vite build --ssr`（伺服端）→ 本腳本。
// 讀 `dist/index.html` 當模板，對每一條路由呼叫 `entry-server.renderRoute()`，
// 把 `<!--app-head-->` 與 `<!--app-html-->` 換掉後寫成各自的靜態檔：
//
//   dist/index.html            ← 中文首頁
//   dist/tech/index.html       ← 中文技術頁
//   dist/en/index.html         ← 英文首頁
//   dist/en/tech/index.html    ← …
//
// 產出**實體目錄 + index.html**（而非 SPA fallback）：GitHub Pages 直接就能服務
// `/Cinderous/tech/`，不需要 404 轉址，爬蟲拿到的是 200 而非 404。

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");
const ssrEntry = join(here, "..", "dist-ssr", "entry-server.js");

const template = readFileSync(join(distDir, "index.html"), "utf8");
for (const marker of ["<!--app-head-->", "<!--app-html-->"]) {
  if (!template.includes(marker)) {
    throw new Error(`index.html 缺少佔位 ${marker}——預渲染無處可注入（請勿從模板移除）`);
  }
}

const { renderAll, extraFiles } = await import(pathToFileURL(ssrEntry).href);

const write = (relPath, content) => {
  const out = join(distDir, relPath);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, content, "utf8");
};

const pages = renderAll();
for (const page of pages) {
  const html = template
    .replace('<html lang="zh-Hant">', `<html lang="${page.lang}">`)
    .replace("<!--app-head-->", page.head)
    // 模板自帶的預設 <title> 會與注入的 <title> 重複——移除它，只留每頁專屬的那一個。
    .replace(/\n\s*<title>[^<]*<\/title>/, "")
    .replace("<!--app-html-->", page.body);
  write(page.file, html);
  console.log(`  ✓ ${page.file}`);
}

for (const { file, content } of extraFiles()) {
  write(file, content);
  console.log(`  ✓ ${file}`);
}

// SSR 中繼產物不該進部署成品。
rmSync(join(here, "..", "dist-ssr"), { recursive: true, force: true });

console.log(`預渲染完成：${pages.length} 頁 + robots.txt + sitemap.xml`);
