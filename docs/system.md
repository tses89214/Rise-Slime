# 系統總覽：這個專案裡有什麼

一句話：一個放置遊戲（瀏覽器版或 bot）把玩家的動作變成事件，事件經 collector 進 Kafka，Flink 計算每分鐘彙總，ClickHouse 存起來，儀表板把它畫出來。

圖在 [`pipeline.md`](pipeline.md)（服務圖、表格圖）。這份是清單：有哪些東西、在哪個 port、怎麼啟動、出問題看哪裡。

## 1. 所有「東西」一覽

| 名稱 | 是什麼 | 網址 / port | 怎麼啟動 | 程式在哪 |
| --- | --- | --- | --- | --- |
| 遊戲（開發版） | 瀏覽器放置遊戲，Vite dev server | http://localhost:5173 | `npm run dev`（`VITE_TELEMETRY=true` 才會送事件） | `src/game/`、`index.html` |
| Bots | Node 程式，模擬玩家並送事件 | 無（打 collector） | `npm run bots -- --bots 20 --seconds 600 --url http://localhost:3000/events` | `src/bots/` |
| **Collector** | Fastify。收事件、用 zod 驗證、寫 Kafka；**同時也提供儀表板** | **http://localhost:3000** | `KAFKA_BROKERS=localhost:9092 npm run collector` | `src/collector/` |
| **儀表板** | 純 HTML + uPlot，每 5 秒打 `/api/dashboard` | **http://localhost:3000/dashboard**（`?client=bot` 只看 bot） | 跟 collector 一起 | `dashboard/index.html`、`src/collector/dashboard.ts` |
| Kafka（2 節點） | 訊息佇列。節點 1 對外 9092，節點 2 對外 9094 | localhost:9092 / 9094 | `docker compose up -d` | `docker-compose.yml` |
| Kafka UI | 看 topic、訊息、consumer group | http://localhost:8080 | 同上 | 同上 |
| Flink | 串流計算。UI 看 job 狀態 | http://localhost:8081 | 同上；job 用 `docker compose --profile submit run --rm flink-sql` 提交 | `pipeline/flink/job.sql` |
| ClickHouse | 資料庫（HTTP 介面） | http://localhost:8123 | 同上 | `pipeline/clickhouse/init.sql` |

沒有帳號密碼（本機開發用）。collector 沒設 `KAFKA_BROKERS` 時只把事件印到 stdout，不會進 Kafka，儀表板也就沒資料。

## 2. 從零啟動（照順序）

```sh
npm install
docker compose up -d                                   # Kafka x2, Kafka UI, ClickHouse, Flink
docker compose --profile submit run --rm flink-sql     # 提交 Flink job（只在第一次；之後用 scripts/flink-restart.sh）
KAFKA_BROKERS=localhost:9092 npm run collector         # 另開終端機
npm run bots -- --bots 20 --seconds 1200 --speed 60 --url http://localhost:3000/events
open http://localhost:3000/dashboard
```

- `--speed 60`：虛擬時間快 60 倍（20 分鐘的遊戲約 20 秒跑完）。沒給就是快轉模式，跑最快。
- 想玩遊戲本身：`npm run dev`；要把真人的事件也送進管線：`VITE_TELEMETRY=true npm run dev`。
- 全部清掉重來：`docker compose down -v`（資料也會刪）。`init.sql` 只在 ClickHouse 第一次啟動時執行。
- 改了 `job.sql`：`scripts/flink-restart.sh`（用 savepoint 接著跑，不重放 Kafka）。

## 3. 事件（11 種）

所有事件共用欄位：`event_id`（UUID v7，去重用）、`event_type`、`schema_version`（1 或 2）、`player_id`、`session_id`、`client`（`browser`/`bot`）、`bot_persona`、`seq`、`event_time`（事件真的發生）、`sent_at`（客戶端送出）、`ingested_at`（collector 收到）。定義在 `src/events/schema.ts`。

| 事件 | 何時 | 版本 |
| --- | --- | --- |
| `session_start` / `session_end` | 開始 / 結束遊玩 | 1 |
| `offline_progress_applied` | 回來時結算離線收益 | 1 |
| `slime_purchased` | 買史萊姆 | 1 |
| `slime_assigned` | 分配崗位（v2 多了可選的 `tier`、`trait`） | 1 |
| `station_upgraded` | 升級工作站 | 1 |
| `achievement_unlocked` | 解鎖成就 | 1 |
| `production_tick` | 每 5 秒的生產快照 | 1 |
| `slime_merged` | 合成（3 合 1） | 2 |
| `station_expanded` | 擴建工位 | 2 |
| `feature_unlocked` | 解鎖合成 / 擴建 | 2 |

