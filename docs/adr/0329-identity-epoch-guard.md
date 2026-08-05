# ADR-0329：身分世代守衛——非同步落地不得寫進新身分

- 狀態：已採用
- 日期：2026-08-04
- 關聯：ADR-0328（行動端互動測試；本文是它列出的第一個後續）、ADR-0294 §2／ROADMAP Phase P4、ADR-0122（拿不到金鑰要大聲失敗）

## 1. 重設清單管不到已經在飛的 promise

行動端切身分是**就地切換**（桌面走 `location.reload()`＝結構性保證）。`signInWith` 內有一份手寫的 42 個重設呼叫把 per-identity 狀態歸零，而 `MobileApp.perIdentityState.test.ts` 強制它不漏。

但那份清單只在**切換的那一瞬間**生效：

```ts
// 開對話 → 查封存塊數（OPFS，非同步）
void arch.chunkCount(id).then((n) => setArchived(...));
//                                   ↑ 這中間若切了身分，這一行把**上個身分**的東西
//                                     寫進**新身分**的 state
```

`archived` 正是 ADR-0294 §2 抓到的那個「歷史入口閘門」——**同一個 bug 換一條路回來**。

盤點時確認：全專案 `grep cancelled|generation|epoch|abort` **是空的**。桌面 `App.tsx` 有 `let cancelled = false`，行動端一個都沒有。

## 2. 決策

每次 `signInWith` 進入新世代。任何「等一下才會回來」的工作在**發出前**記下當時的世代，**落地時**比對——變了就丟掉。

```ts
const still = epochRef.current.mark();     // 發出前
void arch.chunkCount(id).then((n) => {
  if (!still()) return;                    // 落地時：已經不是同一個身分 → 丟掉
  setArchived(/* … */);
});
```

🔴 **丟掉是正確的失敗方向**：那份結果屬於上一個身分，對現在這個身分沒有意義；照寫就是跨身分洩漏。

⚠ `bump()` 必須在 `backendRef.current?.stop()` **之前**——晚了的話，停後端那一刻起的落地還會被當成同一個身分。有測試釘住順序。

### 已守住的四處

| 位置 | 若不守 |
| --- | --- |
| `openConvo` → `arch.chunkCount().then(setArchived)` | 幽靈歷史入口（ADR-0294 §2 那個） |
| `depositToSlot` → `pickFile().then(setSlotQueue)` | 在工作身分挑的檔，進了個人身分的公司儲存槽佇列 |
| `sendFileFromPicker` → `pickFile().then(b.sendFile)` | 用已停掉的舊後端送出 |
| `sendPhotoFromCamera` → `takePhoto().then(b.sendFile)` | 同上 |

## 3. 真正的產出是「下一個也會被擋住」

只修這四處是治標——下一個非同步落地照樣會漏，那正是 ADR-0294 §2 三個漏網的成因。

故加 `MobileApp.asyncEpoch.test.ts`：掃原始碼，**任何 `.then(` 回呼裡寫了 per-identity setter 卻沒有世代守衛就紅**。形狀與這個專案處理同類問題的既有做法一致——`sub-plan.ts` 讓續取策略成為**宣告的必填項**（ADR-0294 P3）、`perIdentityState.test.ts` 讓分類成為必填項。

🔴 **規則不是「一律要求」**：`setPairPhase` 是裝置／外殼層，不在名單內、不受此限。要求的只有會跨身分的那些。

而且這支測試**自己驗自己抓得到違規**——餵它一段沒守衛的合成程式碼必須被標出來。否則它綠著也不代表任何事（掃描器寫壞了同樣會綠）。

## 4. 買不到什麼

1. **沒有重現這個競態的行為測試。** 它要求「非同步工作發出後、落地前」剛好切身分，而那兩條路在 jsdom 裡不好觸發（`archived` 走 OPFS、`slotQueue` 走檔案挑選器），且**結果不可觀察**——`archived` 只在同一個對話再次開啟時影響 `open-history`，切身分後那個 id 根本不會再出現。
   ⇒ **機制**有單元測試（`identity-epoch.test.ts`），**套用**由掃描器強制，**競態本身**沒有端到端證明。這是誠實的覆蓋範圍，不是「已完整驗證」。
2. **擋不住「守衛寫了但比對邏輯寫反」**（例如 `if (still()) return;`）。那需要人看。擋得住的是**忘了加**，而忘了加正是這類 bug 的成因。
3. **只認 `.then(`。** `await` 之後的程式碼在同一個函式內，由該函式自己的守衛涵蓋；但**巢狀在別處的 callback**（例如 `setTimeout`）不在掃描範圍。目前沒有這種寫法。
4. **`useRef` 仍未涵蓋**（ADR-0328 §2 的第 2 類）。目前 12 個 ref 都安全（8 個是 render-time 鏡像、其餘顯式清空），但那是巧合不是保證。

## 5. 🔵 2026-08-05 校正：ADR-0332 2c 之後這支守衛**不退場**

ADR-0332 §3 原本寫著「2c 之後 `asyncEpoch` 整支可以退場——子元件重掛後，舊身分的非同步落地寫進的是已卸載元件的 state，React 直接忽略」。

**那個推論只對一半。** 掛上 `key` 之後逐一檢查四個守衛點：

| 守衛點 | 落地時做什麼 | 重掛涵蓋得了嗎 |
| --- | --- | --- |
| `openConvo → setArchived` | 純 state 寫入 | ✅ |
| `sendFileFromPicker` | `b.sendFile(...)`——**閉包抓住的舊後端** | ❌ |
| `sendPhotoFromCamera` | 同上 | ❌ |
| `depositToSlot` | `org.updateSlots(...)`（state）＋佇列後由背景效果送出 | 部分 |

「React 會忽略已卸載元件的 `setState`」買到的是**狀態**那一半，**不是副作用那一半**。元件卸載不會取消一個已經在飛的 `.then`，也不會讓它裡面的 `b.sendFile(...)` 消失。

⇒ **守衛與掃描器都保留。** 憑「反正 React 會忽略」拆掉它，會靜默地讓後三個點失去保護——而那正是這個專案一路在防的那種「看起來沒事」。

## 6. 後續

~~有了世代守衛與兩支掃描器之後，P4 治本重構的前提又補上一塊：子元件重掛時世代自然遞增，這層守衛屆時會退化成免費的。~~

🔵 **2026-08-05 修正**：重構已完成（ADR-0332），但「屆時會退化成免費的」這句話**不準確**——見 §5。重掛涵蓋狀態，不涵蓋副作用。守衛保留。
