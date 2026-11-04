<!--
給其他 bot 的說明(發表前刪除這段):
- 這是 Medium 引流用精簡版草稿,語言 zh-TW,技術名詞保留英文。
- 數字都來自 .claude/PROGRESS.md 的 E2E 對帳紀錄與 docs/pipeline.md;標 [待補] 的地方是還沒有素材(截圖、發表日期)。
- 「待確認」清單在檔案最後,不要把清單內的說法寫成已驗證的事實。
- 圖檔:docs/pipeline-services.png、docs/pipeline-tables.png;儀表板截圖需要重新拍(指令見 docs/system.md)。
- Repo:https://github.com/tses89214/Rise-Slime
-->

# 我做了一款放置遊戲,只為了餵飽一條即時數據管線

> 副標:Kafka → Flink → ClickHouse,處理重複、遲到、壞掉的事件,以及一個我沒預料到的 bug。

我是資料工程師。工作上很難自己決定「資料長什麼樣」,所以我做了一款小遊戲 *Rise & Slime*(史萊姆麵包坊放置遊戲),讓玩家的每個動作都變成一筆事件,送進一條完整的即時管線。遊戲只是水源,重點是管線怎麼面對髒資料。

[待補:遊戲截圖一張]

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

遊戲本身是純 TypeScript、不依賴畫面,所以同一份規則可以在 Node 裡跑成 bots,不用開瀏覽器就能產生大量玩家。

## 我故意讓資料變髒

真實的資料管線不會收到乾淨的資料,所以我讓 bots 主動製造問題:

- **重複事件**:約 1% 的事件送兩次。Flink 依 `event_id` 去重(state 保留 1 小時)。
- **格式錯誤的事件**:進 dead-letter topic,同時記下錯誤原因,儀表板會顯示最新幾筆。
- **斷線再補送**:bot 暫存事件、事後一次送出,於是事件「遲到」。視窗允許 15 分鐘的遲到,遲到的事件會讓該視窗重新計算並以 upsert 覆寫。
- **schema 演進**:v1 與 v2 的事件同時存在,同一條管線都能處理。

![資料表流向](pipeline-tables.png)

## 怎麼知道算對了?

我沒有只看儀表板「看起來合理」,而是拿 ClickHouse 的原始事件表(`events FINAL`)逐分鐘對帳 Flink 算出來的視窗。

做法:2026-11-04 先 `docker compose down -v` 把 Kafka 與 ClickHouse 的資料全部清掉,重新啟動並提交 Flink job,再即時(`--speed 1`)跑一輪 20 個 bots × 600 秒(重複事件 1%、格式錯誤 0.5%、斷線 2% 為預設值),等 2 分鐘讓 Flink 跟上。結果(共 3,998 筆事件、11 個分鐘;最後一個分鐘的視窗在 run 結束時還沒關閉,不會輸出,所以比對 10 個已輸出的視窗):

- 10 個視窗,**0 個不一致**。事件數:視窗加總 3,886 = 原始表同分鐘的不重複事件 3,886。
- 麵包銷售量(`bread_sold`):34,299 = 34,299。
- **各站產量逐站對帳**:30 列(10 視窗 × farm / mill / bakery),`produced` 291,510 = 291,510、`consumed` 207,620 = 207,620、玩家數也相同,0 個不一致。
- 沒有任何一個原始事件所在的分鐘「完全沒有視窗」(沒有被默默丟掉的整個視窗)。
- 重複事件:Flink 在這 10 個視窗內計到 45 筆重複(約 1.2%),bots 的注入率是 1%;樣本小,波動正常。
- schema 全是 v2(清資料後沒有 v1)。
- Dead letters 18 筆,錯誤全是 `unknown event_type`,與 0.5% 的格式錯誤注入率(約 20 筆)數量級相符;我沒有逐筆比對。
- 這一輪的 20 個 bots 是 10 個 optimizer、5 個 random_assigner、5 個 quitter。

