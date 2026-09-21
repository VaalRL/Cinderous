import { describe, expect, it } from "vitest";
import { asLocale, catalog, createT, detectLocale, LOCALES, translate } from "./index.js";

describe("i18n", () => {
  it("每個語系都有完整且鍵一致的訊息", () => {
    const zhKeys = Object.keys(catalog["zh-Hant"]).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(catalog[locale]).sort()).toEqual(zhKeys);
    }
  });

  it("依語系翻譯", () => {
    expect(translate("zh-Hant", "status_online")).toBe("線上");
    expect(translate("en", "status_online")).toBe("Online");
  });

  it("插值參數", () => {
    expect(translate("en", "convo_typing", { name: "Bob" })).toBe("Bob is typing…");
    expect(translate("zh-Hant", "group_online", { count: 3 })).toBe("線上 (3)");
  });

  it("createT 綁定語系", () => {
    const t = createT("en");
    expect(t("signIn_button")).toBe("Sign in");
  });

  it("detectLocale 由偏好語言推測", () => {
    expect(detectLocale("zh-TW")).toBe("zh-Hant");
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("fr")).toBe("zh-Hant"); // 回退預設
    expect(detectLocale(null)).toBe("zh-Hant");
  });

  it("asLocale 收斂無效值", () => {
    expect(asLocale("en")).toBe("en");
    expect(asLocale("xx")).toBe("zh-Hant");
    expect(asLocale(null)).toBe("zh-Hant");
  });
});

// ADR-0302 §4／ADR-0306：FS 相關文案的紅線。放在 i18n 層是刻意的——
// 桌面與行動端共用同一份文案，在這裡鎖住就同時保護兩端，不會有一端漂移。
describe("FS 文案紅線（ADR-0302 §4／ADR-0306 D1）", () => {
  it("🔴「不支援的機制」與「疑似降級」必須是不同的兩句話", () => {
    for (const locale of LOCALES) {
      expect(translate(locale, "fs_unsupportedWarning")).not.toBe(translate(locale, "fs_downgradeWarning"));
    }
  });

  it("🔴 三句話兩兩互異（ADR-0302 §4 的完整形態）", () => {
    // ADR-0302 §3 記強度之後多了第三種情況：**對方退回較弱的機制**。
    // 那與「還沒收到他的金鑰」是完全不同的事，共用一句話就是把確定的訊號講成暫時的雜訊。
    for (const locale of LOCALES) {
      const three = ["fs_downgradeWarning", "fs_rollbackWarning", "fs_unsupportedWarning"] as const;
      const said = three.map((k) => translate(locale, k));
      expect(new Set(said).size).toBe(3);
    }
  });

  it("🔴 退回較弱機制**不得**說成「稍後會自動更新」——它不會自己好", () => {
    // 既有的 fs_downgradeWarning 有這層安撫（對它自己的情況是對的：金鑰還沒同步而已）。
    // 退回較弱機制是對方**明說**要用較弱的，安撫在這裡是誤導。
    const zh = translate("zh-Hant", "fs_rollbackWarning");
    expect(zh).toContain("較弱");
    expect(zh).not.toContain("自動更新");
    const en = translate("en", "fs_rollbackWarning").toLowerCase();
    expect(en).toContain("weaker");
    expect(en).not.toContain("automatically");
  });

  it("🔴「不支援的機制」不得寫成安全警告——對方是升級了，不是被攻擊", () => {
    // 把「你該更新」顯示成「對方可能被攻擊」就是說謊（同 ADR-0278／0287 的立場）。
    expect(translate("zh-Hant", "fs_unsupportedWarning")).toContain("更新");
    expect(translate("zh-Hant", "fs_unsupportedWarning")).not.toContain("攻擊");
    const en = translate("en", "fs_unsupportedWarning").toLowerCase();
    expect(en).toContain("update");
    expect(en).not.toContain("attack");
  });

  it("🔴 常駐揭露必須講明「未經外部審計」（ADR-0306 D1 的驗收條件）", () => {
    expect(translate("zh-Hant", "fs_unaudited")).toContain("外部");
    expect(translate("zh-Hant", "fs_unaudited")).toContain("審計");
    expect(translate("en", "fs_unaudited").toLowerCase()).toContain("audit");
  });

  it("🔴 啟用確認必須重述「未經審計」，不得只說「要啟用嗎」", () => {
    expect(translate("zh-Hant", "fs_enableConfirm")).toContain("審計");
    expect(translate("en", "fs_enableConfirm").toLowerCase()).toContain("audit");
  });

  it("🔴 標題必須是「實驗性」而非「進階」（ADR-0306 §3：後者讀起來像成熟功能）", () => {
    expect(translate("zh-Hant", "fs_title")).toContain("實驗性");
    expect(translate("en", "fs_title").toLowerCase()).toContain("experimental");
  });
});

