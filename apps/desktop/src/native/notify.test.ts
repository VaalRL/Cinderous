import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserNotifier, getNotifier, onNotificationClick } from "./notify.js";

/** 建構後最新一個假 Notification 實例（供測 onclick）。 */
let lastInstance: { onclick?: () => void } | undefined;

/** 可控的 Notification 假替身：記錄建構呼叫、可設定 permission 與 requestPermission 結果。 */
function installNotification(opts: {
  permission: NotificationPermission;
  request?: NotificationPermission;
}): { ctor: ReturnType<typeof vi.fn> } {
  const ctor = vi.fn();
  const mock = function (this: { onclick?: () => void }, title: string, options?: NotificationOptions) {
    ctor(title, options);
    lastInstance = this;
  } as unknown as {
    permission: NotificationPermission;
    requestPermission: () => Promise<NotificationPermission>;
  };
  mock.permission = opts.permission;
  mock.requestPermission = vi.fn(async () => opts.request ?? opts.permission);
  (globalThis as { Notification?: unknown }).Notification = mock;
  return { ctor };
}

describe("通知服務 browserNotifier（ADR-0076）", () => {
  beforeEach(() => {
    lastInstance = undefined;
  });
  afterEach(() => {
    delete (globalThis as { Notification?: unknown }).Notification;
    vi.restoreAllMocks();
  });

  it("已授權：notify 送出、標題與內文傳入 Web Notification", async () => {
    const { ctor } = installNotification({ permission: "granted" });
    await browserNotifier.notify({ title: "王小明", body: "嗨" });
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(ctor).toHaveBeenCalledWith("王小明", { body: "嗨" });
  });

  it("未授權：notify 靜默略過、不建構通知、不丟例外", async () => {
    const { ctor } = installNotification({ permission: "default" });
    await expect(browserNotifier.notify({ title: "t", body: "b" })).resolves.toBeUndefined();
    expect(ctor).not.toHaveBeenCalled();
  });

  it("環境無 Notification：notify/ensurePermission 皆安全回退", async () => {
    delete (globalThis as { Notification?: unknown }).Notification;
    await expect(browserNotifier.notify({ title: "t", body: "b" })).resolves.toBeUndefined();
    expect(await browserNotifier.ensurePermission()).toBe(false);
  });

  it("ensurePermission：granted 直接 true、default 觸發請求、denied 直接 false", async () => {
    installNotification({ permission: "granted" });
    expect(await browserNotifier.ensurePermission()).toBe(true);

    installNotification({ permission: "default", request: "granted" });
    expect(await browserNotifier.ensurePermission()).toBe(true);

    installNotification({ permission: "default", request: "denied" });
    expect(await browserNotifier.ensurePermission()).toBe(false);

    installNotification({ permission: "denied" });
    expect(await browserNotifier.ensurePermission()).toBe(false);
  });

  it("非 Tauri 環境（jsdom）getNotifier 回瀏覽器後備", () => {
    // jsdom 無 window.__TAURI_INTERNALS__ → isTauri() 為 false
    expect(getNotifier()).toBe(browserNotifier);
  });

  it("點擊回跳（N3）：註冊 handler 後，通知 onclick 觸發帶回 convo", async () => {
    installNotification({ permission: "granted" });
    const received: (string | undefined)[] = [];
    const unregister = onNotificationClick((convo) => received.push(convo));
    await browserNotifier.notify({ title: "王小明", body: "嗨", convo: "pkX" });
    expect(lastInstance?.onclick).toBeTypeOf("function");
    lastInstance?.onclick?.(); // 模擬使用者點擊通知
    expect(received).toEqual(["pkX"]);
    unregister();
  });

  it("點擊回跳：取消註冊後不再回呼", async () => {
    installNotification({ permission: "granted" });
    const received: (string | undefined)[] = [];
    const unregister = onNotificationClick((convo) => received.push(convo));
    unregister();
    await browserNotifier.notify({ title: "t", body: "b", convo: "pkY" });
    lastInstance?.onclick?.();
    expect(received).toEqual([]);
  });
});
