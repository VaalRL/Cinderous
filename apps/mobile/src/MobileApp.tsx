// 行動端外殼（ADR-0332 階段 2b）。
//
// 這裡**只放比一個 session 活得久的東西**：
//
//   - `profiles`：身分登錄（ADR-0138）。切身分時它必須存活，否則切完就找不到要切去哪。
//   - `theme`／`locale`／`accent`／`videoQuality`：**這台裝置**的偏好（ADR-0294 §2 的分類），切身分不重設。
//
// 其餘（一個身分的全部 session state、後端生命週期、所有畫面）都在 `AppSession.tsx`。
//
// ⚠ 現在還沒有 `key`：階段 2b 只做搬家與控制流反轉；`key={pubkey}` 是 2c（ADR-0332 §1）。
import { useState } from "react";
import type { Locale } from "@cinderous/i18n";
import type { Theme } from "@cinderous/theme";
import type { VideoQuality } from "@cinderous/core";
import { type ProfilesState } from "@cinderous/engine";
import { type ActiveSession, AppSession, type SessionOpts } from "./AppSession.js";
import type { MobileIdentity } from "./auth.js";
import {
  readAccent,
  readLocale,
  readTheme,
  readVideoQuality,
  saveAccent,
  saveLocale,
  saveTheme,
  saveVideoQuality,
} from "./device-prefs.js";
import { loadIdentities } from "./identities.js";

export function MobileApp({
  relayUrl = null,
  initialTheme = "light",
  initialLocale = "zh-Hant",
  initialAccent = null,
}: {
  /** 真實中繼站網址（wss://…）；null＝示範後端（ADR-0086）。 */
  relayUrl?: string | null;
  initialTheme?: Theme;
  initialLocale?: Locale;
  initialAccent?: string | null;
}): JSX.Element {
  const [profiles, setProfiles] = useState<ProfilesState>(() => loadIdentities(relayUrl ?? ""));
  // ADR-0333：外觀偏好**跨重啟記住**（桌面一直有，行動端原本三個都沒有）。
  // 傳進來的 `initial*` 降為「沒存過時的預設」——ADR-0248 的「初次登入一律明亮」仍成立。
  const [theme, setThemeState] = useState<Theme>(() => readTheme(initialTheme));
  const [locale, setLocaleState] = useState<Locale>(() => readLocale(initialLocale));
  const [accent, setAccentState] = useState<string | null>(() => readAccent(initialAccent));
  const setTheme = (t: Theme): void => {
    setThemeState(t);
    saveTheme(t);
  };
  const setLocale = (l: Locale): void => {
    setLocaleState(l);
    saveLocale(l);
  };
  const setAccent = (a: string | null): void => {
    setAccentState(a);
    saveAccent(a);
  };
  // 視訊畫質（ADR-0337）：裝置層——這是「這台的相機與網路」，與主題同類。
  // 由外殼往下傳，因為 CallScreen 與後端（setVideoQuality）都在 session 內。
  const [videoQuality, setVideoQualityState] = useState<VideoQuality>(() => readVideoQuality());
  const setVideoQuality = (q: VideoQuality): void => {
    setVideoQualityState(q);
    saveVideoQuality(q);
  };
  /**
   * 作用中的 session（ADR-0332 2b）。
   *
   * `gen` 讓**同一個身分重新登入**也算新的一次 session——2c 會把 `key` 綁在它身上，
   * 屆時「登出再登入自己」與「切到別人」一樣都會重掛，不必再靠手寫的重設清單。
   */
  const [active, setActive] = useState<{ session: ActiveSession; gen: number } | null>(null);
  const enter = (identity: MobileIdentity, opts: SessionOpts = {}): void =>
    setActive((prev) => ({ session: { identity, opts }, gen: (prev?.gen ?? 0) + 1 }));

  return (
    <AppSession
      /**
       * 🔴 **Phase P4 的結構性保證就是這一行**（ADR-0332 2c）。
       *
       * 換身分（`pubkey` 變）或重新登入同一個身分（`gen` 變）都會讓 `AppSession` **重掛**
       * ⇒ 裡面的 7 個功能簇一律回到初值。這不是「記得呼叫重設」，是 React 的掛載語意——
       * ADR-0294 §2 抓到的三個漏網（`archived`／`purged`／`calDraft`）從此**不可能**再發生。
       *
       * ⚠ 未登入時 key 固定為 `none`：登入畫面不該因為打字就重掛。
       */
      key={active ? `${active.session.identity.pubkey}:${active.gen}` : "none"}
      relayUrl={relayUrl}
      profiles={profiles}
      onProfiles={setProfiles}
      theme={theme}
      onTheme={setTheme}
      locale={locale}
      onLocale={setLocale}
      accent={accent}
      onAccent={setAccent}
      videoQuality={videoQuality}
      onVideoQuality={setVideoQuality}
      active={active?.session ?? null}
      onEnter={enter}
      onLeave={() => setActive(null)}
    />
  );
}
