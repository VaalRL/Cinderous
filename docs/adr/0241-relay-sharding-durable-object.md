# 0241. 中繼分片：從單一全域 Durable Object 到按收件人 pubkey 分片

- 狀態：已接受（**已實作＋預設開**）：server 路由（worker 依 URL 選 DO＋血條隔離）、分片計算 SSOT（core，
  client/server 共用）、客戶端訊息路由（收件匣自己片＋發布 shard(B)＋跨分片雙向投遞）、presence 獨立層、
  App 接線皆已落地並端到端測；遷移＝直接切換（pre-release 幾乎無使用者，不做雙讀/版本閘）、`shardingEnabled()`
  預設開＋kill-switch。shard 數＝16；一人一片（選項 1b）為未來待實測替代。**運維：relay 需 deploy 最新 worker。**
- 日期：2026-07-23
- 相關文件：ADR-0056（DO 內建 SQLite）、ADR-0059（休眠式 WebSocket）、ADR-0034（多中繼路由／outbox）、
  ADR-0035（加密 rumor 學 relay hint）、ADR-0235（C1：畸形事件曾可打掛全域 DO）、
  ADR-0237（元資料可連結性；Tier 2 多連線與本 ADR 一起評估）、ADR-0240（真隱身）、`relay/src/worker.ts`

## 背景與問題

產線中繼把**所有**流量路由到**單一** Durable Object：`worker.ts` 的
`env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName("global"))`。全網每個連線、每則離線留言、每次扇出，
都經過這一個 DO 實例。這造成兩個結構性問題：

1. **爆炸半徑（急）**：單一實例＝單點故障。**一崩全崩**。ADR-0235 C1 正是因此被評為 critical——
   一則畸形事件的未捕捉例外就能中止這個 DO，**全站掉線**。防禦性修補降低了「崩的機率」，但沒動
   「崩的影響」。
2. **擴充天花板（不急，但終究撞牆）**：一個 DO 是**單執行緒、~128MB 記憶體、有限 CPU 與連線數**。
   休眠式 WebSocket（ADR-0059）省的是 idle，不是**活躍扇出**的吞吐。用戶量夠大時，這是硬牆。

## 考量的選項

- **選項 0：維持現狀＋防禦性強化。** 繼續降低崩潰機率（如 C1 的圍籬）。零架構改動，但**血條與天花板
  都在**——單點故障的**影響**不變。
- **選項 1（採用）：按收件人 pubkey 前綴分片。** `idFromName("shard-" + pubkey前綴)`。收件匣天然同片、
  分片可由 pubkey **直接算出**（免 hint）、跨分片路由重用既有 outbox（ADR-0034）——**非重寫，是把
  既有多中繼機制向內轉**。先取 16 片（見〈決策〉）。
- **選項 1b（記錄，待實測）：一人一片（per-user DO）。** `idFromName(pubkey)`——每個使用者一個 DO，
  Cloudflare 的正統 actor 模式，DO 被定址即**自動生成**（天生動態、免決定片數、**永遠不用 re-shard 遷移**、
  血條＝1/全體）。且因 outbox 模型「**你在自己的 DO 收信、只有送信才連對方 DO**」，常駐連線仍只有
  「自己 DO＋presence 層」、送信可短暫連。**但成本從「連線數」換成兩個未知數**：(a) 每次送信要 NIP-42
  AUTH → **連線 churn＋Schnorr 開銷**（緩解＝對話進行中連線留著）；(b) **幾百萬個冷 DO**的喚醒延遲與
  計費——這規模不實測就是黑盒。presence 仍須自己一層（per-user 不解 many-to-many）；名人熱點集中在其
  自己的 DO。**架構最乾淨、血條最好、免遷移，但 churn/計費需 prototype 實測才敢承諾。**
- **選項 2：按對話/房間分片。** 不適用——Cinderous **無伺服器端房間**（群組是客戶端成對扇出，ADR-0027）。

## 決策

**採選項 1：按收件人 pubkey 前綴分片、presence 拆成獨立層、shard 數＝16、遷移＝切換＋自然過期。** 方向性子問題皆已定；剩實作 prototype。

- **分片鍵＝收件人 pubkey 前綴，先取 16 片**（pubkey 高 nibble）。血條 1/16——從「一崩全崩」到「一崩
  1/16」是質變、拿到大部分價值；1/16→1/256 邊際遞減。擴充現在不急，且因離線留言 7 天 TTL，日後要切細
  （甚至切到選項 1b 一人一片）可用「切換＋舊留言自然過期」低成本 re-shard，故**先保守是低後悔路徑**。
  presence 已拆走，故 16 這個數**不再乘 client 連線**（訊息片連線只來自「自己＋活躍對話」）。
- **連線時以 URL 選片，解「AUTH 早於選 DO」的雞生蛋。** WS 升級發生在 NIP-42 AUTH 之前，當下不知
  對方 pubkey——但**客戶端知道自己的 npub**。故客戶端連 `wss://relay/s/<自己pubkey前綴>`；worker 依
  路徑選 `idFromName("shard-" + prefix)`。
