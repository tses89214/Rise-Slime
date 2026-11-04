<!--
給其他 bot 的說明(發表前刪除這段):
- 第 2 篇:介紹資料工程管線。讀者是資料工程師。第 1 篇介紹遊戲(docs/medium-game.md),這篇只簡述遊戲。zh-TW,技術名詞保留英文。不寫除錯過程、踩坑細節、時間與具體數字。
- 圖檔:itch-media/shot1-main.png(遊戲畫面,demo 狀態)、docs/pipeline-services.png、docs/pipeline-tables.png;儀表板截圖待補。
- 待確認:文中「對帳都吻合」是 2026-11-04 清資料後單次跑(20 bots × 600 s)的結果,合成與擴充樣本小、遲到事件路徑那輪沒觸發,所以文章只說「已輸出的視窗」。
- 遊戲名撞名只查過網路搜尋,未查 itch.io / Steam 站內搜尋。
- Repo:https://github.com/tses89214/Rise-Slime  試玩:https://tses89214.itch.io/rise-slime
-->

# 用一款放置遊戲餵出來的即時資料管線:Kafka、Flink、ClickHouse

> 一個 side project:遊戲產生事件,事件經過 Collector → Kafka → Flink → ClickHouse,最後到一個自製的儀表板。

我是資料工程師。要練習即時資料管線,最難的是沒有「會自己產生事件」的資料來源,所以我做了一款放置遊戲 *Rise & Slime*:玩家(和一群模擬玩家)的每個動作都是一筆事件,送進一條完整的管線。遊戲本身的介紹在另一篇:[待補:第 1 篇網址]。這一篇專講管線。

![遊戲畫面](../itch-media/shot1-main.png)

## 資料從哪來

*Rise & Slime* 是一款史萊姆麵包坊放置遊戲:玩家把史萊姆派到 Farm、Mill、Bakery 生產,賣麵包賺金幣,再買史萊姆、升級、合成。玩家的每個動作都會變成一筆事件(開始遊戲、購買、升級、合成、每 5 秒一筆的產量快照……共 11 種)。遊戲的細節在第 1 篇,這裡只需要知道:它會源源不絕地產生有意義、有結構的事件。

另外,遊戲核心是純 TypeScript,不依賴畫面,所以同一份規則能在 Node 裡跑成 **bots**:模擬玩家不用開瀏覽器,就能一次產生大量事件。

## 整體架構

```
瀏覽器遊戲 / 模擬玩家 bots
        ↓ JSON
Collector(Python FastAPI,JSON Schema 驗證)
   ├─ 合格 → Kafka  events
   └─ 不合格 → Kafka  events.dlq(dead letter,不丟棄)
        ↓
Flink SQL(去重、1 分鐘視窗、遲到事件)
        ↓ upsert topics
ClickHouse(ReplacingMergeTree)
        ↓
自製 HTML 儀表板(uPlot)
```

![服務圖](pipeline-services.png)

幾個設計重點:

- **遊戲核心是純 TypeScript、不依賴畫面**,所以同一份規則能在 Node 裡跑成 bots,不用開瀏覽器就能產生大量玩家。
- **事件格式只有一份**:用 zod 定義,遊戲和 bots 直接引用,collector 讀它匯出的 JSON Schema 驗證。
- **無效事件不丟棄**:格式不對的事件進 dead-letter topic,附上錯誤原因。
- **模擬玩家會故意把資料弄髒**:重複事件、格式錯誤、斷線後補送(於是事件遲到)。管線要面對這些才算是真的管線。
- **Flink** 用 SQL 去重,並以 1 分鐘視窗彙總,視窗允許 15 分鐘的遲到事件並重新計算;**ClickHouse** 用 ReplacingMergeTree 接收更新。
- **schema 演進**:新舊版本的事件同時存在,同一條管線都能處理。

![資料表流向](pipeline-tables.png)

## 怎麼知道算對了

儀表板「看起來合理」不算數。我拿 ClickHouse 的原始事件表逐分鐘對帳 Flink 算出來的視窗(事件數、麵包銷售量、各站產量),已輸出的視窗都吻合。

[待補:儀表板截圖]

## 試試看

- 試玩這款遊戲:https://tses89214.itch.io/rise-slime
- 原始碼(MIT):https://github.com/tses89214/Rise-Slime
- README 有「只玩遊戲」和「跑完整管線」兩種啟動方式。
