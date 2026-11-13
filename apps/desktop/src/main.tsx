import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccentProvider } from "./accent.js";
import { App } from "./App.js";
import { ContrastProvider } from "./contrast.js";
import { DialogProvider } from "./ui/Dialog.js";
import { ErrorBoundary } from "./ui/ErrorBoundary.js";
import { installErrorCapture } from "@cinderous/engine";
import { diagExportText, diagLog } from "./native/diag.js";
import { I18nProvider } from "./i18n.js";
import { LayoutProvider } from "./layout.js";
import { ThemeProvider } from "./theme.js";
import { TitlebarProvider, WindowChrome } from "./titlebar.js";
import { applyUiScale, getUiScale } from "./ui-scale.js";

// ADR-0421：未攔到的例外／promise rejection 記進本機診斷紀錄（遮罩後存在這台裝置、不上傳）。
installErrorCapture(window, diagLog);

// UI 尺寸（ADR-0253）：開機即套用裝置偏好（Tauri 原生 setZoom／瀏覽器 CSS zoom）。
void applyUiScale(getUiScale());

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      {/* ADR-0421：最外層——任何 Provider 或畫面丟例外都顯示錯誤畫面，不再只剩底色。 */}
      <ErrorBoundary log={diagLog} exportText={diagExportText}>
      <ThemeProvider>
        <ContrastProvider>
          <AccentProvider>
            <I18nProvider>
              <LayoutProvider>
                <TitlebarProvider>
                  <DialogProvider>
                    {/* ADR-0150：自繪視窗外框——包在所有畫面外，登入/解鎖也有標題列。 */}
                    <WindowChrome>
                      <App />
                    </WindowChrome>
                  </DialogProvider>
                </TitlebarProvider>
              </LayoutProvider>
            </I18nProvider>
          </AccentProvider>
        </ContrastProvider>
      </ThemeProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}
