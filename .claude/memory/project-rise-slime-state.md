---
name: project-rise-slime-state
description: Current state of the Rise & Slime repo (M1-M3 done, next M4; art pivot to original sprites)
metadata:
  type: project
---

Repo: github.com/tses89214/Rise-Slime (main). Spec: `docs/design.md` (zh-TW), CLAUDE.md has commands/layout.

M1 first version done (2026-10-29): `src/core/sim.ts` (pure sim), `src/events/` (zod + UUID v7 emitter), `src/bots/`, `src/collector/` (Fastify, DLQ), `src/game/main.ts` plain-DOM UI, docker-compose Kafka. Flink/ClickHouse/dashboard = M2, not started.

Sim rule decided: a cycle only starts when input is on hand (starved slimes bank no work); first bread at ~13s with 1/1/1 setup, matching spec.

**Art pivot:** user dropped `asset-integration.md` + `rise-and-slime-handoff.zip` (original pixel sprites in `assets/original/`, `tools/sprites/make_sprites.py`). Per that doc, third-party IMAGE packs (Tiny Town, Tiny Creatures, GreenRangerPIX slimes, food icons, Kenney Pixel UI) are NOT used; only fonts (m5x7, monogram, Kenney Fonts) and audio stay third-party CC0. The doc's art section overrides design.md's asset section. UI palette and pixel-border CSS rules are in the doc.

Since then (2026-10-29): achievements (29, `src/core/achievements.ts`, event `achievement_unlocked`), cosy bakery shop sprite, windmill (4-angle blades) + oven (embers flicker) props, production popups (+N wheat/flour/bread, same motion as shop +10), (sweating slimes was tried and dropped: user found it ugly), 7 wandering customers (each real sale sends one in and out carrying bread), responsive integer scaling (`--u` 3px/2px), perf pass. Slime colour follows job (lounge blue, farm green, mill brown, bakery red) as cosmetic.\n\n**Why:** original assets avoid license burden and match the design mockup `docs/design/main-screen.dc.html`.
**How to apply:** don't re-add third-party image packs; edit sprites via the make_sprites.py script, not PNGs.

Later (2026-10-29): music is a single track, Good Morning by Cakeflaps (CC0), user confirmed it sounds right; old loops deleted. Header Settings button became Credits (opens the credits dialog); `src/game/ui.test.ts` checks every button has a handler and every audio/font file is in CREDITS.md and the dialog. Collector answers CORS preflight. When adding any third-party file: update CREDITS.md AND the in-game credits dialog (the test fails otherwise).

Later (2026-10-29, evening): game finished. Kafka path verified (2-node compose, volumes, Kafka UI :8080, listeners WEB_GAME/DOCKER/CONTROLLER). CLAUDE.md now has a clock-in/out routine: read/update `.claude/PROGRESS.md` and `.claude/DECISIONS.md`. Next: M2 (ClickHouse, Flink SQL, uPlot dashboard in `pipeline/` and `dashboard/`). User dropped the "ask when unsure" and token-budget rules: keep deciding small details myself.

Later (2026-10-30): M2 and M3 done and verified end to end. M3 = merge/mutation/slots, schema v2, Flink dedup + allowed-lateness upserts (ClickHouse tables are ReplacingMergeTree(version), read with FINAL), `late_1m`, bot disconnects, savepoint restart (`scripts/flink-restart.sh`). Dashboard is on port 3000 (`/dashboard`, served by the collector). User wants docs kept current (`docs/system.md` inventory, `docs/pipeline.md` colour-coded diagrams) and checks the dashboard visually. Next: M4. Known limit: back-to-back `--speed` bot runs drop the next run's first minutes (event time ahead of wall clock).

