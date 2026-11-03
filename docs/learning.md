# 數據鏈路學習筆記

給熟悉資料工程、但不熟 Kafka / Flink / ClickHouse 的讀者。一課一節,依序讀。圖與表的來源是 `docs/pipeline.md`、`pipeline/flink/job.sql`、`pipeline/clickhouse/init.sql`、`docker-compose.yml`。

## 學習進度(下次從這裡接)

| 項目 | 狀態 |
| --- | --- |
| 第 1 課 Kafka | 完成 |
| 第 2 課 Collector(含 schema 演進,第 7–10 節) | 完成 |
| 處理線總覽(6 條線) | 完成 |
| 第 3 課 Flink:table、watermark、window | 完成 |
| 第 3 課 Flink:state、changelog | 完成 |
| 第 4 課 `job.sql` 逐段讀 | 完成(練習題 1–4 檢討完畢) |
| 第 5 課 ClickHouse | 完成(練習題 1–5 檢討完畢) |
| 第 6 課 問題:client 時鐘與 watermark | 未講(結論已在文末「已知問題」,未實測) |
| 練習題 1–9 | 已作答;**檢討完畢**(含 Flink 停機延伸題) |

練習題中還不穩的地方(下次檢討重點):
- 第 6 題:`upsert-kafka` 每次送出都是 Kafka 上新的一則;每一列是視窗的累計值(不是增量),所以不加 `FINAL` 會重複加總。
- 第 7 題:線 3 不去重,專門數重複。
- 第 8 題:新增事件類型,`schema.ts` 要改、`npm run schema` 要重跑、collector 要重啟;否則進 DLQ。
- 哪些東西是「啟動時載入」或「只在首次執行」:`event.schema.json`、`init.sql`、Flink job 定義。

專案另外在學習過程中發現的問題(靜態讀碼,未實測),已記入 `.claude/PROGRESS.md` 的 Open 區:
- client 時鐘決定 watermark,一筆時間錯誤的事件能讓其他玩家的事件被視窗丟掉。
- collector 對「body 不是 JSON」回 400,不進 DLQ,與「不默默丟」原則不符。

## 課程地圖

1. Kafka:topic、partition、offset、consumer group(已寫)
2. Collector → Kafka:key 與 partition 怎麼決定
3. Flink 概念:event time、watermark、window、state、changelog
4. `job.sql` 逐段讀
5. ClickHouse:MergeTree、Kafka 引擎、MV、Replacing、`FINAL`
6. 回頭看問題:client 時鐘為什麼會弄壞 watermark

整條鏈路:

```
遊戲/bot → Collector → Kafka(events / events.dlq) → Flink → Kafka(ch.*) → ClickHouse → 儀表板
```

---

## 第 1 課:Kafka

### 它是什麼

Kafka 是只能往後附加(append-only)的 log。生產者在尾巴寫入,消費者從自己記住的位置往後讀。和 queue 不同:讀過的資料不會消失,可以重讀。

### 名詞

| 名詞 | 意思 | 本專案的例子 |
| --- | --- | --- |
| topic | 一個命名的 log | `events`、`events.dlq`、`ch.production_1m` |
| partition | topic 切成幾條獨立的 log。每條內部有順序,條與條之間沒有順序 | 實際條數看 Kafka UI(topic 由 collector 自動建立,沒有明確設定,很可能是預設值 1) |
| offset | 一條 partition 裡每筆訊息的編號。完整位置是「第 N 條 partition 的第 M 筆」 | `ch.events` end offset 38069 |
| consumer group | 一組共同讀 topic 的消費者,Kafka 替這組記住讀到哪 | `flink-events`、`flink-typed`、`flink-sent`、`clickhouse-events` |

### Partition

把 topic 切成幾條獨立的 log,讓不同機器同時寫、同時讀。

```
topic: events
  partition 0:  [e1][e4][e5][e9] →
  partition 1:  [e2][e3][e7]     →
  partition 2:  [e6][e8]         →
```

寫入時帶 key:同一個 key 做 hash 後永遠落在同一條 partition;沒有 key 則輪流分配。

Collector 用 `player_id` 當 key(`collector/main.py`):

```python
{"topic": "events", "key": raw["player_id"], ...}
```

所以同一個玩家的事件在同一條 partition。

### Consumer group 與 partition 的規則

- 同一個 group 內:一條 partition 只給一個消費者。一個消費者可以拿多條 partition。消費者比 partition 多,多的閒置。
- 不同 group 之間:互不影響,各自記自己的 offset,各讀一遍。
- 為什麼同組內一對一:為了保證順序。同一條 partition 的兩筆訊息若分給兩個消費者,處理完的先後會和 partition 內的順序不一致。
- 消費者掛掉:Kafka 做 rebalance,把它的 partition 分給組內其他消費者,從 group 記住的 offset 繼續。

### 順序保證

key = `player_id` + 一對一,合起來:同一玩家的事件依「寫入 Kafka 的順序」被同一個消費者處理。

- 保證的是寫入 Kafka 的順序,不是玩家實際操作的順序。事件經網路到達 collector 時若顛倒,Kafka 裡就是顛倒的。事件上有 `seq` 和 `event_time` 可用來判斷。
- 跨 partition 沒有順序保證。
- 本專案不靠這個保證維持正確:`player_state` 用 `max` / `min` / `argMax by event_time` 冪等合併;Flink 視窗按 `event_time` 分,不按到達順序。

### 兩個節點與 replication

`docker-compose.yml` 有 `kafka` 和 `kafka2`。

- `KAFKA_DEFAULT_REPLICATION_FACTOR: 2`:每條 partition 在兩個節點各存一份(一個 leader,一個 follower)。
- `kafka` 同時是 broker 與 controller;`kafka2` 只是 broker。`kafka` 掛掉時叢集失去 controller,所以 replication 2 不等於高可用。
- 位址:`localhost:9092` 給你的機器(collector、bot)連;`kafka:29092` 給 docker 內部容器(Flink、ClickHouse)連。

### 本專案的 topic

| topic | 誰寫 | 誰讀 |
| --- | --- | --- |
| `events` | collector(合法事件) | Flink,三個 group:`flink-events`、`flink-typed`、`flink-sent` |
| `events.dlq` | collector(壞事件) | ClickHouse `clickhouse-dlq`(不經 Flink) |
| `ch.events` | Flink(攤平後的事件) | ClickHouse `clickhouse-events` |
| `ch.production_1m`、`ch.pipeline_1m`、`ch.ops_1m`、`ch.late_1m` | Flink(視窗結果,upsert) | ClickHouse,各有一個 group |

### 三個練習題與答案

**1. `events` 被讀了三次,資料為什麼沒被「讀掉」?**
Kafka 不是 queue,訊息留在 log 裡,保留多久由 retention 決定。「讀到哪」由消費者那邊的 group offset 記錄,三個 group 各有自己的 offset,讀取只是移動指標。

**2. 把 `flink-typed` 改名再提交 job,會發生什麼?**
新名字的 group 沒有 offset 記錄,由 `scan.startup.mode = earliest-offset` 決定:從 `events` 最舊的訊息重讀整個 topic。

- 視窗重算,三張 `*_1m` 表再收到一份結果。它們是 `ReplacingMergeTree(version)`,同一個視窗留 version 最大的列,重複被吸收。
- 重讀舊資料時 watermark 會往前跑,可能丟掉比 15 分鐘更舊的視窗(`late_1m` 只有 live 才有意義)。
- `events` 表會有重複列,merge 後才收斂,在那之前用 `count()` 的 KPI 會偏高。
- 舊 group 的 offset 留在 Kafka,沒人用。
- `scripts/flink-restart.sh` 用 savepoint 就是為了避免這件事:savepoint 把 offset 一起存下來。

**3. Flink 寫 `ch.*` topic 而不是直接寫 ClickHouse,好處?**
- 解耦故障:ClickHouse 掛掉時資料留在 Kafka,Flink 不會背壓或停住,ClickHouse 回來後從自己的 offset 接著讀。
- 拉取而非推送:ClickHouse 自己決定讀多快。
- 可重放:表壞了或要重建,重設 offset 就能再讀一遍。
- 代價:多一層 topic、多一組 `kafka_*` 表和 MV;刪掉 topic 會讓 ClickHouse 的 consumer 卡住(見 `docs/pipeline.md` operating notes)。

### 動手看

```
docker compose up -d kafka kafka2 kafka-ui
```

開 http://localhost:8080,看 Topics 頁:partition 數、replica、各 partition 的 offset,點進 `events` 看一筆 JSON。

---

## 設計問答

### 為什麼聚合也要 Flink 算?不能 Flink 只攤平寫入 ClickHouse,由 ClickHouse 算聚合嗎?

可以。技術上 ClickHouse 自己算大部分聚合就夠了。專案用 Flink 算,主要是為了學習與展示,不是非它不可。

ClickHouse 自己算已經在發生:`leaderboard`、`efficiency`、`activity_daily`、`player_state` 都是從 `slime.events` 算的。`production_1m` 也可以寫成:

```sql
SELECT toStartOfMinute(event_time) AS window_start, client, station, sum(produced), ...
FROM slime.events FINAL
GROUP BY window_start, client, station
```

或用 materialized view + `AggregatingMergeTree` 在寫入時累積。好處:
- 不需要 watermark:遲到事件只是多一列,下次查詢自然算進去。
- 不需要 `version` 和 upsert。
- 少一個系統:不用維護 Flink、`ch.*` topic、`kafka_*` 表。
- 第 6 課的時鐘問題不存在:沒有 watermark,就沒有「被丟掉的視窗」。

Flink 的價值:

| 能力 | 說明 |
| --- | --- |
| 計算時機 | 資料流過就算,結果預先算好;ClickHouse 方案是查詢時算(或靠 MV) |
| 有狀態的串流邏輯 | 去重(同一個 `event_id` 只算一次)、session 判斷、跨事件關聯,用 SQL 聚合不好表達 |
| 事件時間語義 | 明確的 watermark 與 allowed lateness,精確控制「多晚算太晚」 |
| 多個 sink | 同一份結果可送到 ClickHouse 以外的地方 |
| 規模 | 資料量大到查詢時聚合太慢,或要即時告警時,串流處理才有明確優勢 |

