# 0184. 行動端輔助面板審查修正——媒體/對話串重算、便條文案、設閘與死碼

- 狀態：已接受（已實作）
- 日期：2026-07-17
- 相關文件：ADR-0183（行動端對話輔助面板）、0182（右欄便條）、0097（算式計算機）

## 背景與問題

對 ADR-0182/0183 做對抗式審查（自審＋獨立子代理），加密/隱私/零廣播/thread-util 上移全部守住、
無 CRITICAL；但發現兩項高優先與若干小尾巴：

1. **[高·效能] `auxImages`/`auxThreads` 每次 render 都重算**：兩者在 `ConversationScreen` render
   body 頂層無條件執行（`messages.filter` 與 `replyCounts(messages)`＝O(n)），未 memoize、未閘
   `auxOpen`。而**每次打字**（`draft`／便條 state 變）都觸發整個畫面 re-render → 長對話下每個
   按鍵都對整份訊息重跑兩次掃描，即使面板從沒開過。
2. **[高·文案] 便條 placeholder/hint 承諾了行動端刻意不做的算式功能**：行動端便條與桌面共用
   `note_placeholder`/`note_hint`（含「輸入算式會自動算出」），但 ADR-0183 明載行動端便條**只做
   筆記、計算在輸入框**——文案教使用者打算式，畫面卻無反應。

## 決策（修正）

1. **`useMemo([messages])`**：`auxImages`/`auxThreads` 只在 `messages` 變（收到新訊息）時重算，
   打字時不重跑——消除每按鍵的浪費。
2. **行動端專屬便條文案**：新增 `note_placeholderM`/`note_hintM`（**不提算式**、且點明「加密存這台
   裝置」「計算請在輸入框打」）；行動端便條改用之。桌面仍用含算式的原鍵（桌面便條真有算式）。
3. **便條分頁設閘改 `onNoteLoad && onNoteSave`**（原只查 `onNoteSave`）：型別上兩者各自 optional，
   避免未來只給一邊時分頁顯示卻載入退化成空。
4. **更正 `MobileApp` 誤導註解**：便條金鑰只取決於 `selfNsec`（登入後恆有），與「示範模式」無關。
5. **清桌面死 CSS**：`.daux__calc`/`.daux__calcin`/`.daux__calchint` 隨 `CalcPanel→NotePanel`
   已無引用，移除（`.daux__calcout` 系列仍用於便條算式結果，保留）。

## 後果

- 正面：輔助面板不再拖慢打字（長對話/舊裝置有感）；行動端便條文案與實作/設計意圖一致；型別設閘
  更穩健；死碼清除。
- 已知殘留（低，非本次修）：
  - 便條逐鍵同步加密＋寫 localStorage 無 debounce——與 `presence.ts`/`personalize.ts` 等本機儲存
    慣例一致；小文字量影響小，若日後有人反映輸入頓再加 ~300ms debounce。
- 測試：既有 `note-store`／`ConvoComposer`／`thread-util` 測試涵蓋；i18n 8＋mobile 197＋desktop
  406 全綠、三端 typecheck 通過。
