// 中繼站拒絕連線時指向的文件網址，必須就是官網開發者頁（ADR-0368）。
//
// 那個網址寫死在 `relay/src/host-config.ts`——官網換網域或改路由時，這裡是唯一會提醒你
// 「中繼那邊也要改」的地方。漂移的症狀是：第三方開發者照著 NOTICE 點過來，拿到 404。

import { describe, expect, it } from "vitest";
import { DEVELOPER_DOCS_URL } from "../../../relay/src/host-config.js";
import { routeUrl } from "./routes.js";

describe("中繼的開發者文件網址（ADR-0368）", () => {
  it("等於官網開發者頁（英文，官網預設語言）的絕對網址", () => {
    expect(DEVELOPER_DOCS_URL).toBe(routeUrl({ view: "developers", locale: "en" }));
  });
});
