import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccentProvider } from "../accent.js";
import { I18nProvider } from "../i18n.js";
import { LayoutProvider } from "../layout.js";
import { ThemeProvider } from "../theme.js";
import { relayChangeReady, SettingsPanel, type SettingsPanelProps } from "./SettingsPanel.js";
import { CHIME_PRESETS } from "./ringtone.js";
import { TitlebarProvider } from "../titlebar.js";

describe("relayChangeReady（更換輸入驗證）", () => {
  it("ws(s):// 且與現值不同才可套用", () => {
    expect(relayChangeReady("wss://new.example", "wss://x")).toBe(true);
    expect(relayChangeReady("ws://localhost:8787", "wss://x")).toBe(true);
    expect(relayChangeReady("wss://x", "wss://x")).toBe(false); // 同值
    expect(relayChangeReady("https://x", "wss://x")).toBe(false); // 非 ws(s)
    expect(relayChangeReady("  ", "wss://x")).toBe(false); // 空
  });
});

function render(extra: Partial<SettingsPanelProps> = {}): string {
  return renderToStaticMarkup(
    <ThemeProvider>
      <AccentProvider>
        <LayoutProvider>
          <I18nProvider locale="zh-Hant">
            <SettingsPanel
              relayUrl="wss://x"
              notifications={false}
              onToggleNotifications={() => {}}
              onClose={() => {}}
              {...extra}
            />
          </I18nProvider>
        </LayoutProvider>
      </AccentProvider>
    </ThemeProvider>,
  );
}

describe("更改顯示名稱（ADR-0144）", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = { matchMedia: () => ({ matches: false }) };
    (globalThis as Record<string, unknown>).localStorage = { getItem: () => null };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it("提供 onRename → 身分分頁出現、且有改名欄（預填目前名稱、按鈕預設停用）", () => {
    const out = render({ initialTab: "identity", onRename: () => true, selfName: "夜" });
    expect(out).toContain('data-testid="settings-tab-identity"');
    expect(out).toContain('data-testid="rename-input"');
    expect(out).toContain('value="夜"'); // 預填目前名稱
    expect(out).toMatch(/data-testid="rename-apply"[^>]*disabled/); // 未改動 → 停用
  });

  it("未提供 onRename → 無改名欄", () => {
    expect(render({ initialTab: "identity", selfName: "夜" })).not.toContain('data-testid="rename-input"');
  });
});

describe("SettingsPanel 分頁（ADR-0142）", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = { matchMedia: () => ({ matches: false }) };
    (globalThis as Record<string, unknown>).localStorage = { getItem: () => null };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it("固定分頁（外觀/連線與備份/隱私與通知）恆在，預設外觀選中", () => {
    const out = render();
    expect(out).toContain('data-testid="settings-tab-appearance"');
    expect(out).toContain('data-testid="settings-tab-relay"');
    expect(out).toContain('data-testid="settings-tab-privacy"');
    expect(out).toMatch(/aria-selected="true"[^>]*data-testid="settings-tab-appearance"/);
  });

  it("身分分頁只在有內容時出現（selfNsec/security/配對）；進階同理（retention/export/ollama）", () => {
    expect(render()).not.toContain('data-testid="settings-tab-identity"');
    expect(render({ selfNsec: "nsec1x" })).toContain('data-testid="settings-tab-identity"');
    expect(render()).not.toContain('data-testid="settings-tab-advanced"');
    expect(render({ onExport: () => {} })).toContain('data-testid="settings-tab-advanced"');
  });

  it("預設外觀分頁只顯示外觀區塊，不顯示其他分頁的內容", () => {
    const out = render({ onRelayChange: () => {}, selfNsec: "nsec1x" });
    expect(out).toContain('data-testid="layout-classic"'); // 外觀在
    expect(out).not.toContain('data-testid="relay-change"'); // 連線分頁未啟用
    expect(out).not.toContain('data-testid="backup-code"'); // 身分分頁未啟用
  });
});

