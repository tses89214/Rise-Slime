---
name: feedback-teaching-style
description: How Po wants the Kafka/Flink/ClickHouse pipeline taught (lesson by lesson, quizzes, written into docs/learning.md)
metadata:
  type: feedback
---

When Po asks to be taught the data pipeline (a stated purpose of this project: get familiar with unfamiliar services):

- Teach one lesson at a time and keep going until Po has no questions; answer each question fully, from the real code (`job.sql`, `init.sql`, `collector/main.py`), not generic theory.
- Write each lesson, answered question and review into `docs/learning.md` (zh-TW). Po says "補" / "補進吧" to approve a write-up; the file has a progress table at the top for the next session.
- Quizzes: give several questions, Po answers, then review them one at a time (not all at once). Say plainly which answers were wrong and why; Po often answers with a partly right intuition, so confirm the right half and fix the other.
- Mark inferences that were not run ("推斷, 沒有實測") and own mistakes immediately (I once asked a wrongly-framed question and had to retract it).
- Po asks "why" about design choices (e.g. why aggregate in Flink instead of ClickHouse): answer honestly, including that the project chose it partly for learning.

**Why:** Po is a batch data engineer new to streaming; wants to understand, not just receive a summary.
**How to apply:** at session start with a learning request, read `docs/learning.md` progress table and continue from "下次從這裡接". See [[feedback-docs-and-explanations]].
