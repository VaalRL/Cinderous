// 行動端通知平台縫（ADR-0116 / ADR-0410）：Android 殼裡 WebView 沒有 Web Notification API，
// 必須改走原生 LocalNotify 外掛；其他環境（瀏覽器預覽）照舊用 Web Notification。
// 真正跳出系統通知、點擊回到 App 只能實機驗收——這裡鎖的是選路與「不假裝授權成功」。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  effectiveNotify,
  initialNotifyWanted,
  nativeNotifySupported,
  notifier,
  notifyPermission,
  onNotifyClick,
  shouldAskNotifyOnStart,
} from "./notify.js";

type Listener = (d: { convo?: string }) => void;
type CapShape = { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> };
const setCap = (v: CapShape | undefined): void => {
  (globalThis as { Capacitor?: CapShape }).Capacitor = v as CapShape;
};

function fakePlugin(granted = true) {
  const listeners: Listener[] = [];
  const plugin = {
    requestPermission: vi.fn(async () => ({ granted })),
    checkPermission: vi.fn(async () => ({ granted })),
    notify: vi.fn(async (_o: { title: string; body: string; convo?: string }) => {}),
    addListener: vi.fn((_ev: string, cb: Listener) => {
      listeners.push(cb);
      return Promise.resolve({ remove: async () => void listeners.splice(listeners.indexOf(cb), 1) });
    }),
  };
  return { plugin, fire: (convo?: string) => listeners.forEach((l) => l(convo === undefined ? {} : { convo })), listeners };
}

afterEach(() => setCap(undefined));

describe("nativeNotifySupported（ADR-0410）", () => {
  it("非 Capacitor（瀏覽器預覽）＝不走原生", () => {
    expect(nativeNotifySupported()).toBe(false);
  });
  it("Capacitor 但外掛不在＝不走原生", () => {
    setCap({ isNativePlatform: () => true, Plugins: {} });
    expect(nativeNotifySupported()).toBe(false);
  });
  it("原生殼＋LocalNotify 外掛在＝走原生", () => {
    setCap({ isNativePlatform: () => true, Plugins: { LocalNotify: fakePlugin().plugin } });
    expect(nativeNotifySupported()).toBe(true);
  });
});

describe("notifier 選路", () => {
  it("🔴 原生殼：權限向系統要（不是 Web Notification）；系統允許＝true", async () => {
    const f = fakePlugin(true);
    setCap({ isNativePlatform: () => true, Plugins: { LocalNotify: f.plugin } });
    expect(await notifier.ensurePermission()).toBe(true);
    expect(f.plugin.requestPermission).toHaveBeenCalledOnce();
  });

  it("🔴 原生殼：系統拒絕＝false（開關不打開，不假裝成功）", async () => {
    setCap({ isNativePlatform: () => true, Plugins: { LocalNotify: fakePlugin(false).plugin } });
    expect(await notifier.ensurePermission()).toBe(false);
  });

  it("原生殼：外掛要權限時丟例外＝false", async () => {
    const f = fakePlugin();
    f.plugin.requestPermission.mockRejectedValueOnce(new Error("boom"));
    setCap({ isNativePlatform: () => true, Plugins: { LocalNotify: f.plugin } });
    expect(await notifier.ensurePermission()).toBe(false);
  });

  it("原生殼：通知內容原樣交給外掛（含對話鍵，供點擊回跳）", async () => {
    const f = fakePlugin();
    setCap({ isNativePlatform: () => true, Plugins: { LocalNotify: f.plugin } });
    await notifier.notify({ title: "Alice", body: "嗨", convo: "pk1" });
    expect(f.plugin.notify).toHaveBeenCalledWith({ title: "Alice", body: "嗨", convo: "pk1" });
  });

  it("原生殼：外掛送出失敗不丟例外（通知失敗不該影響收訊）", async () => {
    const f = fakePlugin();
    f.plugin.notify.mockRejectedValueOnce(new Error("blocked"));
    setCap({ isNativePlatform: () => true, Plugins: { LocalNotify: f.plugin } });
    await expect(notifier.notify({ title: "t", body: "b" })).resolves.toBeUndefined();
  });

  it("瀏覽器預覽且沒有 Web Notification：權限＝false、送出靜默略過", async () => {
    expect(await notifier.ensurePermission()).toBe(false);
    await expect(notifier.notify({ title: "t", body: "b" })).resolves.toBeUndefined();
  });
});