describe("SettingsPanel relay 區塊：更換中繼站（ADR-0066 H2）", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = {
      matchMedia: () => ({ matches: false }),
    };
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => null,
    };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it("提供 onRelayChange 時顯示「更換」鈕", () => {
    expect(render({ initialTab: "relay", onRelayChange: () => {} })).toContain('data-testid="relay-change"');
  });

  it("relayLocked（工作身分）：顯示鎖定說明、無更換鈕", () => {
    const out = render({ initialTab: "relay", relayLocked: true });
    expect(out).toContain('data-testid="relay-locked"');
    expect(out).not.toContain('data-testid="relay-change"');
  });

  it("皆未提供（示範模式）：無更換鈕也無鎖定說明", () => {
    const out = render({ initialTab: "relay" });
    expect(out).not.toContain('data-testid="relay-change"');
    expect(out).not.toContain('data-testid="relay-locked"');
  });

  // 排水完全隱藏（ADR-0082）：機制仍自動運作（drainUrl 由 App 於 createBackend 傳入），但不再有任何 UI。
});

describe("SettingsPanel 安全區塊：本地密碼（ADR-0067）", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = { matchMedia: () => ({ matches: false }) };
    (globalThis as Record<string, unknown>).localStorage = { getItem: () => null };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).localStorage;
  });
  const security = (enabled: boolean) => ({
    enabled,
    hidden: false,
    onEnable: async () => true,
    onChangePassword: async () => true,
    onDisable: async () => true,
    onToggleHidden: () => {},
  });

  it("未啟用：顯示啟用鈕；已啟用：顯示改密碼/停用/隱藏身分", () => {
    const off = render({ initialTab: "identity", security: security(false) });
    expect(off).toContain('data-testid="pass-enable"');
    expect(off).not.toContain('data-testid="pass-change"');
    const on = render({ initialTab: "identity", security: security(true) });
    expect(on).toContain('data-testid="pass-change"');
    expect(on).toContain('data-testid="pass-disable"');
    expect(on).toContain('data-testid="pass-hidden"');
    expect(on).not.toContain('data-testid="pass-enable"');
  });

  it("未提供 security（瀏覽器/示範模式）：無安全區塊", () => {
    expect(render({ initialTab: "identity" })).not.toContain('data-testid="security"');
  });
});

describe("雲端同步設定（ADR-0071）", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = { matchMedia: () => ({ matches: false }) };
    (globalThis as Record<string, unknown>).localStorage = { getItem: () => null };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it("三檔模式選項齊備；開啟時有「立即備份」、關閉時沒有；未提供則無區塊", () => {
    const on = render({ initialTab: "relay", cloud: { mode: "full", onChange: () => {}, onBackupNow: () => {} } });
    expect(on).toContain('data-testid="cloud-sync"');
    expect(on).toContain('data-testid="cloud-off"');
    expect(on).toContain('data-testid="cloud-basic"');
    expect(on).toContain('data-testid="cloud-full"');
    expect(on).toContain('data-testid="cloud-backup-now"');
    const off = render({ initialTab: "relay", cloud: { mode: "off", onChange: () => {} } });
    expect(off).not.toContain('data-testid="cloud-backup-now"');
    expect(render({ initialTab: "relay" })).not.toContain('data-testid="cloud-sync"');
  });
});

describe("版面佈局切換（ADR-0079）", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = { matchMedia: () => ({ matches: false }) };
    (globalThis as Record<string, unknown>).localStorage = { getItem: () => null };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it("渲染經典/三欄兩個佈局選項，預設經典為選中", () => {
    const out = render();
    expect(out).toContain('data-testid="layout-classic"');
    expect(out).toContain('data-testid="layout-modern"');
    expect(out).toMatch(/aria-checked="true"[^>]*data-testid="layout-classic"/); // 預設經典選中
  });
});

describe("主題色：主色＋副色（ADR-0078）", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = { matchMedia: () => ({ matches: false }) };
    (globalThis as Record<string, unknown>).localStorage = { getItem: () => null };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it("渲染主色與副色兩排取色器，副色列含「跟隨主色」", () => {
    const out = render();
    expect(out).toContain('data-testid="accent2-classic"'); // 副色預設色票
    expect(out).toContain("主色");
    expect(out).toContain("副色");
    expect(out).toContain("跟隨主色");
  });
});

