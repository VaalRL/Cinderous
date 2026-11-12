// @vitest-environment jsdom
//
// 名冊管理視窗的共同管理者（ADR-0418）：擁有者能列共同管理者，共同管理者看到的視窗不能改這份名單。
// 要按「簽章並發布」看 onPublish 收到什麼，所以用 jsdom 掛載（SSR 測不到點擊）。

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { npubEncode, type OrgRosterDoc } from "@cinderous/core";
import { I18nProvider } from "./i18n.js";
import { RosterAdminModal } from "./App.js";
import { mount } from "./test/jsdom-mount.js";

const OWNER = "a".repeat(64);
const CO = "b".repeat(64);
const M = "c".repeat(64);

const initial: OrgRosterDoc = {
  org: "小公司",
  members: [
    { pubkey: OWNER, name: "老闆" },
    { pubkey: CO, name: "甲" },
    { pubkey: M, name: "乙" },
  ],
  groups: [{ id: "g1", name: "全體", members: [OWNER, CO, M] }],
  admins: [CO],
  updatedAt: 1,
};

type Publish = Parameters<typeof RosterAdminModal>[0]["onPublish"];

function open(props: { coAdmin?: boolean; onPublish: Publish }) {
  return mount(
    <I18nProvider locale="zh-Hant">
      <RosterAdminModal
        selfNpub={npubEncode(props.coAdmin ? CO : OWNER)}
        onPublish={props.onPublish}
        onCancel={() => {}}
        initial={initial}
        {...(props.coAdmin ? { coAdmin: true } : {})}
      />
    </I18nProvider>,
  );
}

const q = <T extends Element>(root: HTMLElement, id: string): T | null => root.querySelector<T>(`[data-testid="${id}"]`);

function type(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const publish = (root: HTMLElement): void => act(() => q<HTMLButtonElement>(root, "roster-publish")!.click());

describe("名冊管理視窗的共同管理者（ADR-0418）", () => {
  it("擁有者：共同管理者欄預填現有名單，發布時帶上", () => {
    const onPublish = vi.fn<Publish>(() => []);
    const m = open({ onPublish });
    const box = q<HTMLTextAreaElement>(m.container, "roster-admins");
    expect(box?.value).toBe(npubEncode(CO));
    publish(m.container);
    expect(onPublish.mock.calls[0]?.[4]?.admins).toEqual([CO]);
    m.unmount();
  });

  it("擁有者清空共同管理者欄 → 發布 admins: []（清掉名單，不是沿用）", () => {
    const onPublish = vi.fn<Publish>(() => []);
    const m = open({ onPublish });
    type(q<HTMLTextAreaElement>(m.container, "roster-admins")!, "");
    publish(m.container);
    expect(onPublish.mock.calls[0]?.[4]?.admins).toEqual([]);
    m.unmount();
  });

  it("擁有者共同管理者欄打錯 → 不發布、顯示錯誤", () => {
    const onPublish = vi.fn<Publish>(() => []);
    const m = open({ onPublish });
    type(q<HTMLTextAreaElement>(m.container, "roster-admins")!, "npub1壞掉");
    publish(m.container);
    expect(onPublish).not.toHaveBeenCalled();
    expect(m.container.textContent).toContain("npub1壞掉");
    m.unmount();
  });

  it("🔴 共同管理者：沒有共同管理者欄、有說明；發布不帶 admins", () => {
    const onPublish = vi.fn<Publish>(() => []);
    const m = open({ coAdmin: true, onPublish });
    expect(q(m.container, "roster-admins")).toBeNull();
    expect(q(m.container, "roster-coadmin-note")).not.toBeNull();
    publish(m.container);
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onPublish.mock.calls[0]?.[4]?.admins).toBeUndefined();
    m.unmount();
  });

  it("共同管理者把管理者移出成員 → 顯示專屬錯誤（不是籠統的發布失敗）", () => {
    const onPublish = vi.fn<Publish>(() => {
      throw new Error("roster-drops-admin");
    });
    const m = open({ coAdmin: true, onPublish });
    publish(m.container);
    expect(q(m.container, "roster-error")?.textContent).toContain("管理者");
    expect(q(m.container, "roster-error")?.textContent).not.toBe("發布失敗");
    m.unmount();
  });

  it("組織群組欄留空 → 沿用現有群組（不再每次發布都把群組洗掉）", () => {
    const onPublish = vi.fn<Publish>(() => []);
    const m = open({ onPublish });
    publish(m.container);
    expect(onPublish.mock.calls[0]?.[3]).toEqual(initial.groups);
    m.unmount();
  });
});
