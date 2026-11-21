"""REST API views for the Vocabulary Engine, Quizzes, SRS, and Excel Export."""
from django.core import signing
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from common.api.exceptions import ContractAPIException

from .models import UserWeakWord, VocabularyAttempt, VocabularyReviewEvent, VocabularySet, VocabularyWord
from .views import require_authenticated, require_role, success
from . import vocabulary_service as service
from . import vocabulary_collections, vocabulary_review


def can_manage_set(user, vocab_set):
    role = getattr(user, "role", None)
    if role in ("admin", "super_admin"):
        return True
    if role != "teacher":
        return False
    group_teacher = getattr(vocab_set.group, "teacher_id", None) if vocab_set.group_id else None
    return user.id in (vocab_set.created_by_id, group_teacher)


def assert_manages_set(user, vocab_set):
    if not can_manage_set(user, vocab_set):
        raise ContractAPIException("FORBIDDEN", "Bu lug'at to'plami sizga tegishli emas", 403)


STAFF_ROLES = ("teacher", "admin", "super_admin")


def student_visibility(user):
    """Q filter of the sets a non-staff user may see: sets created by the teacher of
    their own group, sets assigned to their group, and their own sets. Staff see all.
    Returns None for staff (no filter)."""
    from apps.legacy_schema.models import Group, StudentProfile
    if getattr(user, "role", None) in STAFF_ROLES:
        return None
    visible = Q(created_by_id=user.id)
    group_id = StudentProfile.objects.filter(user_id=user.id).values_list("group_id", flat=True).first()
    if group_id:
        visible |= Q(group_id=group_id, is_public=True)
        teacher_id = Group.objects.filter(id=group_id).values_list("teacher_id", flat=True).first()
        if teacher_id:
            visible |= Q(created_by_id=teacher_id, group_id__isnull=True, is_public=True)
    return visible


def visible_collections(user):
    if user.role == "teacher":
        return Q(is_public=True) | Q(created_by_id=user.id) | Q(group__teacher_id=user.id)
    return student_visibility(user)


def visible_set(request, set_id):
    """The set if this user may study it; 404 otherwise (no existence leak)."""
    require_authenticated(request)
    rows = VocabularySet.objects.select_related("group", "created_by").filter(id=set_id)
    visible = visible_collections(request.user)
    if visible is not None:
        rows = rows.filter(visible)
    vocab_set = rows.first()
    if not vocab_set:
        raise ContractAPIException("VOCABULARY_SET_NOT_FOUND", "Lug'at to'plami topilmadi", 404)
    return vocab_set


def managed_set(request, set_id):
    require_authenticated(request)
    require_role(request, "teacher", "admin", "super_admin")
    vocab_set = VocabularySet.objects.select_related("group").filter(id=set_id).first()
    if not vocab_set:
        raise ContractAPIException("VOCABULARY_SET_NOT_FOUND", "Lug'at to'plami topilmadi", 404)
    assert_manages_set(request.user, vocab_set)
    return vocab_set


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def vocabulary_sets_view(request):
    require_authenticated(request)

    if request.method == "GET":
        qs = VocabularySet.objects.select_related("group", "created_by").prefetch_related("words")
        visible = visible_collections(request.user)
        if visible is not None:
            qs = qs.filter(visible)

        group_id = request.query_params.get("group_id") or request.query_params.get("groupId")
        level = request.query_params.get("level")

        if group_id:
            qs = qs.filter(group_id=group_id)
        if request.query_params.get("owned") == "true":
            require_role(request, "teacher", "admin", "super_admin")
            qs = qs.filter(created_by_id=request.user.id)
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
                "canEdit": can_manage_set(request.user, s),
                "wordCount": s.words.filter(is_archived=False).count(),
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
    is_public = payload.get("isPublic", True)
    if not isinstance(is_public, bool):
        raise ContractAPIException("VALIDATION_ERROR", "isPublic qiymati mantiqiy bo‘lishi kerak", 400)
    if group_id:
        from . import groups

        groups.assert_manages_group(request.user, groups.get_group(group_id))

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
        is_public=is_public,
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


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([AllowAny])
def vocabulary_set_detail_view(request, set_id):
    if request.method == "PATCH":
        from .domain_contracts import payload

        editable = managed_set(request, set_id)
        fields = payload(request, {"title", "description", "level", "isPublic", "revision", "words"})
        updated = vocabulary_collections.edit_collection(editable, fields)
        view = vocabulary_collections.snapshot(updated)
        return success({"id": updated.id, **view, "description": updated.description, "isPublic": updated.is_public})
    vocab_set = visible_set(request, set_id)

    if request.method == "DELETE":
        require_role(request, "teacher", "admin", "super_admin")
        assert_manages_set(request.user, vocab_set)
        if vocab_set.homework_assignments.exists():
            raise ContractAPIException("SET_ASSIGNED", "Biriktirilgan to‘plamni o‘chirib bo‘lmaydi", 409)
        vocab_set.delete()
        return success({"deleted": True})

    words = vocabulary_collections.snapshot(vocab_set)["words"]

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
        "revision": vocab_set.revision,
        "isPublic": vocab_set.is_public,
        "canEdit": can_manage_set(request.user, vocab_set),
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
    vocab_set = visible_set(request, set_id)
    mode = request.query_params.get("mode", "mixed")
    return success(service.issue_practice(
        request.user, vocab_set, mode, explicit=request.query_params.get("session") == "explicit",
    ))


