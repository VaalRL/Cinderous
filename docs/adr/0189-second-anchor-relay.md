# 0189. 第二座錨點 relay＋簽章池收錄

- 狀態：已接受
- 日期：2026-07-18
- 相關文件：ADR-0039（混合式引導路由／錨點）、ADR-0092（分級收錄）、ADR-0188（維護者信任根啟用）

## 背景與問題

ADR-0039 建議 2–3 座錨點以抵銷單點故障，但先前只有一座生產站（`cinder-relay.whoami885.workers.dev`）。已部署第二座 Cloudflare Worker relay 並收錄進簽章池。

部署要點：
- 放在**另一個 Cloudflare 帳號**（而非既有帳號），以隔離帳號層故障、且不重用既有 `whoami885` 子網域。
- 新帳號預設 workers.dev 子網域是由帳號 email 推導（會直接洩露擁有者信箱），**已手動改成中性子網域**後才對外，最終網址 `wss://cinder-relay.jt0856.workers.dev`。

## 決策

1. `packages/engine/src/bootstrap-config.ts` 的 `ANCHOR_RELAYS` 加入 `wss://cinder-relay.jt0856.workers.dev` → 硬編錨點達 2 座（恆連保底＋登入自動選座來源）。
2. `relay/bootstrap/relays.json` 收錄兩座 URL 為候選（whoami885＋jt0856）；每小時 `relay-health.yml` 探測 → `evaluateAdmission` 定 `accepting`/`weight` →（`MAINTAINER_NSEC` 設定後）簽章並帶內發佈。

## 理由

- 兩座錨點滿足 ADR-0039 的最低韌性門檻；分級收錄讓品質由機器持續維護。
- 第二座放**獨立帳號**：隔離帳號層故障，且不擴大既有 `whoami885` 曝光。
- 子網域刻意改為**中性名**：預設 email 推導子網域會洩露擁有者身分，改名後對「不知情者」近乎不透明。

## 後果

- 正面：錨點 ≥2；簽章池有兩名成員；登入自動選座有備援。
- 負面 / 已知殘餘風險：
  - **兩座皆 Cloudflare**：CF 全域性故障仍會同時影響兩座。更徹底的第三座宜換**平台**（repo 已支援 Docker `node-relay` 自架於 VPS/Zeabur/RPi）。
  - 中性子網域 `jt0856` **降低但未完全消除**與擁有者的關聯（仍呼應 email 數字）；經擁有者判斷可接受。若要完全不可關聯，改純隨機子網域或綁自訂網域＋關 workers.dev。
  - 生效條件：`ANCHOR_RELAYS` 為**編譯期常數**，需**重建並重新部署**客戶端；簽章發佈需先設 `MAINTAINER_NSEC` secret（ADR-0188）。
  - uptime 累積前（<12 次探測），兩座依 ADR-0092 判為**試用**（`accepting:false`，不自動分配新戶），屬預期。
- 後續行動 / 待辦：
  1. 設 GitHub secret `MAINTAINER_NSEC`（啟用簽章）。
  2. 重建並重新部署桌面/行動/CLI（吃到新 `ANCHOR_RELAYS`）。
  3. 手動觸發 `relay-health.yml` 驗證探測＋簽章＋帶內發佈。
  4. 日後考慮換平台的第三座錨點。
