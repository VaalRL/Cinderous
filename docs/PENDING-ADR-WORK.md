# 待完成 ADR 與內容

> 本清單源自先前 session 的幻覺校正（詳見 git 歷史）。**2026-07-22 本清單全部完成並清零**。

## 完成記錄（2026-07-22）

先前 session 留下的五項待辦已全部落地（每項一 commit、commit 後皆以 `git log`＋`git cat-file` 驗證）：

1. **修復 main**（`9a31d9e`）：發現前一 session 提交的 ADR-0231 P1 不完整——`url-hygiene.ts` 缺 `known-malicious` 型別與 `assessUrl` matcher 參數、`markdown.tsx` 引用不存在的 i18n 鍵、`Messages` 型別缺 `settings_update*`，main typecheck 是紅的。已補完並全綠。
2. **ADR-0231 文件**（`6f8a2b1`）：`docs/adr/0231-url-threat-intel-mask.md`＋README 索引。
3. **ADR-0228 P3**（`fb697aa`）：`update-check.ts`（shouldCheck／fetchLatest／opt-in／狀態，9 測試）＋App 開機查詢＋SettingsPanel 關於區徽章與開關（CSP 為 null 不需放行）。
4. **ADR-0229**（`90b68d0`）：官網 hero SVG icon 按鈕列（分平台下載、disabled tooltip「即將推出」、手機可見標籤）＋doc＋9 測試。
5. **ADR-0230**（`faf589f`）：官網手機可用性（觸控 44px／clamp 字級／overflow-x:clip）＋doc。
6. **ADR-0231 P2**（`d5faf0b`）：`scripts/threat-snapshot.mjs`＋`docs/threat-intel.json`（20,525 網域）＋`threat-intel.yml` 每日排程＋官網 dist 複製＋desktop `threat-db.ts` 拉取快取。
7. **ADR-0231 P3**（`f932ff4`）：`ThreatProvider`＋markdown 遮罩（來源標示、一般可展開/嚴格不可展開）＋送出端警示/阻止＋設定四項＋i18n。
8. **ADR-0231 P4**（`c7177c8`）：官網技術原理頁威脅防護介紹卡。

ADR-0228／0231 已轉「已接受」，`ARCHITECTURE.md` 已同步。最終測試：desktop 513／core 411／website 10／mobile 197 全綠、全 repo typecheck 綠。

## 後續（非阻塞）

- ADR-0231 snapshot 首次 CI 排程跑完後，確認 abuse.ch 主 feed 在 Actions 可達（本地被擋、已有 GitHub 鏡像 fallback）。
- macOS／行動版推出時，官網 hero disabled 鈕轉可用（ADR-0229 後果節）。
- 經典 UI 驗收與 v0.0.13 發版仍 hold（見 memory）。

## 工作守則（此環境，保留備查）

1. 只信**最簡單的單一命令**輸出；複雜鏈的成功訊息不可信。
2. 寫檔後以 `ls -la`＋`rg -c` 驗證；Edit 後以 `rg -n` 驗證。
3. 每次 commit 後：`git log --oneline -1` 確認 HEAD 前進＋`git cat-file -e HEAD:<檔>` 確認檔案進了 commit。
4. 直接在 main commit；push 用 fetch＋merge（勿 pull --rebase）。
5. 一次一個原子步驟。
