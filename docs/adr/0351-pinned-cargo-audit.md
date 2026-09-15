# 0351. CI 的 cargo-audit 改用釘版＋釘雜湊的預編 binary

- 狀態：已接受
- 日期：2026-09-15
- 相關文件：ADR-0235（供應鏈與 CI 硬閘：action 一律釘 commit SHA）、ADR-0348（讓 CI 編譯 `main.rs`）、ADR-0350（排程與狀態）

## 背景與問題

CI 的 `audit` job 這樣跑：

```yaml
run: |
  cargo install cargo-audit --locked
  cargo audit
```

兩個問題：

1. **每次都從原始碼重編**（數分鐘）——整條 CI 最貴的單一步驟，而且每個 PR、每次 push 都付一次。
2. 🔴 **版本沒釘。** `--locked` 鎖的是 cargo-audit **自己的** lockfile，不是它的版本——上游發佈什麼就裝什麼。

第 2 點比第 1 點嚴重：ADR-0235 C5 的立場是「action 一律釘 commit SHA，因為可變 tag 等於在我們的 runner 上執行任意程式碼」。而 `cargo-audit` 是**整個 CI 裡唯一不受那條規則約束的可執行檔**——偏偏它的職責正是供應鏈安全。

## 決策

改用官方預編的 musl 靜態 binary，**版本與 sha256 都釘死**：

```yaml
env:
  CARGO_AUDIT_VERSION: "0.22.2"
  CARGO_AUDIT_SHA256: "7fb9497f8594b389e5fce5ef9b92db08432996895b2e0c5a0167a69ed445c428"
run: |
  set -euo pipefail
  curl -fsSL -o /tmp/cargo-audit.tgz "…/cargo-audit%2Fv${VERSION}/${asset}.tgz"
  echo "${CARGO_AUDIT_SHA256}  /tmp/cargo-audit.tgz" | sha256sum -c -
  tar xzf … && install -m 0755 "…/cargo-audit" "$HOME/.cargo/bin/cargo-audit"
  cargo audit
```

- 落點刻意選 `$HOME/.cargo/bin`——與原本 `cargo install` 的落點一致，所以 `cargo audit` 的呼叫方式一個字都不用改。
- 標籤是 `cargo-audit/v<版本>`，URL 路徑中的 `/` 必須編碼成 `%2F`。
- 升級＝改那兩行，**版本與雜湊必須同時改**；對不上即中止。

**雜湊是實際下載後算出來的，不是抄的。** 下載了兩次、兩次雜湊一致、解開後執行 `cargo-audit --version` 確認是 0.22.2，並在本機完整跑過整個步驟（含故意用錯雜湊 ⇒ 確認 `sha256sum -c` 讓步驟以離開碼 1 中止）。

## 順帶發現：這個 job 本來就要變紅了

用釘版 binary 實跑時，`cargo audit` 回報 **1 個 vulnerability**：

> **RUSTSEC-2026-0285** — `rustls` 0.23.41：TLS 1.3 handshake messages incorrectly accepted across encryption level boundaries（5.3 medium，需 ≥ 0.23.45）

Advisory 日期是 **2026-09-14**，也就是這個決策的前一天——所以它還沒被任何一次 CI 執行看到。

已一併修正：`cargo update -p rustls --precise 0.23.45`（連帶 `rustls-webpki` 0.103.13 → 0.103.15）。修完 `cargo audit` 離開碼 0，`cargo check --features tauri-app` 與 `cargo test` 均通過。

⚠ `rustls` 進到相依樹是經由 `reqwest`（本機 Ollama 的 HTTP 客戶端，ADR-0060，**只在 `tauri-app` feature 下編譯**）。實際暴露面是「連本機 Ollama 的 TLS」，不是使用者訊息——訊息走 Nostr relay 的 WebSocket，不經這條路。但這仍是出貨二進位裡的程式碼，該修。

## 理由

- **一致性。** 這是 CI 裡最後一個沒被釘死的可執行檔，而它的職責偏偏是供應鏈安全。
- **快取無法替代。** 用 cache 保存編好的 binary 也能省時間，但**不解決版本沒釘**；而釘死同時解決兩者。

## 後果

- 正面：`audit` job 少掉數分鐘的編譯；cargo-audit 本身從「上游發什麼裝什麼」變成釘死。順帶修掉一個尚未被 CI 看見的真實 advisory。
- 負面／已知殘餘風險：
  - 🔴 **workflow 沒有在 GitHub 上跑過。** 我在本機跑過與 workflow **逐字相同**的 shell 序列（下載→驗雜湊→解開→install→`cargo audit`），兩條路徑都驗過；但 runner 上的 `$HOME/.cargo/bin` 是否存在且在 PATH 上、是否有寫入權限，只能實跑確認。若不成立，改 `sudo install` 到 `/usr/local/bin` 即可。
  - **釘死的版本會過期，而且沒有自動提醒。** 影響比想像小——advisory DB 是執行期抓的，所以舊 binary 仍會看到新 advisory；過期的只有工具本身的邏輯。但仍需要人定期升。
  - **只釘 x86_64-linux-musl。** 換 runner 架構（arm64）就會抓不到這個資產。
  - **雜湊是我在這個環境下抓到的。** 兩次下載一致、binary 可執行且自報 0.22.2——但那不等於上游沒有在發佈時就被動手腳。這個作法把信任從「每次都信 crates.io 最新版」收斂成「信任這一次抓到的這個檔案」，是改善，不是根除。
  - **`rustls` 的更新沒有實機驗證**：`cargo check`／`cargo test` 通過，但 Ollama 的 HTTPS 連線沒有實際跑過。
- 後續行動／待辦：
  1. 首次 CI 執行後確認 `audit` job 綠、且時間確實縮短。
  2. 定期（或在 advisory 觸發時）升 `CARGO_AUDIT_VERSION`＋雜湊。
  3. 其餘 8 則 `warning`（unmaintained／unsound／yanked）目前不擋 CI，值得另案盤點——尤其 `glib` 與 `event-listener` 來自 Tauri 的相依樹。
