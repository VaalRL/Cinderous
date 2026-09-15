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

  it("儲存槽 origin 隨 file-begin 幀往返（ADR-0161 審查修正）；一般檔案無此欄；過長截斷", () => {
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    const file = { name: "報表.xlsx", mime: "application/x", bytes: bytes(1, 2, 3) };
    for (const m of encodeFile(file, "s1", 1024, "與阿強的對話")) rx.receive(m);
    expect(onFile.mock.calls[0]![0].origin).toBe("與阿強的對話");
    // 一般檔案（無 origin）→ 收端不帶 origin 欄。
    const onFile2 = vi.fn();
    const rx2 = new DataChannelReceiver({ onFile: onFile2 });
    for (const m of encodeFile(file, "s2", 1024)) rx2.receive(m);
    expect(onFile2.mock.calls[0]![0].origin).toBeUndefined();
    // 過長 origin（遠端可控）→ 收端截斷至 200 字。
    const onFile3 = vi.fn();
    const rx3 = new DataChannelReceiver({ onFile: onFile3 });
    for (const m of encodeFile(file, "s3", 1024, "x".repeat(500))) rx3.receive(m);
    expect(onFile3.mock.calls[0]![0].origin.length).toBe(200);
  });

  it("多塊、亂序送達仍正確重組", () => {
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    const payload = new Uint8Array(50).map((_, i) => i);
    const [begin, ...chunks] = encodeFile({ name: "b", mime: "x", bytes: payload }, "id2", 8);
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
    // encodeFile 的分塊皆為二進位、begin 為字串（ADR-0345 起是 generator ⇒ 需要陣列時自行展開）
    const msgs = [...encodeFile({ name: "a", mime: "x", bytes: new Uint8Array(20) }, "id10", 8)];
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

// ── ADR-0345：串流化——發送端惰性產生、接收端單一緩衝區直寫 ──────────────
//
// 這組測的是改動後**新出現**的不變式。往返一致、亂序重組、資源上限那些既有契約由
// 上方的既有測試把關（它們一個字都沒改，正是「行為不變、只是不再多複製一份」的證據）。

describe("Data Channel — 發送端惰性分塊（ADR-0345）", () => {
  it("🔴 encodeFile 是 generator：不先把所有分塊配置出來", () => {
    const gen = encodeFile({ name: "a", mime: "x", bytes: new Uint8Array(1000) }, "lazy", 8);
    // 有 next 才是 generator；陣列沒有。
    expect(typeof (gen as { next?: unknown }).next).toBe("function");
    // 只取前兩則就停——若是預先配置的陣列，這個「只取兩則」毫無意義。
    const it2 = gen[Symbol.iterator]();
    expect(typeof it2.next().value).toBe("string"); // file-begin
    expect(it2.next().value).toBeInstanceOf(Uint8Array); // 第一塊
  });

  it("逐塊產生的內容與一次展開完全相同（惰性不改變位元組）", () => {
    const payload = new Uint8Array(100).map((_, i) => i % 251);
    const file = { name: "a", mime: "x", bytes: payload };
    const all = [...encodeFile(file, "same", 16)];
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    for (const m of all) rx.receive(m);
    expect(eq(onFile.mock.calls[0]![0].bytes, payload)).toBe(true);
  });

  it("file-begin 帶 chunkSize，供收端直接算位移", () => {
    const [begin] = encodeFile({ name: "a", mime: "x", bytes: new Uint8Array(20) }, "cs", 8);
    expect(JSON.parse(begin as string).chunkSize).toBe(8);
  });
});

describe("Data Channel — 接收端單一緩衝區（ADR-0345）", () => {
  const begin = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ t: "file-begin", id: "z", name: "n", mime: "m", size: 6, chunks: 3, chunkSize: 2, ...over });

  it("有 chunkSize → 亂序送達仍寫對位置", () => {
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    rx.receive(begin());
    rx.receive(encodeFileChunk("z", 2, bytes(5, 6)));
    rx.receive(encodeFileChunk("z", 0, bytes(1, 2)));
    rx.receive(encodeFileChunk("z", 1, bytes(3, 4)));
    expect(eq(onFile.mock.calls[0]![0].bytes, bytes(1, 2, 3, 4, 5, 6))).toBe(true);
  });

  it("重複的分塊被忽略，不會把檔案算成收滿", () => {
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    rx.receive(begin());
    rx.receive(encodeFileChunk("z", 0, bytes(1, 2)));
    rx.receive(encodeFileChunk("z", 0, bytes(1, 2)));
    rx.receive(encodeFileChunk("z", 0, bytes(1, 2)));
    expect(onFile).not.toHaveBeenCalled(); // 只收到 1/3 塊
  });

  it("🔴 序號超出宣告範圍即中止——這條讓「收滿 N 塊」等價於「沒有洞」", () => {
    const onError = vi.fn();
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onError, onFile });
    rx.receive(begin());
    rx.receive(encodeFileChunk("z", 9, bytes(1, 2)));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("超出宣告範圍"));
    expect(onFile).not.toHaveBeenCalled();
  });

  it("🔴 收滿宣告塊數時不可能有洞（舊版是收滿後才逐一檢查）", () => {
    const onFile = vi.fn();
    const onError = vi.fn();
    const rx = new DataChannelReceiver({ onFile, onError });
    rx.receive(begin());
    // 只有相異且在範圍內的 3 塊才可能湊滿，湊滿就一定是 0/1/2 全到。
    rx.receive(encodeFileChunk("z", 1, bytes(3, 4)));
    rx.receive(encodeFileChunk("z", 2, bytes(5, 6)));
    rx.receive(encodeFileChunk("z", 0, bytes(1, 2)));
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("位移加長度超出宣告大小即中止（惡意 chunkSize／超長塊）", () => {
    const onError = vi.fn();
    const rx = new DataChannelReceiver({ onError });
    rx.receive(begin({ size: 4, chunks: 2, chunkSize: 2 }));
    rx.receive(encodeFileChunk("z", 1, bytes(1, 2, 3, 4, 5))); // 位移 2 + 5 > 4
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("超出宣告大小"));
  });

  it("chunkSize 非正整數（遠端可控）→ 當作沒給，退回循序寫入", () => {
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    rx.receive(begin({ chunkSize: -5 }));
    rx.receive(encodeFileChunk("z", 0, bytes(1, 2)));
    rx.receive(encodeFileChunk("z", 1, bytes(3, 4)));
    rx.receive(encodeFileChunk("z", 2, bytes(5, 6)));
    expect(eq(onFile.mock.calls[0]![0].bytes, bytes(1, 2, 3, 4, 5, 6))).toBe(true);
  });

  it("舊版對端（無 chunkSize）循序送達仍正確——可靠有序通道的正常情形", () => {
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    rx.receive(begin({ chunkSize: undefined }));
    rx.receive(encodeFileChunk("z", 0, bytes(1, 2)));
    rx.receive(encodeFileChunk("z", 1, bytes(3, 4)));
    rx.receive(encodeFileChunk("z", 2, bytes(5, 6)));
    expect(eq(onFile.mock.calls[0]![0].bytes, bytes(1, 2, 3, 4, 5, 6))).toBe(true);
  });

  it("🔴 舊版對端 ＋ 跳號 → 中止而非靜默寫錯位置", () => {
    const onError = vi.fn();
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onError, onFile });
    rx.receive(begin({ chunkSize: undefined }));
    rx.receive(encodeFileChunk("z", 0, bytes(1, 2)));
    rx.receive(encodeFileChunk("z", 2, bytes(5, 6))); // 跳過 1
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("亂序"));
    expect(onFile).not.toHaveBeenCalled();
  });

  it("🔴 只宣告不送資料 → 不配置緩衝區（否則對方零成本吃掉記憶體）", () => {
    const rx = new DataChannelReceiver({});
    // 宣告 16 個 100 MiB 的檔（剛好踩滿 maxConcurrentFiles），一個位元組都不送。
    for (let i = 0; i < 16; i++) {
      rx.receive(JSON.stringify({ t: "file-begin", id: `d${i}`, name: "n", mime: "m", size: 100 * 1024 * 1024, chunks: 1 }));
    }
    const partials = (rx as unknown as { partials: Map<string, { buf: Uint8Array | null }> }).partials;
    expect(partials.size).toBe(16);
    expect([...partials.values()].every((p) => p.buf === null)).toBe(true);
  });
});
