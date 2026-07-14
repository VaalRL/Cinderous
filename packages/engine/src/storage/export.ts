// 明文紀錄導出（ADR-0094）：把本地對話序列化成人類可讀／可重匯入的檔案。
//
// 隱私邊界：這是唯一「刻意」把解密後明文寫出加密邊界之處——僅供**使用者主動、本機**導出（UI 負責警告）。
// 本模組是純函式（不碰檔案系統/網路），輸出字串交由各平台寫檔（Tauri save_file／瀏覽器下載）。
//
// 內容（依 ADR-0094 裁示）：文字訊息＋檔案 metadata（檔名/大小/路徑，無位元組）＋emoji 回應（NIP-25）；
// 已收回訊息標「（已收回）」。**不含私鑰、不含檔案本體。**

import { loadAllArchived } from "./archive.js";
import type { AppStorage, StoredMessage } from "./types.js";

export type ExportFormat = "txt" | "md" | "json";

export interface ExportOptions {
  /** 要匯出的對話鍵（聯絡人 pubkey 或群組 id）；省略／空＝全部（所有聯絡人＋群組）。 */
  keys?: string[];
  /** 含檔案 metadata 行（預設 true）。 */
  includeFiles?: boolean;
  /** 含 emoji 回應（預設 true）。 */
  includeReactions?: boolean;
  /** 匯出時間（毫秒）；供 JSON 標頭。呼叫端提供以利決定性。 */
  now?: number;
  /** 自己送出訊息的顯示標籤（預設「我」）。 */
  selfLabel?: string;
}

interface ExportConvo {
  kind: "contact" | "group";
  id: string;
  name: string;
  messages: StoredMessage[];
}

