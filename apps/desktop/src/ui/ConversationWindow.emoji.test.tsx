// @vitest-environment jsdom
//
// 行內自訂 emoji（ADR-0220）端到端接線：渲染（收到含資產清單的訊息 → 行內小圖）與
// 收到自動收藏（effect 寫入本機庫）。這些走 useEffect / DOM，SSR 測不到，故於 jsdom 掛載。

import { act } from "react";
import { describe, expect, it } from "vitest";
import { appendAssetManifest, contentHash } from "@cinderous/core";
import { MemoryStorage } from "@cinderous/engine";
import type { ChatMessage, Contact, Self } from "@cinderous/engine";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import { ConversationWindow } from "./ConversationWindow.js";
import { mount } from "../test/jsdom-mount.js";

const self: Self = { pubkey: "aa".repeat(32), name: "我", status: "online", statusMessage: "" };
const bob: Contact = { pubkey: "bb".repeat(32), name: "Bob", status: "online", statusMessage: "", nowPlaying: "" };
const smiley =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#ffd84d"/></svg>';
const heart =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 82 C10 54 22 22 50 40 C78 22 90 54 50 82 Z" fill="#e8567a"/></svg>';

const render = (messages: ChatMessage[]): JSX.Element => (
  <I18nProvider>
    <ThemeProvider>
      <ConversationWindow
        self={self}
        contact={bob}
        messages={messages}
        typing={false}
        nudgeSignal={0}
        onSend={() => {}}
        onTyping={() => {}}
        onNudge={() => {}}
        onClose={() => {}}
      />
    </ThemeProvider>
  </I18nProvider>
);

