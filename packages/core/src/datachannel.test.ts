import { describe, expect, it, vi } from "vitest";
import {
  blobStream,
  DataChannelReceiver,
  decodeFileChunk,
  encodeDcPresence,
  encodeFileChunk,
  encodeNudge,
  encodeTyping,
  streamFile,
  bytesStream,
  asFileStream,
  fileSizeOf,
  type DataChannelLimits,
  type OpenFileSink,
  type ReceivedFile,
} from "./datachannel.js";

/** 收集 async generator 的全部訊息（測試要陣列時用）。 */
async function frames(...args: Parameters<typeof streamFile>): Promise<(string | Uint8Array)[]> {
  const out: (string | Uint8Array)[] = [];
  for await (const m of streamFile(...args)) out.push(m);
  return out;
}

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
  it("單塊檔案往返一致", async () => {
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    const file = { name: "a.bin", mime: "application/octet-stream", bytes: bytes(1, 2, 3) };
    for (const m of await frames(file, "id1", 1024)) rx.receive(m);
    expect(onFile).toHaveBeenCalledTimes(1);
    const got = onFile.mock.calls[0]![0];
    expect(got.id).toBe("id1"); // 傳輸 id 帶出，供關聯中繼 metadata（ADR-0093）
    expect(got.name).toBe("a.bin");
    expect(eq(got.bytes, file.bytes)).toBe(true);
  });

  it("儲存槽 origin 隨 file-begin 幀往返（ADR-0161 審查修正）；一般檔案無此欄；過長截斷", async () => {
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    const file = { name: "報表.xlsx", mime: "application/x", bytes: bytes(1, 2, 3) };
    for (const m of await frames(file, "s1", 1024, "與阿強的對話")) rx.receive(m);
    expect(onFile.mock.calls[0]![0].origin).toBe("與阿強的對話");
    // 一般檔案（無 origin）→ 收端不帶 origin 欄。
    const onFile2 = vi.fn();
    const rx2 = new DataChannelReceiver({ onFile: onFile2 });
    for (const m of await frames(file, "s2", 1024)) rx2.receive(m);
    expect(onFile2.mock.calls[0]![0].origin).toBeUndefined();
    // 過長 origin（遠端可控）→ 收端截斷至 200 字。
    const onFile3 = vi.fn();
    const rx3 = new DataChannelReceiver({ onFile: onFile3 });
    for (const m of await frames(file, "s3", 1024, "x".repeat(500))) rx3.receive(m);
    expect(onFile3.mock.calls[0]![0].origin.length).toBe(200);
  });

  it("多塊、亂序送達仍正確重組", async () => {
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    const payload = new Uint8Array(50).map((_, i) => i);
    const [begin, ...chunks] = await frames({ name: "b", mime: "x", bytes: payload }, "id2", 8);
    rx.receive(begin!);
    for (const m of [...chunks].reverse()) rx.receive(m); // 反序
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(eq(onFile.mock.calls[0]![0].bytes, payload)).toBe(true);
  });

  it("分塊為二進位框架（非 base64/JSON），可還原 id/seq/bytes 且開銷極小", async () => {
    const frame = encodeFileChunk("id9", 3, bytes(9, 8, 7));
    expect(frame).toBeInstanceOf(Uint8Array);
    const dec = decodeFileChunk(frame)!;
    expect(dec.id).toBe("id9");
    expect(dec.seq).toBe(3);
    expect(eq(dec.bytes, bytes(9, 8, 7))).toBe(true);
    // header = type(1)+idLen(1)+id(3)+seq(4) = 9；payload 原封不動（無 base64 33% 膨脹）
    expect(frame.length).toBe(9 + 3);
    // 分塊皆為二進位、begin 為字串（ADR-0345/0346：async generator ⇒ 需要陣列時自行收集）
    const msgs = await frames({ name: "a", mime: "x", bytes: new Uint8Array(20) }, "id10", 8);
    expect(typeof msgs[0]).toBe("string");
    expect(msgs.slice(1).every((m) => m instanceof Uint8Array)).toBe(true);
  });

  it("非法二進位框架交給 onError（不丟例外）", () => {
    const onError = vi.fn();
    const rx = new DataChannelReceiver({ onError });
    rx.receive(new Uint8Array([0xff, 0, 0]));
    expect(onError).toHaveBeenCalled();
  });

  it("空檔案在 begin 後即完成", async () => {
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    for (const m of await frames({ name: "empty", mime: "x", bytes: bytes() }, "id3", 16)) {
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
  it("🔴 streamFile 是 async generator：不先把所有分塊配置出來", async () => {
    const it2 = streamFile({ name: "a", mime: "x", bytes: new Uint8Array(1000) }, "lazy", 8);
    // 只取前兩則就停——若是預先配置的陣列，這個「只取兩則」毫無意義。
    expect(typeof (await it2.next()).value).toBe("string"); // file-begin
    expect((await it2.next()).value).toBeInstanceOf(Uint8Array); // 第一塊
  });

  it("🔴 惰性來源逐塊才讀：只取前兩則時，來源只被讀過一次（ADR-0346）", async () => {
    const reads: Array<[number, number]> = [];
    const src = {
      name: "big",
      mime: "x",
      size: 1000,
      slice: (offset: number, length: number): Promise<Uint8Array> => {
        reads.push([offset, length]);
        return Promise.resolve(new Uint8Array(length));
      },
    };
    const it2 = streamFile(src, "lazy2", 8);
    await it2.next(); // file-begin：還沒讀任何位元組
    expect(reads).toEqual([]);
    await it2.next(); // 第一塊
    expect(reads).toEqual([[0, 8]]);
    await it2.next(); // 第二塊
    expect(reads).toEqual([
      [0, 8],
      [8, 8],
    ]);
    // 全檔 125 塊，但我們只讀了 2 塊——整檔從未進 RAM。
  });

  it("尾段只讀剩下的長度（不向來源多要）", async () => {
    const reads: Array<[number, number]> = [];
    const src = {
      name: "tail",
      mime: "x",
      size: 20,
      slice: (offset: number, length: number): Promise<Uint8Array> => {
        reads.push([offset, length]);
        return Promise.resolve(new Uint8Array(length));
      },
    };
    for await (const _ of streamFile(src, "tail", 8)) void _;
    expect(reads).toEqual([
      [0, 8],
      [8, 8],
      [16, 4],
    ]);
  });

  it("blobStream：Blob/File 逐塊讀，往返位元組一致", async () => {
    const payload = new Uint8Array(50).map((_, i) => i);
    const blob = new Blob([payload]);
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    for await (const m of streamFile(blobStream("b.bin", "application/octet-stream", blob), "bs", 8)) {
      rx.receive(m);
    }
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0]![0].name).toBe("b.bin");
    expect(eq(onFile.mock.calls[0]![0].bytes, payload)).toBe(true);
  });

  it("bytesStream 的 slice 不複製（subarray，共用同一段底層記憶體）", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const src = bytesStream({ name: "a", mime: "x", bytes: payload });
    const part = await src.slice(1, 2);
    expect(part.buffer).toBe(payload.buffer);
    expect([...part]).toEqual([2, 3]);
  });

  it("asFileStream／fileSizeOf 兩種型態都吃", async () => {
    const bytesFile = { name: "a", mime: "x", bytes: new Uint8Array(7) };
    expect(fileSizeOf(bytesFile)).toBe(7);
    expect(asFileStream(bytesFile).size).toBe(7);
    const stream = blobStream("b", "x", new Blob([new Uint8Array(9)]));
    expect(fileSizeOf(stream)).toBe(9);
    expect(asFileStream(stream)).toBe(stream); // 已經是串流就原樣回傳
  });

  it("逐塊產生的內容與一次展開完全相同（惰性不改變位元組）", async () => {
    const payload = new Uint8Array(100).map((_, i) => i % 251);
    const file = { name: "a", mime: "x", bytes: payload };
    const all = await frames(file, "same", 16);
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    for (const m of all) rx.receive(m);
    expect(eq(onFile.mock.calls[0]![0].bytes, payload)).toBe(true);
  });

  it("file-begin 帶 chunkSize，供收端直接算位移", async () => {
    const [begin] = await frames({ name: "a", mime: "x", bytes: new Uint8Array(20) }, "cs", 8);
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

// ── ADR-0347：收檔端串流落盤 ─────────────────────────────────────────────────
//
// 上面所有既有測試都沒有給 `openSink` ⇒ 一律走記憶體路徑，**一個位元組都沒變**。
// 這一組測的是給了 sink 之後的新行為。

/** 記帳型 sink：把寫入記在陣列裡，並可注入延遲/失敗。 */
function fakeSink(opts: { delay?: boolean; failOn?: number } = {}) {
  const writes: Array<[number, number[]]> = [];
  let closed = false;
  let aborted = false;
  let n = 0;
  const sink = {
    write(offset: number, chunk: Uint8Array): Promise<void> | void {
      n += 1;
      if (opts.failOn === n) return Promise.reject(new Error("磁碟壞了"));
      writes.push([offset, [...chunk]]);
      return opts.delay ? Promise.resolve() : undefined;
    },
    close(): { handle: string } {
      closed = true;
      return { handle: "/tmp/x" };
    },
    abort(): void {
      aborted = true;
    },
  };
  return {
    sink,
    writes,
    get closed() {
      return closed;
    },
    get aborted() {
      return aborted;
    },
    /** 依寫入順序拼回完整位元組（驗證落盤內容正確）。 */
    assembled(size: number): Uint8Array {
      const out = new Uint8Array(size);
      for (const [at, b] of writes) out.set(new Uint8Array(b), at);
      return out;
    },
  };
}

/** 送一個 payload 給裝了 sink 的收端；回傳 sink 記帳與收到的檔案。 */
async function receiveWithSink(
  payload: Uint8Array,
  chunkSize: number,
  opts: { limits?: DataChannelLimits; sinkOpts?: Parameters<typeof fakeSink>[0]; openSink?: OpenFileSink } = {},
) {
  const rec = fakeSink(opts.sinkOpts);
  const files: ReceivedFile[] = [];
  const errors: string[] = [];
  const rx = new DataChannelReceiver(
    { onFile: (f) => files.push(f), onError: (e) => errors.push(e) },
    { sinkMinBytes: 1, ...opts.limits },
    opts.openSink ?? (() => rec.sink),
  );
  for (const m of await frames({ name: "big.bin", mime: "application/octet-stream", bytes: payload }, "s1", chunkSize)) {
    rx.receive(m);
  }
  for (let i = 0; i < 50; i++) await Promise.resolve(); // 沖刷落盤佇列
  return { rec, files, errors, rx };
}

describe("Data Channel — 收檔端串流落盤（ADR-0347）", () => {
  const payload = new Uint8Array(100).map((_, i) => i % 251);

  it("🔴 落盤後不帶 bytes，改帶 sink 落腳處與權威 size", async () => {
    const { rec, files } = await receiveWithSink(payload, 16);
    expect(files).toHaveLength(1);
    expect(files[0]!.bytes).toBeUndefined();
    expect(files[0]!.sink).toEqual({ handle: "/tmp/x" });
    expect(files[0]!.size).toBe(100);
    expect(rec.closed).toBe(true);
  });

  it("🔴 落盤內容與原始位元組完全一致", async () => {
    const { rec } = await receiveWithSink(payload, 16);
    expect(eq(rec.assembled(100), payload)).toBe(true);
  });

  it("每塊各寫一次，位移正確（不是最後才一次寫出）", async () => {
    const { rec } = await receiveWithSink(payload, 16);
    expect(rec.writes.map(([at]) => at)).toEqual([0, 16, 32, 48, 64, 80, 96]);
  });

  it("非同步 sink（真磁碟）也照樣收齊", async () => {
    const { rec, files } = await receiveWithSink(payload, 16, { sinkOpts: { delay: true } });
    expect(files).toHaveLength(1);
    expect(eq(rec.assembled(100), payload)).toBe(true);
  });

  it("🔴 小檔不落盤——縮圖/儲存槽/預覽需要位元組", async () => {
    const { rec, files } = await receiveWithSink(payload, 16, { limits: { sinkMinBytes: 1000 } });
    expect(rec.writes).toHaveLength(0);
    expect(files[0]!.bytes).toBeDefined();
    expect(files[0]!.sink).toBeUndefined();
  });

  it("🔴 openSink 回 null → 退回記憶體，檔案照樣收得到（磁碟問題不該讓收檔整個失敗）", async () => {
    const { files } = await receiveWithSink(payload, 16, { openSink: () => null });
    expect(files).toHaveLength(1);
    expect(eq(files[0]!.bytes!, payload)).toBe(true);
    expect(files[0]!.sink).toBeUndefined();
  });

  it("openSink 拋例外 → 同樣退回記憶體", async () => {
    const { files } = await receiveWithSink(payload, 16, {
      openSink: () => {
        throw new Error("no fs");
      },
    });
    expect(files).toHaveLength(1);
    expect(eq(files[0]!.bytes!, payload)).toBe(true);
  });

  it("🔴 開 sink 期間到達的分塊不會掉——退回記憶體時要倒回緩衝區", async () => {
    // openSink 回傳一個「晚一點才 resolve」的 promise：分塊會先塞進佇列。
    let release: (v: null) => void = () => {};
    const pending = new Promise<null>((r) => (release = r));
    const files: ReceivedFile[] = [];
    const rx = new DataChannelReceiver({ onFile: (f) => files.push(f) }, { sinkMinBytes: 1 }, () => pending);
    for (const m of await frames({ name: "a", mime: "x", bytes: payload }, "late", 16)) rx.receive(m);
    expect(files).toHaveLength(0); // 還在等 sink
    release(null); // 沒有 sink ⇒ 退回記憶體
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(files).toHaveLength(1);
    expect(eq(files[0]!.bytes!, payload)).toBe(true);
  });

  it("🔴 落盤跟不上接收速度 → 中止並報錯，不靜默吃光記憶體", async () => {
    const { errors, files } = await receiveWithSink(payload, 16, {
      limits: { maxQueuedBytes: 8 }, // 一塊就爆
      sinkOpts: { delay: true },
    });
    expect(errors.some((e) => e.includes("跟不上"))).toBe(true);
    expect(files).toHaveLength(0);
  });

  it("🔴 寫入失敗 → 中止、報錯、清掉半成品", async () => {
    const { rec, errors, files } = await receiveWithSink(payload, 16, { sinkOpts: { failOn: 2, delay: true } });
    expect(errors.some((e) => e.includes("落盤失敗"))).toBe(true);
    expect(rec.aborted).toBe(true);
    expect(files).toHaveLength(0);
  });

  it("中止後續到的分塊被丟棄，且不重複報錯", async () => {
    const rec = fakeSink();
    const errors: string[] = [];
    const rx = new DataChannelReceiver({ onError: (e) => errors.push(e) }, { sinkMinBytes: 1 }, () => rec.sink);
    rx.receive(JSON.stringify({ t: "file-begin", id: "z", name: "n", mime: "m", size: 6, chunks: 3, chunkSize: 2 }));
    rx.receive(encodeFileChunk("z", 9, bytes(1, 2))); // 超出範圍 → 中止
    rx.receive(encodeFileChunk("z", 0, bytes(1, 2)));
    rx.receive(encodeFileChunk("z", 1, bytes(3, 4)));
    expect(errors).toHaveLength(1);
  });

  it("abort() 會關掉串流中的 sink（逾時清理不留半成品）", async () => {
    const rec = fakeSink();
    const rx = new DataChannelReceiver({}, { sinkMinBytes: 1 }, () => rec.sink);
    rx.receive(JSON.stringify({ t: "file-begin", id: "z", name: "n", mime: "m", size: 64, chunks: 4, chunkSize: 16 }));
    await Promise.resolve();
    rx.receive(encodeFileChunk("z", 0, new Uint8Array(16)));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    rx.abort("z");
    expect(rec.aborted).toBe(true);
  });

  it("記憶體路徑也帶 size（兩條路徑的 ReceivedFile 形狀一致）", async () => {
    const onFile = vi.fn();
    const rx = new DataChannelReceiver({ onFile });
    for (const m of await frames({ name: "a", mime: "x", bytes: payload }, "sz", 16)) rx.receive(m);
    expect(onFile.mock.calls[0]![0].size).toBe(100);
  });
});
