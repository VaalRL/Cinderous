// 技術原理頁：威脅防護介紹卡（ADR-0231 P4）——主打純本地比對、URL 不外送、可自訂可關。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useCopy } from "../copy.js";
import { Tech } from "./Tech.js";

describe("Tech 威脅防護介紹（ADR-0231 P4）", () => {
  it("zh/en 都有介紹卡並強調純本地與不送 URL", () => {
    const zh = renderToStaticMarkup(<Tech c={useCopy("zh-Hant")} />);
    expect(zh).toContain('data-testid="tech-threat"');
    expect(zh).toContain("純本地");
    expect(zh).toContain("URLhaus");
    const en = renderToStaticMarkup(<Tech c={useCopy("en")} />);
    expect(en).toContain("never sent to any server");
  });
});

describe("Tech 底層機制（進階，ADR-0246）", () => {
  it("zh/en 都有進階區並涵蓋分片、多裝置同步、通話 NAT 穿透", () => {
    const zh = renderToStaticMarkup(<Tech c={useCopy("zh-Hant")} />);
    expect(zh).toContain('data-testid="tech-advanced"');
    expect(zh).toContain("分片"); // 中繼分片
    expect(zh).toContain("多裝置");
    expect(zh).toContain("TURN"); // 通話 NAT 穿透保底
    const en = renderToStaticMarkup(<Tech c={useCopy("en")} />);
    expect(en).toContain("sharding");
    expect(en).toContain("multi-device");
    expect(en).toContain("TURN");
  });

  // FS（前向保密）尚未通過外部審計。
  // ~~原規則：官網文案不得宣稱 FS（ADR-0245）~~
  // → ADR-0306 D2 修訂為「**不得以對等形式宣稱**」：得列入，但必須同時帶
  //   「實驗性」與「未經外部審計」，不得只有名稱。判準是**讀者的認知正不正確**。
  it("技術原理頁有前向保密的限定式說明（ADR-0306 D2.2）", () => {
    // 上一條是**形狀**守則（若提到就必須限定），它容許「乾脆不提」。
    // 這一條釘住「確實有提」，兩條合起來才擋得住兩個方向的漂移。
    expect(renderToStaticMarkup(<Tech c={useCopy("zh-Hant")} />)).toContain('data-testid="tech-fs"');
    expect(renderToStaticMarkup(<Tech c={useCopy("en")} />)).toContain('data-testid="tech-fs"');
  });

  it("🔴 提到前向保密時，必須同時帶「實驗性」與「未經外部審計」——不得只有名稱", () => {
    const zh = renderToStaticMarkup(<Tech c={useCopy("zh-Hant")} />);
    if (zh.includes("前向保密")) {
      expect(zh).toContain("實驗性");
      expect(zh).toContain("審計");
    }
    const en = renderToStaticMarkup(<Tech c={useCopy("en")} />).toLowerCase();
    if (en.includes("forward secrecy")) {
      expect(en).toContain("experimental");
      expect(en).toContain("audit");
    }
  });
});

describe("Tech 原理圖傳訊角色＝吉祥物（ADR-0247 延伸）", () => {
  it("兩張圖的角色都是 CinderMascot，且保留角色標題", () => {
    const zh = renderToStaticMarkup(<Tech c={useCopy("zh-Hant")} />);
    expect(zh).toContain('aria-label="Cinderous"'); // 待機吉祥物
    expect(zh).toContain('aria-label="Cinderous（有新訊息）"'); // FlowDiagram 收件者 alert
    expect(zh).toContain("<title>你</title>"); // 角色標題（無障礙）仍在
    expect(zh).toContain("<title>好友</title>");
    // 不應再是原本的通用人物頭像（circle 頭 + 肩弧），改吉祥物後不再用 var(--muted) 填頭
    const en = renderToStaticMarkup(<Tech c={useCopy("en")} />);
    expect(en).toContain("<title>You</title>");
    expect(en).toContain("<title>Friend</title>");
  });
});
