// 檔案合集（ADR-0355 第三段）：把多個檔案／一整個資料夾折疊成**單一 tar 串流**。
//
// ## 為什麼是 tar，而且是自己寫
//
// 傳 1,000 個小檔的災難不在位元組總量，而在**每檔一次的固定成本**：一則 kind 1059 加密
// 中繼事件、一次 `file-begin` 握手、收端一次「另存新檔」對話框。折疊成一個檔之後，
// 這些成本從 O(N) 變成 O(1)，而且「傳整個資料夾」這件本來做不到的事順便解鎖。
//
// 選 tar 而非 zip：tar 是**純串流**格式——標頭在前、內容緊接其後，寫出時不需要回頭修改
// 任何欄位，也不需要像 zip 那樣在結尾寫中央目錄。這正好對上 ADR-0347 第一段的串流管線：
// 邊讀邊送、記憶體恆定。不壓縮是刻意的——聊天傳的多半是已壓縮的相片與影片，壓縮只是
// 白白吃 CPU。
//
// 自己寫而不引入 `tar-stream`／`fflate`：ustar 格式小到一個檔就寫得完（寫入端約 100 行），
// 而 `file-begin` 必須**先宣告確切大小**，這要求「不產生位元組也能算出總長度」的能力——
// 現成套件不保證這點。自己寫就順便零新相依（ADR-0355 原本把依賴選型列為待決，這裡解掉它）。

const BLOCK = 512;
const NAME_MAX = 100;
const PREFIX_MAX = 155;
/** GNU longname 擴充項的 typeflag：下一個項目的真實路徑放在本項的內容裡。 */
const TYPE_LONGNAME = "L";
const LONGNAME_MARKER = "././@LongLink";

