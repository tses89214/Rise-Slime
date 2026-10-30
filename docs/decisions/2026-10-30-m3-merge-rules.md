# M3 rules the spec left open, and schema v2

Implemented in `src/core/sim.ts`; numbers stay provisional as in the spec.

- **Unlocks** (`checkFeatures`, pure conditions on `State`, one `feature_unlocked` event each): `merge` after 6 lifetime purchases; `expansion` once any station holds 8 slimes. The spec gave no trigger.
- **Slots**: 10 per station, `expand` adds 5 for `100 * 2^((slots-10)/5)` coins. Assigning to a full station fails.
- **Merge** takes the lowest tier that has 3 slimes, lounge slimes first, and the result waits in the lounge (the freed slots are the point). Tier multiplier `2.5^(tier-1)`.
- **Traits**: leaf/stone/flame give x1.5 at their station and x0.8 at one other; lucky has no station effect. A result inherits a random trait from an ingredient that has one; otherwise the 5% roll (x2 with a lucky ingredient) gives a random trait. `slime_merged.mutated` means a brand-new trait appeared; `mutation_chance` is logged because lucky slimes bias the observed rate (the spec warns about this confound).
- **Pricing** already used lifetime purchases (`totalPurchased`), so merging cannot lower prices. A test pins this.
- **Schema v2**: new events `slime_merged`, `station_expanded`, `feature_unlocked` (version 2 only) and optional `tier` / `trait` on `slime_assigned`. v1 events remain valid. The emitter now stamps 2.
- **Bots** merge only when slimes are waiting and every station is full; the optimizer expands instead when that is cheaper than a slime.
- **Bot fault injection**: `--disconnect-rate` (per bot-minute, 30 s to 10 min offline) and `--max-buffer`. Buffered events are sent on reconnect with `sent_at` = reconnect time, so `event_time` is well before `sent_at`; past the buffer limit the oldest are dropped and `seq` gets a gap.
- **Look**: no new sprite art. Tier is a `T2`/`T3` badge and trait is a coloured glow, both CSS on the existing sheet. A roster line above the lounge counts slimes per tier and trait. Merge and Expand are plain buttons, not a Slimes/Upgrades tab.
