// 行動端 web preview（ADR-0085）：以 react-native-web 在瀏覽器實跑 MobileApp。
// 用手機外框包住 app，並提供 深/淺主題、繁中/英、主色 的即時切換，以及一組可複製的示範 nsec
// （貼到登入畫面即可用示範後端與機器人對話）。純開發預覽，不影響 app 本身。
import { type CSSProperties, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { generateSecretKey, nsecEncode } from "@cinder/core";
import type { Locale } from "@cinder/i18n";
import type { Theme } from "@cinder/theme";
import { DEFAULT_RELAY } from "./backend.js";
import { MobileApp } from "./MobileApp.js";

const ACCENTS = [
  { name: "預設藍", hex: null as string | null },
  { name: "森綠", hex: "#2f9e44" },
  { name: "葡萄紫", hex: "#7c4dff" },
  { name: "櫻桃", hex: "#e5498f" },
  { name: "琥珀", hex: "#e2632b" },
];

function Preview(): JSX.Element {
  const [theme, setTheme] = useState<Theme>("light");
  const [locale, setLocale] = useState<Locale>("zh-Hant");
  const [accentIdx, setAccentIdx] = useState(0);
  const [useRelay, setUseRelay] = useState(false);
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY);
  // 一組有效的示範 nsec（每次載入頁面固定）：貼到「用私鑰登入」即可進入示範對話。
  const demoNsec = useMemo(() => nsecEncode(generateSecretKey()), []);
  const accent = ACCENTS[accentIdx]!.hex;

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

      {/* 控制列 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "center" }}>
        <button type="button" style={btn(!dark)} onClick={() => setTheme("light")}>淺色</button>
        <button type="button" style={btn(dark)} onClick={() => setTheme("dark")}>深色</button>
        <span style={{ width: 8 }} />
        <button type="button" style={btn(locale === "zh-Hant")} onClick={() => setLocale("zh-Hant")}>繁中</button>
        <button type="button" style={btn(locale === "en")} onClick={() => setLocale("en")}>EN</button>
        <span style={{ width: 8 }} />
        {ACCENTS.map((a, i) => (
          <button key={a.name} type="button" style={btn(i === accentIdx)} onClick={() => setAccentIdx(i)}>
            {a.name}
          </button>
        ))}
        <span style={{ width: 8 }} />
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

      {/* 示範 nsec */}
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
        <button
          type="button"
          style={btn(false)}
          onClick={() => {
            void navigator.clipboard?.writeText(demoNsec);
          }}
        >
          複製
        </button>
      </div>

      {/* 手機外框 */}
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
          theme={theme}
          locale={locale}
          accent={accent}
          relayUrl={useRelay ? relayUrl.trim() : null}
        />
      </div>

      <p style={{ fontSize: 12, color: muted, maxWidth: 520, textAlign: "center" }}>
        {useRelay
          ? "真實 relay 模式：登入後按右上「＋」貼好友 npub 加入即可對話；把「你的 npub」分享給對方（或開兩個分頁、各自不同 nsec 互加）才有雙向訊息。"
          : "示範模式：登入後可與機器人「小幫手／阿明」對話（記憶體 relay，不連真實網路）。"}
        「從舊裝置匯入（配對）」在網頁環境不可用（需原生／WebRTC）。
      </p>
    </div>
  );
}

const el = document.getElementById("root");
if (el) createRoot(el).render(<Preview />);