/** 合集裡的一個項目；`open()` 逐段吐出內容，故來源可以是磁碟檔而非記憶體。 */
export interface ArchiveEntry {
  /** 合集內的相對路徑（以 `/` 分隔）。 */
  path: string;
  /** 內容位元組數；必須與 `open()` 實際產出的總量一致。 */
  size: number;
  /** 修改時間（Unix 秒）；省略＝0。**要帶**：省略會讓解開後的檔案都變成 1970 年。 */
  mtime?: number;
  /** POSIX 權限位元；省略＝`0o644`。帶著它，可執行腳本解開後才還是可執行的。 */
  mode?: number;
  /**
   * 讀取這個項目內容的 `[offset, offset+length)`。
   *
   * 🔴 **隨機存取而非串流**，是為了讓整個合集能做成 `OutgoingFileStream`（ADR-0346）：
   * 傳輸層要的是 `slice(offset, length)`，而斷點續傳要的也是「從第 N 個位元組開始」。
   * 若這裡只給循序產生器，合集就只能從頭重傳。
   */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** 由記憶體位元組做出一個合集項目（小檔與測試用）。 */
export function bytesEntry(path: string, bytes: Uint8Array, meta: { mtime?: number; mode?: number } = {}): ArchiveEntry {
  return {
    path,
    size: bytes.length,
    ...(meta.mtime !== undefined ? { mtime: meta.mtime } : {}),
    ...(meta.mode !== undefined ? { mode: meta.mode } : {}),
    read: async (offset, length) => bytes.subarray(offset, offset + length),
  };
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** 無條件進位到 512 的倍數。 */
function pad512(n: number): number {
  return Math.ceil(n / BLOCK) * BLOCK;
}

/**
 * 把路徑拆成 ustar 的 `prefix` / `name` 兩段；拆不開（太長或無法在分隔處切）回 null，
 * 由呼叫端改走 GNU longname。
 */
function splitUstarPath(path: string): { prefix: string; name: string } | null {
  const bytes = enc.encode(path).length;
  if (bytes <= NAME_MAX) return { prefix: "", name: path };
  // 從後往前找一個分隔點，讓兩段都塞得下。
  for (let i = path.length - 1; i > 0; i--) {
    if (path[i] !== "/") continue;
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (enc.encode(name).length <= NAME_MAX && enc.encode(prefix).length <= PREFIX_MAX) return { prefix, name };
  }
  return null;
}

/** 以位元組為單位截斷，且不切斷多位元組字元。 */
function truncateUtf8(s: string, maxBytes: number): string {
  let out = "";
  let used = 0;
  for (const ch of s) {
    const n = enc.encode(ch).length;
    if (used + n > maxBytes) break;
    out += ch;
    used += n;
  }
  return out;
}

/**
 * 寫一個八進位欄位（尾端補 NUL，tar 慣例）。
 *
 * 🔴 **裝不下就拋錯，絕不靜默截斷**。`padStart` 只會補零、不會截短：size 欄位有 12 格
 * （11 位八進位＋NUL），而 8 GiB 剛好需要 12 位 ⇒ 塞滿之後最後一格被寫成 NUL ⇒
 * 回讀時在那裡停住，等於**把真實大小除以 8**。
 *
 * 那種腐蝕抓不出來：checksum 是拿腐蝕後的位元組算的，所以自洽。解析端會照錯的長度只讀
 * 一小段，然後把後面真正的內容誤判成下一個標頭，整份合集從那一項之後全部錯位。
 * 寧可在打包時就失敗，也不要送出一份解不開的合集。
 */
function writeOctal(block: Uint8Array, offset: number, len: number, value: number): void {
  const s = value.toString(8);
  if (s.length > len - 1) {
    throw new Error(`數值超出 tar 欄位容量（${value} 需要 ${s.length} 位八進位，欄位只有 ${len - 1} 位）`);
  }
  block.set(enc.encode(s.padStart(len - 1, "0")), offset);
  block[offset + len - 1] = 0;
}

function writeString(block: Uint8Array, offset: number, len: number, value: string): void {
  const b = enc.encode(value).subarray(0, len);
  block.set(b, offset);
}

/** 組出一個 512 位元組的 tar 標頭（含校驗和）。 */
function header(path: string, size: number, mtime: number, typeflag: string, mode = 0o644): Uint8Array {
  const block = new Uint8Array(BLOCK);
  // 路徑塞不進 ustar 欄位時，本標頭的 name 只是**佔位**（截斷即可）——真實路徑由前一個
  // GNU longname 項目提供，解析端會優先採用它。這正是 GNU tar 的作法。
  const split =
    typeflag === TYPE_LONGNAME
      ? { prefix: "", name: LONGNAME_MARKER }
      : (splitUstarPath(path) ?? { prefix: "", name: truncateUtf8(path, NAME_MAX) });
  writeString(block, 0, NAME_MAX, split.name);
  writeOctal(block, 100, 8, mode & 0o777); // mode（只取權限位元，不讓 setuid 之類的跟著跑）
  writeOctal(block, 108, 8, 0); // uid
  writeOctal(block, 116, 8, 0); // gid
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, mtime);
  writeString(block, 156, 1, typeflag);
  writeString(block, 257, 6, "ustar");
  writeString(block, 263, 2, "00");
  writeString(block, 345, PREFIX_MAX, split.prefix);
  // 校驗和：先把 chksum 欄位當成 8 個空格再加總（tar 規範）。
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of block) sum += b;
  const s = sum.toString(8).padStart(6, "0");
  block.set(enc.encode(s), 148);
  block[154] = 0;
  block[155] = 0x20;
  return block;
}

/** 內容後的補零塊（把內容補滿 512 的倍數）；已對齊則回 undefined。 */
function padding(size: number): Uint8Array | undefined {
  const rem = size % BLOCK;
  return rem === 0 ? undefined : new Uint8Array(BLOCK - rem);
}

/**
 * 預先算出 {@link writeTar} 會產生的**確切**位元組數。
 *
 * 這不是最佳化，是必要條件：傳輸協定的 `file-begin` 要先宣告 `size`，算錯一個位元組
 * 收端就會永遠等不到最後一塊（或判定超量而中止）。所以本函式與 `writeTar` 的分支
 * （ustar／longname）必須**完全同步**。
 */
