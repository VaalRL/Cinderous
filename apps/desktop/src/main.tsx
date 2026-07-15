import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccentProvider } from "./accent.js";
import { App } from "./App.js";
import { DialogProvider } from "./ui/Dialog.js";
import { I18nProvider } from "./i18n.js";
import { LayoutProvider } from "./layout.js";
import { ThemeProvider } from "./theme.js";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <ThemeProvider>
        <AccentProvider>
          <I18nProvider>
            <LayoutProvider>
              <DialogProvider>
                <App />
              </DialogProvider>
            </LayoutProvider>
          </I18nProvider>
        </AccentProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
