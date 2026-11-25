# Phase 3 checkpoint

Phase 3 starts from Phase 2 commit `16d0ea90a99b81682eed8bb5a19a12f756119e3e` on `feat/bestway-exam4-cbt-analysis`.

The teacher analytics service returned a 6.0 average without graded results, 100% attendance without records, and hard-coded topic percentages. It also combined incompatible scales. This checkpoint removes those invented values, returns null for unavailable averages and attendance, and groups IELTS Academic, IELTS General and Multilevel results separately. The current attendance calculation counts present as one, late as one half and all other recorded states as zero. No records produce null. Pending and unanswered responses are excluded from prediction weakness counts.

The group service currently reports results of current group members. Historical membership attribution has not been implemented and must be corrected before treating group results as assignment-level historical statistics. Topic heatmap data is temporarily empty pending real database-derived aggregation. Ranking, filters, export parity, review evidence for continuation groups, and the remaining Phase 3 CBT, results, progress and reporting requirements remain unfinished. No Phase 3 browser journey, cumulative test suite or production verification has been completed.

Focused tests `tests/test_phase5_analytics_and_progress.py` and `tests/test_study_plan_and_teacher_hub.py` passed 12 tests. TypeScript checking was run separately. Next investigate historical membership and assignment ownership, implement real objective response aggregation, then continue the full Phase 3 brief and required cumulative tests.