export function tarSize(entries: readonly Pick<ArchiveEntry, "path" | "size">[]): number {
  let total = 0;
  for (const e of entries) {
    if (!splitUstarPath(e.path)) {
      // GNU longname：一個標頭 + 路徑內容（含結尾 NUL，補到 512 倍數）
      total += BLOCK + pad512(enc.encode(e.path).length + 1);
    }
    total += BLOCK + pad512(e.size);
  }
  return total + BLOCK * 2; // 結尾兩個零塊
}

// ── 版面配置（隨機存取的基礎）────────────────────────────────────────────────

/** 合集裡的一段連續位元組：要嘛是算得出來的標頭／補零，要嘛是某個項目的內容。 */
interface Segment {
  /** 在合集中的起始位移。 */
  at: number;
  length: number;
  /** 記憶體片段（標頭、longname 內容、補零）；有值就直接切它。 */
  inline?: Uint8Array;
  /** 內容片段：從這個項目的第 `innerAt` 個位元組讀起。 */
  entry?: ArchiveEntry;
  innerAt?: number;
}

/**
 * 算出整個合集的版面。
 *
 * 這是「隨機存取」與「大小可預先宣告」共同的基礎：tar 的每一段位置都只取決於
 * 路徑與大小，不取決於內容，所以不產生任何位元組就能把版面排完。
 */
function layout(entries: readonly ArchiveEntry[]): { segments: Segment[]; total: number } {
  const segments: Segment[] = [];
  let at = 0;
  const push = (seg: Omit<Segment, "at">): void => {
    segments.push({ at, ...seg });
    at += seg.length;
  };
  for (const e of entries) {
    const mtime = e.mtime ?? 0;
    const mode = e.mode ?? 0o644;
    if (!splitUstarPath(e.path)) {
      // 路徑塞不進 ustar 欄位 → 先發一個 GNU longname 項目載真實路徑。
      const raw = enc.encode(`${e.path}\0`);
      push({ length: BLOCK, inline: header(e.path, raw.length, mtime, TYPE_LONGNAME) });
      push({ length: raw.length, inline: raw });
      const pad = pad512(raw.length) - raw.length;
      if (pad > 0) push({ length: pad, inline: new Uint8Array(pad) });
    }
    push({ length: BLOCK, inline: header(e.path, e.size, mtime, "0", mode) });
    if (e.size > 0) push({ length: e.size, entry: e, innerAt: 0 });
    const pad = pad512(e.size) - e.size;
    if (pad > 0) push({ length: pad, inline: new Uint8Array(pad) });
  }
  push({ length: BLOCK * 2, inline: new Uint8Array(BLOCK * 2) }); // 結尾零塊
  return { segments, total: at };
}

/**
 * 把一組項目做成可定位的合集（`OutgoingFileStream` 的形狀，見 `datachannel.ts`）。
 *
 * 傳輸層只要 `slice(offset, length)`，所以這裡不預先產生任何位元組——版面算得出每個
 * 位移落在哪一段，要哪一段才去讀哪一段。因此：整個合集從不進記憶體，斷點續傳也天然成立。
 */
export function tarStream(
  entries: readonly ArchiveEntry[],
  name: string,
  mime = "application/x-tar",
): { name: string; mime: string; size: number; slice(offset: number, length: number): Promise<Uint8Array> } {
  const { segments, total } = layout(entries);
  return {
    name,
    mime,
    size: total,
    async slice(offset: number, length: number): Promise<Uint8Array> {
      const want = Math.max(0, Math.min(length, total - offset));
      const out = new Uint8Array(want);
      let filled = 0;
      // 線性掃描找起點；傳輸是循序的，段數又遠小於位元組數，這不是瓶頸。
      let i = segments.findIndex((sg) => offset < sg.at + sg.length);
      if (i < 0) return out.subarray(0, 0);
      let cursor = offset;
      while (filled < want && i < segments.length) {
        const sg = segments[i]!;
        const within = cursor - sg.at;
        const take = Math.min(sg.length - within, want - filled);
        if (sg.inline) {
          out.set(sg.inline.subarray(within, within + take), filled);
        } else {
          const piece = await sg.entry!.read((sg.innerAt ?? 0) + within, take);
          // 來源短讀（檔案在傳輸中被縮短）→ 就地停住，讓上層的大小檢查爆出來。
          if (piece.length === 0) break;
          out.set(piece.subarray(0, take), filled);
        }
        filled += take;
        cursor += take;
        i += 1;
      }
      return filled === want ? out : out.subarray(0, filled);
    },
  };
}

