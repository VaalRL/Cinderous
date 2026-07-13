// 行動端 web preview（ADR-0085/0087）：以 react-native-web 在瀏覽器實跑 MobileApp。
// 用手機外框包住 app，提供 頁面淺/深、示範/真實 relay、relay URL、可複製示範 nsec。
// 主題/主色/語言改由 app 內「設定」分頁掌管（ADR-0087）——此頁只留開發預覽用的外框控制。
import { type CSSProperties, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { generateSecretKey, nsecEncode } from "@cinder/core";
import type { Theme } from "@cinder/theme";
import { DEFAULT_RELAY } from "./backend.js";
import { MobileApp } from "./MobileApp.js";

function Preview(): JSX.Element {
  const [theme, setTheme] = useState<Theme>("light");
  const [useRelay, setUseRelay] = useState(false);
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY);
  // 一組有效的示範 nsec（每次載入頁面固定）：貼到「用私鑰登入」即可進入。
  const demoNsec = useMemo(() => nsecEncode(generateSecretKey()), []);

  const dark = theme === "dark";
  const pageBg = dark ? "#0b1220" : "#eef2f7";
  const panelBg = dark ? "#161c26" : "#ffffff";
  const ink = dark ? "#e6edf7" : "#1b2b44";
  const muted = dark ? "#93a1ba" : "#6b7d99";
  const border = dark ? "#33405a" : "#cdddf2";

  const btn = (active: boolean): CSSProperties => ({
    padding: "4px 10px",
    borderRadius: 8,
    border: `1px solid ${active ? "#2f6cd6" : border}`,
    background: active ? "#2f6cd6" : panelBg,
    color: active ? "#fff" : ink,
    cursor: "pointer",
    fontSize: 13,
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: pageBg,
        color: ink,
        fontFamily: '"Segoe UI", "Microsoft JhengHei", system-ui, sans-serif',
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <h1 style={{ fontSize: 18, margin: 0 }}>Cinder 行動端 — Web Preview</h1>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 12, color: muted }}>頁面：</span>
        <button type="button" style={btn(!dark)} onClick={() => setTheme("light")}>淺</button>
        <button type="button" style={btn(dark)} onClick={() => setTheme("dark")}>深</button>
        <span style={{ width: 12 }} />
        <span style={{ fontSize: 12, color: muted }}>後端：</span>
        <button type="button" style={btn(!useRelay)} onClick={() => setUseRelay(false)}>示範</button>
        <button type="button" style={btn(useRelay)} onClick={() => setUseRelay(true)}>真實 relay</button>
      </div>

      {useRelay ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", maxWidth: 520, width: "100%", boxSizing: "border-box" }}>
          <input
            value={relayUrl}
            onChange={(e) => setRelayUrl(e.target.value)}
            placeholder="wss://…"
            style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: `1px solid ${border}`, background: panelBg, color: ink, fontSize: 12 }}
          />
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: panelBg,
          border: `1px solid ${border}`,
          borderRadius: 10,
          padding: "8px 12px",
          maxWidth: 520,
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontSize: 12, color: muted, flex: 1, minWidth: 0 }}>
          示範 nsec（複製後貼到「用私鑰登入」，名稱隨意）：
          <code style={{ display: "block", fontSize: 11, color: ink, overflowWrap: "anywhere" }}>{demoNsec}</code>
        </div>
        <button type="button" style={btn(false)} onClick={() => void navigator.clipboard?.writeText(demoNsec)}>
          複製
        </button>
      </div>

      <div
        style={{
          width: 390,
          height: 800,
          maxWidth: "100%",
          borderRadius: 36,
          border: `10px solid ${dark ? "#000" : "#222"}`,
          boxShadow: "0 20px 60px rgba(0,0,0,.35)",
          overflow: "hidden",
          background: panelBg,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <MobileApp
          key={useRelay ? `relay:${relayUrl}` : "demo"}
          initialTheme={theme}
          relayUrl={useRelay ? relayUrl.trim() : null}
        />
      </div>

      <p style={{ fontSize: 12, color: muted, maxWidth: 520, textAlign: "center" }}>
        底部分頁：聊天／聯絡人／設定（主題·主色·語言在「設定」切換）。
        {useRelay
          ? " 真實 relay：登入後在聊天分頁按「＋」貼好友 npub；開兩個分頁各用不同 nsec 互加才有雙向訊息。"
          : " 示範模式：登入後可與機器人「小幫手／阿明」對話（記憶體 relay）。"}
        「從舊裝置匯入（配對）」在網頁不可用（需原生／WebRTC）。
      </p>
    </div>
  );
}

const el = document.getElementById("root");
if (el) createRoot(el).render(<Preview />);
