// @vitest-environment jsdom
//
// 部署精靈（ADR-0356）。這支測試盯住四件會真的害到使用者的事：
//   1. token 存進金鑰庫之後**不留在前端**；
//   2. 驗證沒過就**不算成功**，更不會讓他去切 home；
//   3. 「帳號還沒命名子網域」要被當成「還缺一個答案」，不是失敗；
//   4. 切 home 是**預設勾選但可取消**，取消時網址仍然要被記下來。

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n.js";
import { mount } from "../test/jsdom-mount.js";
import { DeployWizard, type DeployApi } from "./DeployWizard.js";

const OK_URL = "wss://cinder-relay.alice.workers.dev";

function stubApi(over: Partial<DeployApi> = {}): DeployApi {
  return {
    tokenUrl: async () => "https://dash.cloudflare.com/profile/api-tokens?x=1",
    saveToken: async () => {},
    listAccounts: async () => [{ id: "acc1", name: "我的帳號" }],
    deploy: async () => ({ relay_url: OK_URL, subdomain: "alice" }),
    verifyRelay: async () => true,
    forgetToken: async () => {},
    teardown: async () => {},
    openUrl: () => {},
    ...over,
  };
}

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};

function render(api: DeployApi, hooks: Partial<{ onClose: () => void; onDeployed: (u: string) => void; onAdopt: (u: string) => void }> = {}) {
  const calls = { closed: 0, deployed: [] as string[], adopted: [] as string[] };
  const el = (
    <I18nProvider locale="zh-Hant">
      <DeployWizard
        api={api}
        onClose={hooks.onClose ?? (() => (calls.closed += 1))}
        onDeployed={hooks.onDeployed ?? ((u) => calls.deployed.push(u))}
        onAdopt={hooks.onAdopt ?? ((u) => calls.adopted.push(u))}
      />
    </I18nProvider>
  );
  return { ...mount(el), calls };
}

