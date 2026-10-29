# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Rise & Slime: A Slime Bakery Idle Game

Portfolio side project: an idle game whose events feed a real-time data pipeline
(Kafka → Flink → ClickHouse → custom HTML dashboard).

## Source of truth

- `docs/design.md` — the full design spec (game rules, numbers, event schema,
  architecture, assets, milestones). Read it before starting any task.
- `docs/design/main-screen.dc.html` — visual reference for the M1 main screen
  (layout, colors, slime states). It is a design mockup, not production code.

If the spec and the code disagree, the spec in `docs/` wins unless a decision
record says otherwise. When a spec decision changes, update `docs/design.md`
and add a short entry to `docs/decisions/`.

## Ground rules (from the spec's "實作原則")

- Game core is pure TypeScript with no rendering dependency, so bots can run it in Node.
- The core never reads the system clock or calls `Math.random()` directly:
  time is passed in, randomness uses a seeded generator.
- Telemetry is switched by `VITE_TELEMETRY`, read via `import.meta.env` at build
  time, so the itch.io build contains no event-sending code.
- Event types and validation live in one shared package (zod); game, bots and
  collector all import it.
- Invalid events go to a dead-letter Kafka topic, never silently dropped.
- Code is MIT. Files under `assets/` keep their original licenses; every asset
  is listed in `CREDITS.md` with author, source URL, license and download date,
  including CC0 ones.
- UI text is English; use the term glossary in the spec for names in code and events.

## Current milestone

M1: one product chain (wheat → flour → bread), three stations, plain slimes,
manual assignment, fixed price; bots send events into Kafka.

## Architecture (from the spec)

One TypeScript game core (rules, numbers, save, event interface) shared by three consumers: browser game (Phaser scene + HTML/CSS UI, Vite), headless Node bots, and the itch.io build (no-op telemetry). Local `docker-compose` pipeline: Collector (Fastify + zod) → Kafka → Flink (Flink SQL, PyFlink for custom state) → ClickHouse → standalone HTML dashboard (uPlot). Tests: Vitest. Planned single repo with folders for core, game, bots, collector, dashboard, Flink jobs.

Bots run in two modes: real-time (into Kafka) and fast-forward (write files, for tuning numbers). Offline progress is computed by simulating the elapsed time (8h cap) with the same core logic.

Spec is written in Traditional Chinese; UI text and event/code names are English (glossary in spec).

## Commands

```
npm install
npm test                       # vitest run
npx vitest run -t "4:6:5"      # single test by name
npm run typecheck
```

## Repo state

Implemented so far: `src/core/sim.ts`, the M1 production-chain simulation (pure, time passed in). Not yet: seeded RNG, events/zod package, Phaser UI, bots, collector, Kafka/Flink/ClickHouse stack.
