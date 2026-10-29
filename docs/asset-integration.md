# 素材整合指南

遊戲畫面一律照 `docs/design/main-screen.dc.html` 的樣子做。圖像全部使用本專案的**原創像素素材**（`assets/original/`），不使用第三方圖像素材包；字型和音訊才用第三方素材。

本文件的美術部分優先於 `docs/design.md`「美術素材與授權」一節：該節列的圖像素材包（Tiny Town、Tiny Creatures、GreenRangerPIX 史萊姆、食物圖示、Kenney Pixel UI 等）改為不採用。

## 1. 檔案放置

```
assets/
  original/            ← 原創像素素材（PNG + JSON），說明見該資料夾的 README.md
    preview/           ← 預覽圖，不進遊戲
  fonts/               ← m5x7、monogram、Kenney Fonts（第三方，CC0）
  audio/
    music/             ← 第三方，CC0
    sfx/               ← 第三方，CC0
  _incoming/           ← 下載的原始 zip，不進 git
tools/
  sprites/             ← 產生原創素材的腳本
```

- 原創素材要修改時，改 `tools/sprites/make_sprites.py` 後重新產生，不直接編輯 PNG
- 新增的圖也加進同一支腳本，維持同一組調色盤和畫法
- 字型、音訊這些第三方素材，每加入一包就在 `CREDITS.md` 新增一列：名稱、作者、來源網址、授權、下載日期

## 2. 像素風規則

- **基準**：角色與物品 16×16，道具 32×32，店舖 64×48
- **Phaser**：開啟 `pixelArt: true`；場景以內部解析度 320×180 繪製，整數倍放大（例如 ×4 到 1280×720）
- **只用整數倍縮放**，不能用 1.25、1.5 這類倍率
- **HTML 介面**：圖片加 CSS `image-rendering: pixelated`

**調色盤**（介面與儀表板共用，定義成 CSS 變數）：

| 用途 | 色碼 |
| --- | --- |
| 背景 | `#EEF0FF` |
| 面板 | `#FFFFFF` |
| 主要文字、外框 | `#1F2547` |
| 次要文字 | `#4A5078` |
| 主要按鈕 | `#FF9EC4` |
| 收入標籤 | `#C9F2E3` |
| 天空 | `#BFE3FF` |
| 草地 | `#8EDB9A`，邊線 `#4FAF6A` |
| 庫存條（正常） | `#6FA8FF` |
| 庫存條（警示，瓶頸） | `#F08A24`，外框 `#D9661A` |

## 3. 場景怎麼拼

場景由左到右分四區：Farm、Mill、Bakery、Shop，區與區之間放 `fence`。

| 圖層 | 素材 | 做法 |
| --- | --- | --- |
| 天空 | `tiles.png` 的 `sky` | 鋪滿上半部 |
| 雲 | `props.png` 的 `cloud` | 放兩三朵，緩慢水平移動 |
| 地面 | `grass_top`（第一排）、`grass`（其餘） | 鋪滿下半部 |
| Farm | `items.png` 的 `wheat` | 種成一排；種麥時一株株冒出（向上彈一下） |
| Mill | `props.png` 的 `sacks`、`millstone` | `sacks` 依待處理庫存疊高或增加數量，上方顯示數字標籤；`millstone` 慢慢轉動 |
| Bakery | `props.png` 的 `oven_baking` 動畫 | 有材料時播放（爐火忽明忽暗）；沒材料時停在 `oven` |
| Shop | `shop.png` | 放在最右邊 |
| 客人 | `customers.png` 的 `walk` 動畫 | 從右邊走進店門口，進門後消失；每隻隨機一種顏色 |
| 售出 | `items.png` 的 `bread`、`coin` | 麵包從烤爐飛向店舖，售出時冒出金幣和「+10」 |

`assets/original/preview/scene-preview.png` 是拼好的示意圖，可以當作配置參考。

## 4. 史萊姆

`slimes.png` 一列一種顏色：

