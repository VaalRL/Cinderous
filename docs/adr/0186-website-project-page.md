# 0186. 官網改採 GitHub 專案頁（/Cinder/）

- 狀態：已接受
- 日期：2026-07-17
- 相關文件：ADR-0185（官網以 GitHub Pages 部署）；本 ADR 修訂 0185 的「部署位置」選擇（root→project page），0185 的 Actions 部署機制不變

## 背景與問題

ADR-0185 評估官網部署位置時，先選了「選項 A：根站（user/org page 或自訂網域）」，理由是網站程式碼零改動。但根站需把主 repo 命名為 `<user>.github.io`——會占用帳號**唯一**的 user-page 名額、且更動主 repo 名會改變所有 clone/remote URL。

釐清後確認：**專案頁是「每個 repo 一個」**（`https://<user>.github.io/<repo>/`），不占用那個唯一名額、也不必改 repo 名。使用者據此選擇「在 `Cinder` 專案下自己開，不要在根」。

改走專案頁的唯一代價是網站需能在子路徑 `/Cinder/` 下運作。實測掃描 `apps/website` 的絕對路徑，只有一處執行期字串會壞：`Transparency.tsx` 的 `fetch("/funds.json")`（Vite 不改寫執行期字串）。其餘皆安全——`index.html` 的 `src="/src/main.tsx"` 由 Vite build 依 `base` 自動改寫；SVG 的 `url(#id)` 是內部 fragment 參照非路徑；各 `href` 為外部絕對 URL；導覽是 client-side `useState<View>`（無 URL 路由）。

## 考量的選項

- **選項 A（維持根站）**：需改 repo 名為 `<user>.github.io`，占用唯一 user-page 名額。已被使用者否決。
- **選項 B（專案頁 `/Cinder/`）**：`vite.config` 設 `base: "/Cinder/"`；`funds.json` 的 fetch 改 base-aware。保留 `Cinder` 名、不占唯一名額。**採用**。

## 決策

採**專案頁 `https://<user>.github.io/Cinder/`**：

1. `apps/website/vite.config.ts` 設 `base: "/Cinder/"`（asset 與 index.html 引用自動帶前綴）。
2. `Transparency.tsx` 改 `fetch(\`${import.meta.env.BASE_URL}funds.json\`)`——`BASE_URL` 帶尾斜線，專案頁下＝`/Cinder/funds.json`，根站下＝`/funds.json`，**兩種部署皆正確**（改法一勞永逸）。
3. `pages.yml` 註解同步為專案頁說明；部署機制（Actions build→upload→deploy）不變。

## 理由

- 專案頁不占用帳號唯一的 user-page 名額、不必改主 repo 名（clone/remote/CI/Releases 位置全不動），符合使用者「在專案下開、不要在根」的取捨。
- base-aware fetch 讓根站/專案頁/自訂網域三種部署共用同一份程式碼——日後若改掛自訂網域，只需把 `base` 改回 `/`，fetch 無需再動。
- 破壞面極小：全站僅一處執行期絕對路徑需改，已修並經 build（asset 前綴 `/Cinder/`）＋測試（6/6）驗證。

## 後果

- 正面：保留 `Cinder` repo 名與唯一 user-page 名額；一份程式碼支援三種部署位置；破壞面經實測收斂到單點。
- 負面 / 已知殘餘風險：
  - `base` 釘死 `/Cinder/`；若 repo 更名，`base` 需同步（已於 vite.config 與 workflow 註解標明）。
  - `funds.json` 仍為開發佔位簽章，透明度頁 fail-closed（沿用 0185，未變）。
- 後續行動 / 待辦：
  - GitHub 端一次性：Settings → Pages → Source = "GitHub Actions"（沿用 0185）。
  - 日後若改掛自訂網域，把 `base` 改回 `/`。
