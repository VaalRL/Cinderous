// 統一自訂對話框（ADR-0139）：取代瀏覽器內建 confirm / alert / prompt。
//
// 原生對話框跳系統 chrome、不吃主題（深色/主色）、位置不受控，部分 webview 還會停用 prompt——
// 與 app 的視窗美學不一致。這裡用既有的 .modal/.win 樣式做一套主題感知、可鍵盤操作的對話框，
// 以 Promise 介面提供：`confirm→boolean`、`alert→void`、`prompt→string|null`。
//
// 未包在 <DialogProvider> 內時（如隔離的 SSR 單元測試）useDialog 回退到 window.*，不丟例外
// ——元件照常渲染；正式 app 一律有 provider（main.tsx），走自訂對話框。

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n.js";

type DialogKind = "confirm" | "alert" | "prompt";

export interface DialogOptions {
  /** 主訊息（可含換行，white-space: pre-wrap）。 */
  message: string;
  /** 標題列文字；預設依種類。 */
  title?: string;
  /** 確認鈕文字；預設「確定／好」。 */
  confirmLabel?: string;
  /** 取消鈕文字；預設「取消」。 */
  cancelLabel?: string;
  /** 破壞性操作：確認鈕轉紅（刪除／封鎖／清除等）。 */
  danger?: boolean;
}
export interface PromptOptions extends DialogOptions {
  defaultValue?: string;
  placeholder?: string;
  /** 遮罩輸入（密碼）。 */
  password?: boolean;
}

export interface DialogApi {
  confirm(opts: string | DialogOptions): Promise<boolean>;
  alert(opts: string | DialogOptions): Promise<void>;
  prompt(opts: string | PromptOptions): Promise<string | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

const norm = (o: string | DialogOptions | PromptOptions): DialogOptions & PromptOptions =>
  typeof o === "string" ? { message: o } : o;

/** 無 provider 時的回退（僅隔離測試/邊角情境）：用原生對話框，不丟例外。 */
const FALLBACK: DialogApi = {
  confirm: (o) => Promise.resolve(typeof window !== "undefined" ? !!window.confirm?.(norm(o).message) : false),
  alert: (o) => {
    if (typeof window !== "undefined") window.alert?.(norm(o).message);
    return Promise.resolve();
  },
  prompt: (o) => {
    const n = norm(o);
    return Promise.resolve(typeof window !== "undefined" ? (window.prompt?.(n.message, n.defaultValue) ?? null) : null);
  },
};

export function useDialog(): DialogApi {
  return useContext(DialogContext) ?? FALLBACK;
}

// 模組級橋接：讓**非元件**的命令式程式（例如後端回呼 onHomeMigrate）也能用同一套對話框。
// DialogProvider 掛載時登記自己的 api；未掛載時回退 window.*（隔離測試/demo）。
let globalApi: DialogApi | null = null;
/** 非 React 情境取用對話框（元件內請用 useDialog）。 */
export function dialog(): DialogApi {
  return globalApi ?? FALLBACK;
}

interface Pending {
  kind: DialogKind;
  opts: DialogOptions & PromptOptions;
  resolve: (v: unknown) => void;
}

export function DialogProvider({ children }: { children: ReactNode }): JSX.Element {
  const [active, setActive] = useState<Pending | null>(null);
  const queue = useRef<Pending[]>([]);
  const activeRef = useRef<Pending | null>(null);
  activeRef.current = active;

  const enqueue = useCallback((kind: DialogKind, o: string | DialogOptions | PromptOptions): Promise<unknown> => {
    return new Promise((resolve) => {
      const item: Pending = { kind, opts: norm(o), resolve };
      // 一次一個；開著時再來的排入佇列（modal 會擋住互動，實務上罕見，但保險）。
      if (activeRef.current) queue.current.push(item);
      else setActive(item);
    });
  }, []);

  const finish = useCallback((result: unknown): void => {
    activeRef.current?.resolve(result);
    setActive(queue.current.shift() ?? null);
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (o) => enqueue("confirm", o) as Promise<boolean>,
      alert: (o) => enqueue("alert", o).then(() => undefined),
      prompt: (o) => enqueue("prompt", o) as Promise<string | null>,
    }),
    [enqueue],
  );

  // 登記給非元件的命令式程式使用（見 dialog()）。
  useEffect(() => {
    globalApi = api;
    return () => {
      if (globalApi === api) globalApi = null;
    };
  }, [api]);

  return (
    <DialogContext.Provider value={api}>
      {children}
      {active ? <DialogView item={active} onDone={finish} /> : null}
    </DialogContext.Provider>
  );
}

function DialogView({ item, onDone }: { item: Pending; onDone: (r: unknown) => void }): JSX.Element {
  const { t } = useI18n();
  const { kind, opts } = item;
  const isPrompt = kind === "prompt";
  const isAlert = kind === "alert";
  const [text, setText] = useState(opts.defaultValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const positive = (): void => onDone(isPrompt ? text : isAlert ? undefined : true);
  const negative = (): void => onDone(isPrompt ? null : isAlert ? undefined : false); // alert：取消＝OK

  // 焦點：prompt 聚焦輸入、其餘聚焦主要按鈕。
  useEffect(() => {
    (isPrompt ? inputRef.current : confirmRef.current)?.focus();
  }, [isPrompt]);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      negative();
    } else if (e.key === "Enter" && !isPrompt) {
      e.preventDefault();
      positive();
    }
  };

  const title =
    opts.title ??
    t(kind === "confirm" ? "dialog_titleConfirm" : isPrompt ? "dialog_titlePrompt" : "dialog_titleAlert");
  const confirmText = opts.confirmLabel ?? t(isAlert ? "dialog_ok" : "dialog_confirm");

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={negative} onKeyDown={onKeyDown}>
      <div className="modal__box win dialog" onClick={(e) => e.stopPropagation()}>
        <div className="win__title">
          <span>{title}</span>
          <span className="spacer" />
          <span className="win__btn" role="button" aria-label={t("dialog_cancel")} onClick={negative}>
            ×
          </span>
        </div>
        <div className="dialog__body">
          <p className="dialog__msg" data-testid="dialog-message">
            {opts.message}
          </p>
          {isPrompt ? (
            <input
              ref={inputRef}
              className="dialog__input"
              type={opts.password ? "password" : "text"}
              value={text}
              placeholder={opts.placeholder}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  positive();
                }
              }}
              data-testid="dialog-input"
            />
          ) : null}
          <div className="dialog__actions">
            {!isAlert ? (
              <button type="button" className="dialog__btn dialog__btn--ghost" data-testid="dialog-cancel" onClick={negative}>
                {opts.cancelLabel ?? t("dialog_cancel")}
              </button>
            ) : null}
            <button
              ref={confirmRef}
              type="button"
              className={`dialog__btn${opts.danger ? " dialog__btn--danger" : ""}`}
              data-testid="dialog-confirm"
              onClick={positive}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
