import { describe, expect, it } from "vitest";
import { syncDocumentLang } from "./document-lang.js";

describe("syncDocumentLang", () => {
  it("將語系寫入注入目標的 documentElement.lang", () => {
    const target = { documentElement: { lang: "" } };
    syncDocumentLang("en", target);
    expect(target.documentElement.lang).toBe("en");
    syncDocumentLang("zh-Hant", target);
    expect(target.documentElement.lang).toBe("zh-Hant");
  });

  it("無目標（SSR）時靜默略過、不丟例外", () => {
    expect(() => syncDocumentLang("en", undefined)).not.toThrow();
  });
});
