import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccentProvider } from "./accent.js";
import { App } from "./App.js";
import { I18nProvider } from "./i18n.js";
import { ThemeProvider } from "./theme.js";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <ThemeProvider>
        <AccentProvider>
          <I18nProvider>
            <App />
          </I18nProvider>
        </AccentProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
