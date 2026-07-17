// 自繪視窗外框（ADR-0150／0151）：TitlebarProvider 保存標題列按鈕的雙帶配置與 autoHide
// （localStorage，純本地 UI 偏好），WindowChrome 在 Tauri 下於整個 App 外圍加自繪標題列——
// 包在所有畫面之外，登入/解鎖畫面也有外框（否則 decorations:false 後那些畫面無法拖動/關閉）。
// ⚙ 設定鈕（ADR-0151）：App 掛載後以 useRegisterSettingsOpener 註冊開啟器，標題列才畫 ⚙。
// 瀏覽器版外框是瀏覽器的，WindowChrome 原樣透傳。
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { tauriTitleBarActions } from "./native/window-controls.js";
import { TitleBar, type TitleBarActions } from "./ui/TitleBar.js";
import { scopedGet, scopedSet } from "./identity-scoped.js";
import {
  parseTitlebarControls,
  serializeTitlebarControls,
  TITLEBAR_CONTROLS_SUFFIX,
  type TitlebarControls,
} from "./ui/titlebar-controls.js";

interface TitlebarContextValue {
  controls: TitlebarControls;
  setControls: (controls: TitlebarControls) => void;
  /** 標題列 ⚙ 的動作（App 註冊；null＝尚未註冊，不畫 ⚙）。 */
  openSettings: (() => void) | null;
  registerSettingsOpener: (fn: (() => void) | null) => void;
}

const TitlebarContext = createContext<TitlebarContextValue | null>(null);

function initialControls(): TitlebarControls {
  // ADR-0167：標題列配置改為身分層覆寫、回退裝置層。
  return parseTitlebarControls(scopedGet(TITLEBAR_CONTROLS_SUFFIX));
}

export function TitlebarProvider({ children }: { children: ReactNode }): JSX.Element {
  const [controls, setControlsState] = useState<TitlebarControls>(initialControls);
  const [openSettings, setOpenSettings] = useState<(() => void) | null>(null);
  const setControls = (next: TitlebarControls): void => {
    scopedSet(TITLEBAR_CONTROLS_SUFFIX, serializeTitlebarControls(next));
    setControlsState(next);
  };
  const value = useMemo<TitlebarContextValue>(
    () => ({
      controls,
      setControls,
      openSettings,
      registerSettingsOpener: (fn) => setOpenSettings(() => fn),
    }),
    [controls, openSettings],
  );
  return <TitlebarContext.Provider value={value}>{children}</TitlebarContext.Provider>;
}

export function useTitlebar(): TitlebarContextValue {
  const ctx = useContext(TitlebarContext);
  if (!ctx) throw new Error("useTitlebar 必須在 TitlebarProvider 內使用");
  return ctx;
}

/**
 * 供 App 註冊「開啟設定面板」給標題列 ⚙（ADR-0151）。
 * 不在 Provider 內（單獨測試 App 時）回 no-op，App 不因此炸掉。
 */
export function useRegisterSettingsOpener(): (fn: (() => void) | null) => void {
  const ctx = useContext(TitlebarContext);
  return ctx?.registerSettingsOpener ?? (() => {});
}

/**
 * 自繪外框本體（獨立出來供 SSR 測試）。autoHide（ADR-0153）＝**整條標題列**滑出畫面
 * （fixed 覆蓋層、translateY(-100%)），滑鼠碰到視窗頂端 6px 熱區或標題列本身才滑入；
 * 內容區同時拿回整個視窗高度（--viewport-h 回 100vh）。
 */
export function ChromeFrame(props: {
  controls: TitlebarControls;
  actions: TitleBarActions;
  onOpenSettings?: () => void;
  children: ReactNode;
}): JSX.Element {
  const { controls } = props;
  return (
    <div className={`window-chrome${controls.autoHide ? " window-chrome--autohide" : ""}`}>
      {controls.autoHide ? <div className="window-chrome__hotzone" data-testid="chrome-hotzone" /> : null}
      <TitleBar
        controls={controls}
        actions={props.actions}
        {...(props.onOpenSettings ? { onOpenSettings: props.onOpenSettings } : {})}
      />
      <div className="window-chrome__body">{props.children}</div>
    </div>
  );
}

/** Tauri 下包一層自繪外框（標題列＋內容區）；瀏覽器版原樣透傳。 */
export function WindowChrome({ children }: { children: ReactNode }): JSX.Element {
  const { controls, openSettings } = useTitlebar();
  if (!isTauri()) return <>{children}</>;
  return (
    <ChromeFrame controls={controls} actions={tauriTitleBarActions} {...(openSettings ? { onOpenSettings: openSettings } : {})}>
      {children}
    </ChromeFrame>
  );
}