本專案的情況:
- 資料量是 demo 規模,ClickHouse 查詢時聚合綽綽有餘。
- `docs/design.md:211` 的選型理由:「Flink 串流原生,事件時間、watermark、狀態去重都是核心設計」,也就是專案要展示的正是這些概念。
- 專案目的包含熟悉這些不熟的服務,全丟給 ClickHouse 就沒地方練 Flink。

結論:要「最簡單且正確的儀表板」,Flink 只攤平、ClickHouse 聚合更簡單,也避開 watermark 丟資料。要「學串流處理」,保留 Flink 聚合合理,代價是第 6 課那類問題,而那些問題本身就是串流處理的教學內容。專案現在選的是後者。

---

## 處理線總覽

整條鏈路共 6 條處理線:5 條在 Flink(`job.sql` 的 `EXECUTE STATEMENT SET` 有 5 個 `INSERT`,是一個 job),1 條不經過 Flink。

| # | 來源 | Flink 做什麼 | Flink sink → topic | ClickHouse 表 |
| --- | --- | --- | --- | --- |
| 1 | `events_raw` | 把 JSON 攤平成欄位,不去重、不開視窗 | `ch_events` → `ch.events` | `events`(原始事件) |
| 2 | `events_typed` → `events_dedup` | 去重 → 1 分鐘視窗,依 client、station 分組 | `ch_production_1m` → `ch.production_1m` | `production_1m` |
| 3 | `events_typed`(不去重) | 1 分鐘視窗,依 client、event_type 分組;數重複份數、延遲 | `ch_pipeline_1m` → `ch.pipeline_1m` | `pipeline_1m` |
| 4 | `events_typed` → `events_dedup` | 去重 → 1 分鐘視窗,依 client 分組;玩家數、session、購買、合併等 | `ch_ops_1m` → `ch.ops_1m` | `ops_1m` |
| 5 | `events_sent`(用 `sent_at` 當時鐘) | 1 分鐘視窗;數遲到的事件 | `ch_late_1m` → `ch.late_1m` | `late_1m` |
| 6 | 無 Flink | `events.dlq` 由 ClickHouse 直接讀 | 無 | `dead_letters` |

每條線在 ClickHouse 都是同一個模式:`Kafka 引擎表 (kafka_xxx) → MV (kafka_xxx_mv) → 真正的表`。

重點:
- 線 1 沒有任何聚合,是原始事件備份,也是 ClickHouse 內部計算的來源。
- 線 2、4 用去重後的資料;線 3 刻意不去重,因為要數重複幾份(`duplicates = COUNT(*) - COUNT(DISTINCT event_id)`)。
- 線 1 的重複事件 Flink 沒去掉,靠 `ReplacingMergeTree` 在 merge 時收斂,查詢要加 `FINAL`。
- 三個 source 表讀同一個 topic `events`,各有 consumer group 與 watermark。線 2、3、4 共用 `events_typed`(同一個 watermark);線 5 用 `events_sent`,時鐘是 `sent_at`,watermark 與其他線不同。

ClickHouse 內部的衍生計算(不在 6 條線裡):

| 來源 | 計算 | 產出 |
| --- | --- | --- |
| `events` → `player_state_mv` | 每筆事件進來時對每個玩家做 `max` / `min` / `argMax` 合併 | 表 `player_state` |
| `player_state` | 讀取時聚合 | view `leaderboard` |
| `events FINAL` | 讀取時聚合最近一小時 | view `efficiency` |
| `events` | 讀取時聚合 DAU / WAU / MAU | view `activity_daily` |

Collector 的 `/api/dashboard` 查詢上面這些表與 view,給儀表板用。

```
events ──┬─ [1 raw 攤平] ───────────────────────→ ch.events ────→ events ─┬→ player_state → leaderboard
         │                                                                ├→ efficiency
         │                                                                └→ activity_daily
         ├─ [typed → dedup → 窗口] ─┬─ [2] → ch.production_1m → production_1m
         │                          └─ [4] → ch.ops_1m        → ops_1m
         ├─ [typed(不去重) → 窗口] ─ [3] → ch.pipeline_1m   → pipeline_1m
         └─ [sent → 窗口(sent_at)] ─ [5] → ch.late_1m       → late_1m

events.dlq ─────────────────────────────────────────────────→ dead_letters
```

---

## 第 2 課:Collector(入口)

### 全貌

```
遊戲 / bot ──POST /events──→ collector ──┬─ 合法 → Kafka `events`     (key = player_id,加 ingested_at,回 202)
(JSON)                                   └─ 不合法 → Kafka `events.dlq` (key = null,帶原文與錯誤,回 422)
                                         └─ 不是 JSON → 回 400,什麼都不寫
```

程式在 `collector/main.py`(FastAPI),事件格式只在一處定義:`src/events/schema.ts`(zod)。

### 1. 事件從哪來

- 瀏覽器:`src/game/telemetry.ts`。`VITE_TELEMETRY=true` 才會建立 emitter,否則是 `null`,整段在 build 時被編譯掉(itch.io 版本不含送事件的程式)。送法是 `fetch(url, { method: 'POST', body: JSON.stringify(e), keepalive: true }).catch(() => {})`。`player_id` 是隨機產生、存在 localStorage。
- Bot:同一個 `makeEmitter`(`src/events/emitter.ts`),`client: 'bot'`;另外有重複、壞格式、斷線補送的注入。
- `makeEmitter` 蓋上共用欄位:`event_id`(UUID v7)、`seq`、`event_time`、`sent_at`。這兩個時間來自 client 時鐘,而且兩者填的是同一個值(`iso`),只有 bot 斷線補送時 `sent_at` 才會晚於 `event_time`。

### 2. 驗證:schema 只有一份

```
zod (schema.ts) ──npm run schema──→ event.schema.json ──→ Python jsonschema
```

- `GameEvent` 是 zod 的 discriminated union,以 `event_type` 區分,共 11 種事件。
- `npm run schema` 把它匯出成 JSON Schema;vitest 會檢查匯出檔是否過期。
- Python 端(`main.py` 第 19 行)讀 `oneOf`,依 `event_type` 的 `const` 建立一個 `{event_type: validator}` 的表。`validate()` 先查 `event_type` 對應哪個 validator,再只用那個 validator 驗證。未知的 `event_type` 直接回 `unknown event_type`。
- 這樣做(我的推測,程式沒寫理由):錯誤訊息只列出該事件類型自己的欄位問題,不會是 `oneOf` 籠統的「沒有一個分支符合」。
- 驗證的是格式(欄位在不在、型別對不對、`event_time` 是不是 ISO 時間字串),不檢查時間合不合理。

### 3. `route()`:兩條路

```python
if error is None:
    {"topic": "events", "key": raw["player_id"], "value": {**raw, "ingested_at": _iso(now_ms)}}
else:
    {"topic": "events.dlq", "key": None, "value": {"raw": raw, "error": error, "ingested_at": _iso(now_ms)}}
```

- `ingested_at` 是 collector 自己的時鐘,寫在 `**raw` 之後,所以 client 即使自己填了 `ingested_at` 也會被蓋掉。它是整條鏈路唯一不來自 client 的時間。
- 合法事件的 key = `player_id`(見第 1 課:同一玩家落在同一條 partition)。DLQ 沒有 key,partition 輪流分配。
- DLQ 訊息帶原文 `raw`、錯誤原因 `error`、`ingested_at`,之後 ClickHouse 直接讀進 `dead_letters`。

### 4. HTTP 層(`POST /events`)

- 回應:合法 202,不合法 422,body 不是 JSON 400。
- 用 `send_and_wait`:等 Kafka 確認寫入才回應,所以 202 代表 Kafka 已收到(確認程度取決於 producer 的 `acks` 設定,我沒查 aiokafka 預設值)。代價是每個請求要等一次 Kafka 往返。
- 沒設 `KAFKA_BROKERS` 時不連 Kafka,只印到 stdout(開發模式)。
- CORS 設 `allow_origins=["*"]`:瀏覽器從 `:5173` 打 `:3000` 是跨來源,JSON 的 content-type 會觸發 preflight。
- 同一個 process 還提供 `/dashboard` 與 `/api/dashboard`(第 5 課之後再講)。

### 5. 這個入口的缺口(值得知道)

| 缺口 | 說明 |
| --- | --- |
| body 不是 JSON → 400,**不進 DLQ** | 專案原則是「不合法的事件進 DLQ,不默默丟掉」。這一種被直接拒絕,沒有任何紀錄。瀏覽器端 `.catch(() => {})` 也不會看回應 |
| 瀏覽器送失敗就丟 | `fetch(...).catch(() => {})`,沒有重試也沒有暫存。只有 bot 有斷線暫存與補送 |
| 不檢查時間 | `event_time` 可以是任何合法的 ISO 時間。這是第 6 課問題的入口 |
| 不去重 | 收到幾次就寫幾次。去重在 Flink(`events_dedup`)與 ClickHouse(`ReplacingMergeTree`) |
| 沒有驗證身分 | CORS 全開、沒有 token。`player_id`、`client` 都是 client 自己宣告的,瀏覽器可以自稱 `client: 'bot'` |
| Topic 自動建立 | `KAFKA_AUTO_CREATE_TOPICS_ENABLE=true`,第一批請求可能在 topic 建好之前失敗(`PROGRESS.md` 提過)。partition 數是 Kafka 預設值,沒有明確設定 |

### 6. 遊戲送出的事件長什麼樣

`event_id` 由遊戲生(`emitter.ts` 的 `uuid7(now)`),不是 collector。Collector 只驗格式(`z.uuidv7()`)。去重靠它:重送必須帶同一個 `event_id`,Flink 的 `events_dedup` 才認得出;若 collector 收到時才生,每次重送都是新 ID,就無法去重。UUID v7 前 48 bit 是毫秒時間戳,取自 client 的 `now`,其餘隨機。`session_id` 也是遊戲生的(`s-` + 4 個隨機字元)。

以下範例是依 `schema.ts` 與 `emitter.ts` 推出來的,不是從運行中的系統擷取,數值是編的。

