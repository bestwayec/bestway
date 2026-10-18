"""Universal assessment overview service consolidating predictions, attempts, criteria assessments, and performance metrics."""
from __future__ import annotations

import math
from datetime import datetime

from apps.legacy_schema.models import (
    AssessmentJob,
    MockAnswer,
    MockAttempt,
    TestAttempt,
    User,
)

from . import auth_service, prediction_service


def _format_iso(dt) -> str | None:
    if not dt:
        return None
    if hasattr(dt, "isoformat"):
        return dt.isoformat().replace("+00:00", "Z")
    return str(dt)


def get_assessment_overview(user) -> dict:
    """Build a comprehensive assessment overview for the student or platform user.

    Returns:
        dict containing:
            - user: normalized public user profile
            - prediction: dual-scale (IELTS & Multi-Level) prediction data
            - recentAttempts: last 10 attempts across mock and legacy tests
            - writingAssessments: graded writing submissions with criteria and feedback
            - speakingAssessments: graded speaking submissions with criteria and feedback
            - statistics: aggregate attempt counts, averages, and practice duration
    """
    if isinstance(user, dict):
        user_id = str(user.get("id") or "")
        user_public = user
    elif hasattr(user, "id"):
        user_id = str(user.id)
        user_row = auth_service.fetch_user(user_id=user_id)
        if user_row:
            user_public = auth_service.public(user_row)
        else:
            user_public = {
                "id": user_id,
                "name": getattr(user, "name", ""),
                "phone": getattr(user, "phone", ""),
                "role": getattr(user, "role", "student"),
                "createdAt": _format_iso(getattr(user, "created_at", None)),
            }
    else:
        user_id = str(user)
        user_row = auth_service.fetch_user(user_id=user_id)
        user_public = auth_service.public(user_row) if user_row else {"id": user_id}

    # 1. Prediction data
    prediction = None
    if user_id:
        try:
            prediction = prediction_service.get_student_prediction(user_id)
        except Exception:
            prediction = {
                "studentId": user_id,
                "studentName": user_public.get("name", ""),
                "activeProgram": "IELTS",
                "attemptsAnalyzed": 0,
                "trend": "insufficient_data",
                "ielts": {
                    "currentBand": 0.0,
                    "predictedBand": 0.0,
                    "trendDelta": 0.0,
                    "targetBand": 7.0,
                    "targetProgressPercent": 0,
                    "gapToTarget": 7.0,
                    "cefrLevel": "A2",
                    "skillBreakdown": {"listening": 0.0, "reading": 0.0, "writing": 0.0, "speaking": 0.0},
                },
                "multilevel": {
                    "currentScore": 0.0,
                    "predictedScore": 0.0,
                    "trendDelta": 0.0,
                    "targetScore": 60.0,
                    "targetCefr": "C1",
                    "targetProgressPercent": 0,
                    "gapToTarget": 60.0,
                    "cefrLevel": "A2",
                    "scaleBands": prediction_service.MULTILEVEL_SCALE_BANDS,
                    "skillBreakdown": {"listening": 0.0, "reading": 0.0, "writing": 0.0, "speaking": 0.0},
                },
                "history": [],
                "weakModules": [],
            }

    # 2. Recent attempts (last 10 across MockAttempt and legacy TestAttempt)
    attempts_combined = []

    mock_attempts = list(
        MockAttempt.objects.filter(student_id=user_id)
        .select_related("exam")
        .order_by("-started_at")[:10]
    )
    for att in mock_attempts:
        metrics = prediction_service.extract_attempt_dual_metrics(att)
        status = att.status
        if status == "completed":
            status = "evaluated" if (metrics["ieltsBand"] > 0 or metrics["multilevelScore"] > 0) else "completed"

        exam_title = att.exam.title if getattr(att, "exam", None) else "Mock Exam"
        exam_type = att.exam.type if getattr(att, "exam", None) else "ielts_academic"

        attempts_combined.append({
            "id": att.id,
            "examId": att.exam_id,
            "examTitle": exam_title,
            "examType": exam_type,
            "status": status,
            "startedAt": _format_iso(att.started_at),
            "finishedAt": _format_iso(att.finished_at or att.submitted_at),
            "overallBand": float(metrics["ieltsBand"]),
            "multilevelScore": float(metrics["multilevelScore"]),
            "cefrLevel": metrics["cefrLevel"],
            "overallScore": float(att.overall_score if att.overall_score is not None else metrics["rawScore"]),
            "skills": metrics["skillsIelts"],
            "_sortKey": att.started_at,
        })

    legacy_attempts = list(
        TestAttempt.objects.filter(student_id=user_id)
        .select_related("test")
        .order_by("-started_at")[:10]
    )
    for la in legacy_attempts:
        t_score = float(la.total_score or la.auto_score or 0.0)
        ml_val = round(min(75.0, max(0.0, t_score if t_score <= 75 else (t_score / 100.0) * 75.0)), 1)
        band_val = prediction_service.multilevel_to_ielts_band(ml_val)
        cefr_val = prediction_service.multilevel_cefr_from_score(ml_val)
        status = "evaluated" if la.status == "completed" else la.status

        exam_title = la.test.title if getattr(la, "test", None) else "Practice Test"
        exam_type = la.test.type if getattr(la, "test", None) else "ielts"

        attempts_combined.append({
            "id": la.id,
            "examId": la.test_id,
            "examTitle": exam_title,
            "examType": exam_type,
            "status": status,
            "startedAt": _format_iso(la.started_at),
            "finishedAt": _format_iso(la.finished_at),
            "overallBand": float(band_val),
            "multilevelScore": float(ml_val),
            "cefrLevel": cefr_val,
            "overallScore": float(t_score),
            "skills": {
                "listening": float(band_val),
                "reading": float(band_val),
                "writing": 0.0,
                "speaking": 0.0,
            },
            "_sortKey": la.started_at,
        })

    attempts_combined.sort(
        key=lambda x: (x["_sortKey"] is not None, x["_sortKey"]),
        reverse=True,
    )
    recent_attempts = []
    for item in attempts_combined[:10]:
        item_clean = {k: v for k, v in item.items() if k != "_sortKey"}
        recent_attempts.append(item_clean)

    # 3. Writing assessments
    writing_assessments = []
    writing_jobs = list(
        AssessmentJob.objects.filter(student_id=user_id, skill="writing")
        .select_related("attempt")
        .order_by("-created_at")[:10]
    )
    for job in writing_jobs:
        final_res = job.approved_feedback or job.final_result or {}
        criteria = final_res.get("criteria") or final_res.get("rubricScores") or {}
        dt = job.completed_at or job.created_at
        band = float(job.final_score if job.final_score is not None else (job.teacher_score or job.ai_score or 0.0))
        exam_title = (
            job.attempt.exam.title
            if job.attempt and getattr(job.attempt, "exam", None)
            else "Writing Assessment"
        )
        writing_assessments.append({
            "id": job.id,
            "attemptId": job.attempt_id,
            "examTitle": exam_title,
            "skill": "writing",
            "band": band,
            "score": band,
            "source": job.final_score_source or ("TEACHER" if job.teacher_score is not None else "AI"),
            "criteria": {
                "taskAchievement": float(criteria.get("taskAchievement") or criteria.get("task_achievement") or criteria.get("ta") or 0.0),
                "coherenceCohesion": float(criteria.get("coherenceCohesion") or criteria.get("coherence_cohesion") or criteria.get("cc") or 0.0),
                "lexicalResource": float(criteria.get("lexicalResource") or criteria.get("lexical_resource") or criteria.get("lr") or 0.0),
                "grammaticalRange": float(criteria.get("grammaticalRange") or criteria.get("grammatical_range") or criteria.get("gra") or 0.0),
            },
            "feedback": str(final_res.get("feedback") or final_res.get("overallFeedback") or ""),
            "createdAt": _format_iso(dt),
        })

    if not writing_assessments:
        mock_writing_answers = list(
            MockAnswer.objects.filter(
                attempt__student_id=user_id,
                is_graded=True,
            )
            .select_related("attempt__exam", "question__group__section")
            .order_by("-updated_at")[:10]
        )
        for ans in mock_writing_answers:
            sec_skill = getattr(getattr(getattr(ans.question, "group", None), "section", None), "skill", "")
            if sec_skill == "writing":
                rubric = ans.rubric_scores or {}
                band = float(ans.score or 0.0)
                writing_assessments.append({
                    "id": ans.id,
                    "attemptId": ans.attempt_id,
                    "examTitle": getattr(getattr(ans.attempt, "exam", None), "title", "Writing Assessment"),
                    "skill": "writing",
                    "band": band,
                    "score": band,
                    "source": "TEACHER" if ans.graded_by_id else "AI",
                    "criteria": {
                        "taskAchievement": float(rubric.get("taskAchievement") or rubric.get("task_achievement") or rubric.get("ta") or 0.0),
                        "coherenceCohesion": float(rubric.get("coherenceCohesion") or rubric.get("coherence_cohesion") or rubric.get("cc") or 0.0),
                        "lexicalResource": float(rubric.get("lexicalResource") or rubric.get("lexical_resource") or rubric.get("lr") or 0.0),
                        "grammaticalRange": float(rubric.get("grammaticalRange") or rubric.get("grammatical_range") or rubric.get("gra") or 0.0),
                    },
                    "feedback": str(ans.feedback or ""),
                    "createdAt": _format_iso(ans.updated_at),
                })

    # 4. Speaking assessments
    speaking_assessments = []
    speaking_jobs = list(
        AssessmentJob.objects.filter(student_id=user_id, skill="speaking")
        .select_related("attempt")
        .order_by("-created_at")[:10]
    )
    for job in speaking_jobs:
        final_res = job.approved_feedback or job.final_result or {}
        criteria = final_res.get("criteria") or final_res.get("rubricScores") or {}
        dt = job.completed_at or job.created_at
        band = float(job.final_score if job.final_score is not None else (job.teacher_score or job.ai_score or 0.0))
        exam_title = (
            job.attempt.exam.title
            if job.attempt and getattr(job.attempt, "exam", None)
            else "Speaking Assessment"
        )
        speaking_assessments.append({
            "id": job.id,
            "attemptId": job.attempt_id,
            "examTitle": exam_title,
            "skill": "speaking",
            "band": band,
            "score": band,
            "source": job.final_score_source or ("TEACHER" if job.teacher_score is not None else "AI"),
            "criteria": {
                "fluency": float(criteria.get("fluency") or criteria.get("fluencyCoherence") or criteria.get("fluency_coherence") or 0.0),
                "pronunciation": float(criteria.get("pronunciation") or 0.0),
                "lexical": float(criteria.get("lexical") or criteria.get("lexicalResource") or criteria.get("lexical_resource") or criteria.get("vocab") or 0.0),
                "grammar": float(criteria.get("grammar") or criteria.get("grammaticalRange") or criteria.get("grammatical_range") or 0.0),
            },
            "feedback": str(final_res.get("feedback") or final_res.get("overallFeedback") or ""),
            "createdAt": _format_iso(dt),
        })

    if not speaking_assessments:
        mock_speaking_answers = list(
            MockAnswer.objects.filter(
                attempt__student_id=user_id,
                is_graded=True,
            )
            .select_related("attempt__exam", "question__group__section")
            .order_by("-updated_at")[:10]
        )
        for ans in mock_speaking_answers:
            sec_skill = getattr(getattr(getattr(ans.question, "group", None), "section", None), "skill", "")
            if sec_skill == "speaking":
                rubric = ans.rubric_scores or {}
                band = float(ans.score or 0.0)
                speaking_assessments.append({
                    "id": ans.id,
                    "attemptId": ans.attempt_id,
                    "examTitle": getattr(getattr(ans.attempt, "exam", None), "title", "Speaking Assessment"),
                    "skill": "speaking",
                    "band": band,
                    "score": band,
                    "source": "TEACHER" if ans.graded_by_id else "AI",
                    "criteria": {
                        "fluency": float(rubric.get("fluency") or rubric.get("fluencyCoherence") or rubric.get("fluency_coherence") or 0.0),
                        "pronunciation": float(rubric.get("pronunciation") or 0.0),
                        "lexical": float(rubric.get("lexical") or rubric.get("lexicalResource") or rubric.get("lexical_resource") or rubric.get("vocab") or 0.0),
                        "grammar": float(rubric.get("grammar") or rubric.get("grammaticalRange") or rubric.get("grammatical_range") or 0.0),
                    },
                    "feedback": str(ans.feedback or ""),
                    "createdAt": _format_iso(ans.updated_at),
                })

    # 5. Statistics calculation
    total_mock = MockAttempt.objects.filter(student_id=user_id).count()
    total_leg = TestAttempt.objects.filter(student_id=user_id).count()
    total_attempts = total_mock + total_leg

    all_bands = []
    all_ml = []
    practice_seconds = 0.0

    all_mock_rows = list(MockAttempt.objects.filter(student_id=user_id))
    for att in all_mock_rows:
        metrics = prediction_service.extract_attempt_dual_metrics(att)
        if metrics["ieltsBand"] > 0:
            all_bands.append(metrics["ieltsBand"])
        if metrics["multilevelScore"] > 0:
            all_ml.append(metrics["multilevelScore"])
        if att.finished_at and att.started_at:
            diff = (att.finished_at - att.started_at).total_seconds()
            if 0 < diff < 86400:
                practice_seconds += diff
        elif att.status == "completed":
            practice_seconds += 7200.0

    all_leg_rows = list(TestAttempt.objects.filter(student_id=user_id))
    for la in all_leg_rows:
        t_score = float(la.total_score or la.auto_score or 0.0)
        if t_score > 0:
            ml_val = round(min(75.0, max(0.0, t_score if t_score <= 75 else (t_score / 100.0) * 75.0)), 1)
            band_val = prediction_service.multilevel_to_ielts_band(ml_val)
            all_ml.append(ml_val)
            all_bands.append(band_val)
        if la.finished_at and la.started_at:
            diff = (la.finished_at - la.started_at).total_seconds()
            if 0 < diff < 86400:
                practice_seconds += diff
        elif la.status == "completed":
            practice_seconds += 3600.0

    statistics = {
        "totalAttempts": total_attempts,
        "averageBand": round(sum(all_bands) / len(all_bands), 1) if all_bands else 0.0,
        "highestBand": max(all_bands) if all_bands else 0.0,
        "averageMultilevelScore": round(sum(all_ml) / len(all_ml), 1) if all_ml else 0.0,
        "practiceHours": round(practice_seconds / 3600.0, 1),
    }

    return {
        "user": user_public,
        "prediction": prediction,
        "recentAttempts": recent_attempts,
        "writingAssessments": writing_assessments,
        "speakingAssessments": speaking_assessments,
        "statistics": statistics,
    }
