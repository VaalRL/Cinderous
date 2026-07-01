# 0021. 貼圖（Stickers，M7）

- 狀態：已接受
- 日期：2026-07-01
- 相關文件：docs/ROADMAP.md（Phase E / M7）；docs/adr/0010（LINE 路線圖）、docs/adr/0011（Reactions）

## 背景與問題

M7 首個功能：內建貼圖。需在不新增協定通道、不破壞隱私與既有 1:1 加密下實作，並
避開任何商標素材（PRD 硬規則）。

## 決策

- **協定（複用訊息通道）**：貼圖即一則普通聊天訊息，內容為
  `nb-sticker:v1:<pack>/<id>` 標記，走既有 NIP-17/59 Gift Wrap 加密通道。收件端以
  `parseSticker` 辨識並渲染對應內建圖，而非文字。→ 持久化、回應（Reaction）、收回
  （Unsend）、限時（Disappearing）**全部自然沿用**，零後端改動。
- **內建包**：`STICKER_PACKS` 提供**原創簡易 SVG** 貼圖（`buddy` 包 6 款：貓咪／
  愛心／星星／哭哭／慶祝／想睡），以 `pack/id` 參照；渲染以 `data:image/svg+xml`
  data URI 放進 `<img>`（內建、受信任內容，不需 `dangerouslySetInnerHTML`）。
- **UI**：對話視窗貼圖選擇器（🧸）→ 點選即以 `formatSticker` 送出；訊息列偵測為
  貼圖時渲染圖片。

## 後果

- 正面：純客戶端 + 既有通道，實作極小且不擴大攻擊面；`stickers.ts` 純函式
  （format/parse/registry）可測，端到端經真實 relay 驗證（兩 context 貼圖渲染一致）。
  避開商標（自繪 SVG）。
- 負面 / 未來：v1 僅內建固定包、無自訂/下載貼圖（需素材分發與快取設計，另議）；
  舊版客戶端若不認得標記會顯示原始文字（向前相容的優雅退化）。動畫貼圖、貼圖商店、
  近期使用等留待後續。