describe("行內自訂 emoji 渲染與自動收藏（ADR-0220）", () => {
  it("收到含資產清單的訊息 → 行內渲染 emoji 小圖、不顯示 nb-assets 字面", () => {
    localStorage.clear();
    const text = appendAssetManifest("嗨 :party: 好", { party: { label: "派對", svg: smiley } });
    const m = mount(render([{ id: "m1", outgoing: false, text, at: 1 }]));
    const img = m.container.querySelector("img.emoji");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe(":party:");
    expect(m.container.textContent ?? "").not.toContain("nb-assets");
    m.unmount();
  });

  it("ADR-0222：收到 raster emoji → 行內 <img> 直接用 data URI（會動、非 svgToDataUri）", () => {
    localStorage.clear();
    const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=";
    const text = appendAssetManifest("嗨 :dance:", { dance: { label: "跳舞", svg: gif, format: "raster" } });
    const m = mount(render([{ id: "r1", outgoing: false, text, at: 1 }]));
    const img = m.container.querySelector("img.emoji");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(gif); // 直接 data URI
    m.unmount();
  });

  it("ADR-0222：送出帶 raster emoji 的訊息 → 內容清單含 format:raster", async () => {
    localStorage.clear();
    const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=";
    localStorage.setItem(
      "nb.stickers.custom",
      JSON.stringify([{ id: "g1", label: "跳舞", svg: gif, kind: "both", shortcode: "dance", format: "raster" }]),
    );
    let sent = "";
    const m = mount(
      <I18nProvider>
        <ThemeProvider>
          <ConversationWindow
            self={self}
            contact={bob}
            messages={[]}
            typing={false}
            nudgeSignal={0}
            onSend={(txt) => {
              sent = txt;
            }}
            onTyping={() => {}}
            onNudge={() => {}}
            onClose={() => {}}
          />
        </ThemeProvider>
      </I18nProvider>,
    );
    const ta = m.container.querySelector("textarea") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(ta, ":dance:");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(sent).toContain("nb-assets:v1:");
    expect(sent).toContain('"format":"raster"');
    m.unmount();
  });

  it("ADR-0223：收到 ref emoji＋blob 在快取 → 渲染動畫 <img>（src＝blob）", () => {
    localStorage.clear();
    const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=";
    const hash = contentHash(gif);
    const store = new MemoryStorage();
    store.saveAssetBlobs([{ hash, data: gif }]);
    const text = appendAssetManifest("嗨 :dance:", { dance: { label: "跳舞", ref: hash, format: "raster" } });
    const m = mount(
      <I18nProvider>
        <ThemeProvider>
          <ConversationWindow
            self={self}
            contact={bob}
            messages={[{ id: "b1", outgoing: false, text, at: 1 }]}
            typing={false}
            nudgeSignal={0}
            onSend={() => {}}
            onTyping={() => {}}
            onNudge={() => {}}
            onClose={() => {}}
            blobStore={{ load: () => store.loadAssetBlobs(), save: () => {} } as never}
          />
        </ThemeProvider>
      </I18nProvider>,
    );
    expect(m.container.querySelector("img.emoji")?.getAttribute("src")).toBe(gif);
    m.unmount();
  });

  it("ADR-0223 P2a-3c：收到 pending ref → 觸發 onRequestAsset(寄件者, hash)", () => {
    localStorage.clear();
    const hash = "a".repeat(64);
    const text = appendAssetManifest("嗨 :dance:", { dance: { label: "跳舞", ref: hash, format: "raster" } });
    const requests: Array<[string, string]> = [];
    const m = mount(
      <I18nProvider>
        <ThemeProvider>
          <ConversationWindow
            self={self}
            contact={bob}
            messages={[{ id: "p1", outgoing: false, text, at: 1 }]}
            typing={false}
            nudgeSignal={0}
            onSend={() => {}}
            onTyping={() => {}}
            onNudge={() => {}}
            onClose={() => {}}
            onRequestAsset={(to, h) => requests.push([to, h])}
          />
        </ThemeProvider>
      </I18nProvider>,
    );
    expect(requests).toContainEqual([bob.pubkey, hash]);
    m.unmount();
  });

  it("ADR-0223：收到 ref emoji＋blob 未到 → 占位（emoji--pending，顯示 :shortcode:）", () => {
    localStorage.clear();
    const hash = "a".repeat(64);
    const text = appendAssetManifest("嗨 :dance:", { dance: { label: "跳舞", ref: hash, format: "raster" } });
    const m = mount(render([{ id: "b2", outgoing: false, text, at: 1 }]));
    expect(m.container.querySelector("img.emoji")).toBeNull();
    const pending = m.container.querySelector(".emoji--pending");
    expect(pending?.textContent).toBe(":dance:");
    m.unmount();
  });

  it("未知短碼保留字面（無對應資產＝不誤渲染）", () => {
    localStorage.clear();
    const m = mount(render([{ id: "m2", outgoing: false, text: "沒有 :nope: 這顆", at: 1 }]));
    expect(m.container.querySelector("img.emoji")).toBeNull();
    expect(m.container.textContent ?? "").toContain(":nope:");
    m.unmount();
  });

  it("收到即自動收藏：資產寫入本機庫（getKv）", () => {
    localStorage.clear();
    const text = appendAssetManifest(":party:", { party: { label: "派對", svg: smiley } });
    const m = mount(render([{ id: "m3", outgoing: false, text, at: 1 }]));
    const saved = localStorage.getItem("nb.stickers.custom");
    expect(saved).toBeTruthy();
    const lib = JSON.parse(saved ?? "[]") as Array<{ id: string; shortcode?: string }>;
    expect(lib.some((a) => a.id === contentHash(smiley) && a.shortcode === "party")).toBe(true);
    m.unmount();
  });

  it("自己送出的訊息不自動收藏（只收別人的）", () => {
    localStorage.clear();
    const text = appendAssetManifest(":party:", { party: { label: "派對", svg: smiley } });
    const m = mount(render([{ id: "m4", outgoing: true, text, at: 1 }]));
    expect(localStorage.getItem("nb.stickers.custom")).toBeNull();
    m.unmount();
  });

  it("關閉自動收藏（設定）後：收到含清單訊息不入庫，但仍行內渲染", () => {
    localStorage.clear();
    localStorage.setItem("nb.stickers.autoAcquire", "0");
    const text = appendAssetManifest("嗨 :party:", { party: { label: "派對", svg: smiley } });
    const m = mount(render([{ id: "m5", outgoing: false, text, at: 1 }]));
    expect(localStorage.getItem("nb.stickers.custom")).toBeNull();
    expect(m.container.querySelector("img.emoji")).not.toBeNull();
    m.unmount();
  });
});

