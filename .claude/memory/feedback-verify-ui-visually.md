---
name: feedback-verify-ui-visually
description: After every UI change, self-check with a headless Chrome screenshot (user asked for this explicitly)
metadata:
  type: feedback
---

User said "每次更新都自己檢查一下". After each UI/CSS/sprite change: run `npm run typecheck`, `npx vitest run`, `npm run build`, then take a headless Chrome screenshot and LOOK at it (also a narrow ~500px one; headless Chrome has a minimum window width ~500).

Recipe: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --user-data-dir=<fresh dir> --window-size=W,H --virtual-time-budget=6000 --screenshot=out.png "http://localhost:5173/?demo=farm,mill,bakery,lounge"`. `?demo=` only works in dev (seeds a state). Use `--dump-dom` to inspect DOM state (e.g. customer `data-s`). Put scratch files in the session scratchpad.

**Why:** several regressions slipped through unseen (an over-broad CSS edit silently deleted the popup/sweat rules; a deleted function broke sprite generation).
**How to apply:** when replacing a CSS block by index range, re-grep that the neighbouring rules still exist; look at the screenshot before saying "done".