```json
{
  "event_id": "0198a3f2-7c41-7b3e-9d2a-5e8f1c0b4a66",
  "event_type": "session_start",
  "schema_version": 2,
  "game_version": "0.1.0",
  "player_id": "player-3f9a1c2e",
  "session_id": "s-7b2d",
  "client": "browser",
  "bot_persona": null,
  "seq": 0,
  "event_time": "2026-10-30T12:00:00.123Z",
  "sent_at": "2026-10-30T12:00:00.123Z",
  "offline_seconds": null,
  "is_new_player": true
}
```

`production_tick`(最豐富的一種)多了 `window_start`、`window_end`、`stations`(陣列,每個 station 一筆 `slimes / level / produced / consumed / input_stock`)、`bread_sold`、`coins_earned`、`coins_balance`、`slimes_owned`、`achievements_unlocked`。

| 欄位 | 誰填 | 意思 |
| --- | --- | --- |
| `event_id` | 遊戲 | UUID v7,事件唯一識別,去重用 |
| `event_type` | 遊戲 | 事件種類,collector 依它選驗證分支 |
| `schema_version` | 遊戲 | emitter 目前固定送 2 |
| `game_version`、`player_id`、`session_id` | 遊戲 | `player_id` 存在 localStorage,也是 Kafka key;`session_id` 每次載入頁面重生 |
| `client`、`bot_persona` | 遊戲 | `browser` / `bot`;瀏覽器的 persona 是 `null` |
| `seq` | 遊戲 | 每個 emitter 一個遞增計數器,從 0 開始;瀏覽器重載頁面就重來,所以只能比同一 session 內的順序 |
| `event_time`、`sent_at` | 遊戲 | client 時鐘;通常相同,bot 斷線補送時 `sent_at` 才會晚 |
| `ingested_at` | collector | collector 時鐘,遊戲不送 |

事件專屬欄位(11 種各有各的)在 ClickHouse `events` 表裡都在 `payload`(整行 JSON 原文)。

### 7. `schema_version`:新舊事件並存

**它在哪裡真正生效:只有 collector 的驗證。** 我 grep 過整個 repo:

| 地方 | 做什麼 |
| --- | --- |
| `schema.ts` 的 `base` | 只接受 `1` 或 `2`,其他(例如 3、9)驗證失敗 → 進 DLQ |
| v2 專屬事件(`slime_merged`、`station_expanded`、`feature_unlocked`) | `schema_version` 必須是字面值 2。舊 client 不可能產生它們,所以 `version: 1` 的這類事件被拒絕 |
| `emitter.ts` | 一律蓋 2 |
| Flink `job.sql`、ClickHouse `init.sql` | 只是原樣帶過去,存成一個欄位(`INT` / `UInt8`) |
| 任何查詢或 Flink 邏輯 | 沒有人依 `schema_version` 分支。儀表板也沒有依版本分的面板(`PROGRESS.md` 的 Next 列了「per-schema-version panel」,還沒做) |

**為什麼要並存:**
- Kafka 與 ClickHouse 裡已經有 v1 的歷史事件;重新提交 Flink job 會從 `earliest-offset` 重讀,一定會讀到 v1。
- 還在跑舊版遊戲的瀏覽器(快取、尚未更新)仍會送 v1。
- 實測過:`PROGRESS.md` 的 E2E 紀錄「schema v1 2727 + v2 14885 events coexist」。

**為什麼不用在下游寫分支:** v2 的規則是只新增事件與可選欄位(`slime_assigned` 多了可選的 `tier`、`trait`),不改既有欄位的意思。這樣 v1 事件在 v2 的 schema 下仍然合法,下游處理不用判斷版本。加上 `payload` 保留完整 JSON,新事件類型不用改 DDL。這種相容性叫向後相容(backward compatible)。

**什麼時候 `schema_version` 才會真的需要:** 一旦要改既有欄位的意思或型別(不相容的變更),下游就要依版本分支處理,這時 `schema_version` 才是必要的判斷依據。目前它的作用是 collector 的守門,加上之後診斷與統計用的標記。

### 8. 不相容的變更怎麼處理(例:`coins_balance` 單位從「個」改成「千個」)

不要分成兩張表。分表要每個查詢 `UNION`、每加一版多一張;同一個玩家先送 v2 再送 v3(瀏覽器更新後很常見)會被拆開,`leaderboard` 無法 `argMax` 出最新值;Flink sink、Kafka 表與 MV 都要複製一套。只有兩版結構根本不同時才值得。

做法依優先順序:

1. 先想能不能不做不相容的變更:新增欄位(例如 `coins_balance_k`),舊欄位照送。這就是只新增的變更,不需要下游分支。
2. 真的要改意思:選一個標準單位(通常是舊的),在進入衍生層時依 `schema_version` 轉成標準單位(upcast)。`coins_balance` 只在 `init.sql` 的 `player_state_mv` 被讀:

```sql
argMaxStateIf(JSONExtractFloat(payload, 'coins_balance') * if(schema_version >= 3, 1000, 1),
              event_time, event_type = 'production_tick') AS coins
```

`events` 表有 `schema_version` 欄位,MV 可直接分支。好處:`events` 只有一張、`payload` 原文不動、舊資料已是標準單位不必改、要修錯可從 `events` 重算 `player_state`。

受影響的地方(讀 `init.sql` 與 `job.sql` 的推斷,沒有實際改過):`player_state_mv`、間接影響 `leaderboard`;`efficiency`、`ops_1m`、`production_1m` 讀的是 `coins_earned`,這個例子不受影響,若改的是 `coins_earned` 就都要改。

原則:原文照存,在衍生層統一。

### 9. Schema 演進的通用做法

**相容性的三個詞**

| 詞 | 意思 | 本專案的例子 |
| --- | --- | --- |
| 向後相容 (backward) | 新版讀得懂舊資料 | v2 的 collector 接受 v1 事件 |
| 向前相容 (forward) | 舊版讀得懂新資料(忽略不認得的欄位) | 舊 job 讀到多了欄位的事件 |
| 完全相容 (full) | 兩者皆是 | |

部署順序決定需要哪一種。先升 consumer、後升 producer,需要向後相容;反過來需要向前相容。

**安全與不安全的變更**

| 通常安全 | 不安全 |
| --- | --- |
| 新增可選欄位、新增事件類型 | 改名、刪除欄位 |
| 放寬限制(必填 → 可選) | 改型別、改單位、改意思 |
| | 收緊限制(可選 → 必填) |

**常見手法**

| 手法 | 做法 |
| --- | --- |
| 展開再收縮 (expand / contract) | 要改名或換型別時分階段:新增新欄位 → 同時寫新舊 → 把讀的人遷移到新欄位 → 過一個保留期後刪舊欄位。每一步都相容 |
| 讀取時升級 (upcast) | 舊事件在讀取時轉成最新格式,只維護一份最新邏輯。事件溯源(event sourcing)常用 |
| 寬鬆讀取 (tolerant reader) | 讀者忽略不認得的欄位、缺欄位給預設值。本專案把完整 JSON 存進 `payload` 就是這個精神 |
| Schema registry | 把 schema 與相容規則(BACKWARD / FORWARD / FULL,以及對所有歷史版本檢查的 TRANSITIVE)集中管理,producer 註冊新 schema 時由 registry 擋下不相容的。常配 Avro / Protobuf。本專案沒有 registry,以 zod 單一來源加匯出的 JSON Schema 代替 |
| 新 topic | 不相容的大改動:開 `events.v3`,新舊並行,遷移完再關舊的 |
| 版本號 | 訊息帶版本(本專案做法),讓讀者知道怎麼處理 |
| DLQ | 不認得的版本不丟,進 DLQ(本專案 collector 已做:版本 3、9 進 `events.dlq`) |
| 重放 / 重建 | 原始事件完整保留,衍生表可以從原始事件重算。這是處理錯誤與回填的後路 |
| 淘汰期 | 舊版本要等舊 client 都消失才能移除。有「per-schema-version panel」就能看見各版還有多少流量,據此決定何時停用 v1(本專案還沒做) |

**各層的注意事項**

- ClickHouse:`ALTER TABLE ... ADD COLUMN` 很快、不改舊資料;但 `ORDER BY` 排序鍵不能改,要改就得建新表、`INSERT ... SELECT`、再換名。
- Flink SQL:json format 讀到缺的欄位是 null(忽略多出的欄位)。已有 state 的聚合 job,改欄位或聚合內容可能無法從 savepoint 還原(`flink-restart.sh` 的限制),就要整個重放。
- 防呆:本專案有 vitest 檢查 `event.schema.json` 是否過期;可再加一個測試,拿舊版範例事件對新 schema 驗證,確保沒有意外破壞向後相容。這是建議,尚未實作。

### 10. 練習:把 `station` 改名為 `station_id`

這是改名,不是改型態(兩者都是 `farm / mill / bakery` 字串)。改名是不相容變更的典型,用展開再收縮處理。

直覺做法(新 client 只送 `station_id`、`station` 留空,聚合時整合)方向對(整合就是 upcast:`COALESCE(station_id, station)`),但有兩個問題:

- `schema.ts` 的 `station` 是必填 `z.enum`,留空會驗證失敗,事件進 DLQ(影響 `station_upgraded`、`station_expanded`、`slime_assigned`、`production_tick.stations[]` 等)。所以第一步是改 schema,不是改 client。
- 新 client 若不送 `station`,舊的 Flink job、舊查詢、還沒升級的下游讀不到。

正確順序:先讓讀的人準備好,再讓寫的人換,最後才移除舊的;過渡期新舊欄位都送。

| 步驟 | 做什麼 | 為什麼這個順序 |
| --- | --- | --- |
| 1. Schema 同時接受兩者 | `station` 改可選、新增可選 `station_id`、規定至少有一個;collector 先升級 | 讀的人先準備好 |
| 2. 讀取端統一 | Flink `events_typed` 的 `ROW` 加 `station_id`,聚合用 `COALESCE(s.station_id, s.station)`;ClickHouse 的 MV 與 view 同理 | 新舊事件都算得進去 |
| 3. Client 兩個都送 | 展開階段 | 舊下游仍讀得到 `station` |
| 4. 觀察 | 看還有多少舊 client 只送 `station`(per-version 面板) | 決定能不能收縮 |
| 5. 收縮 | client 停送 `station`;`station_id` 改必填;過保留期後移除 `station` | 舊 client 都消失才能做 |