/** 把項目串流寫成 tar（ustar 格式，不壓縮）。以版面為準，故與 {@link tarStream} 位元組相同。 */
export async function* writeTar(
  entries: Iterable<ArchiveEntry>,
  sliceBytes = 64 * 1024,
): AsyncGenerator<Uint8Array> {
  const list = [...entries];
  const stream = tarStream(list, "bundle.tar");
  for (let off = 0; off < stream.size; off += sliceBytes) {
    const want = Math.min(sliceBytes, stream.size - off);
    const piece = await stream.slice(off, want);
    // 短讀＝某個項目吐不出宣告的位元組（打包中途被刪／權限沒了）。寫出一個內容對不上
    // 標頭的 tar 比當場失敗糟糕得多——收端會拿到一個解不開、卻看起來「完整」的檔案。
    if (piece.length !== want) throw new Error(`合集項目內容短少（位移 ${off}），無法產生完整的 tar`);
    yield piece;
  }
}

/** 讀出的合集項目；`body` 逐段吐出內容（必須讀完才能拿下一個項目）。 */
export interface ReadArchiveEntry {
  path: string;
  size: number;
  mtime: number;
  /** POSIX 權限位元（解包端據此還原）。 */
  mode: number;
  body: AsyncIterable<Uint8Array>;
}

function readString(block: Uint8Array, offset: number, len: number): string {
  const slice = block.subarray(offset, offset + len);
  const end = slice.indexOf(0);
  return dec.decode(end === -1 ? slice : slice.subarray(0, end));
}