// ── 🔴 後量子文案紅線（ADR-0365／ADR-0306 D2.2）────────────────────────────
//
// 本版**還沒有任何後量子文案**（公告開關關著、沒有對應的 UI），所以下面這組測試
// 今天是空跑的。**這正是重點**：它不是在驗現況，是在「有人寫下第一句」的那一刻咬住。
//
// 為什麼這條線必須存在：混合式 KEM 換掉的只有**加密**。事件簽章仍是 secp256k1
// ⇒ 一個真的有量子電腦的攻擊者**照樣偽造得出訊息**。我們買到的只有一件事：
// 今天被側錄的密文，未來解不開（harvest-now-decrypt-later）。
// 把那寫成「量子安全」，與 ADR-0302 §4 抓過的「對等宣稱」是同一種謊。
describe("後量子文案紅線（ADR-0365）", () => {
  /** 掃全部語系的全部字串。 */
  const everyString = (): { locale: string; key: string; text: string }[] =>
    LOCALES.flatMap((locale) =>
      Object.entries(catalog[locale]).map(([key, text]) => ({ locale, key, text: String(text) })),
    );

  it("🔴 沒有任何一則文案宣稱「量子安全／抗量子」這類包山包海的話", () => {
    // 這些詞的問題不在於誇張，在於它們指的是**整個產品**，而我們換掉的只有加密那一半。
    const banned = [/量子安全/, /抗量子/, /防量子/, /量子級/, /quantum[-\s]?safe/i, /quantum[-\s]?proof/i];
    const bad = everyString().filter((e) => banned.some((re) => re.test(e.text)));
    expect(bad.map((e) => `${e.locale}:${e.key}`)).toEqual([]);
  });

  it("🔴 提到「後量子」的文案必須同時寫明實驗性／未經審計", () => {
    // 與 `fs_unaudited`／`fs_enableConfirm` 同一條規則（ADR-0306 D1）：
    // 一個尚未經外部審計的自製組合器，不該以成熟功能的口吻出現。
    const mentions = everyString().filter((e) => /後量子|post[-\s]?quantum/i.test(e.text));
    const qualified = (t: string) => /實驗性|未經.*審計|experimental|unaudited|not.*audited/i.test(t);
    expect(mentions.filter((e) => !qualified(e.text)).map((e) => `${e.locale}:${e.key}`)).toEqual([]);
  });
});

// ADR-0305 §6.1：這句文案在「還原範圍」上說得比實際多。與入口整併**脫鉤**、必改。
describe("中繼大檔提示的文案紅線（ADR-0344）", () => {
  it("🔴「確定在中繼上」與「無法確認」必須是不同的兩句話", () => {
    // 判定層刻意保留 `unknown` 而不猜（ADR-0344 §決策二）；若兩句文案相同，那個誠實
    // 就在最後一哩被抹掉——使用者看到的仍是「你正在中繼上」這個沒有根據的斷言。
    for (const locale of LOCALES) {
      expect(translate(locale, "fileGate_relayWarn")).not.toBe(translate(locale, "fileGate_unknownWarn"));
    }
  });

  it("🔴「無法確認」不得寫成斷言——那是假警報，ADR-0210 拿掉全域 P2P 錯誤正是為此", () => {
    expect(translate("zh-Hant", "fileGate_unknownWarn")).toContain("無法確認");
    expect(translate("en", "fileGate_unknownWarn").toLowerCase()).toContain("cannot confirm");
    // 確定的那句反而不該說「無法確認」。
    expect(translate("zh-Hant", "fileGate_relayWarn")).not.toContain("無法確認");
    expect(translate("en", "fileGate_relayWarn").toLowerCase()).not.toContain("cannot confirm");
  });

  it("🔴 是提示不是封鎖——兩句都要問「仍要傳送嗎」，而不是宣告不能送", () => {
    for (const key of ["fileGate_relayWarn", "fileGate_unknownWarn"] as const) {
      expect(translate("zh-Hant", key)).toContain("仍要傳送嗎");
      expect(translate("en", key).toLowerCase()).toContain("anyway?");
    }
  });

  it("兩句都要插得進檔案大小（少了 {size} 使用者無從判斷值不值得）", () => {
    for (const key of ["fileGate_relayWarn", "fileGate_unknownWarn"] as const) {
      for (const locale of LOCALES) {
        expect(translate(locale, key, { size: "60.0 MB" })).toContain("60.0 MB");
      }
    }
  });
});

describe("nsec 登入的還原範圍要誠實（ADR-0305 §6.1）", () => {
  it("🔴 不得無條件宣稱「訊息會一起回來」——貼 nsec 拿不回本機歷史，也拿不回 EK", () => {
    // 事實：`fsState` 來自 `storage.loadFsState()`（本機），而備份碼刻意身分-only（0245 §2）
    // ⇒ 全新裝置貼 nsec／救援碼後，中繼 7 天窗內**加密到 EK 的那部分永遠解不開**。
    const zh = translate("zh-Hant", "signIn_useNsecHint");
    expect(zh).not.toContain("原本的聯絡人與訊息會一起回來");
  });

  it("🔴 必須指出「更早的歷史」要靠搬家或多裝置同步", () => {
    const zh = translate("zh-Hant", "signIn_useNsecHint");
    expect(zh).toMatch(/搬家|同步/);
    const en = translate("en", "signIn_useNsecHint").toLowerCase();
    expect(en).toMatch(/transfer|sync/);
  });

  it("🔴 必須指出前向保密的子鑰不含在 nsec 裡", () => {
    expect(translate("zh-Hant", "signIn_useNsecHint")).toContain("子鑰");
    expect(translate("en", "signIn_useNsecHint").toLowerCase()).toContain("subkey");
  });
});
