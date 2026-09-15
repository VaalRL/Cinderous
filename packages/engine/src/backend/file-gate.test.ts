import { describe, expect, it } from "vitest";
import {
  formatBytes,
  relayFileWarning,
  relayFileWarningFor,
  RELAY_FILE_WARN_BYTES,
} from "./file-gate.js";
import type { IcePath } from "./ice-path.js";

const MB = 1024 * 1024;

describe("relayFileWarning — 走中繼的大檔才提示（ADR-0344）", () => {
  it("門檻是 50 MB", () => {
    expect(RELAY_FILE_WARN_BYTES).toBe(50 * MB);
  });

  it("直連：多大都不提示（不關中繼的事）", () => {
    expect(relayFileWarning(500 * MB, "direct")).toBeNull();
    expect(relayFileWarning(1, "direct")).toBeNull();
  });

  it("經中繼且超過門檻 → 提示，並標明是「確定在中繼上」", () => {
    expect(relayFileWarning(51 * MB, "relay")).toEqual({ sizeBytes: 51 * MB, path: "relay" });
  });

  it("經中繼但未超過門檻 → 不提示（日常照片/語音不該被打擾）", () => {
    expect(relayFileWarning(5 * MB, "relay")).toBeNull();
  });

  it("恰好等於門檻 → 不提示（「超過」才提示）", () => {
    expect(relayFileWarning(RELAY_FILE_WARN_BYTES, "relay")).toBeNull();
    expect(relayFileWarning(RELAY_FILE_WARN_BYTES + 1, "relay")).not.toBeNull();
  });

  it("🔴 unknown 保守當成會走中繼——但標成 unknown，文案才能說「無法確認」", () => {
    expect(relayFileWarning(60 * MB, "unknown")).toEqual({ sizeBytes: 60 * MB, path: "unknown" });
  });

  it("門檻可覆寫（供測試與未來的政策）", () => {
    expect(relayFileWarning(2 * MB, "relay", 1 * MB)).not.toBeNull();
    expect(relayFileWarning(2 * MB, "relay", 10 * MB)).toBeNull();
  });
});

describe("relayFileWarningFor — 群組扇出合議（ADR-0124）", () => {
  it("沒有對象 → 不提示", () => {
    expect(relayFileWarningFor(99 * MB, [])).toBeNull();
  });

  it("全部直連 → 不提示", () => {
    expect(relayFileWarningFor(99 * MB, ["direct", "direct"])).toBeNull();
  });

  it("🔴 任一對象走中繼就提示——群組逐一扇出，一個人在 TURN 上就是一份完整流量", () => {
    expect(relayFileWarningFor(99 * MB, ["direct", "direct", "relay"])).toMatchObject({ path: "relay" });
  });

  it("relay 優先於 unknown（確定的事實比「不知道」更值得說）", () => {
    expect(relayFileWarningFor(99 * MB, ["unknown", "relay", "unknown"])).toMatchObject({ path: "relay" });
  });

  it("全是 unknown → 以 unknown 提示", () => {
    expect(relayFileWarningFor(99 * MB, ["unknown", "unknown"])).toMatchObject({ path: "unknown" });
  });

  it("小檔即使全走中繼也不提示", () => {
    const paths: IcePath[] = ["relay", "relay"];
    expect(relayFileWarningFor(1 * MB, paths)).toBeNull();
  });
});

describe("formatBytes", () => {
  it("B / KB / MB 三段", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(MB)).toBe("1.0 MB");
    expect(formatBytes(51 * MB)).toBe("51.0 MB");
  });
});