- **跨分片路由重用 outbox（ADR-0034），且比多 relay 更簡單。** 送給 B → **算** `shard(B)` → 連該片發布
  B 的 Gift Wrap（B 的收件匣訂閱掛在 `shard(B)`）。分片由 pubkey 可算 → **免 ADR-0035 的 hint 學習**。
- **收件匣天然同片。** 你的訊息 `#p:你` → 存 `shard(你)`；你訂閱 `#p:你` 也在 `shard(你)`。
- **presence 拆成獨立層——不進訊息分片。** 訊息按收件人切得乾淨（一對一→一片）；但 presence 是
  **多對多廣播**（一個人的在線被其**所有**聯絡人關注，而他們散在各片）——資料形狀不同，**不該共用
  同一套分片**。故：**訊息分片（按收件人）＋ presence 獨立層**。客戶端連「自己的訊息片」＋「presence
  層」（後者一次 `authors:[聯絡人]` 問完全部）→ **不必連每個聯絡人的片，跨分片連線爆炸消失**。
  presence 層失效只讓**綠點暫時消失、訊息照常**（非關鍵，血條再收斂一層）；presence 又輕（ADR-0129
  無內容信標、不寫庫、不扇大檔），一個 presence DO 能撐遠比訊息片多的連線，真撐不住時再**單獨**切它
  （用適合廣播的方式，不影響訊息片）。真隱身（ADR-0240，隱身完全不問）與 P2P（正在對話者直連）再
  把 presence 層負載壓小。**隱私不變**：`authors:[聯絡人]` 送給 presence 層＝與現況同（送給那唯一 DO），
  非退化；真隱身照樣不問、要完整隱私照樣自架（ADR-0237 結論不變，只換位置）。
- **遷移＝切換＋舊留言自然過期（不搬資料）。** 切換日起新版連自己的片、新訊息進各片；已存離線留言
  留在全域 DO、**7 天 TTL 內自然過期**。過渡期（~7 天）新客戶端**同時讀「自己的片＋全域 DO」**以收
  切換前的離線留言；配一個**最低版本閘**（舊客戶端未更新前仍走全域 DO）。過渡期滿、全域 DO 空 → 退役。
  **不搬 DO 間資料**；pre-release／小用戶量下近乎零成本。（同理，日後 16→更細或→一人一片的 re-shard
  也用這招，故切片數是低後悔決定。）

- **為何按收件人 pubkey。** (a) 收件匣天然同片，訊息路由乾淨；(b) 分片可由 pubkey 直接算出，**免 hint**
  （比多 relay 案還簡單）；(c) 重用 outbox＝把「路由到收件人的 home relay」變成「路由到收件人的 home
  shard」，非重寫。
- **血條收益是無條件的。** 分片後一片崩＝**只影響 `shard(該片)` 的 ~1/N 使用者的收發**，他們重連到
  乾淨的新 DO。你自己的收發只看你**自己的片**活不活——與 presence 跨片連線無關。C1「一崩全崩」直接
  降為「一崩 1/N」。
- **為何把 presence 拆出去（解掉「連線數收益有條件」）。** 天真做法是讓 presence 掛在收件人的訊息片
  ——那會逼一個聯絡人分佈廣的 client 連 ~所有片（自己片＋每個聯絡人所在片）→ 連線**只分散不減**、每片
  的連線數 ≈ 全體 client 數 → **與單一全域 DO 相同**，擴充白做。**根因：訊息是一對一（切得乾淨），
  presence 是多對多廣播（切不乾淨）；硬塞同一套分片就撞牆。** 把 presence 拆成獨立層即解：client 對
  presence 只需**一條**連線（`authors:[聯絡人]` 一次問完），訊息片只連自己＋少數活躍對話 → 典型 2~3 條。
  訊息分片的擴充/血條收益因此**無條件**成立、不再被 presence 抵銷。presence 層自己是廣播型、又輕，可先
  用單一（或少數）DO，其失效**只影響綠點、不影響訊息**——非關鍵單點，比現況（一 DO 掛連訊息都停）好
  太多；日後單獨按廣播特性擴充。
- **與 ADR-0237 Tier 2 的關聯（一起評估）。** Tier 2（臨時身分連線，把發布/presence 從真名連線解綁）
  本就要**更多連線**。分片把連線**分散到多個 DO**，反而讓 Tier 2 更可行（不堆在一個全域 DO）；但兩者
  都乘連線數，需一起算總帳。故本 ADR 與 ADR-0237 Tier 2 綁定評估。

**本 ADR 的方向性子問題皆已定案**：訊息按收件人分片、presence 獨立層、shard 數＝16、遷移＝切換＋自然
過期（全見〈決策〉）。剩下的是**實作 prototype**，與一個**未來替代**：

- **一人一片（選項 1b）＝待實測的替代方案，非現在做。** 血條最好、免片數/遷移，但需先 prototype 量
  「送信 AUTH churn 延遲」與「幾百萬冷 DO 的喚醒/計費」。數字漂亮再考慮從 16 片切過去（同樣靠 7 天
  過期低成本 re-shard）。**現在先 16、不上一人一片**——避免拿未實測的成本/延遲賭產線。