| 列 | 顏色名 | 對應變異 |
| --- | --- | --- |
| 1 | normal | 一般 |
| 2 | leafy | Leafy |
| 3 | rocky | Rocky |
| 4 | fiery | Fiery |
| 5 | lucky | Lucky |

**動畫對應遊戲狀態**（動畫定義在 `slimes.json`）：

| 遊戲狀態 | 動畫 | 補充 |
| --- | --- | --- |
| 在 Lounge 待命 | `idle` | 每隔幾秒隨機播一次 `hop` |
| 被調派、移動中 | `hop` | 加上水平位移，一路跳到工作站 |
| 種麥中 | `hop` | 旁邊的 `wheat` 冒出 |
| 磨粉中 | `spin` | 站在 `millstone` 旁 |
| 烘焙中 | `hop` | 搭配 `oven_baking` |
| 沒材料可做 | `sleep` | 頭上疊 `zzz`，並緩慢上飄 |
| 新買進場 | `hop` 一次 | 從畫面外跳進 Lounge |
| 合成（M3） | 三隻往中間 `hop` 後消失，新史萊姆放大出現 | 加閃光粒子（程式畫的小方塊） |
| 升級完成 | `hop` 一次 | 該站所有史萊姆同步 |

- **階級**：一階 ×3、二階 ×4、三階 ×5（以場景放大後的倍率計算，原則是整數）
- **效能**：每區最多同時畫 8 隻，其餘以「+12」這類數字顯示

## 5. 介面（HTML，疊在 Phaser 畫布上）

介面元件不用圖片素材，照設計稿用 CSS 畫出像素風：

| 元素 | 做法 |
| --- | --- |
| HUD、卡片、Lounge 面板 | 白底、3 到 4px `#1F2547` 實線外框、4px 實色位移陰影（`box-shadow: 4px 4px 0 #1F2547`），不用圓角、不用漸層 |
| 主要按鈕（Upgrade、Buy Slime） | `#FF9EC4` 底、3px 外框；按下時陰影歸零、元件下移 4px，做出按壓感 |
| 次要按鈕（+ / −、Music、SFX、Settings） | 背景色底、3px 外框 |
| 庫存條 | 外框 3px，填色依堆積量切換正常色、警示色；警示時卡片外框也換成 `#D9661A` |
| 金幣、產物小圖示 | 用 `items.png` 的圖，CSS 整數倍放大 |
| 內文 | m5x7，字級用 16 的倍數 |
| 數字（金幣、產量） | monogram（等寬，數字跳動時不會左右晃） |
| 標題（遊戲名、區域名、分頁名） | Kenney Fonts 的像素字型 |

按鈕最小高度 44px，方便手機點按。

## 6. 音訊（第三方，CC0）

| 觸發時機 | 素材 |
| --- | --- |
| 背景音樂 | 8 Bit Concentration Loop，另從 Chiptune Loops、Starlight City 挑一到兩首輪播 |
| 按鈕點擊 | Kenney Interface Sounds |
| 麵包售出、收錢 | 10 8bit coin sounds |
| 升級、解鎖新分頁 | Level up, power up, Coin get |
| 史萊姆進場、調派、合成 | 8 wet squish, slurp impacts；不夠用再加 25 CC0 mud sfx |

來源網址與作者見 `docs/design.md`。音樂等玩家第一次點擊後才播放；音樂、音效各有音量控制，並記住玩家設定。

## 7. 完成檢查

- [ ] 畫面配置、配色和設計稿一致
- [ ] 場景只用 `assets/original/` 的圖，沒有第三方圖像素材
- [ ] 所有圖都是整數倍縮放，沒有模糊
- [ ] 史萊姆每種狀態都有對應動畫，沒材料時會睡著並冒 `zzz`
- [ ] 第三方字型、音訊都列在 `CREDITS.md`、遊戲內製作名單、itch.io 頁面
- [ ] 瀏覽器第一次點擊前不會自動播放音樂
