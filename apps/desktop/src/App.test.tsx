import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "./i18n.js";
import {
  AddIdentityModal,
  convoVisibleIn,
  nextActiveAfterRemoval,
  pickSignInNamespace,
  profileGlyph,
  relayChangeTarget,
  RosterAdminModal,
  shouldMuteOrgNotification,
} from "./App.js";
import type { Profile } from "@cinder/engine";

const renderModal = (
  defaultRelayUrl: string,
  initialMode: "personal" | "org" | "owner" | null = "personal",
): string =>
  renderToStaticMarkup(
    <I18nProvider locale="zh-Hant">
      <AddIdentityModal
        defaultRelayUrl={defaultRelayUrl}
        initialMode={initialMode}
        onAdd={() => {}}
        onCancel={() => {}}
      />
    </I18nProvider>,
  );

describe("AddIdentityModal", () => {
  it("relay 欄位預填目前作用中身分的網址（可改）", () => {
    expect(renderModal("wss://relay.example")).toContain('value="wss://relay.example"');
  });

  it("預設值為空字串時 relay 欄位維持空白且建立鈕停用", () => {
    expect(renderModal("")).toContain("disabled");
  });

  it("經 i18n 呈現（D）：標題與建立鈕走訊息目錄", () => {
    const out = renderModal("wss://x");
    expect(out).toContain("新增身分"); // addId_title
    expect(out).toContain("建立並切換"); // addId_submit
  });

  it("ADR-0145/0155：預設先顯示「個人／企業成員／企業主」選類型步驟，尚未出現表單", () => {
    const out = renderModal("wss://x", null);
    expect(out).toContain('data-testid="addid-mode-personal"');
    expect(out).toContain('data-testid="addid-mode-org"');
    expect(out).toContain('data-testid="addid-mode-owner"');
    expect(out).not.toContain('value="wss://x"'); // relay 欄位尚未出現
  });

  it("ADR-0145：選「組織」後表單出現管理者 npub 欄位；ADR-0156：另有邀請碼貼入欄", () => {
    const out = renderModal("wss://x", "org");
    expect(out).toContain('data-testid="addid-admin"');
    expect(out).toContain('data-testid="addid-invite"');
    expect(out).not.toContain('data-testid="addid-invite-ok"'); // 尚未貼碼
  });

  it("ADR-0145：選「個人」表單不含管理者 npub 欄位", () => {
    const out = renderModal("wss://x", "personal");
    expect(out).not.toContain('data-testid="addid-admin"');
  });

  it("ADR-0155：選「企業主」表單＝個人表單（無管理者欄——自己就是管理者）＋🗂 類型標示", () => {
    const out = renderModal("wss://x", "owner");
    expect(out).not.toContain('data-testid="addid-admin"');
    expect(out).toContain("🗂");
    expect(out).toContain("企業主（建立組織名冊）"); // addId_modeOwner
    expect(out).toContain('value="wss://x"'); // 進入表單（relay 欄位已出現）
  });
});

describe("profileGlyph（ADR-0155：身分類型圖示）", () => {
  it("🗂 企業主 ＞ 🏢 企業成員 ＞ 👤 個人；null 回 👤", () => {
    expect(profileGlyph(prof({ orgOwner: true }))).toBe("🗂");
    expect(profileGlyph(prof({ enterprise: true }))).toBe("🏢");
    expect(profileGlyph(prof())).toBe("👤");
    expect(profileGlyph(null)).toBe("👤");
  });
});

const prof = (over: Partial<Profile> = {}): Profile => ({
  pubkey: "a",
  name: "我",
  relayUrl: "wss://x",
  enterprise: false,
  namespace: "",
  ...over,
});

describe("pickSignInNamespace（ADR-0140：登入建身分的命名空間隔離）", () => {
  it("第一個身分（登錄無人佔用 \"\"）→ 沿用空命名空間（向後相容）", () => {
    expect(pickSignInNamespace([], "pk_new")).toBe("");
    // 登錄裡的身分都用非空命名空間 → 仍可讓下一個用 ""？不：只要沒人佔 "" 就給 ""。
    expect(pickSignInNamespace([prof({ pubkey: "b", namespace: "b" })], "pk_new")).toBe("");
  });

  it("🔴 已有身分佔用 \"\" → 新身分改用自己的 pubkey 命名空間（不讀到第一個身分的聯絡人）", () => {
    const existing = [prof({ pubkey: "a", namespace: "" })];
    expect(pickSignInNamespace(existing, "pk_new")).toBe("pk_new");
  });
});

describe("relayChangeTarget（ADR-0066 H2 更換守門）", () => {
  it("合法新網址：回傳正規化結果（trim、去尾斜線）", () => {
    expect(relayChangeTarget(prof(), " wss://y/ ")).toBe("wss://y");
  });

  it("同值（含正規化等價）與非法網址 → null（no-op）", () => {
    expect(relayChangeTarget(prof(), "wss://x/")).toBeNull();
    expect(relayChangeTarget(prof(), "https://y")).toBeNull();
    expect(relayChangeTarget(prof(), "")).toBeNull();
  });

  it("企業身分鎖定漫遊、無作用中身分 → null", () => {
    expect(relayChangeTarget(prof({ enterprise: true }), "wss://y")).toBeNull();
    expect(relayChangeTarget(null, "wss://y")).toBeNull();
  });
});

