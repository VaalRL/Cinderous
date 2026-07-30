// 裝置本地欄位不得跨裝置同步（ADR-0071 雲端快照／ADR-0118 配對搬家）。
//
// 起因：P1（ADR-0294 §1.2）為了修「重開 App 重收檔案」而新增了 `StoredFileMeta.received`
// ——那是**「這台裝置已把位元組交付給 App」**的意思。但兩條跨裝置同步路徑都是把
// `StoredMessage` 原封帶走，於是這個記號會跟著到另一台，
// **讓那台以為收過而永遠跳過交付**。
//
// 這與 P1 修錯的第一版是同一個形狀（見 relay-backend 的 `onFileBytes` 註解）：
// 記號的語意是「**這台**收到了」，任何把它複製給別台的路徑都會造成永久不交付。
//
// `savedPath` 同理（另一台上那個路徑不存在）——`StoredFileMeta` 的註解本來就寫著
// 「裝置本地語意，不跨裝置同步」，但過去兩條路徑都沒有真的執行它。
import { describe, expect, it } from "vitest";
import { buildSnapshotContent } from "./cloud-snapshot.js";
import { MemoryStorage } from "./memory.js";
import { exportFullSnapshot } from "./pair-bundle.js";
import { stripDeviceLocalFile, type StoredMessage } from "./types.js";

const fileMsg = (over: Partial<StoredMessage> = {}): StoredMessage => ({
  id: "bf-tid-1",
  contact: "bob",
  outgoing: false,
  text: "",
  at: 1,
  file: {
    tid: "tid-1",
    name: "報表.pdf",
    size: 100,
    mime: "application/pdf",
    received: true, // 這台已交付
    savedPath: "/Users/me/Downloads/報表.pdf", // 這台的路徑
    thumb: "data:image/jpeg;base64,AAAA", // 可跨裝置沿用的衍生預覽
  },
  ...over,
});

/** 一份含檔案訊息的儲存。 */
function storeWithFile(): MemoryStorage {
  const s = new MemoryStorage();
  s.addContact({ pubkey: "bob", name: "Bob" });
  s.appendMessage(fileMsg());
  return s;
}

describe("stripDeviceLocalFile", () => {
  it("剝掉 `received` 與 `savedPath`，保留其餘", () => {
    const out = stripDeviceLocalFile(fileMsg());
    expect(out.file?.received).toBeUndefined();
    expect(out.file?.savedPath).toBeUndefined();
    expect(out.file?.tid).toBe("tid-1");
    expect(out.file?.name).toBe("報表.pdf");
  });

  it("`thumb` **不剝**——衍生預覽可跨裝置沿用（ADR-0102）", () => {
    expect(stripDeviceLocalFile(fileMsg()).file?.thumb).toBeDefined();
  });

  it("沒有 file 的訊息原樣回傳（不無謂複製）", () => {
    const plain: StoredMessage = { id: "m1", contact: "bob", outgoing: false, text: "嗨", at: 1 };
    expect(stripDeviceLocalFile(plain)).toBe(plain);
  });
});

describe("🔴 雲端快照（ADR-0071 完整模式）不得帶出裝置本地欄位", () => {
  it("`received` 不進快照——帶過去會讓另一台**永遠收不到**那個檔案", () => {
    const content = buildSnapshotContent(storeWithFile(), "full");
    const m = content.messages?.find((x) => x.id === "bf-tid-1");
    expect(m).toBeDefined();
    expect(m?.file?.received).toBeUndefined();
  });

  it("`savedPath` 不進快照——另一台上那個路徑不存在", () => {
    const content = buildSnapshotContent(storeWithFile(), "full");
    expect(content.messages?.[0]?.file?.savedPath).toBeUndefined();
  });

  it("本機那份**不受影響**（剝除只發生在送出的副本上）", () => {
    const store = storeWithFile();
    buildSnapshotContent(store, "full");
    expect(store.loadMessages("bob")[0]?.file?.received).toBe(true);
  });
});

describe("🔴 配對搬家（ADR-0118）不得帶出裝置本地欄位", () => {
  it("`received`／`savedPath` 都不進捆包", () => {
    const snap = exportFullSnapshot(storeWithFile(), { nsec: "nsec1x", name: "我" });
    const m = snap.messages["bob"]?.[0];
    expect(m).toBeDefined();
    expect(m?.file?.received).toBeUndefined();
    expect(m?.file?.savedPath).toBeUndefined();
  });
});
