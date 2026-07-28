import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccentProvider } from "./accent.js";
import { App } from "./App.js";
import { ContrastProvider } from "./contrast.js";
import { DialogProvider } from "./ui/Dialog.js";
import { I18nProvider } from "./i18n.js";
import { LayoutProvider } from "./layout.js";
import { ThemeProvider } from "./theme.js";
import { TitlebarProvider, WindowChrome } from "./titlebar.js";
import { applyUiScale, getUiScale } from "./ui-scale.js";

// UI 尺寸（ADR-0253）：開機即套用裝置偏好（Tauri 原生 setZoom／瀏覽器 CSS zoom）。
void applyUiScale(getUiScale());

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <StrictMode>
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
    </StrictMode>,
  );
}
