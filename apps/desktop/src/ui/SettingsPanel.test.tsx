import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccentProvider } from "../accent.js";
import { ContrastProvider } from "../contrast.js";
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
      <ContrastProvider>
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
      </ContrastProvider>
    </ThemeProvider>,
  );
}

describe("無障礙設定（ADR-0253）", () => {
  it("外觀分頁有無障礙區：高對比切換（預設關）＋五檔尺寸（預設 100% 選中）", () => {
    const out = render();
    expect(out).toContain('data-testid="a11y-settings"');
    const toggleAt = out.indexOf('data-testid="a11y-contrast-toggle"');
    expect(toggleAt).toBeGreaterThanOrEqual(0);
    expect(out.slice(toggleAt, toggleAt + 90)).toContain('aria-pressed="false"'); // 預設關
    const at100 = out.indexOf('data-testid="a11y-scale-100"');
    expect(at100).toBeGreaterThanOrEqual(0);
    expect(out.slice(at100 - 70, at100)).toContain('aria-pressed="true"'); // 預設 100%
    expect(out).toContain('data-testid="a11y-scale-90"');
    expect(out).toContain('data-testid="a11y-scale-150"');
  });

  it("色覺友善色票列在主色設定內（accent-cb-row）", () => {
    expect(render()).toContain('data-testid="accent-cb-row"');
  });
});

