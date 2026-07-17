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

describe("封鎖（行動端）", () => {
  const bob: MobileContact = { pubkey: "pk_bob", name: "Bob", status: "online" };

  it("未提供 onBlock → 不顯示封鎖入口（如示範模式）", () => {
    const html = renderToStaticMarkup(
      <ContactListScreen selfPubkey={"aa".repeat(32)} selfName="我" contacts={[bob]} locale="en" />,
    );
    // 用 testID 斷言（不是字串 "Block"）——react-native-web 產生的 CSS class 含 `r-paddingBlock-…`，
    // 用字串比對會誤判。
    expect(html).not.toContain('data-testid="block-pk_bob"');
  });

  it("封鎖鈕要長按才出現（避免誤觸把人封鎖掉）", () => {
    const html = renderToStaticMarkup(
      <ContactListScreen
        selfPubkey={"aa".repeat(32)}
        selfName="我"
        contacts={[bob]}
        onBlock={() => {}}
        locale="en"
      />,
    );
    expect(html).toContain("Bob");
    expect(html).not.toContain('data-testid="block-pk_bob"'); // 未長按 → 不顯示
  });

  it("移除聯絡人（ADR-0169，非封鎖）：未提供 onRemove → 無移除入口；提供也需長按才出現", () => {
    const without = renderToStaticMarkup(
      <ContactListScreen selfPubkey={"aa".repeat(32)} selfName="我" contacts={[bob]} onBlock={() => {}} locale="en" />,
    );
    expect(without).not.toContain('data-testid="remove-pk_bob"'); // 未提供 onRemove
    const withRemove = renderToStaticMarkup(
      <ContactListScreen
        selfPubkey={"aa".repeat(32)}
        selfName="我"
        contacts={[bob]}
        onRemove={() => {}}
        locale="en"
      />,
    );
    expect(withRemove).toContain("Bob");
    expect(withRemove).not.toContain('data-testid="remove-pk_bob"'); // 未長按 → 不顯示（避免誤觸）
  });

  it("已封鎖名單可解除；被封鎖者不再出現在聯絡人區", () => {
    const html = renderToStaticMarkup(
      <ContactListScreen
        selfPubkey={"aa".repeat(32)}
        selfName="我"
        contacts={[]}
        blocked={[{ pubkey: "pk_eve", name: "Eve" }]}
        onUnblock={() => {}}
        locale="en"
      />,
    );
    expect(html).toContain("Blocked"); // 區標題
    expect(html).toContain("Eve");
    expect(html).toContain("Unblock");
  });
});

describe("行動端訊息請求區（ADR-0121）", () => {
  const requests = [{ pubkey: "zz", name: "小明" }];
  const render = (extra: Record<string, unknown>) =>
    renderToStaticMarkup(
      <ContactListScreen selfPubkey={"aa".repeat(32)} selfName="我" contacts={[]} {...extra} />,
    );

  it("沒有請求時完全不顯示", () => {
    expect(render({})).not.toContain('data-testid="requests"');
  });

  it("顯示請求者與接受／刪除（testID 斷言——RN-web 的 class 名不可靠）", () => {
    const html = render({ requests, onAcceptRequest: () => {}, onDeclineRequest: () => {} });
    expect(html).toContain('data-testid="requests"');
    expect(html).toContain('data-testid="request-accept-zz"');
    expect(html).toContain('data-testid="request-decline-zz"');
    expect(html).toContain("小明");
  });

  it("說明接受前對方能做什麼（使用者要能判斷風險）", () => {
    expect(render({ requests })).toContain("不會跳通知");
  });

  it("請求者不混進聯絡人名冊", () => {
    const html = render({ requests, contacts: [] });
    expect(html.split("小明")).toHaveLength(2);
  });
});

describe("行動端訊息請求防洪：全部刪除（ADR-0127）", () => {
  const two = [{ pubkey: "z1", name: "甲" }, { pubkey: "z2", name: "乙" }];
  const render = (extra: Record<string, unknown>) =>
    renderToStaticMarkup(<ContactListScreen selfPubkey={"aa".repeat(32)} selfName="我" contacts={[]} {...extra} />);

  it("多於一筆時顯示「全部刪除」", () => {
    expect(render({ requests: two, onClearRequests: () => {} })).toContain('data-testid="requests-clear"');
  });

  it("只有一筆時不顯示", () => {
    expect(render({ requests: [two[0]], onClearRequests: () => {} })).not.toContain('data-testid="requests-clear"');
  });
});
