# Rise & Slime 原創像素素材

本專案原創的像素圖，風格與 `docs/design/main-screen.dc.html` 一致。全部由 `tools/sprites/make_sprites.py` 產生，要改圖就改腳本後重新執行：

```
python3 tools/sprites/make_sprites.py assets/original
python3 tools/sprites/make_preview.py assets/original assets/original/preview
```

每張精靈圖都附一份同名 JSON，記錄每一格的位置（`frames`）與動畫（`animations`）。

| 檔案 | 格子大小 | 內容 |
| --- | --- | --- |
| `slimes.png` | 16×16 | 5 列 = 5 種顏色（normal、leafy、rocky、fiery、lucky），9 欄 = 9 個動作格 |
| `customers.png` | 16×16 | 4 列 = 4 種客人（pink、purple、teal、lime），2 欄 = 走路 2 格 |
| `items.png` | 16×16 | wheat、flour、bread、coin、zzz |
| `tiles.png` | 16×16 | sky、grass_top、grass、fence |
| `props.png` | 32×32 | millstone、oven、oven_lit、sacks、cloud |
| `shop.png` | 64×48 | 店舖外觀（單張） |

## 史萊姆動作格與動畫

動作格（每列相同）：`idle_0`、`idle_blink`、`hop_squash`、`hop_stretch`、`hop_air`、`sleep_0`、`sleep_1`、`spin_left`、`spin_right`

| 動畫 | 組成 | 用在 |
| --- | --- | --- |
| `idle` | idle_0 ×3 → idle_blink | 在 Lounge 待命 |
| `hop` | squash → stretch → air → stretch → idle_0 | 移動、種麥、烘焙、升級時一起跳 |
| `sleep` | sleep_0 ↔ sleep_1 | 沒材料可做（頭上另疊 `zzz`） |
| `spin` | spin_left → idle_0 → spin_right → idle_0 | 磨粉（左右張望，像在推石磨） |

階級用整數倍放大區分，例如一階 ×3、二階 ×4、三階 ×5。

## 授權

這些是本專案的原創作品，不是第三方素材，不需要放進 `CREDITS.md` 的第三方清單（可以在製作名單寫「Original art: 你的名字」）。授權由專案作者決定；若希望別人可以重複使用並標註出處，可選 CC BY 4.0。