describe("前向保密設定區（ADR-0245 Phase 2）", () => {
  const fsProps = (enabled: boolean) => ({ initialTab: "privacy" as const, fs: { enabled, onEnable: () => {}, onRotate: () => {} } });
  it("未啟用 → 顯示「啟用」按鈕、不顯示「更換金鑰」", () => {
    const out = render(fsProps(false));
    expect(out).toContain('data-testid="fs-enable"');
    expect(out).not.toContain('data-testid="fs-rotate"');
  });
  it("已啟用 → 顯示「已啟用」＋「更換金鑰」按鈕", () => {
    const out = render(fsProps(true));
    expect(out).toContain('data-testid="fs-rotate"');
    expect(out).not.toContain('data-testid="fs-enable"');
  });
  it("未提供 fs（如瀏覽器示範）→ 不顯示區塊", () => {
    expect(render({ initialTab: "privacy" })).not.toContain('data-testid="fs-enable"');
  });

  // ADR-0306 D1：實驗性上線的硬條件——未經審計必須「明示」，不得只寫在文件裡。
  it("🔴 未啟用時就必須看得到「尚未經外部審計」，不能等按下去才說", () => {
    const out = render(fsProps(false));
    expect(out).toContain('data-testid="fs-unaudited"');
  });

  it("🔴 已啟用後那句揭露不得消失（啟用不是把警語關掉的開關）", () => {
    const out = render(fsProps(true));
    expect(out).toContain('data-testid="fs-unaudited"');
  });

  it("🔴 標題必須帶「實驗性」，不得只寫「進階」", () => {
    // 「進階」讀起來像「給高階使用者的成熟功能」，那正是 ADR-0306 §3 說的遮羞布。
    const out = render(fsProps(false));
    expect(out).toContain("實驗性");
    expect(out).not.toContain("前向保密（進階）");
  });
});

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

  it("關於分頁：顯示版號與本版更新記錄（ADR-0227 P4）", () => {
    expect(render()).toContain('data-testid="settings-tab-about"'); // 分頁恆在
    const out = render({ initialTab: "about" });
    expect(out).toContain('data-testid="about"');
    expect(out).toContain(__APP_VERSION__); // build-time 注入的版號
    expect(out).toContain("本版更新內容"); // zh-Hant（provider 固定語系）
  });

  it("關於分頁：可更新徽章＋前往下載（ADR-0228 P3）；無新版不顯示", () => {
    const out = render({ initialTab: "about", updateAvailable: "9.9.9" });
    expect(out).toContain('data-testid="update-badge"');
    expect(out).toContain("9.9.9");
    expect(out).toContain("github.com/VaalRL/Cinderous/releases");
    expect(render({ initialTab: "about" })).not.toContain('data-testid="update-badge"');
    expect(render({ initialTab: "about", updateAvailable: null })).not.toContain('data-testid="update-badge"');
  });

  it("隱私分頁：威脅情報防護四項（ADR-0231 P3）——提供 threat 才顯示；停用時收合子項", () => {
    expect(render({ initialTab: "privacy" })).not.toContain('data-testid="threat-settings"');
    const threat = {
      enabled: true,
      sendWarn: true,
      strict: false,
      custom: ["evil.com"],
      onToggleEnabled: () => {},
      onToggleSendWarn: () => {},
      onToggleStrict: () => {},
      onCustomChange: () => {},
    };
    const on = render({ initialTab: "privacy", threat });
    expect(on).toContain('data-testid="threat-settings"');
    expect(on).toContain('data-testid="threat-enable"');
    expect(on).toContain('data-testid="threat-send-warn"');
    expect(on).toContain('data-testid="threat-strict"');
    expect(on).toContain('data-testid="threat-custom"');
    expect(on).toContain("evil.com");
    const off = render({ initialTab: "privacy", threat: { ...threat, enabled: false } });
    expect(off).toContain('data-testid="threat-enable"');
    expect(off).not.toContain('data-testid="threat-send-warn"');
  });

  it("關於分頁：自動檢查更新開關（ADR-0228 P3）——提供 onToggleUpdateCheck 才顯示、反映開關狀態", () => {
    expect(render({ initialTab: "about" })).not.toContain('data-testid="update-check-toggle"');
    const on = render({ initialTab: "about", updateCheck: true, onToggleUpdateCheck: () => {} });
    expect(on).toContain('data-testid="update-check-toggle"');
    expect(on).toMatch(/data-testid="update-check-toggle"[^>]*checked/);
    const off = render({ initialTab: "about", updateCheck: false, onToggleUpdateCheck: () => {} });
    expect(off).not.toMatch(/data-testid="update-check-toggle"[^>]*checked/);
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

  it("提供 notifyEvents → 顯示「要通知哪些事件」子區與各事件開關（ADR-0217）", () => {
    const out = render({
      ...base,
      notifyEvents: { dm: true, group: true, mention: true, nudge: true, call: true, request: false, reaction: false },
      onToggleNotifyEvent: () => {},
    });
    expect(out).toContain('data-testid="notify-events"');
    expect(out).toContain("要通知哪些事件");
    expect(out).toContain('data-testid="notify-event-dm"');
    expect(out).toContain('data-testid="notify-event-mention"');
    expect(out).toContain('data-testid="notify-event-request"');
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
        <ContrastProvider>
          <AccentProvider>
            <LayoutProvider>
              <TitlebarProvider>
                <I18nProvider locale="zh-Hant">
                  <SettingsPanel relayUrl="wss://x" notifications={false} onToggleNotifications={() => {}} onClose={() => {}} {...extra} />
                </I18nProvider>
              </TitlebarProvider>
            </LayoutProvider>
          </AccentProvider>
        </ContrastProvider>
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

describe("NIP-62 清除請求（ADR-0260）", () => {
  it("提供 onVanish → 隱私分頁顯示清除區塊（含危險樣式）", () => {
    const html = render({ initialTab: "privacy", onVanish: () => [] });
    expect(html).toContain('data-testid="vanish-section"');
    expect(html).toContain('data-testid="vanish-btn"');
    expect(html).toContain("要求中繼站清除");
  });

  it("未提供（示範後端）→ 不顯示", () => {
    expect(render({ initialTab: "privacy" })).not.toContain('data-testid="vanish-section"');
  });

  it("措辭誠實：說明只影響中繼站、且結果不由本端保證", () => {
    const html = render({ initialTab: "privacy", onVanish: () => [] });
    expect(html).toContain("本機的對話不受影響"); // 不讓使用者誤以為會刪掉自己的歷史
    expect(html).not.toContain("已刪除"); // 刪除在對方機器上，不做做不到的保證
  });

  it("按下之前不顯示結果（結果只在送出後出現）", () => {
    expect(render({ initialTab: "privacy", onVanish: () => [] })).not.toContain('data-testid="vanish-result"');
  });
});

describe("公司政策條列（ADR-0312）", () => {
  const identity = { initialTab: "identity" as const, selfNsec: "nsec1abc" };

  it("沒有政策：整段不顯示", () => {
    expect(render(identity)).not.toContain('data-testid="org-policy"');
  });

  it("空政策物件同樣不顯示（有企業身分但政策全空）", () => {
    expect(render({ ...identity, orgPolicy: {} })).not.toContain('data-testid="org-policy"');
  });

  it("🔴 停用的功能逐條列出——使用者看得出是被公司關掉、不是壞了", () => {
    const html = render({ ...identity, orgPolicy: { disableFiles: true, disableStickers: true } });
    expect(html).toContain('data-testid="org-policy"');
    expect(html).toContain('data-testid="org-policy-disabled"');
    expect(html).toContain("已停用的功能");
    expect(html).toContain("無法在本機關閉"); // 明示不是本機開關
  });

  it("生效中的規則另立一段，數值有內插", () => {
    const html = render({ ...identity, orgPolicy: { forceTurn: true, messageTtlDays: 30 } });
    expect(html).toContain('data-testid="org-policy-rules"');
    expect(html).toContain("生效中的規則");
    expect(html).toContain("30");
    expect(html).not.toContain("{days}");
  });

  it("只有停用、沒有規則時不顯示「生效中的規則」標頭", () => {
    const html = render({ ...identity, orgPolicy: { disableCalls: true } });
    expect(html).toContain('data-testid="org-policy-disabled"');
    expect(html).not.toContain('data-testid="org-policy-rules"');
  });
});

describe("FS 自動輪替與停用（ADR-0313／0314）", () => {
  const fsProp = (extra: Record<string, unknown> = {}) => ({
    initialTab: "privacy" as const,
    fs: { enabled: true, onEnable: () => {}, onRotate: () => {}, ...extra },
  });

  it("已啟用時說明「每 7 天自動更換」——保護來自自動，不是那顆手動鈕", () => {
    const html = render(fsProp());
    expect(html).toContain('data-testid="fs-auto-rotate"');
    expect(html).toContain("7");
  });

  it("🔴 提供 onDisable 時顯示停用鈕——啟用確認說了「可以隨時關閉」", () => {
    expect(render(fsProp({ onDisable: () => {} }))).toContain('data-testid="fs-disable"');
  });

  it("未啟用時不顯示停用鈕與自動輪替說明", () => {
    const html = render({
      initialTab: "privacy" as const,
      fs: { enabled: false, onEnable: () => {}, onRotate: () => {}, onDisable: () => {} },
    });
    expect(html).not.toContain('data-testid="fs-disable"');
    expect(html).not.toContain('data-testid="fs-auto-rotate"');
    expect(html).toContain('data-testid="fs-unaudited"'); // 揭露仍在（ADR-0306 D1）
  });
});

describe("解封失敗的可見性（ADR-0316）", () => {
  const base = { initialTab: "privacy" as const, fs: { enabled: true, onEnable: () => {}, onRotate: () => {} } };

  it("沒發生過就不顯示", () => {
    expect(render(base)).not.toContain('data-testid="fs-undecryptable"');
    expect(render({ ...base, fs: { ...base.fs, undecryptable: { count: 0, lastAt: 0 } } })).not.toContain(
      'data-testid="fs-undecryptable"',
    );
  });

  it("🔴 發生過就要看得見——ADR-0315 第 1 步要解的正是「靜默消失」", () => {
    const html = render({ ...base, fs: { ...base.fs, undecryptable: { count: 3, lastAt: Date.now() } } });
    expect(html).toContain('data-testid="fs-undecryptable"');
    expect(html).toContain("3");
  });

  it("🔴 文案不得把「可能」寫成「是」，且要講明查不出是誰送的（NIP-59 的必然限制）", () => {
    const html = render({ ...base, fs: { ...base.fs, undecryptable: { count: 1, lastAt: Date.now() } } });
    expect(html).toContain("可能");
    expect(html).toContain("無法分辨");
    expect(html).toContain("查不出是誰送的");
  });
});

describe("入群邀請閘門的設定（ADR-0317）", () => {
  it("未提供 handler → 不顯示（示範後端）", () => {
    expect(render({ initialTab: "privacy" })).not.toContain('data-testid="group-invite-anyone"');
  });

  it("關閉時＝只有聯絡人可以把我加進群組，且說明講清楚封鎖優先", () => {
    const html = render({ initialTab: "privacy", groupInviteFromAnyone: false, onToggleGroupInvite: () => {} });
    const at = html.indexOf('data-testid="group-invite-anyone"');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(html.slice(at - 120, at + 120)).not.toContain("checked");
    expect(html).toContain("只有你的聯絡人");
    expect(html).toContain("封鎖");
  });

  it("開啟時勾選", () => {
    const html = render({ initialTab: "privacy", groupInviteFromAnyone: true, onToggleGroupInvite: () => {} });
    const at = html.indexOf('data-testid="group-invite-anyone"');
    expect(html.slice(at - 120, at + 120)).toContain("checked");
  });
});

describe("我的裝置（ADR-0321 E-lite）", () => {
  const devices = [
    { id: "aabbccdd11223344", firstSeen: Date.now(), source: "local" },
    { id: "eeff001122334455", firstSeen: Date.now(), source: "snapshot" },
  ];

  it("未提供裝置時不顯示（示範後端）", () => {
    expect(render({ initialTab: "identity", selfNsec: "nsec1" })).not.toContain('data-testid="devices"');
  });

  it("🔴 列出裝置並標明「這台」——今天使用者根本看不到自己有幾台", () => {
    const html = render({ initialTab: "identity", selfNsec: "nsec1", devices });
    expect(html).toContain('data-testid="device-list"');
    expect(html).toContain("aabbccdd"); // 縮寫 id
    expect(html).toContain("這台");
  });

  it("🔴 限制揭露是驗收條件：必須說出「看到只有一台不等於沒有人在讀」", () => {
    const html = render({ initialTab: "identity", selfNsec: "nsec1", devices });
    expect(html).toContain('data-testid="devices-limit"');
    expect(html).toContain("會寫入的裝置");
    expect(html).toContain("不等於沒有人在讀你的訊息");
  });
});

describe("裝置目錄狀態（ADR-0322 S1）", () => {
  it("🔴 觀測到但不在目錄內 → 顯著標示（今天完全看不出來的那種）", () => {
    const html = render({
      initialTab: "identity",
      selfNsec: "nsec1",
      devices: [
        { id: "aabbccdd11223344", firstSeen: Date.now(), source: "local", inDirectory: true },
        { id: "eeff001122334455", firstSeen: Date.now(), source: "snapshot", inDirectory: false },
      ],
    });
    expect(html).toContain('data-testid="device-not-in-dir"');
  });

  it("全部在目錄內時不標示（避免常態被當警告）", () => {
    const html = render({
      initialTab: "identity",
      selfNsec: "nsec1",
      devices: [{ id: "aabbccdd11223344", firstSeen: Date.now(), source: "local", inDirectory: true }],
    });
    expect(html).not.toContain('data-testid="device-not-in-dir"');
  });
});

describe("撤銷三態與移除入口（ADR-0322 S2／S3）", () => {
  const two = [
    { id: "aabbccdd11223344", firstSeen: Date.now(), source: "local", inDirectory: true },
    { id: "eeff001122334455", firstSeen: Date.now(), source: "snapshot", inDirectory: true },
  ];
  const base = { initialTab: "identity" as const, selfNsec: "nsec1", devices: two };

  it("🔴 雙軌期間必須明說「移除還不會生效」，且指出是哪一台", () => {
    const html = render({ ...base, revocation: { state: "dual-track" as const, devices: ["eeff001122334455"] } });
    expect(html).toContain('data-testid="revocation-dual-track"');
    expect(html).toContain("還不會生效");
    expect(html).toContain("eeff0011");
  });

  it("目錄建立中＝「請稍候」，不是「不能撤銷」", () => {
    const html = render({ ...base, revocation: { state: "unknown" as const } });
    expect(html).toContain('data-testid="revocation-unknown"');
    expect(html).toContain("請稍候");
  });

  it("生效時說明後果（歷史不受影響）", () => {
    const html = render({ ...base, revocation: { state: "active" as const } });
    expect(html).toContain('data-testid="revocation-active"');
    expect(html).toContain("歷史不受影響");
  });

  it("🔴 移除入口只給別台，不給「這台」", () => {
    const html = render({ ...base, onRemoveDevice: () => {} });
    expect(html).toContain('data-testid="device-remove-eeff001122334455"');
    expect(html).not.toContain('data-testid="device-remove-aabbccdd11223344"');
  });

  it("已移除的裝置標示出來且不再提供移除", () => {
    const html = render({
      ...base,
      devices: [two[0]!, { ...two[1]!, revoked: true, inDirectory: false }],
      onRemoveDevice: () => {},
    });
    expect(html).toContain("已移除");
    expect(html).not.toContain('data-testid="device-remove-eeff001122334455"');
  });
});

describe("目錄異常的常駐呈現（ADR-0322 S4）", () => {
  const base = {
    initialTab: "identity" as const,
    selfNsec: "nsec1",
    devices: [{ id: "aabbccdd11223344", firstSeen: Date.now(), source: "local", inDirectory: true }],
  };

  it("沒有異常時不顯示", () => {
    expect(render(base)).not.toContain('data-testid="device-conflicts"');
  });

  it("🔴 有異常時常駐顯示（不是一次性對話框——重開還在）", () => {
    const html = render({ ...base, deviceConflicts: [{ at: Date.now(), mineV: 3, incomingV: 1 }] });
    expect(html).toContain('data-testid="device-conflicts"');
    expect(html).toContain("版本倒退");
    expect(html).toContain("本機沒有採用它");
  });
});

describe("手動授權裝置（ADR-0322 S5）", () => {
  const base = {
    initialTab: "identity" as const,
    selfNsec: "nsec1",
    devices: [{ id: "aabbccdd11223344", firstSeen: Date.now(), source: "local", inDirectory: true }],
  };
  const pk = "ab".repeat(32);

  it("顯示這台的裝置代碼，並要求比對兩邊字元", () => {
    const html = render({ ...base, selfDevicePk: pk });
    expect(html).toContain('data-testid="my-device-code"');
    expect(html).toContain(pk);
    expect(html).toContain("比對兩邊顯示的字元");
  });

  it("🔴 已在清單上 → 顯示授權欄位；按鈕預設停用（代碼未填）", () => {
    const html = render({ ...base, selfDevicePk: pk, onAuthorizeDevice: () => {}, canAuthorizeDevice: true });
    expect(html).toContain('data-testid="authorize-input"');
    const at = html.indexOf('data-testid="authorize-go"');
    expect(html.slice(at - 100, at + 100)).toContain("disabled");
  });

  it("🔴 不在清單上 → **不給授權入口**，並說明原因（授權資格＝已在清單上）", () => {
    const html = render({ ...base, selfDevicePk: pk, onAuthorizeDevice: () => {}, canAuthorizeDevice: false });
    expect(html).not.toContain('data-testid="authorize-input"');
    expect(html).toContain('data-testid="no-authority"');
    expect(html).toContain("還不在清單上");
  });
});

describe("久未出現與從清單移除（ADR-0324）", () => {
  const self = { id: "aaaa1111", firstSeen: Date.now(), source: "local", inDirectory: true };
  const gone = { id: "cccc3333", firstSeen: Date.now(), source: "snapshot", inDirectory: false, stale: true };
  const view = (p: Record<string, unknown>) =>
    render({ initialTab: "identity" as const, selfNsec: "nsec1", devices: [self, gone], ...p });

  it("🔴 久未出現要標出來——它已被排除在撤銷判定之外，那會影響行為", () => {
    expect(view({})).toContain('data-testid="device-stale-cccc3333"');
  });

  it("🔴 不在目錄內的不給撤銷鈕——它沒有目錄項，按下去是靜默什麼都不做", () => {
    expect(view({ onRemoveDevice: () => {} })).not.toContain('data-testid="device-remove-cccc3333"');
  });

  it("改給「從清單移除」", () => {
    expect(view({ onForgetDevice: () => {} })).toContain('data-testid="device-forget-cccc3333"');
  });

  it("在目錄內的給撤銷、不給「從清單移除」——後者只會把它藏起來，授權原封不動", () => {
    const inDir = { id: "cccc3333", firstSeen: Date.now(), source: "snapshot", inDirectory: true };
    const html = render({
      initialTab: "identity" as const,
      selfNsec: "nsec1",
      devices: [self, inDir],
      onRemoveDevice: () => {},
      onForgetDevice: () => {},
    });
    expect(html).toContain('data-testid="device-remove-cccc3333"');
    expect(html).not.toContain('data-testid="device-forget-cccc3333"');
  });
});

describe("金鑰保護等級的誠實揭露（ADR-0297 §6 紅線）", () => {
  const base = {
    initialTab: "identity" as const,
    selfNsec: "nsec1",
    devices: [{ id: "aabbccdd11223344", firstSeen: Date.now(), source: "local", inDirectory: true }],
  };

  it("🔴 明文時必須說出後果：磁碟被複製 ⇒ 移除裝置擋不住他", () => {
    const html = render({ ...base, deviceKeyTier: "plaintext" as const });
    expect(html).toContain('data-testid="key-tier-plaintext"');
    expect(html).toContain("明文存放");
    expect(html).toContain("「移除裝置」擋不住他");
  });

  it("🔴 就算到了最高級也不得宣稱「裝置被入侵也安全」（ADR-0297 §5 的界線）", () => {
    const html = render({ ...base, deviceKeyTier: "keystore" as const });
    expect(html).toContain('data-testid="key-tier-keystore"');
    expect(html).toContain("不代表裝置被入侵時也安全");
    // 🔴 而且要說對「為什麼不安全」：我們是把金鑰**取出來用**，不是請晶片代簽
    // ——後者的說法會讓人以為金鑰不出晶片，那高估了實作（ADR-0323 §5-1 校正）。
    expect(html).toContain("取出來用");
    expect(html).not.toContain("請金鑰庫代簽");
  });

  it("🔴 encrypted 不得宣稱有密碼保護——包裹金鑰是軟體保管的，沒有使用者祕密參與", () => {
    const html = render({ ...base, deviceKeyTier: "encrypted" as const });
    expect(html).toContain('data-testid="key-tier-encrypted"');
    expect(html).toContain("包裹它的那把金鑰是軟體保管的");
    expect(html).not.toContain("以密碼包裹"); // 曾經這樣寫過，是承諾了不存在的東西
    expect(html).toContain("仍有機會解開"); // 且要說出它擋不住什麼
  });

  it("未提供時不顯示（避免猜平台猜出一個比實情好看的答案）", () => {
    expect(render(base)).not.toContain("key-tier-");
  });

  it("🔴 金鑰庫打不開時要說出後果：這台不會出現在裝置清單（ADR-0323）", () => {
    const html = render({ ...base, deviceKeyTier: "ephemeral" as const });
    expect(html).toContain('data-testid="key-tier-ephemeral"');
    expect(html).toContain("這台不會出現在你的裝置清單裡");
    expect(html).toContain("settings__warn"); // 這是警告，不是中性資訊
  });

  it("🔴 由明文遷入金鑰庫者：不得只說「已受保護」，要說舊備份可能已有一份", () => {
    const html = render({ ...base, deviceKeyTier: "keystore" as const, deviceKeyEverPlaintext: true });
    expect(html).toContain('data-testid="key-tier-was-plain"');
    expect(html).toContain("在那之前備份過磁碟的人可能已經有一份");
  });

  it("原生於金鑰庫者不掛那句告白（沒發生過的事不要嚇人）", () => {
    expect(render({ ...base, deviceKeyTier: "keystore" as const })).not.toContain("key-tier-was-plain");
  });

  it("明文時不掛「曾經明文」——它還在明文，講「曾經」會讓人以為已經搬走了", () => {
    const html = render({ ...base, deviceKeyTier: "plaintext" as const, deviceKeyEverPlaintext: true });
    expect(html).not.toContain("key-tier-was-plain");
  });
});
