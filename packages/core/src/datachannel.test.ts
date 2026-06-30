import { describe, expect, it, vi } from "vitest";
import { DataChannelReceiver, encodeFile, encodeNudge } from "./datachannel.js";

function bytes(...n: number[]): Uint8Array {
  return new Uint8Array(n);
}
const eq = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

describe("Data Channel — Nudge", () => {
  it("編碼並接收 Nudge", () => {
    const onNudge = vi.fn();
    const rx = new DataChannelReceiver({ onNudge });
    rx.receive(encodeNudge());
    expect(onNudge).toHaveBeenCalledTimes(1);
  });
});

describe("Data Channel — 檔案分塊與重組", () => {
  it("單塊檔案往返一致", () => {
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    const file = { name: "a.bin", mime: "application/octet-stream", bytes: bytes(1, 2, 3) };
    for (const m of encodeFile(file, "id1", 1024)) rx.receive(m);
    expect(onFile).toHaveBeenCalledTimes(1);
    const got = onFile.mock.calls[0]![0];
    expect(got.name).toBe("a.bin");
    expect(eq(got.bytes, file.bytes)).toBe(true);
  });

  it("多塊、亂序送達仍正確重組", () => {
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    const payload = new Uint8Array(50).map((_, i) => i);
    const msgs = encodeFile({ name: "b", mime: "x", bytes: payload }, "id2", 8);
    const [begin, ...chunks] = msgs;
    rx.receive(begin!);
    for (const m of [...chunks].reverse()) rx.receive(m); // 反序
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(eq(onFile.mock.calls[0]![0].bytes, payload)).toBe(true);
  });

  it("空檔案在 begin 後即完成", () => {
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    for (const m of encodeFile({ name: "empty", mime: "x", bytes: bytes() }, "id3", 16)) {
      rx.receive(m);
    }
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0]![0].bytes.length).toBe(0);
  });

  it("非法訊息不丟例外，交給 onError", () => {
    const onError = vi.fn();
    const rx = new DataChannelReceiver({ onError });
    expect(() => rx.receive("not json")).not.toThrow();
    expect(onError).toHaveBeenCalled();
  });
});