describe("onNotifyClick", () => {
  it("原生殼：點通知帶回對話鍵；取消註冊後不再收到", async () => {
    const f = fakePlugin();
    setCap({ isNativePlatform: () => true, Plugins: { LocalNotify: f.plugin } });
    const got: (string | undefined)[] = [];
    const off = onNotifyClick((c) => got.push(c));
    await new Promise((r) => setTimeout(r, 0));
    f.fire("pk1");
    f.fire();
    expect(got).toEqual(["pk1", undefined]);
    off();
    await new Promise((r) => setTimeout(r, 0));
    f.fire("pk2");
    expect(got).toEqual(["pk1", undefined]);
  });

  it("🔴 addListener 直接回傳 handle（不是 Promise）也不能炸掉 App——Pixel 8a 實機白畫面", async () => {
    const listeners: Listener[] = [];
    const remove = vi.fn(async () => {});
    const plugin = {
      ...fakePlugin().plugin,
      addListener: (_ev: string, cb: Listener) => {
        listeners.push(cb);
        return { remove };
      },
    };
    setCap({ isNativePlatform: () => true, Plugins: { LocalNotify: plugin } });
    const got: (string | undefined)[] = [];
    const off = onNotifyClick((c) => got.push(c));
    await new Promise((r) => setTimeout(r, 0));
    listeners.forEach((l) => l({ convo: "pk1" }));
    expect(got).toEqual(["pk1"]);
    off();
    await new Promise((r) => setTimeout(r, 0));
    expect(remove).toHaveBeenCalledOnce();
  });

  it("addListener 同步丟例外也不能炸掉 App", () => {
    const plugin = { ...fakePlugin().plugin, addListener: () => { throw new Error("no"); } };
    setCap({ isNativePlatform: () => true, Plugins: { LocalNotify: plugin } });
    expect(() => onNotifyClick(() => {})()).not.toThrow();
  });

  it("瀏覽器預覽：不碰原生外掛，照樣回傳取消函式", () => {
    const off = onNotifyClick(() => {});
    expect(typeof off).toBe("function");
    off();
  });
});

describe("通知預設開＋跟系統同步（ADR-0426）", () => {
  it("🔴 Android 殼沒設定過＝預設要通知；瀏覽器預覽沒設定過＝不要（權限得在手勢裡要）", () => {
    expect(initialNotifyWanted(null, true)).toBe(true);
    expect(initialNotifyWanted(null, false)).toBe(false);
  });
  it("使用者明確選過就照他的選擇", () => {
    expect(initialNotifyWanted("1", false)).toBe(true);
    expect(initialNotifyWanted("0", true)).toBe(false);
  });
  it("只有 Android 殼、而且從沒選過，開機才主動問一次權限", () => {
    expect(shouldAskNotifyOnStart(null, true)).toBe(true);
    expect(shouldAskNotifyOnStart(null, false)).toBe(false);
    expect(shouldAskNotifyOnStart("0", true)).toBe(false);
    expect(shouldAskNotifyOnStart("1", true)).toBe(false);
  });

  it("🔴 原生殼：只查權限、不跳系統對話框", async () => {
    const f = fakePlugin(false);
    setCap({ isNativePlatform: () => true, Plugins: { LocalNotify: f.plugin } });
    expect(await notifyPermission()).toBe("denied");
    expect(f.plugin.requestPermission).not.toHaveBeenCalled();
    f.plugin.checkPermission.mockResolvedValueOnce({ granted: true });
    expect(await notifyPermission()).toBe("granted");
  });
  it("原生殼：舊版外掛沒有 checkPermission 或丟例外＝不知道（不改顯示）", async () => {
    const f = fakePlugin();
    const { checkPermission: _drop, ...old } = f.plugin;
    setCap({ isNativePlatform: () => true, Plugins: { LocalNotify: old } });
    expect(await notifyPermission()).toBe("unknown");
    f.plugin.checkPermission.mockRejectedValueOnce(new Error("x"));
    setCap({ isNativePlatform: () => true, Plugins: { LocalNotify: f.plugin } });
    expect(await notifyPermission()).toBe("unknown");
  });
  it("瀏覽器：照 Notification.permission；沒有這個 API＝不知道", async () => {
    expect(await notifyPermission()).toBe("unknown");
    const g = globalThis as { Notification?: unknown };
    g.Notification = { permission: "denied" };
    expect(await notifyPermission()).toBe("denied");
    g.Notification = { permission: "granted" };
    expect(await notifyPermission()).toBe("granted");
    g.Notification = { permission: "default" };
    expect(await notifyPermission()).toBe("unknown");
    delete g.Notification;
  });

  it("🔴 系統關掉通知時開關顯示關；系統再打開就自動回來（偏好本身不動）", () => {
    expect(effectiveNotify(true, "denied")).toBe(false);
    expect(effectiveNotify(true, "granted")).toBe(true);
    expect(effectiveNotify(true, "unknown")).toBe(true);
    expect(effectiveNotify(false, "granted")).toBe(false);
  });
});