function readOctal(block: Uint8Array, offset: number, len: number): number {
  const s = readString(block, offset, len).trim();
  const n = Number.parseInt(s, 8);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 串流解析 tar。輸入切片**不必對齊 512**（網路與磁碟給什麼長度都可能），
 * 故內部自行緩衝到湊滿一個區塊為止。
 */
export async function* readTar(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<ReadArchiveEntry> {
  const it = chunks[Symbol.asyncIterator]();
  let buf = new Uint8Array(0);
  let done = false;

  const pull = async (): Promise<boolean> => {
    if (done) return false;
    const r = await it.next();
    if (r.done) {
      done = true;
      return false;
    }
    const merged = new Uint8Array(buf.length + r.value.length);
    merged.set(buf);
    merged.set(r.value, buf.length);
    buf = merged;
    return true;
  };
  /** 取出前 n 個位元組（不足就繼續拉）；來源耗盡回 null。 */
  const take = async (n: number): Promise<Uint8Array | null> => {
    while (buf.length < n) {
      if (!(await pull())) return null;
    }
    const out = buf.subarray(0, n);
    buf = buf.subarray(n);
    return out;
  };

  let longName: string | undefined;
  for (;;) {
    const head = await take(BLOCK);
    if (!head) return;
    if (head.every((b) => b === 0)) return; // 結尾零塊
    const typeflag = readString(head, 156, 1) || "0";
    const size = readOctal(head, 124, 12);
    const mtime = readOctal(head, 136, 12);
    const mode = readOctal(head, 100, 8);

    if (typeflag === TYPE_LONGNAME) {
      const raw = await take(pad512(size));
      if (!raw) return;
      longName = dec.decode(raw.subarray(0, size)).replace(/\0+$/, "");
      continue;
    }

    const prefix = readString(head, 345, PREFIX_MAX);
    const name = readString(head, 0, NAME_MAX);
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = undefined;

    // 內容必須在產出下一個項目前被讀完；未讀完的由這裡補讀掉，避免解析錯位。
    let remaining = size;
    let consumed = false;
    const body = (async function* () {
      consumed = true;
      while (remaining > 0) {
        const want = Math.min(remaining, Math.max(buf.length, 1));
        const part = await take(want);
        if (!part) return;
        remaining -= part.length;
        yield part;
      }
    })();
    yield { path, size, mtime, mode, body };
    if (!consumed) {
      // 呼叫端沒讀 body → 直接跳過內容區。
      const skip = await take(remaining);
      if (!skip) return;
      remaining = 0;
    } else if (remaining > 0) {
      const skip = await take(remaining);
      if (!skip) return;
      remaining = 0;
    }
    const padLen = pad512(size) - size;
    if (padLen > 0 && !(await take(padLen))) return;
  }
}

// ── 解包安全（zip-slip 防禦） ────────────────────────────────────────────────

const WINDOWS_ILLEGAL = new Set(["<", ">", ":", '"', "|", "?", "*"]);

/** 單一路徑片段的消毒——刻意對齊 Rust 端 `sanitize_filename`（ADR-0119）：非法字元移除。 */
function sanitizeSegment(seg: string): string {
  let out = "";
  for (const ch of seg) {
    const code = ch.codePointAt(0) ?? 0;
    // 控制字元（含 NUL）與 Windows 非法字元一律剔除，不是換成別的字元。
    if (code < 0x20 || code === 0x7f || WINDOWS_ILLEGAL.has(ch)) continue;
    out += ch;
  }
  out = out.trim().replace(/^\.+/, "").trim();
  const stem = (out.split(".")[0] ?? "").toUpperCase();
  const reserved =
    stem === "CON" ||
    stem === "PRN" ||
    stem === "AUX" ||
    stem === "NUL" ||
    ((stem.startsWith("COM") || stem.startsWith("LPT")) && stem.length === 4 && /[1-9]/.test(stem[3] ?? ""));
  if (reserved) out = `_${out}`;
  return [...out].slice(0, 255).join("");
}

/**
 * 把合集裡的路徑轉成**保證落在目標目錄之下**的相對路徑；任何可疑形狀回 `null`（整項跳過）。
 *
 * 🔴 這是解包的唯一防線。tar 的路徑完全由送出端決定，而送出端是**別人的電腦**：
 * `../../.ssh/authorized_keys` 這種項目只要照著寫，就等於讓對方覆寫你家目錄的檔案
 * （zip-slip）。ADR-0119 的 `sanitize_filename` 只管單一檔名，擋不住多層路徑，故有本函式。
 */
export function safeArchivePath(raw: string): string | null {
  if (!raw) return null;
  // Windows 磁碟機代號與 UNC 路徑（`\\server\share`）＝絕對路徑，直接拒。
  if (/^[a-zA-Z]:[/\\]/.test(raw) || raw.startsWith("\\\\")) return null;
  const unified = raw.replace(/\\/g, "/");
  if (unified.startsWith("/")) return null; // POSIX 絕對路徑
  const out: string[] = [];
  for (const seg of unified.split("/")) {
    if (seg === "" || seg === ".") continue; // 尾端斜線與 `./` 只是雜訊
    if (seg === "..") return null; // 🔴 穿越：不試圖「修正」，直接整項拒絕
    const clean = sanitizeSegment(seg);
    if (!clean) return null; // 消毒後變空（例如整段都是控制字元）＝來路不明
    out.push(clean);
  }
  return out.length > 0 ? out.join("/") : null;
}

// ── 折疊規則與命名 ──────────────────────────────────────────────────────────

/**
 * 多少個檔案以上就折疊成合集（ADR-0355 §3 修訂）。
 *
 * 門檻的意義：**少量檔案要維持聊天體驗**（收到三張相片就該是三張可預覽的相片，不是一個
 * 壓縮包）；多到一定程度時，逐檔的固定成本才是主要痛點，折疊才划算。
 */
export const ARCHIVE_FILE_THRESHOLD = 8;

/** 這批拖放要不要折疊成單一合集。 */
export function shouldArchive(input: { fileCount: number; hasDirectory: boolean }): boolean {
  return input.hasDirectory || input.fileCount > ARCHIVE_FILE_THRESHOLD;
}

/**
 * 會被 ADR-0273 清除中繼資料的圖片副檔名。
 *
 * 對齊 `isSanitizable`（`image/*` 但排除 SVG 與 GIF）：GIF 排除是因為 canvas 重編碼會把
 * 動畫壓成單張（ADR-0222 要留動畫），SVG 排除是因為它是可執行標記。這裡寧可**多列**幾種——
 * 少警告一次的代價是使用者不知情地送出帶 GPS 的相片。
 */
const SANITIZABLE_IMAGE_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "heif",
  "avif",
]);