## 後果

- 正面：
  - **血條 1/1 → 1/N（無條件）**：C1 那類「一崩全崩」結構性消除；一片崩只影響其 1/N 使用者的收發。
  - **presence 與訊息分層**：presence 層失效只讓綠點消失、**訊息照常**——關鍵路徑的血條再收斂一層。
  - **擴充天花板移除**：presence 拆出後，訊息片的連線只來自「自己＋活躍對話」→ 分片的擴充收益不再被
    presence 跨片連線抵銷。
  - **重用既有 outbox**（ADR-0034），分片由 pubkey 可算、免 hint；非重寫。
  - 使 ADR-0237 Tier 2（多連線）更可行（負載分散）。
- 負面 / 已知殘餘風險：
  - **presence 層是（非關鍵的）單點/需自行擴充**：先用單一/少數 DO，失效只影響綠點；成長後要按廣播
    特性單獨切它。比現況（一 DO 掛連訊息都停）好，但仍是要處理的一塊。
  - **遷移過渡窗**：~7 天「雙讀＋最低版本閘」期間全域 DO 與各片並存（不搬資料）；小用戶量下風險低。
  - **client 連線數略升**（自己訊息片＋少數活躍對話片＋一條 presence 層），對行動端連線管理是（小）成本。
- 後續行動 / 待辦：
  1. ✅ shard 數＝**16**（血條優先、邊際遞減、可低成本再切細）。✅ 遷移＝**切換＋舊留言自然過期**（不搬資料、過渡期雙讀＋最低版本閘）。
  2. presence 獨立層設計：先單一/少數 DO（廣播型、輕）；`authors:[聯絡人]` 一條連線；與 ADR-0240 真隱身
     ／P2P 卸載協同降負載。
  3. 與 ADR-0237 Tier 2（臨時身分連線）綁定，算連線總帳後再定是否一起做。
  4. prototype（分兩部分）：
     - ✅ **server 端已落地**：`relay/shard.ts`（純路由：`shardPrefix`／`messageShardName`／`shardPath`／
       `shardNameForPath`）＋`worker.ts` 依 URL 選 DO（`/s/<prefix>`→訊息片、`/presence`→presence 層、
       其他含 `/`→舊全域回退）。**backward-compatible**：客戶端連 `/s/` 前，`/` 仍走 global＝零行為變化。
       血條測試綠（一片收畸形訊息不影響他片的離線留言查詢）。
     - ✅ **客戶端訊息路由已落地**：`RelayPoolOptions.shardingBase` 開分片模式——home（收件匣）連自己的
       訊息片（`<base>/s/<自己前綴>`，pubkey 到建構才知 → 該處才定 homeUrl，解「AUTH 早於選 DO」）；
       `foreignUrlOf` 改由 pubkey **直接算** `shard(對方)`（免 hint），`publishAddressed` 修正**非聯絡人**
       （陌生人/群成員）也路由到 `shard(對方)`。**重用既有 outbox/pool**（分片＝把「路由到 home relay」變
       「路由到 home shard」）。分片計算 SSOT 於 core（client/server 共用）。TDD：跨分片雙向投遞（`createShardedRelayNetwork`
       每 host＝獨立 DO）＋向後相容（未設 shardingBase 走單一 relay）；123 既有後端測不變。
     - ✅ **presence 獨立層已落地**：心跳移出訊息片、集中到 `<base>/presence`——`subscribeOn` 新增 presence
       層分支（一條連線訂 `authors:[全部聯絡人]`）、訊息片不再訂心跳；`beat` 只發到 presence 層；`resubscribe`
       另連該層。TDD：不同分片的 Alice/Bob 仍互看在線（只靠 presence 層）。隱私不變（ADR-0237：`authors:[聯絡人]`
       送 presence 層＝與送單一 DO 同級；真隱身照樣不問）。
     - ✅ **App 建構點接線**：`buildBackend` 非企業路徑於 `shardingEnabled()` 時傳 `shardingBase=p.relayUrl`
       （`connectorFor` 已提供）。
     - ✅ **遷移＝直接切換（預設開）**：pre-release 幾乎無使用者 → **不做雙讀/最低版本閘**（全域 DO 上頂多
       幾則離線留言、可捨棄，與〈決策〉「小用戶量下近乎零成本」一致）。`shardingEnabled()` **預設開**、
       kill-switch＝`localStorage nb.sharding=0`。**運維前提**：relay 需 `wrangler deploy` 最新 worker（分片路由；
       backward-compatible——舊 worker 對 `/s/` 仍回退 global，不壞、只是不分片）。
     - **未來若使用者量已成長才要 re-shard（16→更細／→一人一片）**：屆時才需本 ADR 記的「切換＋7 天過期＋
       過渡雙讀」；現在直接切是低後悔決定（切片數/遷移皆可日後低成本再做）。
  5. **（未來、非現在）** 一人一片（選項 1b）prototype＋量測 AUTH churn／冷 DO 喚醒/計費；數字好再評估切過去。