describe("通知音效下拉（ADR-0149）", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = { matchMedia: () => ({ matches: false }) };
    (globalThis as Record<string, unknown>).localStorage = { getItem: () => null };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  const base: Partial<SettingsPanelProps> = {
    initialTab: "privacy",
    notifications: true,
    notifySound: true,
    onToggleNotifySound: () => {},
    notifyChime: "bell",
    onSelectNotifyChime: () => {},
  };

  it("提示音開啟→列出全部合成預設與試聽鈕（零音檔）", () => {
    const out = render(base);
    expect(out).toContain('data-testid="notify-chime-select"');
    for (const p of CHIME_PRESETS) expect(out).toContain(`value="${p.id}"`);
    expect(out).toContain("鐘聲"); // zh-Hant 預設名（bell）
    expect(out).toContain('data-testid="notify-chime-preview"'); // 試聽
  });

  it("提示音關閉或未接 onSelectNotifyChime→不顯示下拉", () => {
    expect(render({ ...base, notifySound: false })).not.toContain('data-testid="notify-chime-select"');
    const { onSelectNotifyChime: _drop, ...noSelect } = base;
    expect(render(noSelect)).not.toContain('data-testid="notify-chime-select"');
  });
});

describe("視窗外框設定（ADR-0150）", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = { matchMedia: () => ({ matches: false }) };
    (globalThis as Record<string, unknown>).localStorage = { getItem: () => null };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  const renderWithTitlebar = (extra: Partial<SettingsPanelProps> = {}): string =>
    renderToStaticMarkup(
      <ThemeProvider>
        <AccentProvider>
          <LayoutProvider>
            <TitlebarProvider>
              <I18nProvider locale="zh-Hant">
                <SettingsPanel relayUrl="wss://x" notifications={false} onToggleNotifications={() => {}} onClose={() => {}} {...extra} />
              </I18nProvider>
            </TitlebarProvider>
          </LayoutProvider>
        </AccentProvider>
      </ThemeProvider>,
    );

  it("showTitlebarSettings（Tauri）→ 拖曳編輯器：左右兩帶＋四顆可拖 piece＋隱藏勾選（ADR-0151/0152）", () => {
    const out = renderWithTitlebar({ showTitlebarSettings: true });
    // 放置帶以 data-drop-side 標記（pointer 拖曳的命中測試靠它，ADR-0152——
    // Tauri dragDropEnabled 會吞 HTML5 DnD，所以不用 draggable）。
    expect(out).toContain('data-drop-side="left"');
    expect(out).toContain('data-drop-side="right"');
    for (const id of ["settings", "min", "max", "close"]) {
      expect(out).toContain(`data-testid="titlebar-piece-${id}"`);
      expect(out).toContain(`data-piece="${id}"`);
    }
    expect(out).not.toContain('draggable="true"'); // HTML5 DnD 在 Tauri 失效，禁用
    expect(out).toContain('data-testid="titlebar-autohide"'); // 平時隱藏、滑鼠碰到才顯示
  });

  it("按鈕風格選擇（ADR-0167）：四種風格 chip＋預設 flat 為選中", () => {
    const out = renderWithTitlebar({ showTitlebarSettings: true });
    expect(out).toContain('data-testid="titlebar-styles"');
    for (const s of ["flat", "rounded", "mac", "compact"]) {
      expect(out).toContain(`data-testid="titlebar-style-${s}"`);
    }
    expect(out).toContain("交通燈"); // titlebarStyle_mac（zh-Hant）
  });

  it("未開 showTitlebarSettings（瀏覽器版）→ 整區不顯示", () => {
    const out = renderWithTitlebar();
    expect(out).not.toContain('data-testid="titlebar-zone-left"');
    expect(out).not.toContain('data-testid="titlebar-piece-min"');
  });
});

describe("加密備份碼入口（ADR-0070）", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = { matchMedia: () => ({ matches: false }) };
    (globalThis as Record<string, unknown>).localStorage = { getItem: () => null };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it("有 selfNsec 時顯示「產生加密備份碼」；無 selfNsec（示範模式）不顯示", () => {
    expect(render({ initialTab: "identity", selfNsec: "nsec1xxx" })).toContain('data-testid="backup-code"');
    expect(render({ initialTab: "identity" })).not.toContain('data-testid="backup-code"');
  });
});