@api_view(["POST"])
@permission_classes([AllowAny])
def vocabulary_submit_view(request, set_id):
    from .domain_contracts import invalid, payload

    visible_set(request, set_id)
    data = payload(request, {"mode", "answers", "sessionId"})
    session_id = data.get("sessionId")
    if "sessionId" in data and (not isinstance(session_id, str) or not 1 <= len(session_id) <= 255):
        invalid("Mashq sessiyasi yaroqsiz")
    return success(service.submit_quiz_attempt(
        student=request.user,
        set_id=set_id,
        mode=data.get("mode", None if session_id else "mixed"),
        answers=data.get("answers"),
        session_id=session_id,
    ))


@api_view(["GET"])
@permission_classes([AllowAny])
def vocabulary_group_report_view(request, set_id):
    managed_set(request, set_id)

    report_data = service.get_vocabulary_set_report(set_id)
    return success(report_data)


@api_view(["GET"])
@permission_classes([AllowAny])
def vocabulary_export_excel_view(request, set_id):
    managed_set(request, set_id)

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
@transaction.atomic
def srs_submit_view(request):
    require_authenticated(request)
    from .domain_contracts import invalid
    from .vocabulary_homework import answer_by_word, normalize

    if not isinstance(request.data, dict) or not isinstance(request.data.get("sessionId"), str):
        invalid("Takrorlash sessiyasi kerak")
    try:
        session = signing.loads(request.data["sessionId"], salt="bestway-vocabulary-review", max_age=3600)
    except signing.BadSignature:
        invalid("Takrorlash sessiyasi yaroqsiz yoki muddati tugagan")
    if session["owner"] != request.user.id:
        raise ContractAPIException("FORBIDDEN", "Sessiya bu foydalanuvchiga tegishli emas", 403)
    # In-flight batches issued before the revision field remain valid for their signed lifetime.
    questions = {word_id: (kind, version, revision[0] if revision else None)
                 for word_id, kind, version, *revision in session["words"]}
    answers = answer_by_word(request.data.get("answers"), questions)
    rows = UserWeakWord.objects.select_for_update(of=("self",)).select_related("word").filter(
        student_id=request.user.id, word_id__in=questions,
    ).order_by("word_id")
    rows = list(rows)
    now = timezone.now()
    if len(rows) != len(questions) or any(
        row.review_count != questions[row.word_id][1]
        or (questions[row.word_id][2] is not None and
            questions[row.word_id][2] != vocabulary_review.word_revision(row.word))
        or (row.next_review_at is not None and row.next_review_at > now)
        for row in rows
    ):
        raise ContractAPIException("REVIEW_SESSION_STALE", "Takrorlash savollari yangilandi", 409)

    wrong = []
    for row in rows:
        word = row.word
        kind = questions[word.id][0]
        expected = word.uzbek if kind == "eng_uzb" else word.english
        from . import vocabulary_answers
        accepted = vocabulary_answers.accepted_forms(word, kind, vocabulary_answers.approved_variants(word.id, kind))
        correct = vocabulary_answers.matches(answers[word.id], expected, accepted)
        vocabulary_review.update_review(row, correct, now)
        if not correct:
            wrong.append({
                "wordId": word.id, "english": word.english, "uzbek": word.uzbek,
                "userAnswer": answers[word.id], "correctAnswer": expected,
            })
    total = len(rows)
    score = total - len(wrong)
    return success({
        "score": score, "totalWords": total, "percentage": round(100 * score / total, 1),
        "pointsAwarded": 0, "mode": "srs_mixed", "wrongAnswers": wrong,
        "masteredCount": sum(row.is_mastered for row in rows),
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
    now = timezone.now()
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
            "nextReviewAt": r.next_review_at.isoformat() if r.next_review_at else None,
            "reviewCount": r.review_count,
            "intervalDays": r.interval_days,
            "lapses": r.lapses,
        }
        for r in weak_records[:50]
    ]

    return success({
        "totalWeakWords": total_unmastered,
        "totalDueWords": sum(
            (r.next_review_at <= now if r.next_review_at is not None else not r.is_mastered)
            for r in weak_records
        ),
        "totalMasteredWords": total_mastered,
        "weakWords": words,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def review_history_view(request):
    require_authenticated(request)
    from .domain_contracts import pagination

    query = pagination(request)
    start = (query["page"] - 1) * query["limit"]
    rows = VocabularyReviewEvent.objects.filter(review__student_id=request.user.id).order_by("-reviewed_at", "-pk")
    page = list(rows.values("id", "review__word__english", "reviewed_at", "next_review_at", "correct", "interval_days", "mastered")
                [start:start + query["limit"] + 1])
    return success({
        "entries": page[:query["limit"]], "page": query["page"], "hasNext": len(page) > query["limit"],
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def vocabulary_lookup_view(request):
    """Look up translation and phonetic details of an English word (Click-to-Vocab)."""
    require_authenticated(request)
    word = (request.query_params.get("word") or "").strip()
    if not word:
        raise ContractAPIException("WORD_REQUIRED", "So'z ko'rsatilmadi", 400)

    from apps.core.vocabulary_service import lookup_word
    result = lookup_word(word)
    return success(result)


@api_view(["POST"])
@permission_classes([AllowAny])
def add_user_word_view(request):
    """Add a clicked or customized word into student's personal SRS weak words bank."""
    user = require_authenticated(request)
    data = request.data or {}
    english = (data.get("english") or data.get("word") or "").strip()
    uzbek = (data.get("uzbek") or "").strip()
    if not english:
        raise ContractAPIException("WORD_REQUIRED", "Inglizcha so'z kiritilmadi", 400)

    from apps.core.vocabulary_service import add_word_to_user_srs
    result = add_word_to_user_srs(user.id, english=english, uzbek=uzbek)
    return success(result, status=201)