const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = (c: HTMLElement, id: string) => act(() => q(c, id)!.click());
const type = (c: HTMLElement, id: string, value: string) =>
  act(() => {
    const el = q(c, id) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

/** 走到「已部署完成」那一畫面。 */
async function toDone(api: DeployApi) {
  const r = render(api);
  click(r.container, "deploy-start");
  type(r.container, "deploy-token-input", "cf-token");
  click(r.container, "deploy-token-next");
  await flush();
  click(r.container, "deploy-run");
  await flush();
  return r;
}

describe("部署精靈（ADR-0356）", () => {
  it("🔴 token 存進金鑰庫之後就從前端清掉", async () => {
    const saved: string[] = [];
    const r = render(stubApi({ saveToken: async (tk) => void saved.push(tk) }));
    click(r.container, "deploy-start");
    type(r.container, "deploy-token-input", "  cf-token  ");
    click(r.container, "deploy-token-next");
    await flush();
    expect(saved).toEqual(["cf-token"]); // 前後空白要修掉
    click(r.container, "deploy-cancel"); // 回不去看輸入框，改驗它已被清空的狀態
    expect(r.container.textContent).not.toContain("cf-token");
  });

  it("空 token 時「下一步」是停用的", () => {
    const r = render(stubApi());
    click(r.container, "deploy-start");
    expect((q(r.container, "deploy-token-next") as HTMLButtonElement).disabled).toBe(true);
  });

  it("成功路徑：部署＋驗證通過 → 顯示網址，並把它記下來", async () => {
    const r = await toDone(stubApi());
    expect(q(r.container, "deploy-url")?.textContent).toBe(OK_URL);
    expect(r.calls.deployed).toEqual([OK_URL]);
  });

  it("🔴 驗證沒過 → 不算成功、不顯示完成畫面、不記網址", async () => {
    const r = await toDone(stubApi({ verifyRelay: async () => false }));
    expect(q(r.container, "deploy-done")).toBeNull();
    expect(r.calls.deployed).toEqual([]);
    expect(q(r.container, "deploy-error")?.textContent).toContain("連不上那座節點");
  });

  it("🔴 帳號還沒命名子網域 → 去問他名字，而不是報錯", async () => {
    let first = true;
    const api = stubApi({
      deploy: async (_id, sub) => {
        if (first) {
          first = false;
          throw { key: "deploy_errNoSubdomain", detail: "" };
        }
        return { relay_url: `wss://cinder-relay.${sub}.workers.dev`, subdomain: sub! };
      },
    });
    const r = render(api);
    click(r.container, "deploy-start");
    type(r.container, "deploy-token-input", "t");
    click(r.container, "deploy-token-next");
    await flush();
    click(r.container, "deploy-run");
    await flush();
    expect(q(r.container, "deploy-subdomain")).not.toBeNull();
    expect(q(r.container, "deploy-error")).toBeNull(); // 不是錯誤，是還缺一個答案
    type(r.container, "deploy-subdomain-input", "bob");
    click(r.container, "deploy-subdomain-next");
    await flush();
    expect(q(r.container, "deploy-url")?.textContent).toBe("wss://cinder-relay.bob.workers.dev");
  });

  it("沒填名字時不能繼續——那個名字之後改不了，不替他編一個", async () => {
    const api = stubApi({
      deploy: async () => {
        throw { key: "deploy_errNoSubdomain", detail: "" };
      },
    });
    const r = render(api);
    click(r.container, "deploy-start");
    type(r.container, "deploy-token-input", "t");
    click(r.container, "deploy-token-next");
    await flush();
    click(r.container, "deploy-run");
    await flush();
    expect((q(r.container, "deploy-subdomain-next") as HTMLButtonElement).disabled).toBe(true);
  });

  it("切 home 預設勾選 → 按完成就切", async () => {
    const r = await toDone(stubApi());
    expect((q(r.container, "deploy-set-home") as HTMLInputElement).checked).toBe(true);
    click(r.container, "deploy-finish");
    expect(r.calls.adopted).toEqual([OK_URL]);
  });

  it("🔴 取消勾選 → 不切 home，但網址仍然被記下來（否則等於白部署）", async () => {
    const r = await toDone(stubApi());
    act(() => {
      const el = q(r.container, "deploy-set-home") as HTMLInputElement;
      el.click();
    });
    click(r.container, "deploy-finish");
    expect(r.calls.adopted).toEqual([]);
    expect(r.calls.deployed).toEqual([OK_URL]);
  });

  it("選了「不記住 token」→ 部署完就忘掉它", async () => {
    const forgot = vi.fn(async () => {});
    const r = render(stubApi({ forgetToken: forgot }));
    click(r.container, "deploy-start");
    act(() => (q(r.container, "deploy-keep-token") as HTMLInputElement).click());
    type(r.container, "deploy-token-input", "t");
    click(r.container, "deploy-token-next");
    await flush();
    click(r.container, "deploy-run");
    await flush();
    expect(forgot).toHaveBeenCalledTimes(1);
  });

  it("預設是記住 token（那才解鎖得了一鍵更新）", () => {
    const r = render(stubApi());
    click(r.container, "deploy-start");
    expect((q(r.container, "deploy-keep-token") as HTMLInputElement).checked).toBe(true);
  });

  it("token 無效 → 顯示可行動的訊息，停在原地讓他重貼", async () => {
    const r = render(stubApi({ listAccounts: async () => Promise.reject({ key: "deploy_errUnauthorized", detail: "" }) }));
    click(r.container, "deploy-start");
    type(r.container, "deploy-token-input", "bad");
    click(r.container, "deploy-token-next");
    await flush();
    expect(q(r.container, "deploy-error")?.textContent).toContain("重新建立");
    expect(q(r.container, "deploy-token")).not.toBeNull();
  });

  it("部署失敗 → 回到選帳號那一步，按鈕變成「再試一次」", async () => {
    const r = render(stubApi({ deploy: async () => Promise.reject({ key: "deploy_errNetwork", detail: "" }) }));
    click(r.container, "deploy-start");
    type(r.container, "deploy-token-input", "t");
    click(r.container, "deploy-token-next");
    await flush();
    click(r.container, "deploy-run");
    await flush();
    expect(q(r.container, "deploy-account")).not.toBeNull();
    expect(q(r.container, "deploy-run")?.textContent).toContain("再試一次");
  });

  it("建立 token 的連結由 Rust 給（權限預填在那裡）", async () => {
    const opened: string[] = [];
    const r = render(stubApi({ openUrl: (u) => void opened.push(u) }));
    click(r.container, "deploy-start");
    click(r.container, "deploy-open-token");
    await flush();
    expect(opened[0]).toContain("dash.cloudflare.com/profile/api-tokens");
  });
});

describe("統一模式（ADR-0354）", () => {
  it("🔴 預設不勾——它是信任降級，不是一個順手的好處", async () => {
    const r = render(stubApi());
    click(r.container, "deploy-start");
    type(r.container, "deploy-token-input", "t");
    click(r.container, "deploy-token-next");
    await flush();
    expect((q(r.container, "deploy-unified") as HTMLInputElement).checked).toBe(false);
  });

  it("警語原樣講出「伺服器同時送出客戶端程式」，不是只講一個網址的好處", async () => {
    const r = render(stubApi());
    click(r.container, "deploy-start");
    type(r.container, "deploy-token-input", "t");
    click(r.container, "deploy-token-next");
    await flush();
    expect(q(r.container, "deploy-account")?.textContent).toContain("竊取金鑰");
  });

  it("沒勾 → 部署時不帶 unified（純中繼站）", async () => {
    const seen: (boolean | undefined)[] = [];
    const api = stubApi({
      deploy: async (_id, _sub, unified) => {
        seen.push(unified);
        return { relay_url: OK_URL, subdomain: "alice" };
      },
    });
    await toDone(api);
    expect(seen).toEqual([false]);
  });

  it("勾了 → 部署時帶 unified", async () => {
    const seen: (boolean | undefined)[] = [];
    const api = stubApi({
      deploy: async (_id, _sub, unified) => {
        seen.push(unified);
        return { relay_url: OK_URL, subdomain: "alice" };
      },
    });
    const r = render(api);
    click(r.container, "deploy-start");
    type(r.container, "deploy-token-input", "t");
    click(r.container, "deploy-token-next");
    await flush();
    act(() => (q(r.container, "deploy-unified") as HTMLInputElement).click());
    click(r.container, "deploy-run");
    await flush();
    expect(seen).toEqual([true]);
  });
});

describe("放棄與收尾（2026-09-17 審查）", () => {
  it("🔴 部署中按取消 → 晚到的成功結果不得落地", async () => {
    let release!: (v: { relay_url: string; subdomain: string }) => void;
    const api = stubApi({ deploy: () => new Promise((r) => (release = r)) });
    const r = render(api);
    click(r.container, "deploy-start");
    type(r.container, "deploy-token-input", "t");
    click(r.container, "deploy-token-next");
    await flush();
    click(r.container, "deploy-run"); // 進入「部署中」
    click(r.container, "deploy-cancel"); // 使用者放棄
    await act(async () => {
      release({ relay_url: OK_URL, subdomain: "alice" }); // 網路只是慢，最後其實成功了
      await flush();
    });
    expect(r.calls.deployed).toEqual([]); // 不得記下他已經取消的節點
    expect(r.calls.adopted).toEqual([]);
  });

  it("部署中取消 → 拆掉可能已經建好的半成品", async () => {
    const tore = vi.fn(async () => {});
    const api = stubApi({ deploy: () => new Promise(() => {}), teardown: tore });
    const r = render(api);
    click(r.container, "deploy-start");
    type(r.container, "deploy-token-input", "t");
    click(r.container, "deploy-token-next");
    await flush();
    click(r.container, "deploy-run");
    click(r.container, "deploy-cancel");
    await flush();
    expect(tore).toHaveBeenCalledTimes(1);
  });

  it("還沒開始部署就取消 → 不去拆任何東西", async () => {
    const tore = vi.fn(async () => {});
    const r = render(stubApi({ teardown: tore }));
    click(r.container, "deploy-start");
    click(r.container, "deploy-cancel");
    await flush();
    expect(tore).not.toHaveBeenCalled();
  });

  it("🔴 忘記 token 失敗不得被當成部署失敗", async () => {
    // 部署已經成功、父層也被通知了；收尾出錯卻讓 UI 顯示「請重試」＝兩邊狀態互相矛盾。
    const api = stubApi({ forgetToken: async () => Promise.reject(new Error("keychain busy")) });
    const r = render(api);
    click(r.container, "deploy-start");
    act(() => (q(r.container, "deploy-keep-token") as HTMLInputElement).click()); // 不記住
    type(r.container, "deploy-token-input", "t");
    click(r.container, "deploy-token-next");
    await flush();
    click(r.container, "deploy-run");
    await flush();
    expect(q(r.container, "deploy-done")).not.toBeNull();
    expect(q(r.container, "deploy-error")).toBeNull();
    expect(r.calls.deployed).toEqual([OK_URL]);
  });
});
