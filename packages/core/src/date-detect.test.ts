import { describe, expect, it } from "vitest";
import { detectDateAtEnd, detectDates } from "./date-detect.js";

/** 2026-07-27（週一）12:00，本機時區。 */
const NOW = new Date(2026, 6, 27, 12, 0, 0);
const at = (text: string): Date | undefined => {
  const hit = detectDates(text, NOW)[0];
  return hit ? new Date(hit.at * 1000) : undefined;
};
const ymd = (d: Date | undefined): string | undefined =>
  d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hm = (d: Date | undefined): string | undefined =>
  d && `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

describe("對話日期偵測（ADR-0260 階段四）", () => {
  describe("相對日", () => {
    it("今天／明天／後天／大後天", () => {
      expect(ymd(at("明天要交"))).toBe("2026-07-28");
      expect(ymd(at("後天見"))).toBe("2026-07-29");
      expect(ymd(at("大後天出發"))).toBe("2026-07-30");
      expect(ymd(at("今天晚上7點"))).toBe("2026-07-27");
    });
    it("英文 tomorrow/today", () => {
      expect(ymd(at("see you tomorrow"))).toBe("2026-07-28");
    });
  });

  describe("週幾", () => {
    it("無前綴＝下一個該週幾（含今天則取今天）", () => {
      expect(ymd(at("週三見"))).toBe("2026-07-29"); // 週一 → 本週三
      expect(ymd(at("禮拜天出遊"))).toBe("2026-08-02");
    });
    it("下週三＝再加一週；下下週三再加兩週", () => {
      expect(ymd(at("下週三"))).toBe("2026-08-05");
      expect(ymd(at("下下週三"))).toBe("2026-08-12");
    });
    it("週/周/星期/禮拜 都認得", () => {
      for (const s of ["週五", "周五", "星期五", "禮拜五"]) expect(ymd(at(s))).toBe("2026-07-31");
    });
    it("英文 next Friday", () => {
      expect(ymd(at("next friday"))).toBe("2026-08-07");
      expect(ymd(at("friday"))).toBe("2026-07-31");
    });
  });

  describe("明確日期", () => {
    it("3/15、3-15、3月15日、12月1號", () => {
      expect(ymd(at("8/15 出發"))).toBe("2026-08-15");
      expect(ymd(at("8-15 出發"))).toBe("2026-08-15");
      expect(ymd(at("8月15日"))).toBe("2026-08-15");
      expect(ymd(at("12月1號"))).toBe("2026-12-01");
    });
    it("沒寫年＝今年；已過就明年（約時間不會約在過去）", () => {
      expect(ymd(at("3/15"))).toBe("2027-03-15"); // 今年 3/15 已過
    });
    it("不存在的日期不報", () => {
      expect(detectDates("2/30", NOW)).toEqual([]);
    });
  });

  describe("時刻", () => {
    it("下午/晚上轉 24 小時制；半＝30 分", () => {
      expect(hm(at("明天下午3點"))).toBe("15:00");
      expect(hm(at("明天晚上7點半"))).toBe("19:30");
      expect(hm(at("明天早上9點"))).toBe("09:00");
    });
    it("中文數字的點數", () => {
      expect(hm(at("明天下午三點"))).toBe("15:00");
      expect(hm(at("明天十一點"))).toBe("11:00");
    });
    it("15:30 與 3pm", () => {
      expect(hm(at("明天 15:30"))).toBe("15:30");
      expect(hm(at("tomorrow 3pm"))).toBe("15:00");
      expect(hm(at("tomorrow 12am"))).toBe("00:00");
    });
    it("沒有時刻時 hasTime=false（UI 可自行預設）", () => {
      expect(detectDates("明天", NOW)[0]?.hasTime).toBe(false);
      expect(detectDates("明天下午3點", NOW)[0]?.hasTime).toBe(true);
    });
  });

  describe("⚠ 偽陽性防線——寧可少報", () => {
    it("過去的日期不報（「我昨天看到」不是在約時間）", () => {
      expect(detectDates("我昨天看到", NOW)).toEqual([]);
      expect(detectDates("上週三那件事", NOW)).toEqual([]);
      expect(detectDates("上上週五", NOW)).toEqual([]);
      expect(detectDates("last friday", NOW)).toEqual([]); // 「上」/`last` 沒列進前綴的話，
      // 比對會從第二個字（「週三」/`friday`）開始，把過去的事報成未來的約定。
    });
    it("今天但時刻已過 → 不報", () => {
      expect(detectDates("今天早上9點", NOW)).toEqual([]); // 現在 12:00
      expect(detectDates("今天下午3點", NOW)).toHaveLength(1);
    });
    it("裸數字不算日期", () => {
      expect(detectDates("編號 315", NOW)).toEqual([]);
      expect(detectDates("共 1234 元", NOW)).toEqual([]);
    });
    it("版本號/多段數字不誤判成日期", () => {
      expect(detectDates("v1/2/3", NOW)).toEqual([]);
      expect(detectDates("2026/3/15", NOW)).toEqual([]);
    });
    it("月份單獨出現不算（「三月的時候」）", () => {
      expect(detectDates("三月的時候", NOW)).toEqual([]);
    });
  });

  describe("多筆與重疊", () => {
    it("長的優先：「下週三」不會被其中的「週三」蓋掉", () => {
      const hits = detectDates("下週三", NOW);
      expect(hits).toHaveLength(1);
      expect(hits[0]!.text).toBe("下週三");
      expect(ymd(new Date(hits[0]!.at * 1000))).toBe("2026-08-05");
    });
    it("一句多個日期，依出現順序回傳且不重疊", () => {
      const hits = detectDates("明天或後天都可以", NOW);
      expect(hits.map((h) => h.text)).toEqual(["明天", "後天"]);
      expect(hits[0]!.end).toBeLessThanOrEqual(hits[1]!.start);
    });
    it("命中片段的起訖對得回原文", () => {
      const text = "那就約明天下午3點吧";
      const hit = detectDates(text, NOW)[0]!;
      expect(text.slice(hit.start, hit.end)).toBe(hit.text);
      expect(hit.text).toBe("明天下午3點");
    });
  });

  describe("composer 尾端偵測（同 ADR-0037 語意）", () => {
    it("剛打完日期才跳；句中早先的日期不跳", () => {
      expect(detectDateAtEnd("約明天", NOW)?.text).toBe("明天");
      expect(detectDateAtEnd("約明天好嗎", NOW)).toBeUndefined();
    });
    it("空草稿不跳", () => {
      expect(detectDateAtEnd("", NOW)).toBeUndefined();
    });
  });
});