describe("組織資訊（ADR-0157）", () => {
  it("提供 orgInfo → 身分分頁顯示公司名稱/歡迎詞/班表與靜音說明", () => {
    const html = render({
      initialTab: "identity",
      selfName: "夜",
      onRename: () => true, // 讓身分分頁存在（hasIdentity）
      orgInfo: { org: "小公司", welcome: "請詳讀規範", workHours: { start: "09:00", end: "18:00" } },
    });
    expect(html).toContain('data-testid="org-info"');
    expect(html).toContain("小公司");
    expect(html).toContain("請詳讀規範");
    expect(html).toContain("09:00–18:00"); // orgInfo_hours 插值
    expect(html).toContain("自動靜音"); // orgInfo_muteNote
  });

  it("未提供 orgInfo（個人身分/尚未採用名冊）→ 無組織資訊區", () => {
    const html = render({ initialTab: "identity", selfName: "夜", onRename: () => true });
    expect(html).not.toContain('data-testid="org-info"');
  });
});

describe("企業頭銜編輯（ADR-0158）", () => {
  it("提供 onSetTitle → 身分分頁顯示頭銜編輯欄（預填現值）", () => {
    const html = render({ initialTab: "identity", selfName: "夜", onRename: () => true, myTitle: "PM", onSetTitle: () => {} });
    expect(html).toContain('data-testid="org-title"');
    expect(html).toContain('data-testid="org-title-input"');
    expect(html).toContain('value="PM"');
  });

  it("未提供 onSetTitle（個人身分）→ 無頭銜編輯欄", () => {
    const html = render({ initialTab: "identity", selfName: "夜", onRename: () => true });
    expect(html).not.toContain('data-testid="org-title"');
  });
});

describe("公司儲存槽設定（ADR-0161）", () => {
  it("員工端：提供 slotQueue → 佇列面板（含狀態與失敗重試）", () => {
    const html = render({
      initialTab: "identity",
      selfName: "夜",
      onRename: () => true,
      slotQueue: [
        { id: "1", path: "C:/a.pdf", name: "a.pdf", size: 1, mime: "application/pdf", origin: "x", status: "done", queuedAt: 1 },
        { id: "2", path: "C:/b.pdf", name: "b.pdf", size: 1, mime: "application/pdf", origin: "x", status: "failed", queuedAt: 2 },
      ],
      onSlotRetry: () => {},
      onSlotRemove: () => {},
    });
    expect(html).toContain('data-testid="settings-slot-queue"');
    expect(html).toContain("已存放");
    expect(html).toContain("失敗");
    expect(html).toContain('data-testid="slot-retry"');
  });

  it("企業主端：提供 onPickSlotDir → 槽目錄區（未設顯示預設槽說明）", () => {
    const html = render({ initialTab: "identity", selfName: "夜", onRename: () => true, slotDirValue: "", onPickSlotDir: () => {} });
    expect(html).toContain('data-testid="settings-slot-dir"');
    expect(html).toContain("CinderSlot"); // settings_slotDirDefault
    expect(html).toContain('data-testid="slot-dir-pick"');
  });

  it("皆未提供（個人身分）→ 兩區都不顯示", () => {
    const html = render({ initialTab: "identity", selfName: "夜", onRename: () => true });
    expect(html).not.toContain('data-testid="settings-slot-queue"');
    expect(html).not.toContain('data-testid="settings-slot-dir"');
  });
});

describe("離職帳號接管（ADR-0163）", () => {
  it("企業主：提供 offboarded → 顯示接管清單（接管登入＋刪除）", () => {
    const html = render({
      initialTab: "identity",
      selfName: "老闆",
      onRename: () => true,
      offboarded: [{ pubkey: "a".repeat(64), name: "小美" }],
      onTakeover: () => {},
      onDeleteEscrow: () => {},
    });
    expect(html).toContain('data-testid="settings-offboard"');
    expect(html).toContain("離職·小美");
    expect(html).toContain('data-testid="offboard-takeover"');
  });

  it("無離職託管條目 → 不顯示接管區", () => {
    const html = render({ initialTab: "identity", selfName: "老闆", onRename: () => true, offboarded: [] });
    expect(html).not.toContain('data-testid="settings-offboard"');
  });
});
