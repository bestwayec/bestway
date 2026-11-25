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

from .exam_blueprint import MULTILEVEL_LEVELS
from .mock_scoring import MULTILEVEL_BELOW_B1, cefr_band, is_full_objective_section, multilevel_level, round_half

_target_table_ensured = False

# Level ranges shown with the prediction: the blueprint's one table (agency criteria).
MULTILEVEL_SCALE_BANDS = [
    {"level": item["level"], "min": item["min"], "max": item["max"],
     "label": f"{'Below B1' if item['level'] == MULTILEVEL_BELOW_B1 else item['level']} ({item['min']}–{item['max']})"}
    for item in reversed(MULTILEVEL_LEVELS)
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
    """Multilevel 0–75 score → level from the blueprint table (B1 38–50, B2 51–64, C1 65–75);
    below 38 there is no level (BELOW_B1)."""
    if score is None or not isinstance(score, (int, float)) or not math.isfinite(score):
        return MULTILEVEL_BELOW_B1
    return multilevel_level(max(0.0, min(75.0, float(score))))


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
        r_score = r_entry.get("score") if isinstance(r_entry, dict) else None
        r_max = r_entry.get("max") if isinstance(r_entry, dict) else None
        if _finite(r_score) and _finite(r_max) and r_max > 0 and 0 <= r_score <= r_max:
            raw_total += r_score
            raw_max += r_max
        if not _full_section_evidence(family, skill, r_max if _finite(r_max) else None):
            continue

        if family == "ielts":
            band = section_bands.get(skill) if isinstance(section_bands, dict) else None
            if _finite(band) and 0 <= band <= 9:
                skills_ielts[skill] = float(round_half(band))
        else:
            entry = standard_scores.get(skill) if isinstance(standard_scores, dict) else None
            score = entry.get("estimatedStandardScore") if isinstance(entry, dict) else entry
            if _finite(score) and 0 <= score <= 75:
                skills_ml[skill] = round(score, 1)

    allowed = getattr(attempt, "status", None) == "completed" and is_full_exam_attempt(attempt)
    stored_band = getattr(attempt, "overall_band", None)
    stored_score = getattr(attempt, "overall_score", None)
    has_ielts = allowed and family == "ielts" and _finite(stored_band) and 0 <= stored_band <= 9
    has_ml = allowed and family == "multilevel" and _finite(stored_score) and 0 <= stored_score <= 75
    ielts_band = float(round_half(stored_band)) if has_ielts else 0.0
    ml_score = round(stored_score, 1) if has_ml else 0.0
    cefr = multilevel_cefr_from_score(ml_score) if has_ml else None
    if has_ielts:
        cefr = getattr(attempt, "cefr_level", None) or cefr_band(ielts_band)

    return {
        "rawScore": round(raw_total, 1),
        "rawMax": round(raw_max, 1),
        "hasOverall": has_ielts or has_ml,
        "hasIeltsOverall": has_ielts,
        "hasMultilevelOverall": has_ml,
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
            "targetScore": float(row[1] or 65.0),
            "targetCefr": str(row[2] or "C1"),
        }
    return {"targetBand": 7.0, "targetScore": 65.0, "targetCefr": "C1"}


def update_student_target(student_id: str, data: dict) -> dict:
    ensure_target_table()
    current = get_student_target(student_id)
    target_band = data.get("targetBand", data.get("targetIeltsBand", current["targetBand"]))
    target_score = data.get("targetScore", data.get("targetMultilevelScore", current["targetScore"]))
    target_cefr = data.get("targetCefr", data.get("cefrLevel"))

    try:
        target_band, target_score = float(target_band), float(target_score)
    except (TypeError, ValueError, OverflowError):
        raise ContractAPIException("VALIDATION_ERROR", "Enter a valid IELTS band and Multilevel score.", 400)
    if not 1 <= target_band <= 9 or target_band * 2 % 1:
        raise ContractAPIException("VALIDATION_ERROR", "IELTS target must be between 1 and 9 in half-band steps.", 400)
    if not 10 <= target_score <= 75:
        raise ContractAPIException("VALIDATION_ERROR", "Multilevel target must be between 10 and 75.", 400)
    target_score = round(target_score, 1)
    target_cefr = str(target_cefr or current["targetCefr"]).upper()
    if target_cefr not in ("B1", "B2", "C1"):
        raise ContractAPIException("VALIDATION_ERROR", "Target CEFR level must be B1, B2 or C1.", 400)

    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO "StudentScoreTarget"
            ("student_id", "target_ielts_band", "target_multilevel_score", "target_cefr", "updated_at")
            VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT ("student_id") DO UPDATE SET
              "target_ielts_band"=EXCLUDED."target_ielts_band",
              "target_multilevel_score"=EXCLUDED."target_multilevel_score",
              "target_cefr"=EXCLUDED."target_cefr",
              "updated_at"=CURRENT_TIMESTAMP
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
        if skill not in ("reading", "listening") or not (ans.response or "").strip():
            continue
        if ans.is_correct is None and ans.score is None:
            continue
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
        .order_by("-started_at", "-id")[:limit]
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

        if metrics["hasIeltsOverall"]:
            ielts_series.append(metrics["ieltsBand"])
        if metrics["hasMultilevelOverall"]:
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
                "ieltsBand": metrics["ieltsBand"] if metrics["hasIeltsOverall"] else None,
                "multilevelScore": metrics["multilevelScore"] if metrics["hasMultilevelOverall"] else None,
                "cefrLevel": metrics["cefrLevel"],
                "skills": metrics["skillsIelts"],
                "skillsMultilevel": metrics["skillsMultilevel"],
            }
        )

    # Legacy TestAttempt rows store a total with no known maximum or scale, so no band,
    # standard score or level is derived from them: they simply give no prediction.

    has_ielts = bool(ielts_series)
    has_ml = bool(ml_series)
    curr_band, pred_band, delta_band = _compute_weighted_prediction(ielts_series, step_half=True, max_cap=9.0)
    curr_ml, pred_ml, delta_ml = _compute_weighted_prediction(ml_series, step_half=False, max_cap=75.0)

    target_band = float(target.get("targetBand") or target.get("targetIeltsBand") or 7.0)
    target_score = float(target.get("targetScore") or target.get("targetMultilevelScore") or 60.0)
    target_cefr = str(target.get("targetCefr") or "C1")

    band_progress = min(100, max(0, round((curr_band / target_band) * 100))) if target_band > 0 else 0
    ml_progress = min(100, max(0, round((curr_ml / target_score) * 100))) if target_score > 0 else 0

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

    active_series, delta, threshold = (ml_series, delta_ml, 1.0) if active_program == "MULTILEVEL" else (ielts_series, delta_band, 0.5)
    if len(active_series) < 2:
        # One result is not a trend: never call it "stable".
        trend = "insufficient_data"
    elif delta >= threshold:
        trend = "improving"
    elif delta <= -threshold:
        trend = "declining"
    else:
        trend = "stable"

    return {
        "studentId": student_id,
        "studentName": user.name,
        "activeProgram": active_program,
        "attemptsAnalyzed": len(ielts_series) + len(ml_series),
        "sectionAttemptsAnalyzed": section_attempts,
        "pendingAttempts": pending_attempts,
        "trend": trend,
        "targetProgressPercent": ml_progress if active_program == "MULTILEVEL" else band_progress,
        "ielts": {
            "currentBand": curr_band if has_ielts else None,
            "predictedBand": pred_band if len(ielts_series) >= 2 else None,
            "trendDelta": delta_band,
            "targetBand": target_band,
            "targetProgressPercent": band_progress if has_ielts else 0,
            "gapToTarget": round(max(0.0, target_band - curr_band), 1) if has_ielts else None,
            "cefrLevel": cefr_band(curr_band) if has_ielts else None,
            "skillBreakdown": skill_breakdown_ielts,
        },
        "multilevel": {
            "currentScore": curr_ml if has_ml else None,
            "predictedScore": pred_ml if len(ml_series) >= 2 else None,
            "trendDelta": delta_ml,
            "targetScore": target_score,
            "targetCefr": target_cefr,
            "targetProgressPercent": ml_progress if has_ml else 0,
            "gapToTarget": round(max(0.0, target_score - curr_ml), 1) if has_ml else None,
            "cefrLevel": multilevel_cefr_from_score(curr_ml) if has_ml else None,
            "scaleBands": MULTILEVEL_SCALE_BANDS,
            "skillBreakdown": skill_breakdown_ml,
        },
        "history": history,
        "weakModules": weak_modules,
    }
