import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContactListScreen, groupByStatus, type MobileContact } from "./ContactListScreen.js";

const mk = (name: string, status: MobileContact["status"]): MobileContact => ({ pubkey: name, name, status });

describe("行動端 ContactListScreen（Phase D 起手）", () => {
  it("groupByStatus：依 線上→離開→忙碌→離線 分區、每區依名稱、跳過空區", () => {
    const secs = groupByStatus([mk("Zoe", "busy"), mk("Amy", "online"), mk("Bob", "online")]);
    expect(secs.map((s) => s.status)).toEqual(["online", "busy"]);
    expect(secs[0]!.contacts.map((c) => c.name)).toEqual(["Amy", "Bob"]);
  });

  it("以 react-native-web 渲染：含區標題（en）與聯絡人名、self 名", () => {
    const html = renderToStaticMarkup(
      <ContactListScreen selfPubkey={"aa".repeat(32)} selfName="我" contacts={[mk("Bob", "online")]} locale="en" />,
    );
    expect(html).toContain("Bob");
    expect(html).toContain("Online"); // @cinder/i18n translate(en, status_online)
    expect(html).toContain("我"); // self 名
  });

  it("吃 @cinder/theme 主題 props（深色＋自訂主色/副色）仍正常渲染（ADR-0080）", () => {
    // 色彩對齊由 @cinder/theme 的 tokens.test.ts 把關；此處確保新 props 路徑不炸、內容照渲染。
    const html = renderToStaticMarkup(
      <ContactListScreen
        selfPubkey={"bb".repeat(32)}
        selfName="夜"
        contacts={[mk("Amy", "online"), mk("Zoe", "busy")]}
        theme="dark"
        accent="#2f6cd6"
        accent2="#e2632b"
      />,
    );
    expect(html).toContain("Amy");
    expect(html).toContain("Zoe");
    expect(html).toContain("夜");
  });
});