describe("convoVisibleIn（ADR-0079 三欄可視性修正）", () => {
  it("經典：聚焦時所有對話皆可見（不看是否 active）", () => {
    expect(convoVisibleIn("classic", "a", "b", false)).toBe(true);
    expect(convoVisibleIn("classic", "a", "a", false)).toBe(true);
  });
  it("視窗未聚焦：一律不可見", () => {
    expect(convoVisibleIn("classic", "a", "a", true)).toBe(false);
    expect(convoVisibleIn("modern", "a", "a", true)).toBe(false);
  });
  it("三欄：僅 active 分頁可見，背景分頁不可見（不誤送已讀/仍累未讀）", () => {
    expect(convoVisibleIn("modern", "a", "a", false)).toBe(true);
    expect(convoVisibleIn("modern", "a", "b", false)).toBe(false);
    expect(convoVisibleIn("modern", null, "a", false)).toBe(false);
  });
});

describe("nextActiveAfterRemoval（ADR-0079 Q3 activeConvo 遞補）", () => {
  it("移除的非作用中分頁：作用中不變", () => {
    expect(nextActiveAfterRemoval(["a", "b"], "a", "b")).toBe("b");
  });
  it("關中間的作用中分頁：遞補右側相鄰", () => {
    expect(nextActiveAfterRemoval(["a", "b", "c", "d", "e"], "c", "c")).toBe("d");
  });
  it("關最後的作用中分頁：遞補左側（剩餘最後一個）", () => {
    expect(nextActiveAfterRemoval(["a", "b", "c"], "c", "c")).toBe("b");
  });
  it("關第一個作用中分頁：遞補右側", () => {
    expect(nextActiveAfterRemoval(["a", "b"], "a", "a")).toBe("b");
  });
  it("關唯一分頁：回 null（中欄回空狀態、不留幽靈）", () => {
    expect(nextActiveAfterRemoval(["a"], "a", "a")).toBeNull();
  });
});

describe("shouldMuteOrgNotification（ADR-0157：下班自動靜音）", () => {
  const info = { members: ["m1", "m2"], workHours: { start: "09:00", end: "18:00" } };

  it("下班時間＋組織來源（成員 1:1 或組織群組）→ 靜音", () => {
    expect(shouldMuteOrgNotification(info, { senderContact: "m1" }, 20 * 60)).toBe(true);
    expect(shouldMuteOrgNotification(info, { orgGroup: true }, 20 * 60)).toBe(true);
  });

  it("上班時間內、或非組織來源 → 不靜音", () => {
    expect(shouldMuteOrgNotification(info, { senderContact: "m1" }, 10 * 60)).toBe(false); // 上班中
    expect(shouldMuteOrgNotification(info, { senderContact: "stranger" }, 20 * 60)).toBe(false); // 私人聯絡人
    expect(shouldMuteOrgNotification(info, { orgGroup: false }, 20 * 60)).toBe(false); // 私人群組
  });

  it("未設班表或無組織資訊 → 永不靜音", () => {
    expect(shouldMuteOrgNotification({ members: ["m1"] }, { senderContact: "m1" }, 20 * 60)).toBe(false);
    expect(shouldMuteOrgNotification(null, { senderContact: "m1" }, 20 * 60)).toBe(false);
  });
});

describe("RosterAdminModal（ADR-0157：公司設定欄位＋現行名冊預填）", () => {
  const render = (initial?: Parameters<typeof RosterAdminModal>[0]["initial"]) =>
    renderToStaticMarkup(
      <I18nProvider locale="zh-Hant">
        <RosterAdminModal
          selfNpub="npub1self"
          onPublish={() => []}
          onCancel={() => {}}
          {...(initial !== undefined ? { initial } : {})}
        />
      </I18nProvider>,
    );

  it("有歡迎詞與上下班時間欄位（未預填時為空）", () => {
    const html = render();
    expect(html).toContain('data-testid="roster-welcome"');
    expect(html).toContain('data-testid="roster-work-start"');
    expect(html).toContain('data-testid="roster-work-end"');
    expect(html).toContain("npub1self 管理者"); // 無現行名冊 → 預填自己一行
  });

  it("以現行名冊預填：組織名/歡迎詞/班表/保留天數/成員行（npub＋名稱）", () => {
    const pk = "a".repeat(64);
    const html = render({
      org: "小公司",
      members: [{ pubkey: pk, name: "老闆" }],
      welcome: "請詳讀規範",
      workHours: { start: "09:30", end: "18:30" },
      policy: { messageTtlDays: 90 },
      updatedAt: 1,
    });
    expect(html).toContain('value="小公司"');
    expect(html).toContain("請詳讀規範");
    expect(html).toContain('value="09:30"');
    expect(html).toContain('value="18:30"');
    expect(html).toContain('value="90"'); // ADR-0160：保留天數預填
    expect(html).toContain(" 老闆"); // 成員行帶名冊名
  });

  it("ADR-0160：有訊息保留天數欄位（未預填時空白、placeholder 7）", () => {
    const html = render();
    expect(html).toContain('data-testid="roster-ttl-days"');
    expect(html).toContain('placeholder="7"');
  });
});
