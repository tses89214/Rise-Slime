---
name: feedback-autonomy-and-tests
description: User wants autonomous decisions, complete tests when asked, commit+push on request
metadata:
  type: feedback
---

- Decide unresolved details yourself and keep going; don't ask clarifying questions for conventional choices.
- "你自己寫測試 / 要完整" means a full suite, not a minimal one (overrides ponytail's one-check rule). Explicit user request beats ponytail laziness.
- "commit push" was given once for the initial work; later commits/pushes to main were done after each finished chunk. Never force-push.
- Fix reported UI glitches at the root (e.g. Zzz layout jump = extra text line; customer reset = innerHTML rewritten every 100ms). Avoid rewriting DOM each tick.

**Why:** user iterates visually in the browser and reports small glitches; they expect quick, verified fixes.
**How to apply:** build DOM once, update by class/text; run `npm test`, `npm run typecheck`, `npm run build` before commit.
