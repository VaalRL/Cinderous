// ADR-0421：畫面元件丟例外時的保底畫面。
//
// 沒有它，React 會把整棵樹卸掉 ⇒ 視窗只剩背景色、沒有任何提示（使用者以為 App 壞了、也無從回報）。
// 錯誤記進本機診斷紀錄（已遮罩、不上傳）；畫面提供「重新載入」與「複製錯誤資訊」。
//
// 🔴 保底畫面**不能依賴任何 Provider**（I18n、Theme…）——出錯的可能就是它們。語言看 `<html lang>`。

import { Component, type ErrorInfo, type ReactNode } from "react";
import type { DiagLog } from "@cinderous/engine";
import { translate } from "@cinderous/i18n";

interface Props {
  log: DiagLog;
  /** 複製錯誤資訊時要拿的完整文字（含原生紀錄）；沒給就用 log.exportText。 */
  exportText?: () => Promise<string>;
  children: ReactNode;
}

interface State {
  failed: boolean;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, copied: false };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const stack = [error.stack ?? "", info.componentStack ?? ""].filter(Boolean).join("\n--- component stack ---");
    const e = new Error(error.message);
    e.name = error.name;
    if (stack) e.stack = stack;
    this.props.log.record("render", e);
  }

  private copy = async (): Promise<void> => {
    try {
      const text = this.props.exportText
        ? await this.props.exportText()
        : this.props.log.exportText({ platform: navigator.userAgent });
      await navigator.clipboard?.writeText(text);
      this.setState({ copied: true });
    } catch {
      /* 剪貼簿不可用就算了 */
    }
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const locale = (document.documentElement.lang || "").toLowerCase().startsWith("en") ? "en" : "zh-Hant";
    const t = (k: Parameters<typeof translate>[1]): string => translate(locale, k);
    return (
      <div className="crash" role="alert" data-testid="crash-screen">
        <h2>{t("crash_title")}</h2>
        <p>{t("crash_body")}</p>
        <div className="crash__actions">
          <button type="button" data-testid="crash-reload" onClick={() => location.reload()}>
            {t("crash_reload")}
          </button>
          <button type="button" data-testid="crash-copy" onClick={() => void this.copy()}>
            {this.state.copied ? t("diag_copied") : t("crash_copy")}
          </button>
        </div>
      </div>
    );
  }
}