不合法的事件進 `events.dlq`，不會被丟掉。

## 4. ClickHouse 表速查（資料庫 `slime`）

| 表 / view | 內容 | 注意 |
| --- | --- | --- |
| `events` | 每筆合法事件，專屬欄位放在 `payload`（JSON 文字） | 重複事件在背景合併時才會收掉，精確計數用 `FINAL` 或 `uniqExact(event_id)` |
| `production_1m` | 每分鐘每站產量、排隊量 | **要用 `FINAL`**（遲到事件會重發同一個視窗，留 `version` 最大的） |
| `ops_1m` | 每分鐘活躍玩家、購買、升級、合成、變異、擴建、麵包與金幣 | 要用 `FINAL` |
| `pipeline_1m` | 每分鐘事件量、延遲、重複數 | 要用 `FINAL` |
| `late_1m` | 每分鐘遲到的事件數（依 `sent_at` 分鐘） | 要用 `FINAL` |
| `dead_letters` | 被拒收的事件與原因 | |
| `player_state` | 每位玩家最新狀態 | 由 `events` 的 materialized view 維護 |
| `leaderboard`、`efficiency`、`activity_daily` | view：排行榜、效率、DAU/WAU/MAU | |

## 5. 常用檢查

```sh
# Flink job 活著嗎
curl -s localhost:8081/jobs/overview
# 事件進來多少（去重後）
curl -s localhost:8123 --data-binary "SELECT count() FROM slime.events FINAL"
# 儀表板的資料 API
curl -s 'localhost:3000/api/dashboard?minutes=60&client=bot'
# 視窗彙總 vs 真實值（排除最新、還沒關閉的那一分鐘）
curl -s localhost:8123 --data-binary "SELECT sum(events) FROM slime.pipeline_1m FINAL"
```

| 症狀 | 先看 |
| --- | --- |
| 儀表板全空 | collector 有沒有設 `KAFKA_BROKERS`？Flink job 是 RUNNING 嗎？ |
| `players online` 是 0 | 「在線」= 最近有事件；跑完後一段時間就會變 0，正常 |
| 彙總比 `events` 少一點點 | 最新那一分鐘視窗還沒關閉，或見下方「已知限制」 |
| 某張 `*_1m` 表停止更新 | 刪過 Kafka topic？重建該表的 `kafka_*` 表和 MV，必要時重設 consumer group offset（見 `.claude/PROGRESS.md`） |
| 重提交 job 後數字變兩倍 | 沒先取消舊 job（兩個 job 同時在寫）；在 Flink UI 取消舊的 |

## 6. 已知限制（不是 bug）

- **最新一分鐘不會輸出。** 視窗要等 watermark 推過去才關閉；最後一分鐘後面沒有新事件就一直開著。
- **遲到只容忍 15 分鐘。** 遲到的事件在 15 分鐘內會讓視窗重發新總數；更晚的會被視窗丟掉（`events` 原始表仍有）。
- **連續跑兩輪 bot 會丟開頭幾分鐘。** bot 用 `--speed` 快轉時，事件時間會跑到真實時間前面；下一輪從「現在」開始，開頭就落在上一輪 watermark 的 15 分鐘之後，被視窗丟掉。實測丟掉 52 筆，和用 Flink 規則從 ClickHouse 反推的結果完全一致。要驗證請單輪跑，或兩輪之間隔夠久。
- **bot 的延遲是假的。** bot 蓋的是模擬時間，`pipeline_1m` 的延遲對 bot 會是負的；只有瀏覽器玩家用真實時鐘。
- **去重狀態 1 小時。** 超過 1 小時才重送的重複事件，Flink 不會擋，只有 `events` 的 ReplacingMergeTree 會收掉。
- **合成後的史萊姆沒有新美術。** 階級用 T2/T3 徽章、特性用光暈（CSS）。合成與擴建是按鈕，沒有分頁。

## 7. 文件地圖

| 檔案 | 看什麼 |
| --- | --- |
| `docs/design.md` | 遊戲與資料管線的完整設計（繁中），規則與數字的依據 |
| `docs/pipeline.md` | 資料流圖：服務之間、表之間，附設計理由 |
| `docs/system.md` | 本頁：有什麼、在哪、怎麼起 |
| `docs/decisions/` | 遊戲規則的決策紀錄（例如 M3 合成規則） |
| `docs/asset-integration.md` | 美術如何對到畫面 |
| `CLAUDE.md` | 給 Claude Code 的專案指引與指令 |
| `.claude/PROGRESS.md` | 目前進度、下一步、尚未驗證的事 |
| `.claude/DECISIONS.md` | 基礎設施的決策（為什麼這樣選） |
| `CREDITS.md` | 第三方字型與音效授權 |
