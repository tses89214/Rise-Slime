---
name: feedback-docs-and-explanations
description: User wants docs updated as work happens, diagrams colour/shape coded, and plain explanations of the stack
metadata:
  type: feedback
---

- "記得更新文件": update PROGRESS.md / DECISIONS.md / design docs / CLAUDE.md in the same chunk of work, not at the end.
- User is a batch data engineer new to streaming: when they ask what Flink/SQL/a glob does, answer plainly in zh-TW, and expect docs (`docs/system.md`, `docs/pipeline.md`) to keep the system legible. Diagrams must distinguish Kafka / Flink / ClickHouse / HTML by shape AND colour.
- Dashboard UI: content must show in full and stay inside its card (wrap, don't clip and don't collapse the whole block). Check screenshots of the real page (port 3000), not just tests.
- End-to-end claims need a number-for-number comparison against raw data (`events FINAL`), excluding the still-open last window.

**Why:** user lost track of the system's parts and asked for docs/diagrams; misread-and-redo cost a round trip when I collapsed the DLQ card instead of fixing its raw column.
**How to apply:** when a request is ambiguous about layout ("衝出格子"), fix the stated symptom minimally first; update docs with the code change.