/**
 * 這批檔名裡有沒有「單獨傳送時會被清除 EXIF／GPS」的圖片。
 *
 * 🔴 為什麼需要它：ADR-0273 的清理是 canvas 重編碼，需要整張圖在記憶體裡，與串流打包互斥；
 * 而合集內的檔案是**原封不動**傳送的。所以同一個動作（拖一批相片）在折疊成合集之後
 * **不再清除位置資訊**——這是使用者看不見的隱私變化，必須先問過他，不能默默改掉。
 */
export function bundleHasSanitizableImage(names: readonly string[]): boolean {
  return names.some((n) => SANITIZABLE_IMAGE_EXT.has(n.split(".").pop()?.toLowerCase() ?? ""));
}

/** 合集檔名：`cinder-bundle-YYYYMMDD-HHMMSS.tar`（本地時間，供人辨識）。 */
export function archiveBaseName(at: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  const d = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}`;
  const t = `${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `cinder-bundle-${d}-${t}.tar`;
}

// ── 只讀標頭的內容列表（ADR-0355 後續）─────────────────────────────────────────

/** 列表結果中的一個項目（不含內容）。 */
export interface TarListEntry {
  path: string;
  size: number;
  /**
   * 這個項目的**內容**在合集中的起始位移。
   *
   * 有了它，解包就不必把位元組搬過任何一層：宿主可以直接「從合集的第 `at` 個位元組
   * 複製 `size` 個位元組到目的檔」。桌面版就是這樣做的——內容完全不經過 IPC。
   */
  at: number;
  /** 修改時間（Unix 秒）；0＝來源沒帶。 */
  mtime: number;
  /** POSIX 權限位元。 */
  mode: number;
}

/** 隨機讀取器：回傳 `[offset, offset+len)` 的位元組（可能較短，代表讀到檔尾）。 */
export type RangeReader = (offset: number, len: number) => Promise<Uint8Array>;

/**
 * 列出合集裡有哪些檔案，**不解開、不讀內容**。
 *
 * ## 為什麼值得一個獨立的函式
 *
 * 收件人在解開之前完全看不出裡面有什麼——聊天視窗只顯示一個檔名與總大小，不知道是三個檔
 * 還是三千個，也不知道是不是自己要的東西。收到一個 500 MB 的合集，唯一的選擇是先解開再說。
 *
 * tar 的結構讓這件事很便宜：每個項目是「512 標頭 ＋ 內容（補到 512 倍數）」，所以讀完一個
 * 標頭就能**跳過**整段內容直接到下一個標頭。列出 1,000 個檔只需要讀 1,000 個 512 位元組的
 * 區塊——與合集本身多大無關，而且全在本機，不連網。
 */
