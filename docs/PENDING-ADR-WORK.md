# 待完成 ADR 與內容（session 幻覺校正後的真實工作清單）

> 背景：本 session 後段工具輸出多次不可靠（Write 靜默 drop、Read 回假內容、複雜 Bash 幻覺成功）。
> 以下為用可信命令（git log / ls / rg）核實後的真實狀態與待辦。往後每個 commit 後以
> `git log --oneline -1` 確認 HEAD 真的前進，並用 `git cat-file -e HEAD:<檔>` 驗證檔案進了 commit。

## 真實狀態（2026-07-22）
- **main HEAD = `08cbabe`（ADR-0228 P2）**。
- 真的在 main：到 ADR-0228 P2（含 0224/0225/0226＋審查修正、**0227 全部 P1–P4**、**0228 P1＋P2**）。
- ADR-0227 P4 已在 main：`apps/desktop/src/version.ts`、`releases.ts`、SettingsPanel「關於」分頁、`docs/releases.json` 皆存在。
- ADR-0228 P1 已在 main：`packages/core/src/version-check.ts`（compareVersion / newerRelease）存在。

## working tree 目前未提交的「真實」變更（測試綠，勿丟失）
- `packages/core/src/threat-intel.ts`(+`.test.ts`) — ADR-0231 P1 core（8 測試綠）
- `apps/desktop/src/ui/url-hygiene.ts`(+`.test.ts`) — ADR-0231 P1：assessUrl 延伸（26 測試綠）
- `packages/core/src/index.ts` — barrel 加 `export * from "./threat-intel.js"`
- `packages/i18n/src/messages.ts` — ADR-0228 P3 的 i18n `settings_update*`（zh/en）
- `docs/adr/0231-url-threat-intel-mask.md` — ADR-0231 文件（已 heredoc 寫回，2626 bytes）

---

## 待完成（依序）

### 1) ADR-0228 P3 — 更新偵測提醒 UI（未落地；P1/P2 已在 main）
決策：僅偵測+提醒、查官網 `releases.json`、比對 `APP_VERSION`、關於區「可更新 vX.Y.Z」徽章+前往下載、opt-in 可關、每日節流、失敗靜默、純本地不送 URL。
待做：
- `apps/desktop/src/update-check.ts`：`UPDATE_ENDPOINT`=https://vaalrl.github.io/Cinderous/releases.json、`GITHUB_RELEASES`、`shouldCheck`(每日節流純函式)、`fetchLatest`(fetch 注入→core `newerRelease`、失敗靜默 null)、`updateCheckEnabled`/`setUpdateCheckEnabled`(getKv opt-in)、`load/saveUpdateState`。
- `App.tsx`：開機查詢(opt-in+節流+失敗靜默)、state `updateAvailable`/`updateCheckOn`、`toggleUpdateCheck`、傳 SettingsPanel。
- `SettingsPanel.tsx` AboutSettings：加 `updateAvailable` 徽章+前往下載(GITHUB_RELEASES `<a target=_blank>`)+opt-in 開關(prop `onToggleUpdateCheck`)。
- i18n `settings_updateAvailable/Download/Check/CheckHint`（zh/en）— **messages 已在 working tree**。
- 測試：update-check(shouldCheck/fetchLatest) + SettingsPanel about 徽章。

### 2) ADR-0229 — 官網 hero icon 按鈕（doc＋實作都缺）
決策（已定案）：
- hero 文字按鈕 → **SVG 品牌 icon 按鈕列**（Windows/Apple/手機/地球/GitHub、currentColor 隨主題）。
- 下載**區分平台**：🪟 Windows 可用(連 releases)、macOS **disabled**、行動版 **disabled**。
- **自訂 CSS tooltip**（hover 顯示）；「看技術原理」**保留文字連結**。
- disabled 灰階+`aria-disabled`+tooltip「即將推出」。
- **手機≤640px：icon+可見標籤**（觸控無 hover）。
- i18n zh/en、`aria-label`、鍵盤可聚焦；nav 右上下載鈕不動。
待做：`docs/adr/0229-website-hero-icon-actions.md` + `apps/website/src/icons.tsx` + `pages/Home.tsx` hero + `styles.css`(iconbtn/tooltip/disabled/手機標籤) + `copy.ts` i18n。

### 3) ADR-0230 — 官網手機可用性（doc＋實作都缺）
決策：觸控目標 ≥44px(nav link/toggle/cta min-height)、hero h1 用 `clamp(36px,9vw,64px)`、`html,body{overflow-x:clip}`+長字串 `overflow-wrap`、nav 維持 flex-wrap(不做漢堡)；與 0229 協同(icon 手機標籤+觸控≥44)。
待做：`docs/adr/0230-website-mobile-usability.md` + `styles.css` RWD 強化。

### 4) ADR-0231 — 威脅情報遮罩（doc 已寫、P1 已做；P2–P4 待做）
決策：見 `docs/adr/0231-url-threat-intel-mask.md`（開源 CC0/MIT 來源、渲染遮罩顯示來源可展開、自訂清單、啟用開關、送出端警示可控、嚴格/企業模式不可展開+送出阻止、P4 官網介紹、純本地不送 URL）。
- **P1**（core threat-intel + url-hygiene assessUrl 延伸）：**working tree 已有，待提交**。
- **P2**：選定來源(URLhaus CC0 + StevenBlack MIT)→build snapshot→官網部署+定期更新(複用 ADR-0228)。
- **P3**：desktop 遮罩 UI(遮住+來源+一般可展開/嚴格不可展開)+送出端警示+嚴格模式+設定(啟用/送出警示/嚴格/自訂清單 四項)+i18n。
- **P4**：官網介紹(主打「純本地、不送 URL」、可自訂可關)。

---

## 教訓 / 工作守則（避免再度幻覺）
1. 只信**最簡單的單一命令**輸出（`git log --oneline -N`、`ls -la`、`rg -c`）；複雜 `&&`/for/heredoc 鏈的成功訊息不可信。
2. 新檔一律用 **bash heredoc** 寫，寫完 `ls -la` + `rg -c` 驗證位元組與關鍵字。
3. 既有檔用 Edit 後，用 **`rg -n`** 驗證改動真的在檔案裡（Read 可能回假內容）。
4. 每次 commit 後：`git log --oneline -1` 確認 HEAD 前進 + `git cat-file -e HEAD:<檔>` 確認檔案進了 commit。
5. 一次一個原子步驟，別把「驗證+commit+push」塞進同一條長命令。