const click = async (m: { container: HTMLElement }, testid: string): Promise<void> => {
  await act(async () => {
    m.container
      .querySelector(`[data-testid="${testid}"]`)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("emoji 挑選器分頁（ADR-0220，步驟 3）", () => {
  it("開挑選器 → emoji 分頁：匯入鈕呈現、點選已擁有 emoji 插入 :shortcode: 到輸入框", async () => {
    localStorage.clear();
    localStorage.setItem(
      "nb.stickers.custom",
      JSON.stringify([{ id: contentHash(smiley), label: "派對", svg: smiley, kind: "both", shortcode: "party" }]),
    );
    const m = mount(render([]));
    await click(m, "sticker-toggle");
    await click(m, "emoji-tab");
    expect(m.container.querySelector('[data-testid="emoji-import"]')).not.toBeNull();
    expect(m.container.querySelector('[data-testid="emoji-item"]')).not.toBeNull();
    await click(m, "emoji-item");
    expect(m.container.querySelector("textarea")?.value ?? "").toContain(":party:");
    m.unmount();
  });

  it("emoji 分頁尚無自訂 emoji 時顯示空狀態＋匯入鈕", async () => {
    localStorage.clear();
    const m = mount(render([]));
    await click(m, "sticker-toggle");
    await click(m, "emoji-tab");
    expect(m.container.querySelector('[data-testid="emoji-import"]')).not.toBeNull();
    expect(m.container.querySelector('[data-testid="emoji-item"]')).toBeNull();
    m.unmount();
  });

  it("批次匯入 Slack 包：多個 SVG 檔 → 檔名成為短碼、一次入庫", async () => {
    localStorage.clear();
    const m = mount(render([]));
    await click(m, "sticker-toggle");
    await click(m, "emoji-tab");
    const input = m.container.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    expect(input).not.toBeNull();
    const files = [
      new File([smiley], "party.svg", { type: "image/svg+xml" }),
      new File([heart], "heart-blob.svg", { type: "image/svg+xml" }),
    ];
    Object.defineProperty(input, "files", { value: files, configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    });
    const saved = JSON.parse(localStorage.getItem("nb.stickers.custom") ?? "[]") as Array<{ shortcode?: string }>;
    expect(saved.map((a) => a.shortcode).sort()).toEqual(["heart-blob", "party"]);
    m.unmount();
  });
});

const seedEmoji = (): void =>
  localStorage.setItem(
    "nb.stickers.custom",
    JSON.stringify([{ id: contentHash(smiley), label: "派對", svg: smiley, kind: "both", shortcode: "party" }]),
  );

const typeInComposer = async (m: { container: HTMLElement }, val: string): Promise<void> => {
  const el = m.container.querySelector("textarea");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    if (el) setter.call(el, val);
    el?.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

type CustomAssetLike = { id: string; label: string; svg: string; kind: string; shortcode?: string };

const renderWith = (messages: ChatMessage[], assetStore: unknown): JSX.Element => (
  <I18nProvider>
    <ThemeProvider>
      <ConversationWindow
        self={self}
        contact={bob}
        messages={messages}
        typing={false}
        nudgeSignal={0}
        onSend={() => {}}
        onTyping={() => {}}
        onNudge={() => {}}
        onClose={() => {}}
        assetStore={assetStore as never}
      />
    </ThemeProvider>
  </I18nProvider>
);

describe("加密 AppStorage 後端＋遷移（ADR-0220，步驟 6）", () => {
  const storeOf = (s: MemoryStorage, namespace: string) => ({
    load: () => s.loadCustomAssets(),
    save: (l: CustomAssetLike[]) => s.saveCustomAssets(l as never),
    namespace,
  });

  it("有 assetStore 時：收到自動收藏寫進 AppStorage，而非 localStorage", () => {
    localStorage.clear();
    const store = new MemoryStorage();
    const text = appendAssetManifest(":party:", { party: { label: "派對", svg: smiley } });
    const m = mount(renderWith([{ id: "s1", outgoing: false, text, at: 1 }], storeOf(store, "ns-a")));
    expect(store.loadCustomAssets().map((a) => a.shortcode)).toContain("party");
    expect(localStorage.getItem("nb.stickers.custom")).toBeNull(); // 未落 localStorage
    m.unmount();
  });

  it("遷移：舊全域 localStorage 庫 → 加密 AppStorage，且刪除舊明文（H1）", () => {
    localStorage.clear();
    localStorage.setItem(
      "nb.stickers.custom",
      JSON.stringify([{ id: contentHash(smiley), label: "舊圖", svg: smiley, kind: "sticker" }]),
    );
    const store = new MemoryStorage();
    const m = mount(renderWith([], storeOf(store, "mig1")));
    expect(store.loadCustomAssets().map((a) => a.id)).toContain(contentHash(smiley));
    expect(localStorage.getItem("nb.mig1.assetsMigrated")).toBe("1");
    expect(localStorage.getItem("nb.stickers.custom")).toBeNull(); // H1：舊明文已刪
    m.unmount();
  });

  it("C1：遷移＋同時有收到的清單訊息 → 遷移的舊庫不被覆蓋", () => {
    localStorage.clear();
    localStorage.setItem(
      "nb.stickers.custom",
      JSON.stringify([{ id: "OLDID", label: "舊", svg: smiley, kind: "sticker" }]),
    );
    const store = new MemoryStorage();
    const text = appendAssetManifest(":party:", { party: { label: "派對", svg: heart } });
    const m = mount(renderWith([{ id: "c1", outgoing: false, text, at: 1 }], storeOf(store, "c1ns")));
    const ids = store.loadCustomAssets().map((a) => a.id);
    expect(ids).toContain("OLDID"); // 遷移的舊庫仍在（未被自動收藏覆蓋）
    expect(ids).toContain(contentHash(heart)); // 收到的也收藏了
    m.unmount();
  });
});

describe(": 自訂 emoji 短碼自動補全（ADR-0220，步驟 4）", () => {
  it("打 :par → 出現候選列、點選插入 :party:", async () => {
    localStorage.clear();
    seedEmoji();
    const m = mount(render([]));
    await typeInComposer(m, "嗨 :par");
    const bar = m.container.querySelector('[data-testid="emoji-bar"]');
    expect(bar).not.toBeNull();
    expect(bar?.textContent ?? "").toContain(":party:");
    await act(async () => {
      bar?.querySelector(".emojibar__item")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(m.container.querySelector("textarea")?.value ?? "").toBe("嗨 :party:");
    m.unmount();
  });

  it("無比對短碼時不出現候選列", async () => {
    localStorage.clear();
    seedEmoji();
    const m = mount(render([]));
    await typeInComposer(m, "嗨 :zzz");
    expect(m.container.querySelector('[data-testid="emoji-bar"]')).toBeNull();
    m.unmount();
  });

  it("完整 :party:（已含結尾冒號）不再跳候選", async () => {
    localStorage.clear();
    seedEmoji();
    const m = mount(render([]));
    await typeInComposer(m, "嗨 :party:");
    expect(m.container.querySelector('[data-testid="emoji-bar"]')).toBeNull();
    m.unmount();
  });
});