export async function listTar(read: RangeReader, total: number, limit = 10_000): Promise<TarListEntry[]> {
  const out: TarListEntry[] = [];
  let offset = 0;
  let longName: string | undefined;

  while (offset + BLOCK <= total && out.length < limit) {
    const head = await read(offset, BLOCK);
    if (head.length < BLOCK) break; // 檔案被截斷
    if (head.every((b) => b === 0)) break; // 結尾零塊
    offset += BLOCK;

    const typeflag = readString(head, 156, 1) || "0";
    const size = readOctal(head, 124, 12);

    if (typeflag === TYPE_LONGNAME) {
      // 這一項的「內容」就是下一項的真實路徑——它很短，是唯一需要讀內容的情形。
      const raw = await read(offset, size);
      longName = dec.decode(raw).replace(/\0+$/, "");
      offset += pad512(size);
      continue;
    }

    const prefix = readString(head, 345, PREFIX_MAX);
    const name = readString(head, 0, NAME_MAX);
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = undefined;

    // 目錄項（typeflag "5"）與其他擴充項不列進來——使用者要看的是檔案。
    if (typeflag === "0" || typeflag === "\0") {
      out.push({ path, size, at: offset, mtime: readOctal(head, 136, 12), mode: readOctal(head, 100, 8) });
    }
    offset += pad512(size); // 🔴 跳過內容：這就是「便宜」的來源
  }
  return out;
}

// ── 解開合集（ADR-0355）────────────────────────────────────────────────────────

/** 解包的落地端（桌面走 Tauri 寫檔，瀏覽器走 File System Access API）。 */
export interface ExtractTarget {
  /** 寫入 `rel` 的 `[offset, offset+bytes.length)`。 */
  write(rel: string, offset: number, bytes: Uint8Array): Promise<void>;
  /** 一個檔案寫完了：還原修改時間與權限（做不到就忽略）。 */
  finalize(rel: string, meta: { mtime: number; mode: number }): Promise<void>;
}

/** 解包結果。`skipped` 是**被守衛擋下**的項目路徑（原樣回報，供 UI 說明）。 */
export interface ExtractResult {
  files: number;
  bytes: number;
  skipped: string[];
}

/**
 * 把合集解開到 `target`。
 *
 * ## 為什麼解析在這裡而不是各平台各寫一份
 *
 * tar 的解析是純位元組運算，桌面與瀏覽器沒有任何差別；會差的只有「寫到哪裡」。把解析
 * 留在 core 表示 zip-slip 守衛（{@link safeArchivePath}）**只有一份**，不會出現「桌面補了
 * 瀏覽器忘了」的情形。
 *
 * ## 守衛
 *
 * 合集是**對方給的**，路徑可以是 `../../.ssh/authorized_keys`。每個項目都先過
 * {@link safeArchivePath}；擋下來的**跳過而不是中止**——一個惡意項目不該讓另外九十九個
 * 正常檔案也解不出來，但使用者要知道有東西被跳過了（見 `skipped`）。
 *
 * 落地端**仍然要自己再驗一次**（桌面的 `filestream::safe_join`）：這一層在 webview 裡，
 * 任何 XSS 都能繞過它直接呼叫寫入 command。
 */
export async function extractTar(
  read: RangeReader,
  total: number,
  target: ExtractTarget,
  opts: { onProgress?: (done: number, total: number) => void; sliceBytes?: number } = {},
): Promise<ExtractResult> {
  const sliceBytes = opts.sliceBytes ?? 256 * 1024;
  const source = async function* (): AsyncGenerator<Uint8Array> {
    for (let off = 0; off < total; off += sliceBytes) {
      const piece = await read(off, Math.min(sliceBytes, total - off));
      if (piece.length === 0) return; // 來源被截斷：就此停住，已解出的仍然有效
      yield piece;
    }
  };

  const out: ExtractResult = { files: 0, bytes: 0, skipped: [] };
  for await (const entry of readTar(source())) {
    const safe = safeArchivePath(entry.path);
    let offset = 0;
    for await (const chunk of entry.body) {
      // 即使要跳過也**必須讀完** body——readTar 是串流的，沒讀完就拿不到下一個項目。
      if (safe !== null) {
        await target.write(safe, offset, chunk);
        out.bytes += chunk.length;
      }
      offset += chunk.length;
    }
    if (safe === null) {
      out.skipped.push(entry.path);
      continue;
    }
    await target.finalize(safe, { mtime: entry.mtime, mode: entry.mode });
    out.files += 1;
    opts.onProgress?.(out.bytes, total);
  }
  return out;
}
