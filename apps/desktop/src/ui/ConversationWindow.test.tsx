import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import type { ChatMessage, Contact, MessageStatus, Self } from "@cinder/engine";
import { ConversationWindow } from "./ConversationWindow.js";
import { CHIME_PRESETS } from "./ringtone.js";

const self: Self = { pubkey: "aa", name: "我", status: "online", statusMessage: "" };
const contact: Contact = { pubkey: "bb", name: "Bob", status: "online", statusMessage: "", nowPlaying: "" };

const mkMessages = (n: number): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, outgoing: i % 2 === 0, text: `msg-${i}`, at: i }));

const render = (messages: ChatMessage[]) =>
  renderToStaticMarkup(
    <I18nProvider locale="en">
      <ThemeProvider>
        <ConversationWindow
          self={self}
          contact={contact}
          messages={messages}
          typing={false}
          nudgeSignal={0}
          onSend={() => {}}
          onTyping={() => {}}
          onNudge={() => {}}
          onClose={() => {}}
        />
      </ThemeProvider>
    </I18nProvider>,
  );

describe("ConversationWindow 訊息列視窗化（P0-3）", () => {
  it("訊息數 ≤ 視窗時全部渲染、無『載入較早』", () => {
    const html = render(mkMessages(10));
    expect(html).not.toContain('data-testid="load-earlier"');
    expect(html).toContain("msg-0");
    expect(html).toContain("msg-9");
  });

  it("超過視窗時只渲染最近 200 則、顯示『載入較早』", () => {
    const html = render(mkMessages(250));
    expect(html).toContain('data-testid="load-earlier"');
    // 最舊 50 則（0..49）被視窗化隱藏、最近的（50..249）渲染
    expect(html).not.toContain("msg-0");
    expect(html).not.toContain("msg-49");
    expect(html).toContain("msg-50");
    expect(html).toContain("msg-249");
  });

  it("對話串（ADR-0051）：回覆不入主頻道、根訊息顯示回覆數入口", () => {
    const html = render([
      { id: "root", outgoing: false, text: "主頻道根訊息", at: 1 },
      { id: "r1", outgoing: false, text: "串內回覆一", at: 2, replyTo: "root" },
      { id: "r2", outgoing: true, text: "串內回覆二", at: 3, replyTo: "root" },
    ]);
    expect(html).toContain("主頻道根訊息");
    // 回覆只在面板顯示，不灌進主頻道
    expect(html).not.toContain("串內回覆一");
    expect(html).not.toContain("串內回覆二");
    // 根訊息顯示回覆數入口（明確以 en 語系渲染，不依賴 OS 預設語系）
    expect(html).toContain('data-testid="thread-count"');
    expect(html).toContain("2 replies");
  });

  it("群組視窗提供成員清單時顯示 👥 成員管理入口（M9）", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ThemeProvider>
          <ConversationWindow
            self={self}
            contact={contact}
            messages={[]}
            typing={false}
            nudgeSignal={0}
            senderName={(pk) => pk}
            groupMembers={[
              { pubkey: "aa", name: "我" },
              { pubkey: "cc", name: "Carol" },
            ]}
            isGroupAdmin
            onSend={() => {}}
            onTyping={() => {}}
            onNudge={() => {}}
            onClose={() => {}}
          />
        </ThemeProvider>
      </I18nProvider>,
    );
    expect(html).toContain('data-testid="members-btn"');
  });

  it("@提及我的訊息以 mention class + 徽章凸顯（ADR-0050）", () => {
    const html = render([
      { id: "m1", outgoing: false, text: "一般訊息", at: 1 },
      { id: "m2", outgoing: false, text: "@我 看這個", at: 2, mentionsMe: true },
    ]);
    expect(html).toContain('class="line in mention"');
    expect(html).toContain('class="mention-badge"');
    // 未被提及的訊息不帶 mention class
    expect(html).toContain('class="line in"');
  });

  const renderCW = (over: Partial<Contact>, onSetAlias?: () => void) =>
    renderToStaticMarkup(
      <I18nProvider locale="en">
        <ThemeProvider>
          <ConversationWindow
            self={self}
            contact={{ ...contact, ...over }}
            messages={[]}
            typing={false}
            nudgeSignal={0}
            {...(onSetAlias ? { onSetAlias } : {})}
            onSend={() => {}}
            onTyping={() => {}}
            onNudge={() => {}}
            onClose={() => {}}
          />
        </ThemeProvider>
      </I18nProvider>,
    );

  it("本地暱稱（ADR-0148）：有暱稱→標頭顯示暱稱、名字可切換（toggle 類名）、有鉛筆入口", () => {
    const html = renderCW({ alias: "阿伯" }, () => {});
    expect(html).toContain('data-testid="convo-title-name"');
    expect(html).toContain("convo__name--toggle"); // 可點切換
    expect(html).toContain("阿伯"); // 顯示暱稱而非廣播名
    expect(html).toContain('data-testid="convo-alias-edit"'); // 鉛筆
  });

  it("本地暱稱：未設暱稱→標頭顯示廣播名、名字不可切換；仍可設定暱稱", () => {
    const html = renderCW({}, () => {});
    expect(html).toContain("Bob"); // 廣播名
    expect(html).not.toContain("convo__name--toggle"); // 無暱稱不提供切換
    expect(html).toContain('data-testid="convo-alias-edit"');
  });

  it("本地暱稱：未提供 onSetAlias（群組/示範）→ 無鉛筆入口", () => {
    const html = renderCW({ alias: "阿伯" });
    expect(html).not.toContain('data-testid="convo-alias-edit"');
  });

  const renderSound = (over: Partial<Contact>, onSetNotifySound?: () => void, initialSoundEditing?: boolean) =>
    renderToStaticMarkup(
      <I18nProvider locale="zh-Hant">
        <ThemeProvider>
          <ConversationWindow
            self={self}
            contact={{ ...contact, ...over }}
            messages={[]}
            typing={false}
            nudgeSignal={0}
            {...(onSetNotifySound ? { onSetNotifySound } : {})}
            {...(initialSoundEditing ? { initialSoundEditing } : {})}
            onSend={() => {}}
            onTyping={() => {}}
            onNudge={() => {}}
            onClose={() => {}}
          />
        </ThemeProvider>
      </I18nProvider>,
    );

  it("依聯絡人通知音效（ADR-0149）：提供 onSetNotifySound→標頭有 🔔 入口；未提供則無", () => {
    expect(renderSound({}, () => {})).toContain('data-testid="convo-sound-edit"');
    expect(renderSound({})).not.toContain('data-testid="convo-sound-edit"');
  });

  it("依聯絡人通知音效：展開選擇列→「跟隨全域」＋全部預設＋試聽鈕", () => {
    const html = renderSound({ notifySound: "bell" }, () => {}, true);
    expect(html).toContain('data-testid="convo-sound-select"');
    expect(html).toContain("跟隨全域預設"); // 清除選項（空值）
    for (const p of CHIME_PRESETS) expect(html).toContain(`value="${p.id}"`);
    expect(html).toContain('data-testid="convo-sound-preview"'); // 試聽
    // 未展開時不佔版面
    expect(renderSound({ notifySound: "bell" }, () => {})).not.toContain('data-testid="convo-sound-select"');
  });
});

