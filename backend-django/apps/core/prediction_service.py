"""Multi-Level (0–75 CEFR) & IELTS (0–9.0) Dynamic Score Prediction and Weak Module Diagnostic Service."""
from __future__ import annotations

import math

from django.db import connection

from apps.legacy_schema.models import (
    MockAnswer,
    MockAttempt,
    StudentProfile,
    TestAttempt,
    User,
)
from common.api.exceptions import ContractAPIException

from .mock_scoring import band_from_raw, cefr_band, round_half

_target_table_ensured = False

MULTILEVEL_SCALE_BANDS = [
    {"level": "A2", "min": 0, "max": 33, "label": "A2 (0–33)"},
    {"level": "B1", "min": 34, "max": 45, "label": "B1 (34–45)"},
    {"level": "B2", "min": 46, "max": 59, "label": "B2 (46–59)"},
    {"level": "C1", "min": 60, "max": 75, "label": "C1 (60–75)"},
]

QUESTION_TYPE_LABELS = {
    "multiple_choice": "Multiple Choice",
    "multi_select": "Multi-Select",
    "true_false_notgiven": "True / False / Not Given",
    "yes_no_notgiven": "Yes / No / Not Given",
    "matching": "Matching",
    "matching_headings": "Matching Headings",
    "sentence_completion": "Sentence Completion",
    "note_completion": "Note Completion",
    "summary_completion": "Summary Completion",
    "table_completion": "Table Completion",
    "short_answer": "Short Answer",
    "map_labelling": "Map / Plan Labelling",
    "essay_task1": "Writing Task 1",
    "essay_task2": "Writing Task 2",
    "speaking_task": "Speaking Task",
}


