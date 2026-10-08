"""Disposable real-PostgreSQL verification for Django mock authoring.

The script uses the configured local DATABASE_URL, creates uniquely named
fixtures, and removes only those fixtures (plus their audit rows) in finally.
It never targets production and refuses non-local database hosts.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
os.environ.setdefault("ALLOWED_HOSTS", "testserver,localhost,127.0.0.1")

database_url = os.environ.get("DATABASE_URL", "")
database_host = urlparse(database_url).hostname
if database_host not in {"localhost", "127.0.0.1", "::1"}:
    raise SystemExit(f"Refusing non-local DATABASE_URL host: {database_host!r}")

import django

django.setup()

from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import mock_authoring, mock_catalog
from apps.core.multilevel import CURRENT_SPEC, CURRENT_SPEAKING_PROFILE, SPECS
from apps.legacy_schema.models import (
    AuditLog,
    MockAttempt,
    MockExam,
    MockQuestion,
    MockQuestionGroup,
    MockSection,
    StudentProfile,
    User,
)


run_id = uuid4().hex[:12]
admin = SimpleNamespace(id=f"django-verify-admin-{run_id}", role="admin", is_authenticated=True)
super_admin = SimpleNamespace(id=f"django-verify-super-{run_id}", role="super_admin", is_authenticated=True)
other_teacher = SimpleNamespace(id=f"django-verify-teacher-{run_id}", role="teacher", is_authenticated=True)
student_actor = SimpleNamespace(id=f"django-verify-student-role-{run_id}", role="student", is_authenticated=True)
client = APIClient()
exam_ids: list[str] = []
user_ids: list[str] = []
checks: list[str] = []


def check(condition: bool, label: str) -> None:
    if not condition:
        raise AssertionError(label)
    checks.append(label)
    print(f"PASS  {label}")


def response_data(response, expected: int):
    check(response.status_code == expected, f"HTTP {expected}: {response.request.get('PATH_INFO')}")
    check(response.data.get("success") is True, f"success envelope: {response.request.get('PATH_INFO')}")
    return response.data["data"]


def question_rows(skill: str, part_index: int, start_number: int) -> list[dict]:
    _key, count, allowed, option_count = SPECS[CURRENT_SPEC][skill]["parts"][part_index]
    rows = []
    for index in range(count):
        question_type = allowed[0]
        if skill == "reading" and part_index == 3:
            question_type = "multiple_choice" if index < 4 else "true_false_notgiven"
        elif skill == "reading" and part_index == 4:
            question_type = "short_answer" if index < 4 else "multiple_choice"
        row = {
            "number": start_number + index,
            "type": question_type,
            "prompt": f"{skill.title()} part {part_index + 1}, response {index + 1}",
            "points": option_count if skill in {"writing", "speaking"} else 1,
        }
        if question_type in {"essay_task1", "essay_task2", "speaking_task"}:
            row.update({"options": [], "correctAnswers": [], "acceptedVariants": []})
        elif question_type == "true_false_notgiven":
            row.update({"options": [], "correctAnswers": ["TRUE"], "acceptedVariants": []})
        elif question_type in {"short_answer", "note_completion", "sentence_completion", "summary_completion"}:
            row.update({
                "options": [], "correctAnswers": ["answer"], "acceptedVariants": [],
                "wordLimit": 1, "answerRule": "ONE_WORD",
            })
        else:
            count_options = 4 if skill == "reading" and question_type == "multiple_choice" else option_count
            options = [f"Option {number + 1}" for number in range(count_options or 2)]
            row.update({"options": options, "correctAnswers": [options[0]], "acceptedVariants": []})
        rows.append(row)
    return rows


def author_full_multilevel(exam_id: str) -> None:
    counters = {skill: 1 for skill in ("listening", "reading", "writing", "speaking")}
    sections = MockSection.objects.filter(exam_id=exam_id).order_by("sort_order", "id")
    for section in sections:
        groups = list(MockQuestionGroup.objects.filter(section_id=section.id).order_by("sort_order", "id"))
        for part_index, group in enumerate(groups):
            changed = []
            if section.skill == "listening":
                group.audio_key = f"mock/django-verify-{run_id}-{group.id}.mp3"
                group.audio_duration_sec = 30 + part_index
                group.passage_text = f"SECRET LISTENING TRANSCRIPT {part_index + 1}"
                changed.extend(["audio_key", "audio_duration_sec", "passage_text"])
            if section.skill == "speaking" and part_index == 1:
                group.image_key = f"mock/django-verify-{run_id}-{group.id}.png"
                changed.append("image_key")
            if changed:
                group.save(update_fields=changed)
            rows = question_rows(section.skill, part_index, counters[section.skill])
            counters[section.skill] += len(rows)
            version = MockExam.objects.values_list("content_version", flat=True).get(id=exam_id)
            response = client.put(
                f"/v1/mock/groups/{group.id}/content",
                {"questions": rows, "deletedQuestionIds": [], "expectedContentVersion": version},
                format="json",
            )
            data = response_data(response, 200)
            check(data["saved"] == len(rows), f"saved {section.skill} part {part_index + 1}")


def contains_answer_keys(value) -> bool:
    if isinstance(value, dict):
        return "correctAnswers" in value or "acceptedVariants" in value or any(contains_answer_keys(item) for item in value.values())
    if isinstance(value, list):
        return any(contains_answer_keys(item) for item in value)
    return False


def source_snapshot(exam_id: str) -> dict:
    exam = MockExam.objects.values().get(id=exam_id)
    groups = list(MockQuestionGroup.objects.filter(section__exam_id=exam_id).order_by("id").values())
    return {
        "exam": exam, "groups": groups,
        "questions": list(MockQuestion.objects.filter(group__section__exam_id=exam_id).order_by('id').values()),
        "attempts": list(MockAttempt.objects.filter(exam_id=exam_id).order_by("id").values_list("id", "status")),
    }


def make_legacy_copy(source_id: str, *, attempted: bool) -> str:
    copy = mock_authoring.clone_exam(admin, source_id)
    exam_ids.append(copy.id)
    MockExam.objects.filter(id=copy.id).update(
        specification_version="UZBMB_MULTILEVEL_EN_LEGACY_VERIFY",
        speaking_profile_version="BESTWAY_MULTILEVEL_SPEAKING_LEGACY_VERIFY",
        is_published=True,
    )
    writing = list(MockQuestionGroup.objects.filter(section__exam_id=copy.id, section__skill="writing").order_by("sort_order", "id"))
    speaking = list(MockQuestionGroup.objects.filter(section__exam_id=copy.id, section__skill="speaking").order_by("sort_order", "id"))
    for index, group in enumerate(writing):
        group.max_score = index + 1
        group.stimulus_ref = f"legacy-unshared-{index}"
        group.save(update_fields=["max_score", "stimulus_ref"])
    for group in speaking:
        group.max_score = 1
        group.save(update_fields=["max_score"])
    if attempted:
        user_id = f"django-verify-student-{run_id}"
        user_ids.append(user_id)
        stamp = timezone.now()
        User.objects.create(
            id=user_id, name="Django Verify Student", phone=f"+998{run_id[:9]}",
            email=None, password_hash="unused", role="student", is_active=True,
            telegram_chat_id=None, created_at=stamp, updated_at=stamp,
        )
        # ArrayField's CharField adapter produces varchar[]; the legacy Prisma
        # column is a PostgreSQL enum array and therefore needs an explicit cast.
        with connection.cursor() as cursor:
            cursor.execute(
                'INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
                'VALUES (%s, ARRAY[\'MULTILEVEL\']::"ExamProgram"[], \'MULTILEVEL\'::"ExamProgram", true, NULL, 0, %s, %s, NULL, false, NULL)',
                [user_id, f"DV{run_id[:8].upper()}", stamp],
            )
        MockAttempt.objects.create(
            id=f"django-verify-attempt-{run_id}", exam_id=copy.id, student_id=user_id,
            status="completed", started_at=stamp, submitted_at=stamp, finished_at=stamp,
            anti_cheat_count=0, mode="practice",
        )
    return copy.id


try:
    # Final gate: paste import, persisted keys, versioning and rejected-write rollback.
    client.force_authenticate(user=admin)
    paste_exam = response_data(client.post('/v1/mock/exams', {
        'type': 'multilevel', 'title': f'DJANGO VERIFY PASTE {run_id}',
    }, format='json'), 201)
    paste_id = paste_exam['id']
    exam_ids.append(paste_id)
    paste_section = response_data(client.post(f'/v1/mock/exams/{paste_id}/sections', {
        'skill': 'reading', 'title': 'Paste reading',
    }, format='json'), 201)
    paste_group = response_data(client.post(f"/v1/mock/sections/{paste_section['id']}/groups", {
        'title': 'Paste group',
    }, format='json'), 201)
    paste_url = f"/v1/mock/groups/{paste_group['id']}/questions/import"
    version = MockExam.objects.get(id=paste_id).content_version
    pasted = response_data(client.post(paste_url, {
        'text': 'Answer the questions\n1. Choose\nA) First\nB) Second',
        'answers': {'1': 'B'}, 'points': 3,
    }, format='json'), 201)
    check(pasted['added'] == 1 and pasted['questions'][0]['correctAnswers'] == ['B', 'Second'], 'paste expands choice answer key')
    check(pasted['questions'][0]['points'] == 3, 'paste retains NestJS supplied objective points')
    check(MockExam.objects.get(id=paste_id).content_version == version + 1, 'paste bumps contentVersion exactly once')
    check(MockQuestionGroup.objects.get(id=paste_group['id']).instructions == 'Answer the questions', 'paste persists preamble instructions')
    second = response_data(client.post(paste_url, {
        'text': 'Do not replace instructions\n2. Fill ____', 'answers': {'2': 'answer'},
    }, format='json'), 201)
    check(second['added'] == 1 and len(second['questions']) == 2, 'paste returns all group questions, not only added rows')
    check(MockQuestionGroup.objects.get(id=paste_group['id']).instructions == 'Answer the questions', 'paste preserves existing instructions')
    snapshot = source_snapshot(paste_id)
    audits = AuditLog.objects.filter(user_id=admin.id).count()
    with patch.object(mock_authoring, 'bump', side_effect=RuntimeError('injected transaction failure')):
        try:
            mock_authoring.import_questions(admin, paste_group['id'], {
                'text': '3. Roll back first\n4. Roll back second', 'answers': {'3': 'one', '4': 'two'},
            })
        except RuntimeError as error:
            check(str(error) == 'injected transaction failure', 'paste fault injection reached post-write version bump')
        else:
            raise AssertionError('Injected failure did not propagate')
    check(source_snapshot(paste_id) == snapshot and AuditLog.objects.filter(user_id=admin.id).count() == audits,
          'post-write failure rolls back all rows and version, with no success audit')
    for payload, code in [
        ({'text': '3. Missing answer'}, 'MISSING_ANSWERS'),
        ({'text': '3. One\n3. Two', 'answers': {'3': 'x'}}, 'VALIDATION_ERROR'),
        ({'text': '1. Already used', 'answers': {'1': 'x'}}, 'VALIDATION_ERROR'),
        ({'text': '201. Out of range', 'answers': {'201': 'x'}}, 'VALIDATION_ERROR'),
        ({'text': 'No numbered questions'}, 'NO_QUESTIONS_PARSED'),
    ]:
        snapshot = source_snapshot(paste_id)
        rejected = client.post(paste_url, payload, format='json')
        check(rejected.status_code == 400 and rejected.data['error']['code'] == code, f'paste rejects {code}')
        check(source_snapshot(paste_id) == snapshot, f'paste {code} leaves full persisted snapshot unchanged')
    client.force_authenticate(user=other_teacher)
    rejected = client.post(paste_url, {'text': '3. Not mine', 'answers': {'3': 'x'}}, format='json')
    check(rejected.status_code == 403 and rejected.data['error']['code'] == 'MOCK_NOT_OWNER', 'paste enforces author ownership')
    client.force_authenticate(user=student_actor)
    rejected = client.post(paste_url, {'text': '3. Student', 'answers': {'3': 'x'}}, format='json')
    check(rejected.status_code == 403 and rejected.data['error']['code'] == 'FORBIDDEN', 'student cannot import questions')

    # Task 6: real route, response shape, and super-admin deletion.
    client.force_authenticate(user=admin)
    draft = response_data(client.post(
        "/v1/mock/exams",
        {"type": "multilevel", "title": f"DJANGO VERIFY DELETE {run_id}"},
        format="json",
    ), 201)
    exam_ids.append(draft["id"])
    check(draft["createdById"] == admin.id and draft["contentVersion"] == 1, "camelCase create response parity")
    denied_delete = client.delete(f"/v1/mock/exams/{draft['id']}")
    check(denied_delete.status_code == 403 and denied_delete.data["error"]["code"] == "FORBIDDEN", "delete_exam route is super-admin-only")
    check(MockExam.objects.filter(id=draft["id"]).exists(), "denied delete preserves the draft")
    client.force_authenticate(user=super_admin)
    deleted = response_data(client.delete(f"/v1/mock/exams/{draft['id']}"), 200)
    check(deleted == {"deleted": True}, "delete_exam response parity")
    check(not MockExam.objects.filter(id=draft["id"]).exists(), "delete_exam removed the disposable draft")
    exam_ids.remove(draft["id"])

    # Task 7: full authoring -> review -> publish -> catalogue/detail parity.
    client.force_authenticate(user=admin)
    created = response_data(client.post(
        "/v1/mock/exams",
        {"type": "multilevel", "title": f"DJANGO VERIFY FULL {run_id}", "profile": "full_mock", "starterStructure": True},
        format="json",
    ), 201)
    full_id = created["id"]
    exam_ids.append(full_id)
    client.force_authenticate(user=other_teacher)
    denied_owner = client.patch(f"/v1/mock/exams/{full_id}", {"title": "Not mine"}, format="json")
    check(denied_owner.status_code == 403 and denied_owner.data["error"]["code"] == "MOCK_NOT_OWNER", "teacher cannot mutate another author's exam")
    client.force_authenticate(user=student_actor)
    denied_preview = client.get(f"/v1/mock/exams/{full_id}/preview")
    check(denied_preview.status_code == 403 and denied_preview.data["error"]["code"] == "FORBIDDEN", "student cannot call staff preview")
    anonymous = APIClient().get(f"/v1/mock/exams/{full_id}/preview")
    check(anonymous.status_code == 401 and anonymous.data["error"]["code"] == "UNAUTHORIZED", "anonymous preview is unauthorized")
    client.force_authenticate(user=admin)
    before = response_data(client.get(f"/v1/mock/exams/{full_id}/readiness"), 200)
    check(before["ready"] is False, "empty full Multilevel preset is not ready")
    blocked = client.patch(f"/v1/mock/exams/{full_id}", {"isPublished": True}, format="json")
    check(blocked.status_code == 400 and blocked.data["error"]["code"] == "MOCK_NOT_READY", "incomplete publish is blocked")

    author_full_multilevel(full_id)
    review = response_data(client.get(f"/v1/mock/exams/{full_id}/readiness"), 200)
    check(review["ready"] is True, "fully authored Multilevel review is ready")
    published = response_data(client.patch(f"/v1/mock/exams/{full_id}", {"isPublished": True}, format="json"), 200)
    check(published["isPublished"] is True, "ready Multilevel exam publishes")
    detail = response_data(client.get(f"/v1/mock/exams/{full_id}"), 200)
    listed = next(item for item in response_data(client.get("/v1/mock/exams"), 200) if item["id"] == full_id)
    check(detail["ready"] is True and listed["ready"] is True and review["ready"] is True, "catalogue, detail and review readiness agree")
    preview = response_data(client.get(f"/v1/mock/exams/{full_id}/preview"), 200)
    check(preview["access"] == "granted" and not contains_answer_keys(preview), "staff preview is student-shaped and keyless")
    preview_listening = next(section for section in preview["sections"] if section["skill"] == "listening")
    check(all(group["passageText"] is None for group in preview_listening["groups"]), "Multilevel preview hides Listening transcripts")
    check(MockAttempt.objects.filter(exam_id=full_id).count() == 0, "author/review/publish created no student attempt")

    # Task 8A: unused legacy exam is repaired in place and left as a draft.
    unused_id = make_legacy_copy(full_id, attempted=False)
    inspection = response_data(client.get(f"/v1/mock/exams/{unused_id}/multilevel-repair-inspection"), 200)
    check(inspection["safeRepairAllowed"] is True and inspection["currentVersion"] is False, "unused legacy exam is eligible for safe repair")
    check(inspection["writingSharesStimulusRef"] is False and bool(inspection["proposedChanges"]), "inspection exposes exact legacy corrections")
    repaired = response_data(client.post(
        f"/v1/mock/exams/{unused_id}/apply-multilevel-safe-repair", {"confirm": True}, format="json"
    ), 201)
    unused = MockExam.objects.get(id=unused_id)
    check(repaired["status"] == "DRAFT_REQUIRES_REVIEW" and not unused.is_published, "safe repair unpublishes and requires review")
    check(unused.specification_version == CURRENT_SPEC and unused.speaking_profile_version == CURRENT_SPEAKING_PROFILE, "safe repair upgrades both Multilevel versions")
    check(mock_authoring.readiness(admin, unused_id)["ready"] is True, "safely repaired legacy exam is ready")

    # Task 8B: attempted legacy exam is immutable; corrected clone is current.
    history_id = make_legacy_copy(full_id, attempted=True)
    history_before = source_snapshot(history_id)
    history_plan = response_data(client.get(f"/v1/mock/exams/{history_id}/multilevel-repair-inspection"), 200)
    check(history_plan["historyExists"] is True and history_plan["recommendedAction"] == "CREATE_CORRECTED_COPY", "attempt history requires a corrected copy")
    denied = client.post(f"/v1/mock/exams/{history_id}/apply-multilevel-safe-repair", {"confirm": True}, format="json")
    check(denied.status_code == 409 and denied.data["error"]["code"] == "EXAM_VERSION_IN_USE", "attempted legacy exam rejects in-place repair")
    check(source_snapshot(history_id) == history_before, "rejected repair leaves source and history unchanged")
    clone_result = response_data(client.post(f"/v1/mock/exams/{history_id}/clone-corrected-multilevel", {}, format="json"), 201)
    corrected_id = clone_result["id"]
    exam_ids.append(corrected_id)
    check(clone_result["sourcePreserved"] is True and corrected_id != history_id, "corrected clone preserves source identity")
    check(source_snapshot(history_id) == history_before, "corrected clone leaves historical source unchanged")
    corrected = MockExam.objects.get(id=corrected_id)
    check(not corrected.is_published and corrected.specification_version == CURRENT_SPEC, "corrected clone is a current-version draft")
    check(MockAttempt.objects.filter(exam_id=corrected_id).count() == 0, "corrected clone copies no attempts")
    check(mock_authoring.readiness(admin, corrected_id)["ready"] is True, "corrected clone is ready after reconciliation")

    print(f"SUMMARY {len(checks)}/{len(checks)} passed")
finally:
    # Exact-ID cleanup only. PostgreSQL cascades owned exam definitions/history.
    if exam_ids:
        MockExam.objects.filter(id__in=exam_ids).delete()
    if user_ids:
        User.objects.filter(id__in=user_ids).delete()
    AuditLog.objects.filter(user_id__in=[admin.id, super_admin.id]).delete()
    leftovers = MockExam.objects.filter(id__in=exam_ids).count() if exam_ids else 0
    print(f"CLEANUP disposable_exam_leftovers={leftovers}")
