import { describe, expect, it, vi } from "vitest";
import { DataChannelReceiver, decodeFileChunk, encodeDcPresence, encodeFile, encodeFileChunk, encodeNudge, encodeTyping } from "./datachannel.js";

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

describe("Data Channel — 輸入中（F5 卸載）", () => {
  it("編碼並接收 typing", () => {
    const onTyping = vi.fn();
    const rx = new DataChannelReceiver({ onTyping });
    rx.receive(encodeTyping());
    expect(onTyping).toHaveBeenCalledTimes(1);
  });
});

describe("Data Channel — 在線狀態（ADR-0088 (e) 心跳卸載）", () => {
  it("編碼並接收 presence（帶 s/m/np）", () => {
    const onPresence = vi.fn();
    const rx = new DataChannelReceiver({ onPresence });
    rx.receive(encodeDcPresence("online", "在忙", "Daft Punk"));
    expect(onPresence).toHaveBeenCalledWith({ s: "online", m: "在忙", np: "Daft Punk" });
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
    expect(got.id).toBe("id1"); // 傳輸 id 帶出，供關聯中繼 metadata（ADR-0093）
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

  it("分塊為二進位框架（非 base64/JSON），可還原 id/seq/bytes 且開銷極小", () => {
    const frame = encodeFileChunk("id9", 3, bytes(9, 8, 7));
    expect(frame).toBeInstanceOf(Uint8Array);
    const dec = decodeFileChunk(frame)!;
    expect(dec.id).toBe("id9");
    expect(dec.seq).toBe(3);
    expect(eq(dec.bytes, bytes(9, 8, 7))).toBe(true);
    // header = type(1)+idLen(1)+id(3)+seq(4) = 9；payload 原封不動（無 base64 33% 膨脹）
    expect(frame.length).toBe(9 + 3);
    // encodeFile 的分塊皆為二進位、begin 為字串
    const msgs = encodeFile({ name: "a", mime: "x", bytes: new Uint8Array(20) }, "id10", 8);
    expect(typeof msgs[0]).toBe("string");
    expect(msgs.slice(1).every((m) => m instanceof Uint8Array)).toBe(true);
  });

  it("非法二進位框架交給 onError（不丟例外）", () => {
    const onError = vi.fn();
    const rx = new DataChannelReceiver({ onError });
    rx.receive(new Uint8Array([0xff, 0, 0]));
    expect(onError).toHaveBeenCalled();
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

describe("Data Channel — 資源上限（防 OOM/洩漏）", () => {
  const beginMsg = (over: Record<string, unknown>) =>
    JSON.stringify({ t: "file-begin", id: "x", name: "n", mime: "m", size: 10, chunks: 1, ...over });

  it("宣告大小超過上限時拒絕、不建立 partial", () => {
    const onError = vi.fn();
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onError, onFile }, { maxFileSize: 1000 });
    rx.receive(beginMsg({ size: 2000 }));
    expect(onError).toHaveBeenCalled();
    expect(onFile).not.toHaveBeenCalled();
  });

  it("實際資料超出宣告大小時中止", () => {
    const onError = vi.fn();
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onError, onFile });
    rx.receive(JSON.stringify({ t: "file-begin", id: "y", name: "n", mime: "m", size: 3, chunks: 1 }));
    rx.receive(encodeFileChunk("y", 0, bytes(1, 2, 3, 4, 5)));
    expect(onError).toHaveBeenCalled();
    expect(onFile).not.toHaveBeenCalled();
  });

  it("超過同時進行檔案數上限時拒絕新檔", () => {
    const onError = vi.fn();
    const rx = new DataChannelReceiver({ onError }, { maxConcurrentFiles: 1 });
    rx.receive(JSON.stringify({ t: "file-begin", id: "a", name: "n", mime: "m", size: 10, chunks: 2 }));
    rx.receive(JSON.stringify({ t: "file-begin", id: "b", name: "n", mime: "m", size: 10, chunks: 2 }));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("上限"));
  });
});

describe("P2P 在線狀態自報節奏（ADR-0109）", () => {
  it("帶上 hb（毫秒），收端原樣讀回", () => {
    let got: { s: string; m: string; np: string; hb?: number } | undefined;
    const rx = new DataChannelReceiver({ onPresence: (p) => (got = p) });
    rx.receive(encodeDcPresence("online", "", "", 300_000));
    expect(got).toEqual({ s: "online", m: "", np: "", hb: 300_000 });
  });

  it("未帶 hb（舊版對端）→ 讀回 undefined，收端退回預設容忍窗（不可直接判離線）", () => {
    let got: { s: string; m: string; np: string; hb?: number } | undefined;
    const rx = new DataChannelReceiver({ onPresence: (p) => (got = p) });
    rx.receive(encodeDcPresence("online", "", ""));
    expect(got?.hb).toBeUndefined();
    expect(got?.s).toBe("online");
  });
});