def ensure_target_table() -> None:
    global _target_table_ensured
    if _target_table_ensured:
        return
    with connection.cursor() as cursor:
        if connection.vendor == "postgresql":
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS "StudentScoreTarget" (
                    "student_id" VARCHAR(255) PRIMARY KEY,
                    "target_ielts_band" FLOAT DEFAULT 7.0,
                    "target_multilevel_score" FLOAT DEFAULT 60.0,
                    "target_cefr" VARCHAR(10) DEFAULT 'C1',
                    "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS "StudentScoreTarget" (
                    "student_id" VARCHAR(255) PRIMARY KEY,
                    "target_ielts_band" FLOAT DEFAULT 7.0,
                    "target_multilevel_score" FLOAT DEFAULT 60.0,
                    "target_cefr" VARCHAR(10) DEFAULT 'C1',
                    "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
    _target_table_ensured = True


def multilevel_cefr_from_score(score: float) -> str:
    """Multi-Level (DTM / Milliy sertifikat) 0–75 scale CEFR mapping:
    A2: 0–33, B1: 34–45, B2: 46–59, C1: 60–75.
    """
    if score is None or not isinstance(score, (int, float)) or not math.isfinite(score):
        return "A2"
    clamped = max(0.0, min(75.0, float(score)))
    if clamped >= 60.0:
        return "C1"
    if clamped >= 46.0:
        return "B2"
    if clamped >= 34.0:
        return "B1"
    return "A2"


def raw_to_multilevel_75(raw_correct: float, max_questions: float) -> float:
    """Convert raw correct answers out of max_questions (e.g. 35 or 40) to the 0–75 scale."""
    if not max_questions or max_questions <= 0:
        return 0.0
    ratio = max(0.0, min(1.0, float(raw_correct) / float(max_questions)))
    return round(ratio * 75.0, 1)


def raw_to_ielts_band(
    raw_correct: float,
    max_questions: float = 40,
    skill: str = "reading",
    exam_type: str = "ielts_academic",
) -> float:
    """Convert raw correct answers to IELTS 0.0–9.0 band in 0.5 steps."""
    if not max_questions or max_questions <= 0:
        return 0.0
    if raw_correct <= 0:
        return 0.0
    return float(
        band_from_raw(
            skill if skill in ("listening", "reading") else "reading",
            exam_type if exam_type in ("ielts_academic", "ielts_general") else "ielts_academic",
            float(raw_correct),
            float(max_questions),
            attempted=True,
        )
    )


def multilevel_to_ielts_band(score_75: float) -> float:
    """Cross-scale projection from Multi-Level 0–75 score to IELTS 0.0–9.0 band."""
    if score_75 is None or not isinstance(score_75, (int, float)) or not math.isfinite(score_75) or score_75 <= 0:
        return 0.0
    s = max(0.0, min(75.0, float(score_75)))
    #Piecewise anchor mapping aligned with CEFR thresholds:
    # 0->0, 33(A2 top)->4.5, 45(B1 top)->5.5, 59(B2 top)->6.5, 68->7.5, 75(C1 top)->8.5
    anchors = [(0.0, 2.0), (33.0, 4.5), (45.0, 5.5), (59.0, 6.5), (68.0, 7.5), (75.0, 8.5)]
    for i in range(1, len(anchors)):
        x1, y1 = anchors[i - 1]
        x2, y2 = anchors[i]
        if s <= x2:
            val = y1 + ((s - x1) / (x2 - x1)) * (y2 - y1)
            return float(round_half(val))
    return 8.5


def ielts_band_to_multilevel(band_9: float) -> float:
    """Cross-scale projection from IELTS 0.0–9.0 band to Multi-Level 0–75 score."""
    if band_9 is None or not isinstance(band_9, (int, float)) or not math.isfinite(band_9) or band_9 <= 0:
        return 0.0
    b = max(0.0, min(9.0, float(band_9)))
    anchors = [(0.0, 0.0), (4.0, 28.0), (4.5, 33.0), (5.0, 39.0), (5.5, 45.0), (6.0, 52.0), (6.5, 59.0), (7.0, 63.0), (7.5, 68.0), (8.0, 72.0), (9.0, 75.0)]
    for i in range(1, len(anchors)):
        x1, y1 = anchors[i - 1]
        x2, y2 = anchors[i]
        if b <= x2:
            val = y1 + ((b - x1) / (x2 - x1)) * (y2 - y1)
            return round(max(0.0, min(75.0, val)), 1)
    return 75.0


def extract_attempt_dual_metrics(attempt: MockAttempt) -> dict:
    """Extract both IELTS (0–9) and Multi-Level (0–75) metrics from a single MockAttempt."""
    exam_type = getattr(attempt.exam, "type", "ielts_academic") if getattr(attempt, "exam", None) else "ielts_academic"
    raw_scores = getattr(attempt, "raw_scores", None) or {}
    section_bands = getattr(attempt, "section_bands", None) or {}
    standard_scores = getattr(attempt, "standard_scores", None) or {}

    raw_total = 0.0
    raw_max = 0.0
    skills_ielts: dict[str, float] = {}
    skills_ml: dict[str, float] = {}

    for skill in ("listening", "reading", "writing", "speaking"):
        r_entry = raw_scores.get(skill) if isinstance(raw_scores, dict) else None
        r_score = float(r_entry.get("score", 0)) if isinstance(r_entry, dict) and r_entry.get("score") is not None else None
        r_max = float(r_entry.get("max", 0)) if isinstance(r_entry, dict) and r_entry.get("max") is not None else None
        if r_score is not None and r_max and r_max > 0:
            raw_total += r_score
            raw_max += r_max

        b_val = section_bands.get(skill) if isinstance(section_bands, dict) else None
        std_entry = standard_scores.get(skill) if isinstance(standard_scores, dict) else None
        std_val = (
            float(std_entry.get("estimatedStandardScore"))
            if isinstance(std_entry, dict) and std_entry.get("estimatedStandardScore") is not None
            else (float(std_entry) if isinstance(std_entry, (int, float)) else None)
        )

        if isinstance(b_val, (int, float)) and math.isfinite(b_val):
            skills_ielts[skill] = float(round_half(float(b_val)))
        elif std_val is not None:
            skills_ielts[skill] = multilevel_to_ielts_band(std_val)
        elif r_score is not None and r_max and r_max > 0:
            if skill in ("listening", "reading"):
                skills_ielts[skill] = raw_to_ielts_band(r_score, r_max, skill=skill, exam_type=exam_type)
            else:
                skills_ielts[skill] = float(round_half((r_score / r_max) * 9.0))

        if std_val is not None and math.isfinite(std_val):
            skills_ml[skill] = round(max(0.0, min(75.0, std_val)), 1)
        elif r_score is not None and r_max and r_max > 0:
            skills_ml[skill] = raw_to_multilevel_75(r_score, r_max)
        elif skill in skills_ielts:
            skills_ml[skill] = ielts_band_to_multilevel(skills_ielts[skill])

    overall_band = getattr(attempt, "overall_band", None)
    overall_score = getattr(attempt, "overall_score", None)

    if isinstance(overall_band, (int, float)) and math.isfinite(overall_band) and overall_band > 0:
        ielts_band = float(round_half(float(overall_band)))
    elif skills_ielts:
        ielts_band = float(round_half(sum(skills_ielts.values()) / len(skills_ielts)))
    elif isinstance(overall_score, (int, float)) and math.isfinite(overall_score) and overall_score > 0:
        ielts_band = multilevel_to_ielts_band(float(overall_score))
    elif raw_max > 0:
        ielts_band = raw_to_ielts_band(raw_total, raw_max)
    else:
        ielts_band = 0.0

    if isinstance(overall_score, (int, float)) and math.isfinite(overall_score) and overall_score > 0:
        ml_score = round(max(0.0, min(75.0, float(overall_score))), 1)
    elif skills_ml:
        ml_score = round(sum(skills_ml.values()) / len(skills_ml), 1)
    elif raw_max > 0:
        ml_score = raw_to_multilevel_75(raw_total, raw_max)
    elif ielts_band > 0:
        ml_score = ielts_band_to_multilevel(ielts_band)
    else:
        ml_score = 0.0

    cefr = multilevel_cefr_from_score(ml_score) if exam_type == "multilevel" else (
        getattr(attempt, "cefr_level", None) or multilevel_cefr_from_score(ml_score)
    )

    return {
        "rawScore": round(raw_total, 1),
        "rawMax": round(raw_max, 1),
        "ieltsBand": ielts_band,
        "multilevelScore": ml_score,
        "cefrLevel": cefr,
        "skillsIelts": skills_ielts,
        "skillsMultilevel": skills_ml,
    }


def get_student_target(student_id: str) -> dict:
    ensure_target_table()
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT "target_ielts_band", "target_multilevel_score", "target_cefr"
            FROM "StudentScoreTarget"
            WHERE "student_id"=%s
            """,
            [student_id],
        )
        row = cursor.fetchone()
    if row:
        return {
            "targetBand": float(row[0] or 7.0),
            "targetScore": float(row[1] or 60.0),
            "targetCefr": str(row[2] or "C1"),
        }
    return {"targetBand": 7.0, "targetScore": 60.0, "targetCefr": "C1"}


def update_student_target(student_id: str, data: dict) -> dict:
    ensure_target_table()
    current = get_student_target(student_id)
    target_band = data.get("targetBand", data.get("targetIeltsBand", current["targetBand"]))
    target_score = data.get("targetScore", data.get("targetMultilevelScore", current["targetScore"]))
    target_cefr = data.get("targetCefr", data.get("cefrLevel"))

    try:
        target_band = float(round_half(max(1.0, min(9.0, float(target_band)))))
    except (TypeError, ValueError):
        target_band = 7.0

    try:
        target_score = round(max(10.0, min(75.0, float(target_score))), 1)
    except (TypeError, ValueError):
        target_score = 60.0

    if not target_cefr or str(target_cefr).upper() not in ("A2", "B1", "B2", "C1"):
        target_cefr = multilevel_cefr_from_score(target_score)
    else:
        target_cefr = str(target_cefr).upper()

    with connection.cursor() as cursor:
        cursor.execute('SELECT 1 FROM "StudentScoreTarget" WHERE "student_id"=%s', [student_id])
        if cursor.fetchone():
            cursor.execute(
                """
                UPDATE "StudentScoreTarget"
                SET "target_ielts_band"=%s, "target_multilevel_score"=%s, "target_cefr"=%s, "updated_at"=CURRENT_TIMESTAMP
                WHERE "student_id"=%s
                """,
                [target_band, target_score, target_cefr, student_id],
            )
        else:
            cursor.execute(
                """
                INSERT INTO "StudentScoreTarget"
                ("student_id", "target_ielts_band", "target_multilevel_score", "target_cefr", "updated_at")
                VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
                """,
                [student_id, target_band, target_score, target_cefr],
            )
    return get_student_prediction(student_id)


def _compute_weighted_prediction(values: list[float], step_half: bool = False, max_cap: float = 9.0) -> tuple[float, float, float]:
    """Compute (current, predicted_next, trend_delta) from chronological score values."""
    if not values:
        return 0.0, 0.0, 0.0
    current = values[-1]
    if len(values) == 1:
        return current, current, 0.0

    # Weighted average favoring recent attempts + 40% of recent linear slope
    weights = [i + 1 for i in range(len(values))]
    w_avg = sum(v * w for v, w in zip(values, weights)) / sum(weights)
    slope = (values[-1] - values[0]) / max(1, len(values) - 1)
    projected = max(0.0, min(max_cap, w_avg + 0.55 * slope))
    if step_half:
        projected = float(round_half(projected))
        current = float(round_half(current))
    else:
        projected = round(projected, 1)
        current = round(current, 1)
    delta = round(projected - values[0], 1)
    return current, projected, delta


def _analyze_weak_modules(attempt_ids: list[str]) -> list[dict]:
    """Inspect MockAnswer rows across recent attempts to pinpoint weak skills, parts, and question types."""
    if not attempt_ids:
        return []

    answers = list(
        MockAnswer.objects.filter(attempt_id__in=attempt_ids)
        .select_related("question__group__section")
    )
    if not answers:
        return []

    buckets: dict[tuple[str, str], dict] = {}
    for ans in answers:
        q = getattr(ans, "question", None)
        if not q or not getattr(q, "group", None) or not getattr(q.group, "section", None):
            continue
        skill = q.group.section.skill
        q_type = q.type
        part_num = q.group.part_number or (q.group.sort_order + 1)
        type_label = QUESTION_TYPE_LABELS.get(q_type, q_type.replace("_", " ").title())

        key = (skill, q_type)
        entry = buckets.setdefault(
            key,
            {
                "skill": skill,
                "questionType": q_type,
                "questionTypeLabel": type_label,
                "module": f"{skill.title()} — {type_label}",
                "parts": set(),
                "totalQuestions": 0,
                "correctCount": 0,
                "errorCount": 0,
            },
        )
        entry["parts"].add(f"Part {part_num}")
        entry["totalQuestions"] += 1

        is_ok = False
        if ans.is_correct is True:
            is_ok = True
        elif ans.is_correct is None and ans.score is not None and q.points:
            is_ok = float(ans.score) >= float(q.points) * 0.65

        if is_ok:
            entry["correctCount"] += 1
        else:
            entry["errorCount"] += 1

    modules_out: list[dict] = []
    for entry in buckets.values():
        total = entry["totalQuestions"]
        if total <= 0:
            continue
        correct_cnt = entry["correctCount"]
        err_cnt = entry["errorCount"]
        acc_pct = round((correct_cnt / total) * 100)
        err_pct = 100 - acc_pct
        if acc_pct < 55:
            severity = "high"
            rec = (
                f"Critical focus area: {entry['module']} ({err_pct}% error rate). "
                f"Practice timed {entry['questionTypeLabel']} drills and review keyword paraphrasing."
            )
        elif acc_pct < 75:
            severity = "medium"
            rec = (
                f"Moderate weakness in {entry['module']} ({acc_pct}% accuracy). "
                f"Review distractor patterns in {', '.join(sorted(entry['parts']))}."
            )
        else:
            severity = "low"
            rec = f"Strong performance in {entry['module']} ({acc_pct}% accuracy). Maintain speed under timed conditions."

        modules_out.append(
            {
                "module": entry["module"],
                "skill": entry["skill"],
                "questionType": entry["questionType"],
                "questionTypeLabel": entry["questionTypeLabel"],
                "parts": sorted(entry["parts"]),
                "totalQuestions": total,
                "correctCount": correct_cnt,
                "errorCount": err_cnt,
                "accuracyPercent": acc_pct,
                "errorRatePercent": err_pct,
                "severity": severity,
                "recommendation": rec,
            }
        )

    modules_out.sort(key=lambda m: (m["errorRatePercent"], m["errorCount"], m["totalQuestions"]), reverse=True)
    return modules_out[:8]


def get_student_prediction(student_id: str, limit: int = 5) -> dict:
    """Compute Dual-Scale (IELTS 0-9.0 & Multi-Level 0-75 CEFR) score predictions, trend history, and weak modules."""
    user = User.objects.filter(id=student_id).first()
    if not user:
        raise ContractAPIException("USER_NOT_FOUND", "O'quvchi topilmadi", 404)

    target = get_student_target(student_id)
    limit = max(3, min(10, int(limit or 5)))

    completed_attempts = list(
        MockAttempt.objects.filter(student_id=student_id, status="completed")
        .select_related("exam")
        .order_by("-finished_at", "-submitted_at", "-started_at")[:limit]
    )
    if not completed_attempts:
        completed_attempts = list(
            MockAttempt.objects.filter(student_id=student_id)
            .exclude(overall_band=None, overall_score=None)
            .select_related("exam")
            .order_by("-started_at")[:limit]
        )

    # Reverse to chronological order (oldest -> newest) for trend calculation
    chronological = list(reversed(completed_attempts))
    history: list[dict] = []
    ielts_series: list[float] = []
    ml_series: list[float] = []
    skills_ielts_acc: dict[str, list[float]] = {"listening": [], "reading": [], "writing": [], "speaking": []}
    skills_ml_acc: dict[str, list[float]] = {"listening": [], "reading": [], "writing": [], "speaking": []}

    for att in chronological:
        metrics = extract_attempt_dual_metrics(att)
        dt = att.finished_at or att.submitted_at or att.started_at
        dt_iso = dt.isoformat() if hasattr(dt, "isoformat") else str(dt or "")
        exam_title = att.exam.title if getattr(att, "exam", None) else "Mock Exam"
        exam_type = att.exam.type if getattr(att, "exam", None) else "ielts_academic"

        ielts_series.append(metrics["ieltsBand"])
        ml_series.append(metrics["multilevelScore"])

        for sk in ("listening", "reading", "writing", "speaking"):
            if sk in metrics["skillsIelts"]:
                skills_ielts_acc[sk].append(metrics["skillsIelts"][sk])
            if sk in metrics["skillsMultilevel"]:
                skills_ml_acc[sk].append(metrics["skillsMultilevel"][sk])

        history.append(
            {
                "attemptId": att.id,
                "examId": att.exam_id,
                "examTitle": exam_title,
                "examType": exam_type,
                "date": dt_iso,
                "rawScore": metrics["rawScore"],
                "rawMax": metrics["rawMax"],
                "ieltsBand": metrics["ieltsBand"],
                "multilevelScore": metrics["multilevelScore"],
                "cefrLevel": metrics["cefrLevel"],
                "skills": metrics["skillsIelts"],
                "skillsMultilevel": metrics["skillsMultilevel"],
            }
        )

    # Fallback to legacy TestAttempt if student only has legacy test attempts
    if not history:
        legacy_rows = list(
            TestAttempt.objects.filter(student_id=student_id, status="completed")
            .select_related("test")
            .order_by("-finished_at", "-started_at")[:limit]
        )
        for la in reversed(legacy_rows):
            t_score = float(la.total_score or la.auto_score or 0.0)
            ml_val = round(min(75.0, max(0.0, t_score if t_score <= 75 else (t_score / 100.0) * 75.0)), 1)
            band_val = multilevel_to_ielts_band(ml_val)
            cefr_val = multilevel_cefr_from_score(ml_val)
            dt = la.finished_at or la.started_at
            ielts_series.append(band_val)
            ml_series.append(ml_val)
            history.append(
                {
                    "attemptId": la.id,
                    "examId": la.test_id,
                    "examTitle": la.test.title if getattr(la, "test", None) else "Practice Test",
                    "examType": la.test.type if getattr(la, "test", None) else "ielts",
                    "date": dt.isoformat() if hasattr(dt, "isoformat") else str(dt or ""),
                    "rawScore": t_score,
                    "rawMax": 40.0,
                    "ieltsBand": band_val,
                    "multilevelScore": ml_val,
                    "cefrLevel": cefr_val,
                    "skills": {},
                    "skillsMultilevel": {},
                }
            )

    curr_band, pred_band, delta_band = _compute_weighted_prediction(ielts_series, step_half=True, max_cap=9.0)
    curr_ml, pred_ml, delta_ml = _compute_weighted_prediction(ml_series, step_half=False, max_cap=75.0)

    target_band = float(target.get("targetBand") or target.get("targetIeltsBand") or 7.0)
    target_score = float(target.get("targetScore") or target.get("targetMultilevelScore") or 60.0)
    target_cefr = str(target.get("targetCefr") or "C1")

    band_progress = min(100, max(0, round((pred_band / target_band) * 100))) if target_band > 0 else 0
    ml_progress = min(100, max(0, round((pred_ml / target_score) * 100))) if target_score > 0 else 0

    skill_breakdown_ielts = {}
    skill_breakdown_ml = {}
    for sk in ("listening", "reading", "writing", "speaking"):
        i_vals = skills_ielts_acc[sk]
        m_vals = skills_ml_acc[sk]
        skill_breakdown_ielts[sk] = float(round_half(sum(i_vals) / len(i_vals))) if i_vals else curr_band
        skill_breakdown_ml[sk] = round(sum(m_vals) / len(m_vals), 1) if m_vals else curr_ml

    weak_modules = _analyze_weak_modules([a.id for a in completed_attempts])

    profile = StudentProfile.objects.filter(user_id=student_id).first()
    active_program = getattr(profile, "active_program", None) or "IELTS"

    if len(history) < 2:
        trend = "insufficient_data" if len(history) == 0 else "stable"
    elif delta_ml > 1.0 or delta_band >= 0.5:
        trend = "improving"
    elif delta_ml < -1.0 or delta_band <= -0.5:
        trend = "declining"
    else:
        trend = "stable"

    return {
        "studentId": student_id,
        "studentName": user.name,
        "activeProgram": active_program,
        "attemptsAnalyzed": len(history),
        "trend": trend,
        "targetProgressPercent": ml_progress if active_program == "MULTILEVEL" else band_progress,
        "ielts": {
            "currentBand": curr_band,
            "predictedBand": pred_band,
            "trendDelta": delta_band,
            "targetBand": target_band,
            "targetProgressPercent": band_progress,
            "gapToTarget": round(max(0.0, target_band - pred_band), 1),
            "cefrLevel": cefr_band(pred_band) if pred_band > 0 else "A2",
            "skillBreakdown": skill_breakdown_ielts,
        },
        "multilevel": {
            "currentScore": curr_ml,
            "predictedScore": pred_ml,
            "trendDelta": delta_ml,
            "targetScore": target_score,
            "targetCefr": target_cefr,
            "targetProgressPercent": ml_progress,
            "gapToTarget": round(max(0.0, target_score - pred_ml), 1),
            "cefrLevel": multilevel_cefr_from_score(pred_ml),
            "scaleBands": MULTILEVEL_SCALE_BANDS,
            "skillBreakdown": skill_breakdown_ml,
        },
        "history": history,
        "weakModules": weak_modules,
    }
