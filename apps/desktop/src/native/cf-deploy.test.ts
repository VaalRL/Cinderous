// 一鍵部署的前端接線（ADR-0356）。
//
// 這支測試盯的是**驗證**那一段：部署 API 回 200 不等於 relay 活著。少了它，
// 使用者會拿到一座打不開的節點，而我們還會把 home 切過去。

import { describe, expect, it, vi } from "vitest";
import { verifyRelay, type SocketFactory } from "./cf-deploy.js";

/** 可控的假 WebSocket：測試自己決定什麼時候送什麼。 */
function fakeSocket(): {
  factory: SocketFactory;
  emit: (type: string, data?: unknown) => void;
  closed: () => number;
  url: () => string;
} {
  const listeners = new Map<string, ((ev: { data?: unknown }) => void)[]>();
  let closes = 0;
  let seen = "";
  const factory: SocketFactory = (url) => {
    seen = url;
    return {
      addEventListener: (type, fn) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      close: () => {
        closes += 1;
      },
    };
  };
  return {
    factory,
    emit: (type, data) => {
      for (const fn of listeners.get(type) ?? []) fn({ data });
    },
    closed: () => closes,
    url: () => seen,
  };
}

const AUTH = JSON.stringify(["AUTH", "challenge-abc"]);

describe("verifyRelay（ADR-0356 §4）", () => {
  it("收到 NIP-42 的 AUTH 挑戰 → 判定活著", async () => {
    const s = fakeSocket();
    const p = verifyRelay("wss://x.workers.dev", s.factory);
    s.emit("message", AUTH);
    expect(await p).toBe(true);
    expect(s.url()).toBe("wss://x.workers.dev");
  });

  it("🔴 連線關掉卻沒收到挑戰 → 判定失敗（腳本在但路由沒開就是這個形狀）", async () => {
    const s = fakeSocket();
    const p = verifyRelay("wss://x", s.factory);
    s.emit("close");
    expect(await p).toBe(false);
  });

  it("連線錯誤 → 判定失敗，不會卡住", async () => {
    const s = fakeSocket();
    const p = verifyRelay("wss://x", s.factory);
    s.emit("error");
    expect(await p).toBe(false);
  });

  it("逾時 → 判定失敗（Worker 沒醒或網址根本不通）", async () => {
    vi.useFakeTimers();
    try {
      const s = fakeSocket();
      const p = verifyRelay("wss://x", s.factory);
      await vi.advanceTimersByTimeAsync(9000);
      expect(await p).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("🔴 別的訊息不算數——只有 AUTH 才證明跑的是我們這份程式碼", async () => {
    const s = fakeSocket();
    const p = verifyRelay("wss://x", s.factory);
    s.emit("message", JSON.stringify(["NOTICE", "hello"]));
    s.emit("message", "這不是 JSON");
    s.emit("message", JSON.stringify(["AUTH"])); // 少了 challenge
    s.emit("close");
    expect(await p).toBe(false);
  });

  it("建構 WebSocket 就爆掉（網址不合法）→ 回 false 而不是拋出來", async () => {
    const throwing: SocketFactory = () => {
      throw new Error("bad url");
    };
    expect(await verifyRelay("wss://x", throwing)).toBe(false);
  });

  it("判定之後把連線關掉——驗證用的那條不該留著", async () => {
    const s = fakeSocket();
    const p = verifyRelay("wss://x", s.factory);
    s.emit("message", AUTH);
    await p;
    expect(s.closed()).toBe(1);
  });

  it("重複事件只結算一次", async () => {
    const s = fakeSocket();
    const p = verifyRelay("wss://x", s.factory);
    s.emit("message", AUTH);
    s.emit("close");
    s.emit("error");
    expect(await p).toBe(true);
    expect(s.closed()).toBe(1);
  });
});
