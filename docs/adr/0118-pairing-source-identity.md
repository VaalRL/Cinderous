# 0118. 配對搬家的捆包一定要有身分——並補上行動端的送出端

- 狀態：已接受（已實作）
- 日期：2026-07-14
- 相關文件：**ADR-0072（配對搬家 D4a）**、0053（OS 金鑰庫）、0063（行動端原生能力）、
  0101（行動端通話／WebRTC）、0112（nsec 不得明文落盤）、0117（行動端記住我）

## 背景與問題

要補行動端的「配對搬家送出端」（目前只能匯入，換手機時沒路走）。研究時先查
`buildPairBundle()` 怎麼組包——結果**先撞到一個既有的 bug**。

### 🔴 `nsecOverride` 環境下，配對捆包**沒有身分**

```ts
export function exportFullSnapshot(storage: AppStorage): StorageSnapshot {
  return { identity: storage.loadIdentity(), … };   // ← 從 AppStorage 讀私鑰
}
```

但 **ADR-0053 之後，私鑰根本不在 `AppStorage` 裡**：

| 環境 | nsec 存哪 | `storage.loadIdentity()` |
|---|---|---|
| **桌面 Tauri** | OS 金鑰庫 | **`null`** |
| **行動端** | 不持久化（ADR-0112） | **`null`** |
| 瀏覽器 | Argon2id 包裹的 blob（ADR-0112） | `{ nsec: "", … }` |

引擎的 `RelayChatBackend` 在 `nsecOverride` 分支**刻意不呼叫** `storage.saveIdentity()`
（正確——私鑰不該落 localStorage）。

**於是 `buildPairBundle()` 產出 `identity: null` 的捆包。** 實測確認：

```
IDENTITY: null
HAS_NSEC: false
```

**桌面的換機搬家（ADR-0072 的招牌功能）一直是壞的。** 而且失敗模式很惡劣：

- 舊機顯示「配對成功、傳送中、完成」
- 新機**在最後**才拋出「配對捆包缺少身分」

**使用者已經比對完 SAS、以為搬家成功了，才發現搬了個空殼。**

## 決策

### 1. `buildPairBundle()` 接受**顯式的 identity**，且**沒有 nsec 就當場拋錯**

```ts
export function buildPairBundle(storage, profile, identity?): string {
  const snapshot = exportFullSnapshot(storage, identity);
  if (!snapshot.identity?.nsec) throw new Error("配對捆包缺少身分（nsec）…");
  …
}
```

**失敗要發生在源頭**，而不是在使用者已經比對完 SAS、以為搬家成功之後。

### 2. `runPairSource()` **先組包、再連線**

```ts
const bundle = buildPairBundle(opts.storage, opts.profile, opts.identity);  // ← 先
const transport = await opts.transport("source", opts.key, opts.profile.relayUrl);
```

沒有身分就當場失敗，連載荷都不該產生。

### 3. 呼叫端必須傳 identity（nsec 由金鑰庫／記憶體提供）

- **桌面**：`identity: { nsec: backend.selfNsec, name: p.name }`（`ChatBackend.selfNsec` 早就有）
- **行動端**：同上。

### 4. 行動端補上送出端 UI

流程與桌面同一套：產生一次性載荷 → 新機貼上 → 雙方顯示 **SAS** →
**使用者比對相符才確認** → 送出全量捆包。

**SAS 是這個流程的安全核心**：沒有它，中間人可以冒充新機把你的整包資料（**含 nsec**）騙走。
所以：

- 「確認」必須是**使用者的明確動作**，不能自動通過。
- **SAS 階段不提供「重新開始」**——避免誤觸繞過驗證。
- 警告文案必須明講「不相符代表有人在中間」。

已有測試釘住。

### 5. 順手：行動端的配對**匯入**也接上真的 WebRTC

```ts
onPair={() => Promise.reject(new Error("配對需原生環境（WebRTC/EAS），此網頁示範不可用"))}
```

那個註解是**舊的**——行動端**本來就有 WebRTC**（通話能用，ADR-0101）。改接
`runPairTarget` ＋ `webRtcPairTransport`。

## 理由

- 這個 bug 的嚴重性在於**失敗得太晚**：使用者已經完成了整個信任儀式（比對 SAS），
  才發現什麼都沒搬到。修法必須讓它**在源頭就失敗**。
- 而「顯式傳入 identity」不只是繞過 bug——它**在型別上承認了一件事**：
  **私鑰不屬於 `AppStorage`**（ADR-0053 之後就是如此）。讓 `buildPairBundle` 繼續假裝
  能從 storage 拿到私鑰，只會讓下一個人再踩一次。

## 後果

- 正面：
  - **桌面的換機搬家修好了**（原本產出無身分的捆包）。
  - 行動端可以**搬出去**了——換手機不再只能「明文匯出 nsec 再貼到新機」，
    而那正是 ADR-0117 想避免的行為（使用者把私鑰貼進記事本／雲端筆記）。
  - 行動端的配對匯入也真的能用了（原本是拋錯的 stub）。
  - 測試 +9（engine 4：**無 nsec 當場拋錯**、顯式 identity、storage 有身分時照舊、
    顯式覆寫 storage；行動 5：SAS 必須使用者裁示、SAS 階段不給「重新開始」…）。
    全 repo **939 通過**。

- 已知限制：
  - 配對搬家**只搬熱區**（ADR-0111：封存不進 `StorageSnapshot`——幾百 MB 塞不進 P2P 信封）。
  - 企業身分不提供配對（ADR-0072 v1 排除；組織政策）。
  - 行動端仍缺：多身分、貼圖、相簿、AI、音樂狀態、多中繼管理。