本專案的兩個細節:
- Flink 的 `GROUP BY` 從 `s.station` 變成 `COALESCE(...)`,已有 state 的 job 大概無法從 savepoint 還原,要整個重放。
- ClickHouse 輸出表(如 `production_1m`)的 `station` 在 `ORDER BY` 裡,據我所知不能重新命名排序鍵上的欄位(未實測)。只統一輸入,輸出欄位仍叫 `station`,儀表板查詢就不用動。

---

## 第 3 課(進行中):Flink 的 table 與 watermark

### Flink 的 table 是宣告,不是處理階段

`CREATE TABLE` 只登記「這個 topic 的訊息長什麼樣」,不存資料。`events_raw`、`events_typed`、`events_sent` 都是對 Kafka `events` 的獨立宣告,各自連 Kafka、各有 consumer group 與 offset,不是上下游:

```
events (Kafka) ──┬─→ events_raw    (format=raw,  group=flink-events)
                 ├─→ events_typed  (format=json, group=flink-typed)
                 └─→ events_sent   (format=json, group=flink-sent)
```

- `events_raw`:整行當字串 `line`。目的是保留原始 JSON,放進 ClickHouse `events.payload`(`player_state`、`efficiency` 之後靠它取欄位;新事件類型不用改 DDL)。用 `json` format 讀會丟掉沒宣告的欄位,原文就沒了。
- `events_typed`:用 `json` format 解析成有型別的欄位(`job.sql` 第 31–44 行),並宣告 watermark,供視窗聚合。做四件事:欄位對應(`stations` 是 `ARRAY<ROW<...>>`,線 2 用 `UNNEST` 展開)、宣告 watermark、算衍生欄位 `latency_ms`(= `ingested_at` − `event_time`)、讀取設定(`flink-typed` group、`earliest-offset`、`json.ignore-parse-errors`)。
- 為什麼 typed 不從 raw 往下接:據我所知 `WATERMARK` 只能寫在 `CREATE TABLE`,view 上不行(依 Flink SQL 文法判斷,未在此環境實測);而且巢狀陣列用 `JSON_VALUE` 一欄一欄取很繁瑣。
- 代價:`events` 被讀三次,對 Kafka 的讀取量是三倍;換來三條線的 offset 與 watermark 互相獨立。
- `json.ignore-parse-errors = true`:解析失敗的那筆事件會從聚合裡默默消失。collector 已先驗證 schema,正常不會觸發。

### 事件時間與 watermark

問題:事件不照時間順序到達(網路延遲、離線、重送)。Flink 如何判斷「12:00–12:01 這個視窗已經到齊,可以送出」?

| | 事件時間 (event time) | 處理時間 (processing time) |
| --- | --- | --- |
| 意思 | 事件發生的時間(資料裡的 `event_time`) | Flink 處理到它的時間(系統時鐘) |
| 本專案 | 使用 | 沒用到 |

Flink 看不到「現在幾點」,只能從資料裡的 `event_time` 推測時間走到哪。

**Watermark = Flink 對「事件時間已經走到哪裡」的估計**:「`event_time` 早於 W 的事件,我相信都到齊了」。

```sql
WATERMARK FOR event_time AS event_time - INTERVAL '10' SECOND
```

意思:watermark = 目前看到的最大 `event_time` 減 10 秒(容忍最多 10 秒亂序)。Watermark 只會往前,不會倒退。

視窗 [12:00:00, 12:01:00) 的例子:

| 到達順序 | event_time | 目前最大 event_time | watermark |
| --- | --- | --- | --- |
| 1 | 12:00:30 | 12:00:30 | 12:00:20 |
| 2 | 12:00:58 | 12:00:58 | 12:00:48 |
| 3 | 12:00:45(亂序) | 12:00:58 | 12:00:48(不倒退) |
| 4 | 12:01:12 | 12:01:12 | 12:01:02,越過 12:01:00,視窗送出 |

### 兩層容忍

| 設定 | 意思 |
| --- | --- |
| watermark 延遲 10 秒(`events_typed` 的 `WATERMARK`) | 視窗要等多久才第一次送出 |
| allowed lateness 15 分鐘(`job.sql` 第 6 行,配合 `late-fire`) | 視窗送出後還能修正多久;期間來的遲到事件會算進去,視窗重新送出更新後的結果 |

重新送出,所以 sink 用 `upsert-kafka`,`version`(視窗內筆數)只增不減,ClickHouse `ReplacingMergeTree(version)` 留最大的那列。超過 15 分鐘的遲到事件被丟掉。

### 多個來源與 idle

Flink 有多個平行的讀取任務,各有自己的 watermark,整個 job 取最慢的那個。某個任務沒資料,watermark 不動,全部卡住。`job.sql` 第 3 行 `idle-timeout = 10 s`:某個來源 10 秒沒資料,就暫時不算進去。

### 沒有事件的時候(練習題)

問:collector 一整分鐘沒收到事件,視窗會送出嗎?
答:不會。視窗是否結束只看 watermark 有沒有越過結束時間,Flink 沒有牆上時鐘;沒有新事件就沒人推 watermark。`idle-timeout` 無助於此:它只排除多個來源中閒置的那個,所有來源都沒資料時,watermark 仍不動。

結果:
- 靜默之前尚未結束的視窗會壓著不送。
- 下一筆事件到達時,watermark 一次跳到它的 `event_time` 減 10 秒,所有等著的視窗同時送出。
- 完全沒有事件的那一分鐘不會有任何一列(不是 0),圖表上是缺口。
- 這就是 `PROGRESS.md` 說的「run 結束時最後一個視窗不會送出,比對時要排除最新一分鐘」。

### buffer 大小的取捨

Watermark = 最大 `event_time` − buffer。視窗要等 watermark 越過結束時間才送出。buffer 越大,Flink 等得越久才出發,不是更早。

| buffer | 視窗 [12:00, 12:01) 送出的條件 | 送出時間 | 容忍的亂序 |
| --- | --- | --- | --- |
| 10 秒 | 看到 `event_time` ≥ 12:01:10 的事件 | 較早 | 最多 10 秒 |
| 60 秒 | 看到 `event_time` ≥ 12:02:00 的事件 | 晚約 50 秒 | 最多 60 秒 |

buffer 小:結果快,但晚到的事件較容易算遲到。buffer 大:結果慢,漏掉的少。取最大 `event_time` 而不是最新一筆:先收到 `00:10:00` 再收到 `00:09:58`,watermark 仍是 `00:09:50`,不倒退。

### 視窗更新:Kafka 重送,ClickHouse overwrite

遲到事件算進已送出的視窗時:

- Flink / Kafka 層:重送。Flink 把整個視窗的新結果(不是增量)當一則新訊息寫到 `ch.*` topic,key 相同(例如 `window_start, client, station`)。Kafka 是 append-only,舊訊息還在 log 裡。
- ClickHouse 層:overwrite,而且是惰性的。兩列都進表,`ReplacingMergeTree(version)` 在背景 merge 時只留 `version` 最大的那列。merge 之前兩列並存,查詢要加 `FINAL`,否則讀到新舊兩列、數字重複。
- `version` = 視窗內筆數,只增不減,所以「新蓋舊」靠比大小,不用知道到達順序。
- `late-fire.delay = 0 s`:每收到一筆遲到事件就重送一次,同一個視窗可能被送出很多次,寫入有放大。
- `late_1m` 用 `sent_at` 開視窗,所以補送的事件算在補送那幾分鐘,不是原本發生的那幾分鐘。

### 超過 allowed lateness 就丟掉

規則:視窗狀態在 `watermark ≥ 視窗結束時間 + 15 分鐘` 時清掉,之後屬於該視窗的事件被丟掉。「15 分鐘」是相對於 watermark,不是補送的長度。

例:bot 12:20 補送 `event_time` 12:00–12:20 的事件,watermark 約 12:19:50:

| 事件 `event_time` | 結果 |
| --- | --- |
| 12:00–12:04(視窗結束時間 ≤ 12:04:50) | 丟掉 |
| 12:05–12:20 | 算進去,視窗重新送出 |

丟掉的事件去向:

| 地方 | 有沒有 |
| --- | --- |
| `events`(線 1,沒有視窗) | 有 |
| `production_1m`、`ops_1m`、`pipeline_1m` | 沒有 |
| `late_1m`(用 `sent_at`,補送當下視窗還開著) | 有,算成遲到事件 |
| `dead_letters`(只收 schema 不合法的) | 沒有 |

Flink 這層是默默丟:沒有錯誤、沒有 DLQ、沒有日誌。線索是兩邊對不上:`late_1m.late_events` 說有這麼多遲到,但 `production_1m` 的總和比 `events FINAL` 少,差距就是被丟的量。`PROGRESS.md` 的「前後兩次 bot 連續跑掉 52 筆」就是這種情況。資料沒有真的遺失(`events` 還在),補救:事後用 ClickHouse 對 `events` 重算,或加大 allowed lateness(代價是 Flink 狀態更大)。

### Window(視窗)

串流是沒有盡頭的,`GROUP BY` 不知道何時算完。視窗把串流按時間切成有限的一段一段,每段算一次結果。本專案只用 tumbling window(滾動視窗):固定長度、不重疊、首尾相接。

```
時間軸:  |-- 12:00 --|-- 12:01 --|-- 12:02 --|
視窗:    [12:00,12:01)[12:01,12:02)[12:02,12:03)    起點含、終點不含
```

`job.sql` 的寫法(線 2):

```sql
SELECT DATE_FORMAT(TUMBLE_START(event_time, INTERVAL '1' MINUTE), 'yyyy-MM-dd HH:mm:ss'),
       client, s.station, COUNT(DISTINCT player_id), ..., SUM(s.produced), ..., COUNT(*)
FROM events_dedup CROSS JOIN UNNEST(stations) AS s
WHERE event_type = 'production_tick'
GROUP BY TUMBLE(event_time, INTERVAL '1' MINUTE), client, s.station;
```