const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 12)}…` : id);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** 決定性時間字串（本地時區）：`YYYY-MM-DD HH:MM:SS`。 */
function fmtTime(atMs: number): string {
  const d = new Date(atMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 收集要導出的對話（含名稱解析、跳過空對話）。
 *
 * **必須併入封存**（ADR-0111）：匯出只讀熱區的話，會**靜默漏掉**所有被封存的舊訊息
 * ——那正是使用者最想留下來的部分。這是正確性紅線，不是最佳化。
 */
async function gather(storage: AppStorage, opts: ExportOptions): Promise<ExportConvo[]> {
  const contacts = storage.loadContacts();
  const groups = storage.loadGroups();
  const nameOf = new Map<string, string>();
  for (const c of contacts) nameOf.set(c.pubkey, c.name);
  for (const g of groups) nameOf.set(g.id, g.name);
  const groupIds = new Set(groups.map((g) => g.id));
  const keys = opts.keys && opts.keys.length > 0 ? opts.keys : [...contacts.map((c) => c.pubkey), ...groups.map((g) => g.id)];
  const archive = storage.archiveOf?.();
  const convos: ExportConvo[] = [];
  for (const key of keys) {
    const archived = archive ? await loadAllArchived(archive, key) : [];
    const hot = storage.loadMessages(key);
    // 封存在前（較舊）、熱區在後。以 id 去重——「先寫封存、後裁切熱區」的當機窗口
    // 可能讓同一則同時存在於兩邊（刻意：寧可重複，絕不遺失）。
    const seen = new Set<string>();
    const messages: StoredMessage[] = [];
    for (const m of [...archived, ...hot]) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      messages.push(m);
    }
    if (messages.length === 0) continue;
    convos.push({ kind: groupIds.has(key) ? "group" : "contact", id: key, name: nameOf.get(key) ?? shortId(key), messages });
  }
  return convos;
}

/** 某訊息的顯示對象名（outgoing＝自己；群訊用 sender；1:1 用對話名）。 */
function whoOf(m: StoredMessage, convo: ExportConvo, selfLabel: string, nameOf: Map<string, string>): string {
  if (m.outgoing) return selfLabel;
  if (convo.kind === "group" && m.sender) return nameOf.get(m.sender) ?? shortId(m.sender);
  return convo.name;
}

/** 某訊息的正文（已收回／檔案 metadata／文字），可含回應。 */
function bodyOf(m: StoredMessage, opts: ExportOptions, deleted: Set<string>, reactions: Map<string, string[]>): string {
  let body: string;
  if (deleted.has(m.id)) {
    body = "（已收回）";
  } else if (m.file && opts.includeFiles !== false) {
    const path = m.file.savedPath ? ` → ${m.file.savedPath}` : "";
    body = `📄 ${m.file.name}（${formatBytes(m.file.size)}）${path}`;
  } else if (m.file) {
    body = "📄 （檔案）";
  } else {
    body = m.text;
  }
  if (opts.includeReactions !== false) {
    const rs = reactions.get(m.id);
    if (rs && rs.length > 0) body += `  ${rs.join("")}`;
  }
  return body;
}

/** 匯出為指定格式的單一字串（含所選全部對話）。 */
export async function exportRecords(
  storage: AppStorage,
  format: ExportFormat,
  opts: ExportOptions = {},
): Promise<string> {
  const selfLabel = opts.selfLabel ?? "我";
  const now = opts.now ?? Date.now();
  const convos = await gather(storage, opts);
  const nameOf = new Map<string, string>();
  for (const c of storage.loadContacts()) nameOf.set(c.pubkey, c.name);
  const deleted = new Set(storage.loadDeleted());
  const reactions = new Map<string, string[]>();
  for (const r of storage.loadReactions()) {
    const list = reactions.get(r.messageId) ?? [];
    list.push(r.emoji);
    reactions.set(r.messageId, list);
  }

  if (format === "json") {
    return JSON.stringify(
      {
        app: "Cinder",
        exportedAt: now,
        conversations: convos.map((c) => ({
          kind: c.kind,
          id: c.id,
          name: c.name,
          messages: c.messages.map((m) => ({
            id: m.id,
            at: m.at,
            outgoing: m.outgoing,
            ...(m.sender ? { sender: m.sender } : {}),
            ...(deleted.has(m.id) ? { deleted: true } : {}),
            ...(m.file && opts.includeFiles !== false
              ? { file: { name: m.file.name, size: m.file.size, mime: m.file.mime, ...(m.file.savedPath ? { savedPath: m.file.savedPath } : {}) } }
              : {}),
            ...(!m.file ? { text: m.text } : {}),
            ...(opts.includeReactions !== false && reactions.get(m.id)?.length ? { reactions: reactions.get(m.id) } : {}),
          })),
        })),
      },
      null,
      2,
    );
  }

  const lines: string[] = [];
  const header = format === "md" ? `# Cinder 對話紀錄導出\n\n_導出時間：${fmtTime(now)}_` : `Cinder 對話紀錄導出（${fmtTime(now)}）`;
  lines.push(header);
  for (const convo of convos) {
    if (format === "md") {
      lines.push(`\n## ${convo.kind === "group" ? "群組" : "對話"}：${convo.name}\n\n\`${convo.id}\`\n`);
    } else {
      lines.push(`\n=== ${convo.kind === "group" ? "群組" : "對話"}：${convo.name}（${convo.id}）===`);
    }
    for (const m of convo.messages) {
      const who = whoOf(m, convo, selfLabel, nameOf);
      const body = bodyOf(m, opts, deleted, reactions);
      if (format === "md") lines.push(`- **[${fmtTime(m.at)}] ${who}：** ${body}`);
      else lines.push(`[${fmtTime(m.at)}] ${who}：${body}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** 導出檔案的建議副檔名。 */
export function exportExtension(format: ExportFormat): string {
  return format;
}

/** 導出檔案的建議 MIME。 */
export function exportMime(format: ExportFormat): string {
  return format === "json" ? "application/json" : format === "md" ? "text/markdown" : "text/plain";
}
