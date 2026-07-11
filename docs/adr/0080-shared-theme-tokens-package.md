# 0080. 跨前端設計 token 套件 @cinder/theme（桌面與行動端共用主題色 SSOT）

- 狀態：已接受
- 日期：2026-07-11
- 相關文件：ADR-0064（自訂主題色）、ADR-0078（副色）、ADR-0074（前端三層封裝與 @cinder/engine）、ADR-0063（行動端骨架）；`apps/desktop/src/ui/msn.css`、`apps/desktop/src/accent.tsx`

## 背景與問題

行動端（`apps/mobile`）目前把介面色彩**硬編碼**（白底、藍字、狀態點色）於 `StyleSheet.create`，與桌面版近期做的**主色＋副色雙色自訂（ADR-0064/0078）**、深淺主題完全沒有對齊，兩邊各走各的視覺。

要「行動端改吃桌面版主題 token」有兩個障礙：

1. 桌面 token 目前散在兩處——CSS（`msn.css` 的 `:root`／`:root[data-theme="dark"]` 基底色票＋`color-mix` 推導 `--bg-a/b/c`、`--titlebar`）與 TS（`accent.tsx` 的 `lightenHex`/`accentForTheme` 深色提亮）。沒有一份「非框架」的真實來源可讓行動端消費。
2. 行動端用 `react-native-web` 的 `StyleSheet`，**吃不了 CSS 變數與 `color-mix()`**，需要具體色值（`#rrggbb`）。

## 考量的選項

- **選項 A：把主題 token 放進 `@cinder/engine`。** 兩端都已依賴 engine。但 engine 開宗明義「與 UI 無關」（ADR-0074），塞入視覺 token 會破壞其邊界。
- **選項 B：把 token 放進 `@cinder/core`。** core 是協定/加密，同樣不該承載 UI 視覺。
- **選項 C（採用）：新增小型純 TS 套件 `@cinder/theme`。** 框架無關的設計 token SSOT，桌面與行動端共吃；不污染既有套件邊界。
- **選項 D：行動端各自複製一份桌面色值。** 最省事但正是要消除的漂移來源，違反 SSOT。

## 決策

**新增 `packages/theme`（`@cinder/theme`）作為跨前端設計 token 的單一真實來源。**

1. **純函式、無 DOM、框架無關**：匯出 `resolveTheme({ accent, accent2, theme })` → 具體 `ThemeTokens`（`#rrggbb`），以及 `mixSrgb`（重現 CSS `color-mix(in srgb)`）、`lightenHex`、`accentForTheme`、`STATUS_COLORS`、`DARK_LIGHTEN`。
2. **重現桌面推導**：base 色票與 `--bg-a/b/c`、`--titlebar` 的 `color-mix` 權重、深色提亮（0.22）皆以 `msn.css`／`accent.tsx` 為參考，一比一重現；未設主色＝內建預設、設了自訂主色＝深色提亮、副色未設＝跟隨主色（與桌面等價）。
3. **桌面去重、轉引 SSOT**：`accent.tsx` 的 `lightenHex`/`accentForTheme` 改為自 `@cinder/theme` 轉引（`export { … } from`），行為與匯出路徑不變（`accent.test.ts` 與各呼叫端沿用）。桌面的 CSS 端 `--bg-a/b/c`/`--titlebar` 仍由 `msn.css` 於瀏覽器即時 `color-mix`，其值與 `@cinder/theme` 由測試對齊。
4. **行動端消費**：`ContactListScreen` 改吃 `resolveTheme(...)`，`StyleSheet` 依當前 token 動態產生；新增 `theme`／`accent`／`accent2` props（預設 light／null）。狀態點色改用 `STATUS_COLORS`（與桌面 `.dot` 同源）。
5. **對齊把關**：`tokens.test.ts` 以桌面 CSS 的基底色值與數個 `color-mix` 推導結果為錨點——改一邊沒改另一邊即測試紅。

## 理由

- **真 SSOT**：主題色推導只有一份 TS 定義，桌面與行動端共吃；`lightenHex`/`accentForTheme` 不再兩處重複。
- **邊界乾淨**：`@cinder/theme` 專責視覺 token，不動 engine「UI 無關」與 core「協定/加密」的定位。
- **低風險**：桌面 CSS 執行期行為完全不變（僅去重轉引）；行動端才真正接上共用 token。
- **可攜**：`resolveTheme` 產出具體色值，RN StyleSheet 直接可用；桌面未來若要以 JS 注入整組 CSS 變數亦可沿用同一函式。

## 後果

- 正面：行動端與桌面同一套主色/副色/深淺主題；未來新前端（web/RN 原生）接同一 SSOT 即視覺一致。
- 負面 / 已知殘餘風險：
  - 桌面 CSS 的 base 色值與 `@cinder/theme` 仍是「兩份、以測試對齊」而非「CSS 由 TS 生成」；完全單一化（桌面改以 JS 注入全部 token）留待需要時再做（另立 ADR）。
  - `mixSrgb` 只重現 `color-mix(in srgb)` 的預設 sRGB 線性內插；若日後 CSS 改用其他色彩空間需同步。
- 後續行動：行動端其餘畫面（登入/對話/設定）移植時一律吃 `@cinder/theme`；桌面若導入 JS 注入全 token 再評估把 `msn.css` base 值改為衍生。