- `TUMBLE(event_time, INTERVAL '1' MINUTE)` 放在 `GROUP BY` 裡:依每一列的 `event_time` 決定它屬於哪個一分鐘視窗,再按 `(視窗, client, station)` 分組。`TUMBLE_START` 取視窗起點,當作輸出的 `window_start`。
- 沿用 SQL 的 `GROUP BY`,只是多了一個「時間桶」當分組鍵。每個 `(視窗, client, station)` 輸出一列。
- 視窗按 UTC 對齊(`job.sql` 第 1 行 `table.local-time-zone = UTC`)。
- 用「group window」寫法而不是 `TUMBLE` 表函數:`job.sql` 的註解說表函數加 view 在 statement set 裡會觸發 planner bug。
- 線 5 的視窗用 `sent_at` 而不是 `event_time`(`TUMBLE(sent_at, ...)`),所以它按「送出時間」分桶,第 3 課前面已說明原因。

例子(線 2,farm,12:00 這一分鐘,三筆 tick):

| `event_time` | player | `produced` |
| --- | --- | --- |
| 12:00:05 | A | 10 |
| 12:00:10 | A | 12 |
| 12:00:20 | B | 8 |

輸出一列:`window_start = 12:00:00, station = farm, players = 2`(`COUNT(DISTINCT player_id)`)`, produced = 30, version = 3`(`COUNT(*)`,視窗內的列數)。12:01:00 整的事件屬於下一個視窗。

**視窗的生命週期**(把 watermark 和 allowed lateness 串起來):

```
1. 視窗開啟:第一筆屬於它的事件到達,Flink 開始累積
2. watermark 越過視窗結束時間 → 第一次送出結果
3. 之後 15 分鐘內:每筆遲到事件 → 重新送出更新後的結果(late fire)
4. watermark 越過「結束時間 + 15 分鐘」→ 清掉這個視窗的狀態,之後的遲到事件被丟掉
```

為什麼需要視窗(而不是不分視窗的 `GROUP BY`):不加視窗的串流 `GROUP BY` 永遠不知道何時算完,每個 key 的狀態要永遠保留。視窗有明確結束,狀態可以清理。這就接到下一個主題 state。

### 會重疊的視窗:滑動視窗(hopping / sliding)

Tumbling 不重疊;每隔一小段時間開一個新視窗、視窗長度比間隔長,就會重疊:

```
[12:00, 12:10)
  [12:01, 12:11)
    [12:02, 12:12)        長度 10 分鐘,每 1 分鐘滑動一次
```

Flink SQL 的 group window 寫法(本專案沒用):

```sql
GROUP BY HOP(event_time, INTERVAL '1' MINUTE, INTERVAL '10' MINUTE)   -- 滑動間隔, 視窗長度
-- HOP_START(...) 取視窗起點
```

每筆事件同時屬於 `長度 ÷ 間隔` 個視窗(這裡 10 個):12:05:30 的事件屬於起點 11:56 到 12:05 的 10 個視窗。代價是狀態與輸出都放大約 10 倍,遲到事件的重新送出也要乘以 10。

其他視窗類型:`CUMULATE`(起點固定、終點逐步延伸,例如「今天累計到現在」)、`SESSION`(以空檔分段,例如 30 分鐘沒動作就算一個 session 結束)。

要算「近幾天平均」時,不一定要用滑動視窗:先用小視窗存可相加的原料,查詢時再往上加總。本專案 `production_1m` 的 `produced` 就是可相加的,查最近 10 分鐘 = 把 10 列加起來;平均要存 sum 與 count,查詢時 `sum / count`。不可相加的(例如 `COUNT(DISTINCT player_id)`、中位數)不能這樣做,`init.sql` 的 `activity_daily`(DAU / WAU / MAU)就是在 ClickHouse 查詢時直接對 `events` 重算滾動窗口。時間尺度到「天」時,Flink 要為每個視窗保留好幾天的 state,通常會改在 ClickHouse 算。

### 練習題:`version` 與不可相加的聚合

**兩個玩家在同一分鐘各送 3 筆 `production_tick`,線 2 的 farm 與線 4 的 `version` 各是多少?**

| | 線 2(`production_1m`) | 線 4(`ops_1m`) |
| --- | --- | --- |
| 來源 | `events_dedup CROSS JOIN UNNEST(stations)` | `events_dedup` |
| `WHERE` | `event_type = 'production_tick'` | 無,所有事件類型都算 |
| 分組 | 視窗、`client`、`s.station` | 視窗、`client` |

- 線 2:每筆 tick 的 `stations` 有 3 個元素,`UNNEST` 把 6 筆展開成 18 列;farm 那組有 6 列,`version = 6`。
- 線 4:沒有 `UNNEST` 與 `WHERE`,算該 client 這分鐘的所有事件。只有那 6 筆 tick 時是 6;若兩人還各送一筆 `session_start`,線 4 是 8,線 2 仍是 6。
- 兩者數的是不同的東西,各自在自己的表裡只增不減,足夠 `ReplacingMergeTree(version)` 用。

**為什麼不能把兩個相鄰視窗的 `players`(`COUNT(DISTINCT player_id)`)相加得到兩分鐘的玩家數?**

不是因為視窗重疊(tumbling 不重疊),而是同一個玩家可以出現在兩個視窗:

```
[12:00,12:01) 玩家 {A, B} → 2
[12:01,12:02) 玩家 {A, C} → 2
相加 4,實際不重複玩家 {A, B, C} = 3
```

不可相加的聚合:`COUNT(DISTINCT)`(同一個 x 出現在多個視窗)、`AVG`(平均的平均會錯,要存 sum 與 count)、中位數與百分位(無法從部分結果還原)。可相加的:`SUM`、`COUNT`。所以 `init.sql` 的註解說 uniq 計數要「per window,not derived from other aggregates」;要兩分鐘的玩家數,得對 `events` 重算。

### State 與 changelog

**State**:Flink 為了「記得過去」存的東西。`job.sql` 兩處:

| 位置 | 存什麼 | 何時清掉 |
| --- | --- | --- |
| 視窗聚合 | 每個還沒關閉的視窗的累計值 | 視窗結束 + 15 分(`allow-lateness`) |
| `events_dedup`(`ROW_NUMBER() OVER (PARTITION BY event_id ...)`) | 每個 `event_id` 一筆,用來認出看過了 | `table.exec.state.ttl = 1 h` |

- 去重 state 的取捨:TTL 越長越準、state 越大。超過 1 小時才到的重複 `event_id` 抓不到,影響用 `events_dedup` 的線 2(`production_1m`)與線 4(`ops_1m`);線 3(`pipeline_1m`)不去重、線 1(`events`)靠 `ReplacingMergeTree`,都不受影響。和「30 天 DAU 不放 Flink」同一個道理(state 太大)。
- 保存:checkpoint 定期把 state 與 Kafka offset 一起存(專案每 10 秒,`flink-state` volume);恢復時還原 state 並從對應 offset 接著讀。沒帶 savepoint 重新提交 = 全新 job,state 空白、從 `earliest-offset` 重讀。

**Changelog**:視窗在 allowed lateness 內收到遲到事件,結果要被修正,Flink 把輸出視為一串變更:`+I` 新增、`-U` 舊值撤回、`+U` 新值、`-D` 刪除。視窗先送 20、後來變 26:`+I(20)`,再 `-U(20)`、`+U(26)`。

**`upsert-kafka` 與 `PRIMARY KEY`**:

- 一般 Kafka sink 只能 append,表達不了「修正」。`upsert-kafka` 要求宣告 `PRIMARY KEY`,它成為 Kafka 訊息的 key;同 key 進同一條 partition,版本依序排列。舊訊息仍在 Kafka,不會被改掉(所以第 6 題 Kafka 上有 3 則)。
- ClickHouse 端靠 `ReplacingMergeTree(version)` 收斂,`FINAL` 讀。串起來:Flink changelog → `upsert-kafka` 每次一則新訊息 → ClickHouse 用 `version` 收斂。
- `PRIMARY KEY` = `GROUP BY` 欄位 + `window_start`,定義「什麼叫同一個視窗的不同版本」。例:`pipeline_1m` 按 `event_type` 分組(看管線健康:各事件類型的數量、重複、延遲),`production_1m` 按 `station` 分組(看遊戲內容:各站產出)。
- `NOT ENFORCED`:Flink 不檢查。key 寫錯(例如漏掉 `client`)不會報錯,不同 client 的視窗被當成同一筆的不同版本,下游互相覆蓋,數字悄悄錯。沒宣告 `PRIMARY KEY` 時 `upsert-kafka` 會在提交時報錯(依 Flink 文件,沒在本專案實測)。
- 沒實測:`-U/+U` 在本專案 sink 實際怎麼送出,是讀文件的推論;`late-fire` 那組設定是 Flink 1.20 保留的舊功能(風險見 `PROGRESS.md`)。

**練習**:(1) `state.ttl` 1 h 改 10 分鐘,哪類問題增加?→ 較晚到的重複 `event_id` 抓不到,影響線 2、線 4。(2) 為什麼 sink 要宣告 `PRIMARY KEY`?→ 定義同一視窗的新舊版本,見上。(3) 為什麼 `pipeline_1m` 的 key 末欄是 `event_type`、`production_1m` 是 `station`?→ 分組不同,見上。

### 練習題與解答(第 1–3 課)

1. **1 條 partition、`parallelism = 2`:** 只有 1 個 source 任務讀得到資料,另一個閒置。它的 watermark 不動,所以靠 `idle-timeout = 10 s` 把它排除,否則整個 job 的 watermark 被卡住。source 之後的運算(分組、視窗)仍可平行。
2. **ClickHouse 停機 1 小時:** Flink 不受影響,因為它不寫 ClickHouse,只寫 `ch.*` topic。資料留在 Kafka(受 retention 限制)。ClickHouse 回來後,Kafka 引擎從 consumer group 記住的 offset 接著讀,MV 寫進表。
3. **Kafka 掛掉時瀏覽器的事件:** 不會進。`send_and_wait` 失敗,collector 回 500;瀏覽器 `fetch(...).catch(() => {})` 不看回應也不重試,事件永久遺失。DLQ 也是 Kafka,所以也進不去。這是入口缺口(只有 bot 有斷線暫存)。
4. **Watermark 逐筆:**

   | 第幾筆 | `event_time` | 最大 `event_time` | watermark |
   | --- | --- | --- | --- |
   | 1 | 12:00:20 | 12:00:20 | 12:00:10 |
   | 2 | 12:00:55 | 12:00:55 | 12:00:45 |
   | 3 | 12:01:08 | 12:01:08 | 12:00:58(未越過 12:01:00,視窗未送出) |
   | 4 | 12:00:40 | 12:01:08 | 12:00:58 |
   | 5 | 12:01:15 | 12:01:15 | 12:01:05(越過 12:01:00,視窗送出) |

   第 5 筆之後視窗第一次送出,內容是第 1、2、4 筆共 3 筆(第 3、5 筆屬於下一個視窗)。第 4 筆不算遲到:到達時視窗還沒送出,事件正常算進去。遲到的定義是視窗送出(甚至清除)之後才到。
