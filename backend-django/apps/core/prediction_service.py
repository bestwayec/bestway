"""Multi-Level (0–75 CEFR) & IELTS (0–9.0) Dynamic Score Prediction and Weak Module Diagnostic Service."""
from __future__ import annotations

import math

from django.db import connection

from apps.legacy_schema.models import (
    MockAnswer,
    MockAttempt,
    StudentProfile,
    User,
)
from common.api.exceptions import ContractAPIException

from .mock_scoring import cefr_band, is_full_objective_section, round_half

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


def _finite(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _full_section_evidence(family: str, skill: str, raw_max) -> bool:
    """A Listening/Reading band or standard score is evidence only for a full section
    (IELTS 40, Multilevel 35 objective questions). A short practice set has a raw
    result and nothing else, also when an older attempt stored a band for it."""
    if skill not in ("listening", "reading") or not raw_max:
        return True
    return is_full_objective_section(family, int(raw_max)) if float(raw_max).is_integer() else False


def extract_attempt_dual_metrics(attempt: MockAttempt) -> dict:
    """IELTS (0-9) and Multilevel (0-75) figures stored for one MockAttempt.

    Nothing is derived from a raw score here: a section figure exists only when the
    scoring module stored a band or standard score for a full section, and an overall
    figure only for a completed full exam whose overall result was stored. ``hasOverall``
    is False (and the overall figures 0.0, level None) in every other case.
    """
    exam_type = getattr(attempt.exam, "type", "ielts_academic") if getattr(attempt, "exam", None) else "ielts_academic"
    family = "multilevel" if exam_type == "multilevel" else "ielts"
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
        if not _full_section_evidence(family, skill, r_max):
            continue

        b_val = section_bands.get(skill) if isinstance(section_bands, dict) else None
        std_entry = standard_scores.get(skill) if isinstance(standard_scores, dict) else None
        std_val = std_entry.get("estimatedStandardScore") if isinstance(std_entry, dict) else std_entry
        std_val = float(std_val) if _finite(std_val) else None

        if _finite(b_val):
            skills_ielts[skill] = float(round_half(float(b_val)))
        elif std_val is not None:
            skills_ielts[skill] = multilevel_to_ielts_band(std_val)

        if std_val is not None:
            skills_ml[skill] = round(max(0.0, min(75.0, std_val)), 1)
        elif skill in skills_ielts:
            skills_ml[skill] = ielts_band_to_multilevel(skills_ielts[skill])

    overall_band = getattr(attempt, "overall_band", None)
    overall_score = getattr(attempt, "overall_score", None)
    stored_band = float(overall_band) if _finite(overall_band) and overall_band > 0 else None
    stored_score = float(overall_score) if _finite(overall_score) and overall_score > 0 else None
    # An attempt that is still being graded has no overall result, and neither has a
    # single-section practice; the mean of whatever sections exist is not one.
    has_overall = (
        getattr(attempt, "status", None) == "completed"
        and is_full_exam_attempt(attempt)
        and (stored_band is not None or stored_score is not None)
    )

    ielts_band = 0.0
    ml_score = 0.0
    cefr = None
    if has_overall:
        ielts_band = float(round_half(stored_band)) if stored_band is not None else multilevel_to_ielts_band(stored_score)
        ml_score = round(max(0.0, min(75.0, stored_score)), 1) if stored_score is not None else ielts_band_to_multilevel(ielts_band)
        cefr = multilevel_cefr_from_score(ml_score) if exam_type == "multilevel" else (
            getattr(attempt, "cefr_level", None) or multilevel_cefr_from_score(ml_score)
        )

    return {
        "rawScore": round(raw_total, 1),
        "rawMax": round(raw_max, 1),
        "hasOverall": has_overall,
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


def is_full_exam_attempt(attempt) -> bool:
    """Only a complete multi-section exam may feed an overall score, CEFR level
    or trend. A single-section practice has real section evidence, but no
    overall result."""
    from .mock_practice import is_partial
    if is_partial(attempt) or getattr(attempt, 'flow_mode', None) in ('single_skill', 'partial_practice'):
        return False
    return True


def get_student_prediction(student_id: str, limit: int = 5) -> dict:
    """Compute Dual-Scale (IELTS 0-9.0 & Multi-Level 0-75 CEFR) score predictions, trend history, and weak modules."""
    user = User.objects.filter(id=student_id).first()
    if not user:
        raise ContractAPIException("USER_NOT_FOUND", "O'quvchi topilmadi", 404)

    target = get_student_target(student_id)
    limit = max(3, min(10, int(limit or 5)))

    completed_attempts = list(
        MockAttempt.objects.filter(student_id=student_id, status__in=["completed", "grading"])
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

    section_attempts = 0
    pending_attempts = 0
    for att in chronological:
        metrics = extract_attempt_dual_metrics(att)
        dt = att.finished_at or att.submitted_at or att.started_at
        dt_iso = dt.isoformat() if hasattr(dt, "isoformat") else str(dt or "")
        exam_title = att.exam.title if getattr(att, "exam", None) else "Mock Exam"
        exam_type = att.exam.type if getattr(att, "exam", None) else "ielts_academic"

        # Section practice contributes per-skill evidence only.
        for sk in ("listening", "reading", "writing", "speaking"):
            if sk in metrics["skillsIelts"]:
                skills_ielts_acc[sk].append(metrics["skillsIelts"][sk])
            if sk in metrics["skillsMultilevel"]:
                skills_ml_acc[sk].append(metrics["skillsMultilevel"][sk])
        if not is_full_exam_attempt(att):
            section_attempts += 1
            continue
        if not metrics["hasOverall"]:
            # Still being graded (or no stored overall): section evidence only.
            pending_attempts += 1
            continue

        ielts_series.append(metrics["ieltsBand"])
        ml_series.append(metrics["multilevelScore"])

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

    # Legacy TestAttempt rows store a total with no known maximum or scale, so no band,
    # standard score or level is derived from them: they simply give no prediction.

    has_overall = bool(ml_series)
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
        # No graded evidence for a skill -> None ("—" in the UI); never copy the
        # overall score into a skill that was not attempted.
        skill_breakdown_ielts[sk] = float(round_half(sum(i_vals) / len(i_vals))) if i_vals else None
        skill_breakdown_ml[sk] = round(sum(m_vals) / len(m_vals), 1) if m_vals else None

    weak_modules = _analyze_weak_modules([a.id for a in completed_attempts])

    profile = StudentProfile.objects.filter(user_id=student_id).first()
    active_program = getattr(profile, "active_program", None) or "IELTS"

    if len(ml_series) < 2:
        # One result is not a trend: never call it "stable".
        trend = "insufficient_data"
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
        "attemptsAnalyzed": len(ml_series) if len(ml_series) > 0 else (section_attempts or len(completed_attempts)),
        "sectionAttemptsAnalyzed": section_attempts,
        "pendingAttempts": pending_attempts,
        "trend": trend,
        "targetProgressPercent": (ml_progress if active_program == "MULTILEVEL" else band_progress) if has_overall else 0,
        "ielts": {
            "currentBand": curr_band if has_overall else None,
            "predictedBand": pred_band if has_overall else None,
            "trendDelta": delta_band,
            "targetBand": target_band,
            "targetProgressPercent": band_progress if has_overall else 0,
            "gapToTarget": round(max(0.0, target_band - pred_band), 1) if has_overall else None,
            "cefrLevel": cefr_band(pred_band) if has_overall and pred_band > 0 else None,
            "skillBreakdown": skill_breakdown_ielts,
        },
        "multilevel": {
            "currentScore": curr_ml if has_overall else None,
            "predictedScore": pred_ml if has_overall else None,
            "trendDelta": delta_ml,
            "targetScore": target_score,
            "targetCefr": target_cefr,
            "targetProgressPercent": ml_progress if has_overall else 0,
            "gapToTarget": round(max(0.0, target_score - pred_ml), 1) if has_overall else None,
            "cefrLevel": multilevel_cefr_from_score(pred_ml) if has_overall else None,
            "scaleBands": MULTILEVEL_SCALE_BANDS,
            "skillBreakdown": skill_breakdown_ml,
        },
        "history": history,
        "weakModules": weak_modules,
    }
