# 0193. 對外說明文件提供中英雙語（.en.md ＋ 語言切換）

- 狀態：已接受
- 日期：2026-07-18
- 相關文件：ADR-0090（雙語文案）、ADR-0191（更名）、各對外 docs

## 背景與問題

官網文字已可中英切換（`copy.ts`），但 repo 內的**對外說明文件**（README、自架/節點/使用者手冊等）先前**只有繁體中文**，英語使用者無法閱讀。需讓所有對外文件都有中英版本。

## 決策

- **每份對外文件 `X.md` 增加英文版 `X.en.md`**；兩份頂端各加一行語言切換：
  - 中文版：`> 🌐 **English** · [English version](./X.en.md)`
  - 英文版：`> 🌐 **繁體中文** · [繁體中文版本](./X.md)`
- **英文版之間的互連**指向對方的 `.en.md`（英語讀者停留在英文）；指向**未翻譯**文件者維持指向中文。
- **納入雙語的對外文件（10 份）**：`README.md`、`.github/CONTRIBUTING.md`、`docs/SECURITY.md`、`docs/SELF-HOSTING.md`、`docs/NODE-SUBMISSION.md`、`docs/MAINTAINER-ACTIVATION.md`、`docs/self-hosting-web-app.md`、`docs/self-hosting-zeabur.md`、`docs/self-hosting-raspberry-pi.md`、`docs/使用手冊_User-Guide.md`（英文版檔名正規化為 `docs/User-Guide.en.md`）。
- **維持單一中文（內部，非對外說明）**：`PRD.md`、`ARCHITECTURE.md`、`docs/adr/*`、`docs/ROADMAP.md`、`docs/OPERATOR-TODO.md`、`docs/relay-metadata-observability.md`、`docs/research/*`、`docs/前端開發指南_Frontend-Guide.md`、`CLAUDE.md`/`AGENTS.md`/`gemini.md`/`claude/*`。

翻譯保留程式碼區塊、指令、路徑、識別字、NIP/ADR 編號、表格與連結；術語統一（relay／node／anchor／ciphertext／self-host…）。

## 理由

- 對外＝使用者／營運者／貢獻者會讀的文件，需英文；內部規劃/決策/開發文件（SSOT、ADR、roadmap、dev guide）讀者為專案內部，維持中文降低維護負擔。
- `.en.md` 同目錄並存＋雙向 header 是 GitHub 常見、零工具的雙語做法。

## 後果

- 正面：對外文件全數雙語、可互相切換；英文互連讓英語讀者不被彈回中文。
- 負面 / 已知殘餘風險：**維護需同步兩種語言**——更新中文文件時應一併更新對應 `.en.md`（或標注英文版可能落後）。ADR/內部文件刻意不雙語。
- 後續：新增對外文件時比照建立 `.en.md` ＋切換 header。
