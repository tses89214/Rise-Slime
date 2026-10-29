# production_tick carries a state snapshot

`production_tick` gets `slimes_owned` (all slimes, including the lounge) and `achievements_unlocked` (running total).

Why: the leaderboard was built from purchase/achievement events, so a player whose save predates telemetry
(or who joins mid-game) showed 0 slimes and 0 achievements. The tick already runs every 5 s and carries
`coins_balance`, so two more numbers give a self-contained snapshot at no new event type and negligible size.
`schema_version` stays 1: only the current game and bots emit this event and both were updated together.