describe("ConversationWindow 送出狀態圖示（ADR-0058／0095 眼睛語言）", () => {
  const out = (status: MessageStatus): ChatMessage => ({ id: "x", outgoing: true, text: "hi", at: 1, status });

  it("已讀＝張開眼（有瞳孔）＋ tick--read（主色）＋較粗線", () => {
    const html = render([out("read")]);
    expect(html).toContain("tick--read");
    expect(html).toContain("<circle"); // 瞳孔＝眼睛張開
    expect(html).toContain('stroke-width="1.9"'); // 「粗體」
  });

  it("已送達＝半開眼（有瞳孔、灰）；已送出＝閉眼（無瞳孔）", () => {
    const delivered = render([out("delivered")]);
    expect(delivered).toContain("tick--delivered");
    expect(delivered).toContain("<circle"); // 半開＝仍有瞳孔
    expect(delivered).not.toContain("tick--read");

    const sent = render([out("sent")]);
    expect(sent).toContain("tick--sent");
    expect(sent).not.toContain("<circle"); // 閉眼＝沒有瞳孔
  });

  it("傳送失敗＝紅色重試圖示（tick--failed）", () => {
    const html = render([out("failed")]);
    expect(html).toContain("tick--failed");
    expect(html).not.toContain("tick--read");
  });

  it("對方訊息（incoming）不顯示狀態圖示", () => {
    const html = render([{ id: "y", outgoing: false, text: "hi", at: 1, status: "read" }]);
    expect(html).not.toContain("tick--");
  });
});