5. **watermark 12:30、`event_time` 12:12:30:** 屬於視窗 [12:12, 12:13),結束 + 15 分 = 12:28 ≤ 12:30,狀態已清除,丟掉。三張表:`events` 有(線 1 無視窗);`production_1m` 沒有;`late_1m` 有,前提是 `sent_at` 比 `event_time` 晚(例如 bot 重連補送);瀏覽器的 `sent_at` 等於 `event_time`,不會被算成遲到。
6. **同一視窗送出 3 次:** Kafka 3 則(每次送出都是新的 append;`upsert-kafka` 不會立刻覆蓋舊訊息)。ClickHouse merge 前 3 列(`version` 20、26、31)。不加 `FINAL` 直接 `sum(produced)` 會把 3 個版本加起來:每一列都是整個視窗的累計值(不是增量),所以結果約是真值的 3 倍(實際倍數看各次送出時的值)。merge 後只剩 `version = 31` 那一列。
7. **同一個 `event_id` 送兩次:** 線 1 兩次(`ch.events` 兩則,`events` 表 merge 前兩列,merge 後 `ReplacingMergeTree` 依 `(event_type, event_time, event_id)` 收斂成一列);線 2 一次(`events_dedup`);線 4 一次(同樣經過 `events_dedup`);線 3 專門數重複:`events = COUNT(DISTINCT event_id)` = 1、`duplicates` = 1、`version` = 2。
8. **新增事件類型 `order_completed`:**
   - `schema_version`:技術上不必升(只新增,向後相容)。專案慣例是升(M3 加新事件時升到 2,並讓新事件規定 `schema_version` 必須是 2,檢查得出舊 client 不可能產生),所以建議升 3 並對新事件限制為 3。
   - collector:Python 程式不用改,但 `schema.ts` 要加這個事件、`npm run schema` 重新匯出 `event.schema.json`、重啟 collector(啟動時才讀 schema)。沒做的話,`order_completed` 會因 `unknown event_type` 全部進 DLQ。
   - ClickHouse `events` 表:不用改 DDL,新欄位都在 `payload`。
   - `ops_1m`:不會自動多欄位。要有「訂單數」得改 `job.sql`、`ops_1m` DDL、`kafka_ops_1m` 與 MV(`init.sql` 只在首次啟動執行,所以要 `ALTER`),Flink 重新提交。順帶:`pipeline_1m` 依 `event_type` 分組,新事件會自動出現;`ops_1m.version = COUNT(*)` 是所有事件,也會把它算進去。
9. **最近 30 天 DAU 放 ClickHouse:** (a) Flink 要為視窗保留 30 天 state,負擔大;Flink 適合分鐘級即時聚合。(b) `COUNT(DISTINCT)` 不可相加,同一玩家出現在不同視窗,必須從 `events` 重算。(c) 原始事件完整保留,ClickHouse 可隨時重算、回填。專案的 `activity_daily` 就是這樣做。

### 練習題逐題檢討

**第 1 題:1 條 partition、`parallelism = 2`(檢討完)**

作答:只有一個 consumer 運作(對)。補充:

- 閒置的只有讀 Kafka 的那一段;下游 `GROUP BY` 依 key 重新分配資料,兩個任務都有工作。
- 核心規則:**下游的 watermark = 所有輸入 watermark 的最小值**。要宣布「12:01:00 以前都到齊」,每一條輸入都必須保證過了這個時間。
- Watermark 是從任務看到的事件的 `event_time` 算出來的;沒收過事件的任務沒有 watermark,取最小值時等於「沒有」,下游 watermark 不前進,視窗永遠不送出。Flink 不能直接忽略它,因為分不出「真的沒資料」與「資料還在路上」,忽略的話之後到的事件會變成遲到,所以預設等。
- `idle-timeout = 10 s`:某條輸入 10 秒沒有事件,就標記閒置,算最小值時排除;有事件來了自動恢復。取捨:若那條輸入其實只是慢超過 10 秒,它的事件可能變遲到。
- 若拿掉 `idle-timeout` 且只有 1 條 partition:`events` 表照常有資料(線 1 沒有視窗,不需要 watermark),`production_1m` 等聚合表完全沒有列(不是一列 0;Flink 不補零)。儀表板上 KPI 的事件數在跳,產出與活躍玩家圖是空的,Flink UI 顯示 RUNNING、沒有錯誤。這是依 Flink 規則推出的,沒有實測。
- 2 條 partition 且兩條都有資料:沒影響。前提是兩邊持續有資料;`player_id` 當 key 時,玩家少很可能全落在同一條 partition,另一條形同閒置。整體 watermark 由最慢的那條決定。

**第 2 題:ClickHouse 停機 1 小時(檢討完)**

作答:Flink 不會停,資料留在 Kafka,回來後再寫進 ClickHouse(對)。補充:

- Flink 不寫 ClickHouse,只寫 `ch.*` topic;ClickHouse 是拉的那一邊。若 Flink 直接寫 ClickHouse,sink 會失敗、重試、背壓。
- 接著讀的位置靠 ClickHouse Kafka 引擎自己的 consumer group offset(存在 Kafka)。
- 緩衝有 retention 上限(Kafka 預設通常 7 天,本專案設定沒查);停機超過保留期,未讀的訊息已被刪除,補不回來。1 小時沒問題。
- 停機期間儀表板資料停住;`leaderboard` 的 `online` 用 `last_seen > now() - 2 分鐘` 算,所以所有玩家會顯示離線,等 ClickHouse 追上積壓才恢復(讀 view 推出,沒實際看過)。

**延伸:Flink 停機 1 小時(檢討完)**

作答:可能會被丟,因為讀到的事件 `event_time` 很舊。這是錯的。

- Watermark 不看牆上時鐘,只看資料:它等於目前讀到的最大 `event_time` 減 10 秒。Flink 從上次的 offset 接著讀,事件依序進來,watermark 跟著舊資料往前走,沒有任何事件算遲到;視窗只是在牆上時鐘的同一刻追趕、一口氣送出。
- 丟的條件是:舊事件在更新的事件已經把 watermark 推走**之後**才到,與離現在多久無關。

  | 情境 | 結果 |
  | --- | --- |
  | Flink 停機後依序追趕 | 不丟 |
  | bot 離線 20 分鐘,其他玩家持續送新事件,之後補送 | 丟前面約 5 分鐘 |
  | 連續兩次 bot `--speed` 測試(`PROGRESS.md` 那條) | 丟:前一次把 watermark 推到「未來」,下一次的事件相對變成很舊 |
- 前提是 Flink 要從上次的位置恢復(checkpoint / savepoint 裡的 offset)。依 `docker-compose.yml` 的推論:沒有設定高可用,Flink 容器重啟後 job 不會自動回來,要重新執行 `flink-sql` 提交;沒帶 savepoint 就是新 job,`earliest-offset` 從 Kafka 最舊的訊息重讀整個 `events`。這個推論沒有實測,與 `PROGRESS.md` 的 "Resubmitting `job.sql` replays all of Kafka" 一致。用 `scripts/flink-restart.sh`(帶 savepoint)可避免。

**第 3 題:Kafka 掛掉時瀏覽器的事件(檢討完)**

作答:事件在瀏覽器 local;不能進 DLQ 因為 Kafka 掛了;可能不會補;bot 不會不同。對兩點半,錯兩點:

- 事件**不在**瀏覽器 local。`src/game/telemetry.ts` 的送出是 `fetch(...).catch(() => {})`,即時送、不暫存、不重試。collector 回 500 是正常 HTTP 回應,連 `.catch` 都不進。localStorage 存的是遊戲存檔,不是事件。
- 不進 DLQ 的理由對,補一層:DLQ 收「內容不合法」的事件,這裡是內容合法但送不出去(基礎設施故障);DLQ 本身也是 Kafka。
- 補不回來是確定的(讀碼確認),不是「可能」。
- bot 不同:`src/bots/run.ts` 有斷線暫存(`--disconnect-rate`、`--max-buffer`),補送的事件 `sent_at` 晚於 `event_time`,會被 `late_1m` 數到;超過 `max_buffer` 丟最舊的,`seq` 留缺口。但那模擬的是 bot 自己斷線;bot 收到 collector 的 500 時怎麼處理,沒讀,不下結論。
- 盲點:以為瀏覽器與 bot 行為一樣。入口是「至多一次」,只有 bot 有補送。

**第 4 題:watermark 逐筆推算(檢討完)**

作答:最大值 12:01:15、watermark 12:01:05(只給終點);第 5 筆送出;視窗內 5 筆;第 4 筆不算遲到,理由「12:00:30 在窗口內」。

- 第 1 小題:終點值對,但要逐筆列。重點是第 4 筆(12:00:40)比最大值小,最大值與 watermark 都不動;watermark 只前進,不因舊事件倒退。
- 第 2 小題對:第 3 筆後 watermark 12:00:58,差 2 秒;第 5 筆後 12:01:05 越過 12:01:00。
- 第 3 小題錯:是 3 筆(第 1、2、4 筆)。視窗依 `event_time` 分組,不是依到達順序;第 3、5 筆屬於 [12:01, 12:02)。錯因:把「到目前收到幾筆」和「這個視窗有幾筆」混在一起。
- 第 4 小題結論對,理由有兩處要修:事件是 12:00:**40**(不是 12:00:30);而且「在窗口內」只是必要條件,遲到看的是**到達時視窗送出了沒**。第 4 筆到達時 watermark 12:00:58,視窗未送出,所以不遲到。若它在第 5 筆之後才到,視窗已送出過,這時算遲到,但 15 分鐘 allowed lateness 內仍會被算進去並重新送出(upsert 與 `version` 的來源);超過 15 分鐘才丟。

