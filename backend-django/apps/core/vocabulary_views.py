"""REST API views for the Vocabulary Engine, Quizzes, SRS, and Excel Export."""
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from common.api.exceptions import ContractAPIException

from .models import UserWeakWord, VocabularyAttempt, VocabularySet, VocabularyWord
from .views import require_authenticated, require_role, success
from . import vocabulary_service as service


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def vocabulary_sets_view(request):
    require_authenticated(request)

    if request.method == "GET":
        qs = VocabularySet.objects.select_related("group", "created_by").prefetch_related("words")

        group_id = request.query_params.get("group_id") or request.query_params.get("groupId")
        level = request.query_params.get("level")

        if group_id:
            qs = qs.filter(group_id=group_id)
        if level:
            qs = qs.filter(level=level)

        # For students: include their last attempt and best score
        user_id = request.user.id
        user_attempts = {
            a.set_id: a
            for a in VocabularyAttempt.objects.filter(student_id=user_id).order_by("completed_at")
        }

        data = []
        for s in qs:
            att = user_attempts.get(s.id)
            data.append({
                "id": s.id,
                "title": s.title,
                "description": s.description,
                "level": s.level,
                "groupId": s.group_id,
                "groupName": s.group.name if s.group else None,
                "createdById": s.created_by_id,
                "createdByName": getattr(s.created_by, "name", "") if s.created_by else "",
                "wordCount": s.words.count(),
                "createdAt": s.created_at.isoformat(),
                "myAttempt": {
                    "score": att.score,
                    "totalWords": att.total_words,
                    "percentage": att.percentage,
                    "pointsAwarded": att.points_awarded,
                    "completedAt": att.completed_at.isoformat(),
                } if att else None,
            })
        return success(data)

    # POST: create set
    require_role(request, "teacher", "admin", "super_admin")
    payload = request.data
    title = payload.get("title", "")
    description = payload.get("description", "")
    level = payload.get("level", "B1")
    group_id = payload.get("groupId") or payload.get("group_id")

    raw_text = payload.get("rawText") or payload.get("raw_text")
    words = payload.get("words")

    if raw_text and not words:
        words = service.parse_raw_vocabulary_text(raw_text)

    if not words:
        raise ContractAPIException("VALIDATION_ERROR", "So'zlar ro'yxati yoki xom matn kiritilishi shart", 400)

    vocab_set = service.create_vocabulary_set(
        actor=request.user,
        title=title,
        words=words,
        level=level,
        group_id=group_id,
        description=description,
    )
    return success({
        "id": vocab_set.id,
        "title": vocab_set.title,
        "level": vocab_set.level,
        "wordCount": vocab_set.words.count(),
        "createdAt": vocab_set.created_at.isoformat(),
    }, status=201)


@api_view(["POST"])
@permission_classes([AllowAny])
def parse_text_preview_view(request):
    """Utility endpoint to test/parse text in real-time before saving."""
    require_authenticated(request)
    raw_text = request.data.get("rawText") or request.data.get("raw_text") or ""
    parsed = service.parse_raw_vocabulary_text(raw_text)
    return success({
        "words": parsed,
        "count": len(parsed),
    })


