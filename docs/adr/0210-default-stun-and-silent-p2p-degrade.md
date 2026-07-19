# 0210. 一般模式加預設 STUN（跨網路 P2P）＋靜音 P2P 失敗警告

- 狀態：已接受
- 日期：2026-07-19
- 相關文件：`packages/engine/src/backend/rtc-config.ts`、`packages/engine/src/backend/webrtc.ts`、`apps/desktop/public/_headers`、`apps/desktop/Caddyfile`、ADR-0048/0051（企業強制 TURN）、ADR-0208（web app CSP）

## 背景與問題

回報：瀏覽器版互通、跨網路的新好友初次對話時，接收方跳「⚠️ P2P 連線失敗」（但**文字訊息照常送達**）。查根因：

1. **一般模式沒有預設 STUN**。`buildRtcConfig(false, undefined)` 原本回 `undefined` → `RTCPeerConnection` 無任何 ICE 伺服器 → 只蒐集得到 host（內網）候選 → **兩人不同網路時找不到彼此公網位址、P2P 必然失敗**（僅同區網可連）。此 rtc-config 原本只為企業 `forceTurn`（relay-only）而寫，一般使用者的 STUN 是缺口。
2. **失敗被當成使用者可見錯誤**。P2P 只是**盡力而為的加值通道**（檔案／在線／輸入中）；文字訊息走 relay（Gift Wrap），與 P2P 無關。跨網路／對稱型 NAT 失敗屬預期，卻對使用者顯示成 ⚠️＝誤導。

## 決策

1. **一般模式帶預設 STUN**（`rtc-config.ts`）：`DEFAULT_STUN = [{ urls: "stun:stun.cloudflare.com:3478" }]`（Cloudflare 公共 STUN，與既有 CF 依賴一致、少一個第三方）。`buildRtcConfig` 於**非 forceTurn** 時回 `{ iceServers: [...DEFAULT_STUN, ...任何已配置 TURN] }`。**企業 `forceTurn` 刻意不加**——維持 relay-only、不揭露 host/srflx IP（ADR-0048/0051 不變）。
2. **靜音失敗**（`webrtc.ts`）：`connectionState === "failed"` 不再呼叫 `onError`，改 `console.debug` 記錄降級。訊息不受影響（走 relay），不再嚇使用者。
3. **瀏覽器 CSP 放行 STUN**：`_headers`（CF Pages/Worker）與 `Caddyfile`（Zeabur）的 `connect-src` 加 `stun.cloudflare.com:3478`——否則瀏覽器版即使配了 STUN 仍被 CSP 擋（桌面 `csp:null` 不受此限）。

## 理由

- 加 STUN＝跨網路 P2P 對多數家用 NAT 可用（檔案/在線/輸入中能用）；對稱型 NAT 仍需 TURN（另有成本，未預設）。
- 靜音＝P2P 是加值、非必要；其失敗不該以錯誤打擾使用者（訊息本就走 relay）。
- CSP 同步放行＝瀏覽器版才吃得到 STUN。

## 後果

- 正面：跨網路即時功能多數可用；不再有誤導的 ⚠️。桌面與瀏覽器一致（引擎層改動）。
- 負面 / 已知取捨（隱私）：**P2P 本質會把你的公網 IP 揭露給對方與 STUN 伺服器**——這是點對點的固有代價。要完全不外洩 IP 者用企業 `forceTurn`（relay-only）或不啟用 P2P。此決策＝一般模式以少量 IP 曝露換即時功能可用（使用者已選定此方向）。
- 已知殘餘：CSP 對 STUN 的 host-source 比對依瀏覽器實作；若某瀏覽器仍擋，需再放寬 `connect-src`。需重建/重部署（瀏覽器版隨 push 自動重建；桌面版下次發版）方全面生效。
