// ADR-0421 行動端：畫面元件丟例外時的保底畫面（不再整片空白），錯誤記進本機診斷紀錄。
// 🔴 不依賴任何 Provider 或主題 hook——出錯的可能就是它們；語言由外面傳入（讀裝置偏好）。

import { Component, type ErrorInfo, type ReactNode } from "react";
import type { DiagLog } from "@cinderous/engine";
import { translate, type Locale } from "@cinderous/i18n";
import { Pressable, StyleSheet, Text, View } from "react-native-web";
import { copyText } from "../native/clipboard.js";

interface Props {
  log: DiagLog;
  locale: Locale;
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
    const text = this.props.exportText
      ? await this.props.exportText()
      : this.props.log.exportText({ platform: "mobile" });
    if (await copyText(text)) this.setState({ copied: true });
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const t = (k: Parameters<typeof translate>[1]): string => translate(this.props.locale, k);
    return (
      <View style={styles.wrap} testID="crash-screen">
        <Text style={styles.title}>{t("crash_title")}</Text>
        <Text style={styles.body}>{t("crash_body")}</Text>
        <View style={styles.row}>
          <Pressable style={styles.btn} accessibilityRole="button" testID="crash-reload" onPress={() => location.reload()}>
            <Text style={styles.btnText}>{t("crash_reload")}</Text>
          </Pressable>
          <Pressable style={styles.btn} accessibilityRole="button" testID="crash-copy" onPress={() => void this.copy()}>
            <Text style={styles.btnText}>{this.state.copied ? t("diag_copied") : t("crash_copy")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: "100%", backgroundColor: "#f4f6fa", alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  title: { fontSize: 18, fontWeight: "700", color: "#1b2b44" },
  body: { fontSize: 14, color: "#4a5a74", textAlign: "center" },
  row: { flexDirection: "row", gap: 10, marginTop: 8 },
  btn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: "#c9d3e3", backgroundColor: "#ffffff" },
  btnText: { fontSize: 14, color: "#1b2b44" },
});