**第 5 題:遲到太久的事件(檢討完)**

作答:不會算進去,因為 12:12 離 12:30 超過 15 分鐘;三張表都不會有。

- 結論對,算法要改:清除時間 = **視窗結束** + 15 分,不是事件時間 + 15 分。事件 12:12:30 屬於 [12:12, 12:13),清除時間 12:28 ≤ watermark 12:30,丟。邊界例子:事件 12:14:30 → 視窗結束 12:15 → 清除 12:30,watermark 12:30 已到,丟;事件 12:15:30 → 清除 12:31,還沒到,不丟。
- 三張表只對一張:`events` **有**(線 1 逐筆攤平,沒有視窗,不看 watermark);`production_1m` 沒有;`late_1m` 看 `sent_at`(bot 補送的 `sent_at` 晚於 `event_time` → 有;瀏覽器 `sent_at` = `event_time` → 沒有)。答案要寫條件。
- 盲點:漏了 `events`。視窗丟掉的只是聚合那條線,原始事件仍在,可以從 `events` 重算。

**第 6 題:同一視窗送出 3 次(檢討完)**

作答:Kafka 3 則;ClickHouse merge 前 3 列、merge 後 1 列;不加 `FINAL` 是 3 倍;加 `FINAL` 是最新一筆。

- 全對,只有「3 倍」要修:每列是送出當時整個視窗的**累計值**,三列的值不同(例:100、130、150,真值 150,`sum` 得 380,約 2.5 倍)。正確說法是「重複加總,倍數看各次的值」,不是剛好 3 倍。
- merge 是背景工作,時間不固定,所以查詢不能假設已 merge,要加 `FINAL`。
- 延伸題(設計取捨,未作答):為什麼送累計值不送增量?送增量時同一個增量被送兩次(例如 Flink 重啟重送)會重複加總,而累計值加上 `version` 去重是冪等的。

**第 7 題:同一個 `event_id` 送兩次(檢討完)**

作答:線 1 兩次都寫進去、merge 後 1 列(對);線 2 算兩次(錯);線 3 不知道;線 4 看不懂題目(題目把「處理線 4」寫成像「第 4 題」,是出題的問題,已重述)。

| 線 | 算幾次 | 為什麼 |
| --- | --- | --- |
| 1 `events` | merge 前 2 列、merge 後 1 列 | 不去重,靠 `ReplacingMergeTree` 收斂 |
| 2 `production_1m` | 1 次 | 經過 `events_dedup` |
| 3 `pipeline_1m` | `COUNT(*)` = 2、`COUNT(DISTINCT event_id)` = 1、`duplicates` = 1 | 不去重,專門數重複 |
| 4 `ops_1m` | 1 次 | 經過 `events_dedup` |

- 錯因:把線 1(不去重)的行為套到線 2。看每條線的來源有沒有 `events_dedup`。
- 線 3 若先去重,`duplicates = COUNT(*) - COUNT(DISTINCT event_id)` 永遠是 0。作答「不去重才抓得到重複送的情況」正確。
- 記法:業務數字(線 2、4)去重,否則產出、玩家數被灌水;監控重複的數字(線 3)與原始備份(線 1)不去重。

**第 8 題:新增事件類型 `order_completed`(檢討完)**

作答:升版本(有變就升);改 collector;事件被丟棄;`events` 表不用改。

- 升版:可以,理由要說明:慣例是升並限制新事件的 `schema_version`,讓舊 client 不可能產生新事件,schema 能擋掉不該出現的組合。技術上只新增是向後相容,不升也能跑。
- 要改的不是 collector 程式碼(Python 只讀 JSON Schema),是源頭:`src/events/schema.ts` 加事件 → `npm run schema` 匯出 `event.schema.json` → **重啟 collector**(啟動時 `collector/main.py:18` 才讀進 `SCHEMA`)。
- 沒做的後果:不是「丟棄」,是進 `events.dlq`,錯誤 `event_type: unknown event_type`(`collector/main.py:33`、`:42`)。事件完好保留,符合「不默默丟」。
- `events` 表不用改(欄位在 `payload`)。漏答另一半:`ops_1m` 不會自動多「訂單數」欄位,要改 `job.sql`、`ops_1m` DDL、`kafka_ops_1m` 與 MV,`init.sql` 只在首次啟動跑,既有環境要 `ALTER`,再重新提交 Flink job。`pipeline_1m` 依 `event_type` 分組,新類型自動出現。
- 共通概念:啟動時載入(`event.schema.json`)、只在首次執行(`init.sql`)、job 定義(Flink),改了不會自動生效。

**討論:Kafka 有 event type 清單嗎?(補充)**

沒有。Kafka topic 只是位元組,什麼都收;清單在 `event.schema.json`,由 collector 的 `route()` 檢查。下游 Flink 只用 `WHERE event_type = ...` / `FILTER` 挑自己要的類型,不認得的略過、不報錯。整條鏈路只有 collector 一處檢查類型清單。

驗證放哪裡的取捨:

| 位置 | 優點 | 缺點 |
| --- | --- | --- |
| Collector(本專案) | 最簡單;壞事件進不了 `events`;DLQ 就在旁邊 | 沒有 schema 版本管理;要重啟才生效;繞過 collector 直接寫 `events` 就不被驗證(靠慣例,非強制) |
| Schema Registry | 版本與相容性規則;所有 producer 都受管 | 多一個服務;需 Avro/Protobuf/JSON Schema 序列化;對小專案過重 |
| Flink | 驗證可和處理合在一起 | 壞資料已進 `events`,線 1 原始備份被污染;SQL 裡寫驗證笨重 |

選 collector 的理由:只有一個入口、DLQ 分流最自然、zod 是唯一真相來源。Schema Registry 一欄是一般知識,本專案沒用、沒實測;「不選 Registry 是因為專案規模與學習焦點」是設計理由,不是技術限制。

**第 9 題:最近 30 天 DAU 放哪(檢討完)**

作答:ClickHouse 算;Flink 處理秒到分鐘級,十分鐘是上限,超過給 ClickHouse,免得 Flink 壓力太大。

- 結論對。理由只有 (a)(state 負擔),且「十分鐘上限」要修:那是經驗法則,不是 Flink 的限制;Flink 能開小時、天的視窗,代價是 state 大(每個玩家 ID 都要保留到視窗關閉,checkpoint 變慢)。
- 漏了 (b),最根本:`COUNT(DISTINCT)` 不可相加。同一玩家 12:00 與 12:30 各在一個一分鐘視窗,相加得 2,真值 1。就算 Flink 每分鐘送出活躍玩家數,也拼不出 DAU,必須回到原始事件重算。
- 漏了 (c):原始事件完整保留在 `events`,定義改了(例如 DAU 改成「至少玩 1 分鐘」)可隨時重算、回填;由 Flink 預先算好的,只能靠重放 Kafka,而 Kafka 有 retention。
- 專案的 `activity_daily` view 就是 ClickHouse 讀取時從 `events` 聚合 DAU / WAU / MAU。

練習題 1–9 檢討完畢。
**練習題中的盲點整理:**
- 把某條線的行為套到另一條線(第 7 題線 1 vs 線 2)。
- 視窗分組看 `event_time`,不是到達順序(第 4 題);遲到看「到達時視窗送出了沒」。
- 丟掉的只是視窗聚合那條線,`events` 仍有(第 5 題)。
- 入口至多一次,瀏覽器不暫存(第 3 題)。
- 啟動時載入 / 只在首次執行的東西改了不自動生效(第 8 題)。

第 3 課已講完(state、changelog 見上方「State 與 changelog」)。

---

## 第 4 課:`job.sql` 逐段讀

| 行數 | 段落 | 做什麼 |
| --- | --- | --- |
| 1–10 | `SET` 設定 | 時區、idle-timeout 10 s、allowed lateness 15 min + late-fire、state TTL 1 h(只影響 `events_dedup`) |
| 12–54 | source / sink 表 | 同一個 topic `events` 讀三次 |
| 56–60 | `events_dedup` view | 每個 `event_id` 留第一筆 |
| 62–90 | 4 張 upsert-kafka sink | 對應 ClickHouse 窗口表 |
| 93–141 | `EXECUTE STATEMENT SET` | 5 個 `INSERT` 合成一個 Flink job(只有一個東西要 cancel / 重送) |

### 同一個 topic 讀三次

| 表 | group.id | 用途 | 時鐘 |
| --- | --- | --- | --- |
| `events_raw` | `flink-events` | 整行當字串,`JSON_VALUE` 抽欄位,`payload` 原樣保留(線 1) | 無 |
| `events_typed` | `flink-typed` | 解析成欄位給窗口算 | `event_time` |
| `events_sent` | `flink-sent` | 只取 3 欄,給 `late_1m`(線 5) | `sent_at` |

- `WATERMARK FOR` 一張表只能一個時間欄位,所以要兩種時鐘就得兩張表(一張表只能一個 `WATERMARK` 是我對 Flink 的了解,推斷, 沒有實測)。
- `events_typed` 的 `json.ignore-parse-errors = true`:解析失敗的行變成全 NULL 的列,**靜默**。壞資料已被 collector 擋掉,所以少見。
- `latency_ms` 是 computed column(`ingested_at − event_time`),讀取時才算。
- `events_dedup` 的 `ORDER BY event_time ASC` 不能亂換:Flink 靠它認出「依 rowtime 去重」,輸出才保有 rowtime,後面的窗口才算得下去。

### 五個 INSERT

| 線 | 來源 | 去重 | 分組 | 重點 |
| --- | --- | --- | --- | --- |
| 1 `events` | `events_raw` | 否 | — | 平的一列一事件 |
| 2 `production_1m` | `events_dedup` | 是 | `client, station` | `CROSS JOIN UNNEST(stations)` 一事件拆成每 station 一列 |
| 3 `pipeline_1m` | `events_typed` | 否 | `client, event_type` | `COUNT(*) − COUNT(DISTINCT event_id)` = 重複筆數 |
| 4 `ops_1m` | `events_dedup` | 是 | `client` | 一堆 `FILTER (WHERE event_type = ...)` 一次掃描算多個指標 |
| 5 `late_1m` | `events_sent` | 否 | `client` | 窗口用 `sent_at`,延遲 > 10 s 算 late |

