// @vitest-environment jsdom
// 企業簇（ADR-0331 第 2 簇）——抽成 hook 之後才測得到。
import { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { useOrgSession, type OrgSession } from "./use-org-session.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function hook(): { get: () => OrgSession } {
  let latest: OrgSession;
  function Probe(): null {
    latest = useOrgSession();
    return null;
  }
  const el = document.createElement("div");
  act(() => createRoot(el).render(<Probe />));
  return { get: () => latest };
}

const OWNER = { orgOwner: true, orgInviteToken: "tok" };
const MEMBER = { enterprise: true, adminPubkey: "admin_pk" };

describe("企業簇（ADR-0331）", () => {
  it("一般個人身分：全空", () => {
    const h = hook();
    act(() => h.get().reset());
    expect(h.get().enterprise).toBe(false);
    expect(h.get().owner).toBe(false);
    expect(h.get().admin).toBeNull();
    expect(h.get().policy).toEqual({});
  });

  it("企業主：owner／權杖／託管清單都播種進來", () => {
    const h = hook();
    const escrow = [{ pubkey: "emp", name: "員工", nsec: "n", relayUrl: "wss://r", at: 1 }];
    act(() => h.get().reset({ org: OWNER, escrow, title: "工程" }));
    expect(h.get().owner).toBe(true);
    expect(h.get().enterprise).toBe(true); // 企業主也是企業身分
    expect(h.get().inviteToken).toBe("tok");
    expect(h.get().escrow).toEqual(escrow);
    expect(h.get().title).toBe("工程");
  });

  it("企業成員：記下企業主 pubkey（儲存槽的存放對象）", () => {
    const h = hook();
    act(() => h.get().reset({ org: MEMBER }));
    expect(h.get().admin).toBe("admin_pk");
    expect(h.get().owner).toBe(false);
  });

  it("🔴 切到個人身分必須清乾淨——否則個人身分會看到工作身分的公司 UI", () => {
    const h = hook();
    act(() => {
      h.get().reset({ org: OWNER, escrow: [{ pubkey: "e", name: "n", nsec: "x", relayUrl: "r", at: 1 }], title: "工程" });
      h.get().setPolicy({ disableFiles: true });
      h.get().updateSlots(() => [{ id: "1", name: "a", size: 1, mime: "text/plain", origin: "o", status: "pending", queuedAt: 1, bytes: new Uint8Array() }]);
    });
    expect(h.get().slots).toHaveLength(1);

    act(() => h.get().reset()); // 切到一般個人身分
    expect(h.get().enterprise).toBe(false);
    expect(h.get().owner).toBe(false);
    expect(h.get().admin).toBeNull();
    expect(h.get().inviteToken).toBeNull();
    expect(h.get().escrow).toEqual([]);
    expect(h.get().slots).toEqual([]);
    expect(h.get().title).toBe("");
    expect(h.get().policy).toEqual({});
  });

  it("🔴 `reset` 不是「一律歸零」——切回企業主要看得到自己的託管清單（ADR-0327 那類錯）", () => {
    const h = hook();
    const escrow = [{ pubkey: "emp", name: "員工", nsec: "n", relayUrl: "wss://r", at: 1 }];
    act(() => h.get().reset());
    act(() => h.get().reset({ org: OWNER, escrow }));
    expect(h.get().escrow).toEqual(escrow);
  });

  it("`markEnterprise()`：後端確認會員身分（比捆包旗標更穩健的設閘訊號）", () => {
    const h = hook();
    act(() => h.get().reset());
    expect(h.get().enterprise).toBe(false);
    act(() => h.get().markEnterprise());
    expect(h.get().enterprise).toBe(true);
  });

  it("政策由後端送來，切身分歸零（政策屬於**該身分的公司**）", () => {
    const h = hook();
    act(() => h.get().setPolicy({ disableCalls: true }));
    expect(h.get().policy.disableCalls).toBe(true);
    act(() => h.get().reset({ org: MEMBER }));
    expect(h.get().policy).toEqual({});
  });
});