這一輪的限制:600 秒太短,bots 到最後兩分鐘才開始合成(9 個合成、1 個擴充,全落在最後兩個分鐘),已輸出的視窗裡只有 3 個合成、0 個擴充(3 = 3、0 = 0),所以**合成與擴充的對帳樣本很小**;遲到事件的功能(`late_1m`)這一輪也沒觸發(0 筆),因為這次沒有斷線到足以產生遲到。

注意:最後一個還沒關閉的視窗,要等後面的事件把 watermark 往前推才會輸出,所以對帳時要排除最新的那一分鐘。

## 我踩到的一個坑:誰的時鐘可信?

Flink 的視窗與 watermark 用的是事件裡的 `event_time`,而這個時間是**客戶端自己填的**。讀程式碼時我發現一個推論(**尚未實測**):只要有一筆事件的時間比其他玩家快很多,watermark 就會被推到未來,其他玩家超過 15 分鐘 allowed lateness 的事件會被視窗默默丟掉,不進 dead letter,也看不到。

我的處理是在 collector 加一道檢查:瀏覽器端的 `event_time` 與收件時間差超過 10 分鐘就進 DLQ(bots 豁免,因為 fast-forward 與斷線暫存本來就合法)。這是權宜之計:`client` 欄位本身可以偽造,而且 10 分鐘對休眠中的分頁是否太緊,我也還沒驗證。比較根本的做法是改用 collector 自己蓋的 `ingested_at`,那是唯一可信的時鐘。

## 這個專案教我的事

- Kafka、Flink、ClickHouse 各自的「正確」是不同層次的:Kafka 保證順序與不遺失,Flink 負責時間語意,ClickHouse 負責最終一致的查詢。把「去重」放在哪一層,是設計時最花時間想的事。
- 「不要靜默丟資料」要落實到每一個邊界,包含 HTTP 層與視窗層。我目前仍有缺口(見下方限制)。
- 可以自己造資料的專案,最大的好處是能**故意製造問題再驗證**,而不是等真實資料出事。

## 已知限制

- 瀏覽器端事件送出失敗時沒有重試或暫存,collector 或 Kafka 掛掉會遺失事件(只有 bots 有斷線暫存)。
- collector 收到不是 JSON 的 body 時回 400,沒有進 DLQ,與「無效事件不靜默丟棄」的原則不一致。
- 超過 15 分鐘 allowed lateness 的事件,Flink 不會修正(原始 `events` 表仍保有)。

## 試試看

Repo:https://github.com/tses89214/Rise-Slime
README 有「只玩遊戲」與「跑完整管線」兩種啟動方式。

試玩(瀏覽器直接玩):https://tses89214.itch.io/rise-slime

---

<!--
待確認清單(寫成已驗證事實前要先確認):
1. 對帳數字是 2026-11-04 `down -v` 後單次乾淨跑(20 bots × 600 s,即時)查出來的。查詢是 ClickHouse 的 JOIN:視窗表 FINAL 對 `events FINAL` 的同分鐘彙總,涵蓋事件數、bread_sold、各站 produced / consumed / 玩家數、合成、擴充。尚未驗證:長時間跑(合成與擴充樣本太小)、遲到事件(`late_1m` 這輪 0 筆)、斷線補送的路徑、`avg` 類欄位(slimes、input_stock)。
2. 「watermark 被推到未來會丟其他玩家事件」:PROGRESS 標為「學習時讀碼發現,未實測」,文章已照樣標明。
3. Dead letters 18 筆全是 `unknown event_type`,與 0.5% 注入率的預期數量相近,但沒有逐筆比對,文章沒有寫成「等於注入數量」。
4. 儀表板截圖、遊戲截圖尚未拍。
5. 遊戲英文名撞名:只做過網路搜尋(沒有同名,最近的是 Rise of the Slime),未查 itch.io / Steam 站內搜尋。
-->