每個 INSERT 最後一欄 `COUNT(*)` 就是 `version`。第 103 行註解:用 `TUMBLE` table function 加 view 會觸發 planner bug,所以用 `GROUP BY TUMBLE(...)` 舊式語法(專案註解的說法,沒有實測)。

### 練習題與檢討(第 4 課)

**第 1 題**(`production_1m` 的 `COUNT(*)` 數什麼):答「每個 station 的事件數」,**對**。`UNNEST` 後每個 `(window, client, station)` 的列數。補充:各 station 的 `version` 加總不是事件數(一個事件在每個 station 各算一次)。每個 tick 是否一定帶齊所有 station 沒查(推斷, 沒有實測)。

**第 2 題**(為什麼要 `events_sent`):**對一半**。對:兩張表 watermark 時鐘不同。修正:「後者才抓得到延遲資訊」不準,`sent_at − event_time` 兩邊都算得出來。真正差別是**窗口按哪個時鐘切**:`event_time` 窗口裡,遲到超過 15 分鐘的事件屬於已清掉的舊窗口,被丟掉沒人算;`sent_at` 窗口裡它屬於「現在送出」的窗口,會被算到,也能判斷遲到。盲點:把「時鐘」和「資訊內容」混在一起。

**第 3 題**(`new_players` 拿掉 `DISTINCT` 會變嗎):**對**,理論上不變(一個玩家只有一次 `is_new_player` 的 `session_start`)。補充:來源是 `events_dedup`,重複的 `event_id` 早被去掉,所以 `DISTINCT` 在這裡是多餘的防線;真正需要的是 `active_players`(同玩家一分鐘多個事件)。沒查:`is_new_player` 是否保證只出現一次(推斷, 沒有實測);玩家清 localStorage 會拿到新 `player_id`,算新玩家是合理的。

**第 4 題**(`ch_ops_1m` 的 PK 改成只有 `(window_start)`):你答「不同 client 會被算在同一個窗口」,方向對但位置錯。Flink 的運算沒變(`GROUP BY` 還是含 `client`),**衝突發生在寫進 Kafka 那步:不同 client 的列 key 一樣**。例:窗口 12:00 有 `web 10`、`bot 50` 兩列,PK 設對時 key 是 `{12:00,web}`、`{12:00,bot}`;PK 設錯時兩則 key 都是 `{12:00}`,`upsert-kafka` 把它解讀成「同一列被更新」。

- Kafka 預設不去重,每則都留著;只有 topic 開了 **log compaction** 才會「同 key 只留最後一則」,這時 `web` 那列會消失。
- 我 grep 過 compose/腳本沒找到 compaction 設定,所以目前大概不會缺資料(推斷, 沒有實測)。這種錯很安靜,等 topic 設定改了才顯現。
- Flink 可能為「查詢唯一鍵比 sink PK 更細」多加補償 state(推斷, 沒有實測)。
- ClickHouse `ReplacingMergeTree ORDER BY (window_start, client)`(`init.sql:129`)用兩欄當身分,與正確的 PK 一致,這也是「PK = `GROUP BY` 欄位 + `window_start`」規則的原因。

第 4 課盲點:想到「key 變粗會合併」,但把合併發生的位置想成 Flink 運算,其實在 Kafka 的 key 上;以及把「Flink 定義同一列」和「Kafka 是否真的刪舊資料」混成一件事。

---

## 第 5 課:ClickHouse

來源:`pipeline/clickhouse/init.sql`、`docker-compose.yml`(ClickHouse 24.8)。

### MergeTree

欄式儲存。一次寫入 = 磁碟上一個 **part**(依 `ORDER BY` 排序),背景把小 part **merge** 成大的。

- `ORDER BY` 是排序鍵 + 稀疏索引,**不是唯一鍵**,重複的鍵照樣存在。要照常用的篩選條件選。
- 沒有 UPDATE / row lock。「改資料」靠 merge 時的規則(Replacing、Aggregating)。

### Replacing 與 `FINAL`

`ReplacingMergeTree(version)`:merge 時,**排序鍵相同**的列只留 `version` 最大的一列。merge 在背景、時間不定,所以 merge 前新舊列同時存在:

- 不加 `FINAL`:全部讀到,`sum()` 重複加總。
- 加 `FINAL`:查詢時當場去重,正確但較慢。

`*_1m` 的 `produced` 是視窗**累計值**(不是增量),`version` = 視窗事件數只增不減,所以「version 最大」= 最新累計。三列 100 / 160 / 230 不加 `FINAL` 得 490(錯),加了得 230。

`events` 的 Replacing 沒有 version 參數:排序鍵 `(event_type, event_time, event_id)` 完全相同即重複,留哪列都行。

### Kafka engine + MV 三件組

```
Kafka topic ch.events
   ▼  consumer group: clickhouse-events
slime.kafka_events      ENGINE = Kafka,不存資料,只是 consumer
   ▼  MV 讀它時 offset 才前進
slime.kafka_events_mv   MATERIALIZED VIEW ... TO slime.events,搬運 + 轉型
   ▼
slime.events            真正存資料的表
```

- MV 在這裡是**插入觸發器**,不是預先算好的查詢結果。
- Kafka 表時間欄位用 `String`,MV 裡才 `parseDateTime64BestEffort`,Flink 和 ClickHouse 不必約定時間格式。
- offset 記在 Kafka(consumer group),ClickHouse 重啟不重讀。刪 topic 或改 sink 後 consumer 會卡住,要重建表 + MV 並重設 offset。
- `dead_letters` 最短:`events.dlq` → Kafka engine → MV → MergeTree,不經 Flink。

### AggregatingMergeTree 與 `player_state`

目標:每玩家一列最新狀態。MV 在 `events` 每進一列就產生一列**部分狀態**;merge 時同 `player_id` 按各欄聚合函數合併。

- `argMax(a, b)` = 「`b` 最大那列的 `a`」。`argMax(coins, event_time)` = 最新那筆的 coins。不是 `max(coins)`(coins 會跌)。
- `AggregateFunction(argMax, ...)` 存中間狀態:寫入用 `argMaxState`,讀取用 `argMaxMerge`。`SimpleAggregateFunction(min/max)` 狀態即結果,不需要 `-State/-Merge`。
- `leaderboard` view 要 `GROUP BY player_id` + `argMaxMerge`:merge 前同玩家可能有多列,查詢時當場合併(和 `FINAL` 同理,手動做)。
- 不用 Replacing 的原因:(1) Replacing 整列取代,別種事件(沒有 coins)會蓋掉欄位;`argMaxStateIf(..., event_type = 'production_tick')` 讓每欄自己挑來源。(2) 晚到舊 tick 在 `argMax` 輸給較新的,不改結果;「後寫入取代先寫入」會讓 coins 倒退。
- 都選**冪等且與順序無關**的聚合:`min`、`max`、`argMax`。重複、亂序到達結果一樣。

### 對照

| 引擎 | merge 時 | 讀的時候 | 本專案 |
| --- | --- | --- | --- |
| `MergeTree` | 只合併 part | 直接讀 | `dead_letters` |
| `ReplacingMergeTree(v)` | 同鍵留 `v` 最大 | `FINAL` | `events`、`*_1m` |
| `AggregatingMergeTree` | 同鍵按欄位函數合併 | `GROUP BY` + `-Merge` | `player_state` |
| `Kafka` | 不存資料 | 不要直接查 | 所有 `kafka_*` |

### 練習題與檢討(第 5 課)

**第 1 題**(version 5/8/12 三列未 merge,`sum` 有無 `FINAL`):答 3 列 vs 1 列,**對**。補充:累計值相加才是錯誤來源。

**第 2 題**(直接 `SELECT kafka_events`):答「會 consume 掉」,**對一半**。缺:讀走的訊息**沒經過 MV**,不會進 `slime.events`,offset 已前進,`events` 永久少了這批(Kafka 裡還在);補救要重設 consumer group offset 重讀,重複由 Replacing 吸收。**未實測**:24.8 可能預設禁止直接 SELECT(`stream_like_engine_allow_direct_select`),屆時是報錯而非吃訊息。看 Kafka 內容用 Kafka UI。

**第 3 題**(Flink 去重後 `events` 為何還用 Replacing):答「保留所有 events、可回放重送」,**對**。補充:(1) Flink 去重 state 只留 1 小時,超過的重複、或 `job.sql` 重送重讀 Kafka,仍會進來,Replacing 是最後防線;(2) `events` 是事實來源,沒有 15 分鐘 lateness 限制,對帳用 `events FINAL`;(3) 新聚合可從 `events` 回填。

**第 4 題**(`player_state` 為何不用 Replacing):原本不知道 `argMax`,講解後補上。要點見上節。小檢查:tick `10:00→100`、`10:05→340`、`10:03→280` 任何順序到達,結果都是 340。

**第 5 題**(改 `init.sql` 加欄,已在跑的 ClickHouse 會生效嗎):答不知道。**不會**:`docker-entrypoint-initdb.d` 只在資料目錄為空時的首次啟動執行。兩條路:`down` + 刪 `clickhouse-data` volume 重來(資料全沒,靠重放 Kafka 回填),或手動 `ALTER TABLE`(資料保留,但 `init.sql` 要同步)。Kafka engine 表和 MV 不能隨便 ALTER,通常 DROP 重建並處理 offset。觀念:`init.sql` 是「首次建立」腳本,不是 migration。

第 5 課盲點:對「讀 Kafka engine 表」只看到 offset,沒想到資料沒進目標表;對「啟動時載入 / 只執行一次」的東西(`event.schema.json`、`init.sql`、Flink job 定義)仍不熟。

---

## 已知問題(第 6 課會展開)

`event_time` 和 `sent_at` 都來自 client 時鐘(`src/events/emitter.ts`),collector 只檢查 schema,不檢查時間(`collector/main.py` 的 `route()`)。Flink watermark = 最大 `event_time` 減 10 秒。一個時鐘快一小時的瀏覽器,會把 watermark 推到未來,其他玩家的事件超過 15 分鐘 allowed lateness 後被視窗默默丟掉,不進 DLQ,也不出現在 `late_1m`(它也用 client 的 `sent_at`)。這是靜態讀碼的推論,尚未實測。