@api_view(["GET", "DELETE"])
@permission_classes([AllowAny])
def vocabulary_set_detail_view(request, set_id):
    require_authenticated(request)
    vocab_set = VocabularySet.objects.select_related("group", "created_by").filter(id=set_id).first()
    if not vocab_set:
        raise ContractAPIException("VOCABULARY_SET_NOT_FOUND", "Lug'at to'plami topilmadi", 404)

    if request.method == "DELETE":
        require_role(request, "teacher", "admin", "super_admin")
        vocab_set.delete()
        return success({"deleted": True})

    words = [
        {
            "id": w.id,
            "english": w.english,
            "uzbek": w.uzbek,
            "contextSentence": w.context_sentence,
            "partOfSpeech": w.part_of_speech,
        }
        for w in vocab_set.words.all()
    ]

    # Student's attempt history on this set
    attempts = [
        {
            "id": a.id,
            "score": a.score,
            "totalWords": a.total_words,
            "percentage": a.percentage,
            "pointsAwarded": a.points_awarded,
            "mode": a.mode,
            "completedAt": a.completed_at.isoformat(),
        }
        for a in VocabularyAttempt.objects.filter(student_id=request.user.id, set_id=set_id).order_by("-completed_at")[:5]
    ]

    return success({
        "id": vocab_set.id,
        "title": vocab_set.title,
        "description": vocab_set.description,
        "level": vocab_set.level,
        "groupId": vocab_set.group_id,
        "groupName": vocab_set.group.name if vocab_set.group else None,
        "words": words,
        "wordCount": len(words),
        "attempts": attempts,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def vocabulary_quiz_view(request, set_id):
    require_authenticated(request)
    mode = request.query_params.get("mode", "mixed")
    quiz = service.generate_quiz_for_set(set_id, mode=mode, student_id=request.user.id)
    return success(quiz)


@api_view(["POST"])
@permission_classes([AllowAny])
def vocabulary_submit_view(request, set_id):
    require_authenticated(request)
    answers = request.data.get("answers", [])
    mode = request.data.get("mode", "mixed")

    result = service.submit_quiz_attempt(
        student=request.user,
        set_id=set_id,
        mode=mode,
        answers=answers,
    )
    return success(result)


@api_view(["GET"])
@permission_classes([AllowAny])
def vocabulary_group_report_view(request, set_id):
    require_authenticated(request)
    require_role(request, "teacher", "admin", "super_admin")

    vocab_set = VocabularySet.objects.select_related("group").filter(id=set_id).first()
    if not vocab_set:
        raise ContractAPIException("VOCABULARY_SET_NOT_FOUND", "Lug'at to'plami topilmadi", 404)

    attempts = list(
        VocabularyAttempt.objects.filter(set_id=set_id)
        .select_related("student")
        .order_by("-completed_at")
    )

    student_roster = []
    seen = set()
    hardest_words_counter = {}

    for a in attempts:
        for w in (a.wrong_answers or []):
            eng = w.get("english")
            if eng:
                hardest_words_counter[eng] = hardest_words_counter.get(eng, 0) + 1

        if a.student_id in seen:
            continue
        seen.add(a.student_id)

        student_roster.append({
            "studentId": a.student_id,
            "studentName": getattr(a.student, "name", "Noma'lum") or "Noma'lum",
            "phone": getattr(a.student, "phone", "") or "-",
            "score": a.score,
            "totalWords": a.total_words,
            "percentage": a.percentage,
            "pointsAwarded": a.points_awarded,
            "completedAt": a.completed_at.isoformat(),
            "wrongCount": len(a.wrong_answers or []),
        })

    # Top hardest words
    hardest = sorted(hardest_words_counter.items(), key=lambda x: x[1], reverse=True)[:8]
    hardest_words = [{"word": word, "mistakes": cnt} for word, cnt in hardest]

    return success({
        "setId": vocab_set.id,
        "setTitle": vocab_set.title,
        "groupName": vocab_set.group.name if vocab_set.group else "Umumiy",
        "totalStudentsSubmitted": len(student_roster),
        "roster": student_roster,
        "hardestWords": hardest_words,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def vocabulary_export_excel_view(request, set_id):
    require_authenticated(request)
    require_role(request, "teacher", "admin", "super_admin")

    excel_bytes = service.export_vocabulary_set_excel(set_id)
    response = HttpResponse(
        excel_bytes,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = f'attachment; filename="vocabulary-{set_id}.xlsx"'
    return response


@api_view(["GET"])
@permission_classes([AllowAny])
def srs_quiz_view(request):
    require_authenticated(request)
    quiz = service.generate_srs_quiz_for_user(request.user.id)
    return success(quiz)


@api_view(["POST"])
@permission_classes([AllowAny])
def srs_submit_view(request):
    require_authenticated(request)
    answers = request.data.get("answers", [])
    if not answers:
        raise ContractAPIException("EMPTY_ANSWERS", "Javoblar mavjud emas", 400)

    # Re-use submit logic with virtual set
    word_ids = [a.get("wordId") or a.get("id") for a in answers if a.get("wordId") or a.get("id")]
    word_map = {w.id: w for w in VocabularyWord.objects.filter(id__in=word_ids)}

    correct_count = 0
    wrong_answers = []

    for ans in answers:
        wid = ans.get("wordId") or ans.get("id")
        user_val = str(ans.get("answer") or "").strip()
        q_type = ans.get("type", "eng_uzb")
        word = word_map.get(wid)
        if not word:
            continue

        if q_type == "eng_uzb":
            is_correct = user_val.lower() == word.uzbek.strip().lower()
            expected = word.uzbek
        elif q_type == "uzb_eng":
            is_correct = user_val.lower() == word.english.strip().lower()
            expected = word.english
        else:
            is_correct = user_val.lower() == word.english.strip().lower()
            expected = word.english

        weak = UserWeakWord.objects.filter(student_id=request.user.id, word_id=word.id).first()
        if is_correct:
            correct_count += 1
            if weak:
                weak.correct_streak += 1
                if weak.correct_streak >= 2:
                    weak.is_mastered = True
                weak.save(update_fields=["correct_streak", "is_mastered", "last_reviewed"])
        else:
            wrong_answers.append({
                "wordId": word.id,
                "english": word.english,
                "uzbek": word.uzbek,
                "userAnswer": user_val,
                "correctAnswer": expected,
            })
            if weak:
                weak.mistake_count += 1
                weak.correct_streak = 0
                weak.is_mastered = False
                weak.save(update_fields=["mistake_count", "correct_streak", "is_mastered", "last_reviewed"])

    return success({
        "score": correct_count,
        "totalWords": len(answers),
        "percentage": round((correct_count / len(answers)) * 100, 1) if answers else 0.0,
        "wrongAnswers": wrong_answers,
        "masteredCount": sum(1 for a in answers if a.get("wordId") not in [w["wordId"] for w in wrong_answers]),
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def srs_stats_view(request):
    require_authenticated(request)
    weak_records = list(
        UserWeakWord.objects.filter(student_id=request.user.id)
        .select_related("word")
        .order_by("-mistake_count")
    )
    total_unmastered = sum(1 for r in weak_records if not r.is_mastered)
    total_mastered = sum(1 for r in weak_records if r.is_mastered)

    words = [
        {
            "id": r.word.id,
            "english": r.word.english,
            "uzbek": r.word.uzbek,
            "mistakeCount": r.mistake_count,
            "correctStreak": r.correct_streak,
            "isMastered": r.is_mastered,
            "lastReviewed": r.last_reviewed.isoformat(),
        }
        for r in weak_records[:50]
    ]

    return success({
        "totalWeakWords": total_unmastered,
        "totalMasteredWords": total_mastered,
        "weakWords": words,
    })