describe("ConversationWindow 長訊息截斷 + 展開全文", () => {
  it("超長訊息在主頻道截斷（尾端被切）並顯示『展開全文』鈕", () => {
    const long = `${"A".repeat(600)}TAILWORD`;
    const html = render([{ id: "m1", outgoing: false, text: long, at: 1 }]);
    expect(html).toContain('data-testid="expand-msg"');
    expect(html).toContain("Show full message"); // en 語系
    expect(html).not.toContain("TAILWORD"); // 尾端被截掉
  });

  it("短訊息不截斷、無展開鈕", () => {
    const html = render([{ id: "m2", outgoing: false, text: "短訊息", at: 1 }]);
    expect(html).not.toContain('data-testid="expand-msg"');
    expect(html).toContain("短訊息");
  });
});

describe("圖片跨 session（ADR-0023／0102）", () => {
  const THUMB = "data:image/jpeg;base64,ZZZ";
  const imgMsg = (extra: { url?: string; thumb?: string } = {}): ChatMessage => ({
    id: "i1",
    outgoing: false,
    text: "",
    at: 1,
    file: { id: "t1", name: "cat.png", mime: "image/png", size: 900, sent: 900, incoming: true, ...extra },
  });

  it("重載後只剩縮圖（無 blob url）：仍渲染為圖片，不再退化成灰色檔案卡", () => {
    const html = render([imgMsg({ thumb: THUMB })]);
    expect(html).toContain('data-testid="imgthumb"'); // 圖片縮圖，而非 filecard
    expect(html).toContain(THUMB);
    expect(html).not.toContain('data-testid="filecard"');
  });

  it("本 session 有原圖時優先顯示原圖（縮圖只是備援）", () => {
    const html = render([imgMsg({ url: "blob:orig", thumb: THUMB })]);
    expect(html).toContain("blob:orig");
  });

  it("既無原圖也無縮圖（如非圖片/縮圖超限）→ 仍走一般檔案卡", () => {
    const html = render([imgMsg()]);
    expect(html).toContain('data-testid="filecard"');
    expect(html).not.toContain('data-testid="imgthumb"');
  });
});

describe("原生拖放命中測試（ADR-0104）", () => {
  it("對話視窗帶 data-convo=pubkey——原生拖放只給座標，靠它判斷掉在哪個對話", () => {
    const html = render([]);
    expect(html).toContain('data-convo="bb"');
  });
});

describe("私有標籤與企業頭銜（ADR-0158）", () => {
  const renderWith = (extra: Record<string, unknown>, c: Contact = contact) =>
    renderToStaticMarkup(
      <I18nProvider locale="zh-Hant">
        <ThemeProvider>
          <ConversationWindow
            self={self}
            contact={c}
            messages={[]}
            typing={false}
            nudgeSignal={0}
            onSend={() => {}}
            onTyping={() => {}}
            onNudge={() => {}}
            onClose={() => {}}
            {...extra}
          />
        </ThemeProvider>
      </I18nProvider>,
    );

  it("提供 labels＋onAddLabel → 對方頭像旁顯示標籤列（chips＋🏷 新增）", () => {
    const html = renderWith({ labels: ["家人", "同好"], onAddLabel: () => {}, onRemoveLabel: () => {} });
    expect(html).toContain('data-testid="convo-labels"');
    expect(html).toContain("家人");
    expect(html).toContain("同好");
    expect(html).toContain('data-testid="convo-label-add"');
  });

  it("聯絡人帶廣播頭銜 → chip--role 色彩區隔顯示；未提供標籤功能仍顯示頭銜", () => {
    const html = renderWith({}, { ...contact, title: "後端工程師" });
    expect(html).toContain('data-testid="convo-title-chip"');
    expect(html).toContain("chip--role");
    expect(html).toContain("後端工程師");
  });

  it("無標籤功能且無頭銜 → 不渲染標籤列", () => {
    const html = renderWith({});
    expect(html).not.toContain('data-testid="convo-labels"');
  });
});
