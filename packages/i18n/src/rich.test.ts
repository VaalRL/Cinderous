import { describe, expect, it } from "vitest";
import { catalog } from "./messages.js";
import { richSegments, stripRich } from "./rich.js";

// UI 字串與發版條目用 **粗體** 與 `程式碼` 標重點；畫面要渲染、不能原樣露出星號。
describe("richSegments：只認 **粗體** 與 `程式碼`", () => {
  it("拆成段落", () => {
    expect(richSegments("**新功能：** 設 `ROSTER_ADMIN_PUBKEY` 就好")).toEqual([
      { kind: "bold", text: "新功能：" },
      { kind: "text", text: " 設 " },
      { kind: "code", text: "ROSTER_ADMIN_PUBKEY" },
      { kind: "text", text: " 就好" },
    ]);
  });

  it("沒有標記 → 一段純文字；沒配對的星號或反引號原樣保留", () => {
    expect(richSegments("一般文字")).toEqual([{ kind: "text", text: "一般文字" }]);
    expect(richSegments("a ** b ` c")).toEqual([{ kind: "text", text: "a ** b ` c" }]);
  });

  it("🔴 底線不是斜體：MAX_TTL_DAYS 這類設定名原樣保留", () => {
    expect(richSegments("自架 relay 設 MAX_TTL_DAYS")).toEqual([{ kind: "text", text: "自架 relay 設 MAX_TTL_DAYS" }]);
  });

  it("換行保留在文字段裡（對話框靠 pre-wrap 排版）", () => {
    expect(richSegments("第一行\n・**重點**")).toEqual([
      { kind: "text", text: "第一行\n・" },
      { kind: "bold", text: "重點" },
    ]);
  });
});

describe("stripRich：不能渲染的地方（原生 confirm、系統通知、手機訊息）拿掉標記", () => {
  it("留下文字、去掉 ** 與反引號", () => {
    expect(stripRich("這個傳輸**不支援**續傳，設 `MAX_FILE_MB`")).toBe("這個傳輸不支援續傳，設 MAX_FILE_MB");
  });
});

describe("所有語系字串的標記都成對", () => {
  it("每個字串渲染後都不再露出 **", () => {
    for (const [locale, messages] of Object.entries(catalog)) {
      for (const [key, value] of Object.entries(messages)) {
        for (const s of richSegments(String(value))) {
          if (s.kind !== "code") expect(s.text, `${locale}.${key}`).not.toContain("**");
        }
      }
    }
  });
});
