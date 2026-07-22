// 客戶端進入點。頁面由 `entry-server.tsx` 在**建置時**預渲染成靜態 HTML（ADR-0235 SEO-2），
// 這裡只負責接手（hydrate）：內容在 JS 執行前就已經在 DOM 裡，爬蟲與答案引擎看得到。
import { hydrateRoot } from "react-dom/client";
import { App, parseCurrent } from "./App.js";
import "./styles.css";

const el = document.getElementById("root");
if (el) hydrateRoot(el, <App route={parseCurrent()} />);
