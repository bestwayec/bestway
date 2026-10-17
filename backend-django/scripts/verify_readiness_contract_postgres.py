"""Disposable real-PostgreSQL verification of the exam readiness contract.

Covers the surfaces that must agree on one meaning of "ready":

* Review readiness (the authoring checklist behind the Review tab),
* Publish validation (PATCH isPublished=true refuses an incomplete exam),
* catalogue and student-detail ``ready`` (structural Start readiness),
* Start eligibility for a student (a structurally incomplete exam is refused
  and never creates an attempt),
* the profile-aware semantics kept from NestJS: a practice exam validates the
  content it actually has, a full_mock enforces the four-section blueprint,
  and IELTS stays "ready" in catalogue/detail while Review stays strict,
* historical exams: an exam used by attempts is never rewritten in place.

The script uses the configured local DATABASE_URL, creates uniquely named
fixtures and removes only those fixtures (plus their audit rows and media) in
``finally``. It never targets production and refuses non-local hosts.

Usage:
    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/education_center \\
        .venv/Scripts/python.exe scripts/verify_readiness_contract_postgres.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
os.environ.setdefault("ALLOWED_HOSTS", "testserver,localhost,127.0.0.1")

database_url = os.environ.get("DATABASE_URL", "")
database_host = urlparse(database_url).hostname
if database_host not in {"localhost", "127.0.0.1", "::1"}:
    raise SystemExit(f"Refusing non-local DATABASE_URL host: {database_host!r}")

import django

django.setup()

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import mock_authoring
from apps.core.multilevel import CURRENT_SPEC, SPECS
from apps.legacy_schema.models import (
    AuditLog,
    MockAttempt,
    MockExam,
    MockQuestion,
    MockQuestionGroup,
    MockSection,
    User,
)
from common.api.exceptions import ContractAPIException

run_id = uuid4().hex[:12]
admin = SimpleNamespace(id=f"readiness-admin-{run_id}", role="admin", is_authenticated=True)
student = SimpleNamespace(id=f"readiness-student-{run_id}", role="student", is_authenticated=True)
client = APIClient()
exam_ids: list[str] = []
user_ids: list[str] = []
attempt_ids: list[str] = []
media_keys: list[str] = []
checks: list[str] = []


def check(condition: bool, label: str) -> None:
    if not condition:
        raise AssertionError(label)
    checks.append(label)
    print(f"PASS  {label}")


def response_data(response, expected: int):
    if response.status_code != expected:
        raise AssertionError(
            f"HTTP {expected}: {response.request.get('PATH_INFO')} "
            f"returned {response.status_code} {getattr(response, 'data', None)}")
    checks.append(f"HTTP {expected}: {response.request.get('PATH_INFO')}")
    print(f"PASS  HTTP {expected}: {response.request.get('PATH_INFO')}")
    if expected >= 400:
        return response.data.get("error", {})
    return response.data["data"]


def new_exam(*, title: str, exam_type: str = "multilevel", profile: str = "practice") -> str:
    exam = mock_authoring.create_exam(admin, {
        "type": exam_type, "title": f"{title} {run_id}", "profile": profile,
    })
    exam_ids.append(exam.id)
    return exam.id


def readiness(exam_id: str) -> tuple[dict[str, dict], dict]:
    report = response_data(client.get(f"/v1/mock/exams/{exam_id}/readiness"), 200)
    return {item["key"]: item for item in report["items"]}, report


def listed_ready(exam_id: str) -> bool:
    rows = response_data(client.get("/v1/mock/exams"), 200)
    return next(item["ready"] for item in rows if item["id"] == exam_id)


def ensure_student() -> None:
    if student.id in user_ids:
        return
    stamp = timezone.now()
    User.objects.create(
        id=student.id, name="Readiness Verify Student", phone=f"+99877{run_id[:7]}",
        email=None, password_hash="unused", role="student", is_active=True,
        telegram_chat_id=None, created_at=stamp, updated_at=stamp,
    )
    user_ids.append(student.id)
    # ArrayField's CharField adapter produces varchar[]; the legacy Prisma
    # column is a PostgreSQL enum array and therefore needs an explicit cast.
    with connection.cursor() as cursor:
        cursor.execute(
            'INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
            "VALUES (%s, ARRAY['MULTILEVEL','IELTS']::\"ExamProgram\"[], 'MULTILEVEL', true, NULL, 0, %s, %s, NULL, false, NULL)",
            [student.id, f"RDY{run_id[:8].upper()}", stamp],
        )


def author_speaking_only(exam_id: str) -> None:
    """Author the four Speaking parts exactly as the specification requires."""
    spec = SPECS[CURRENT_SPEC]["speaking"]
    section = response_data(client.post(f"/v1/mock/exams/{exam_id}/sections", {
        "skill": "speaking", "title": "Speaking",
    }, format="json"), 201)
    number = 1
    for part_index, (key, count, _types, raw_max) in enumerate(spec["parts"]):
        group = response_data(client.post(f"/v1/mock/sections/{section['id']}/groups", {
            "title": f"Part {key}", "sortOrder": part_index, "maxScore": raw_max,
        }, format="json"), 201)
        if key == "1.2":
            response_data(client.post(f"/v1/mock/groups/{group['id']}/media", {
                "image": SimpleUploadedFile("two-picture.png", b"\x89PNG\r\n\x1a\n-readiness-fixture",
                                            content_type="image/png"),
            }, format="multipart"), 201)
            image_key = MockQuestionGroup.objects.values_list("image_key", flat=True).get(id=group["id"])
            if image_key:
                media_keys.append(image_key)
        rows = [{
            "number": number + offset, "type": "speaking_task",
            "prompt": f"Speaking {key}, response {offset + 1}", "points": raw_max,
            "options": [], "correctAnswers": [], "acceptedVariants": [],
        } for offset in range(count)]
        number += count
        version = MockExam.objects.values_list("content_version", flat=True).get(id=exam_id)
        response_data(client.put(
            f"/v1/mock/groups/{group['id']}/content",
            {"questions": rows, "deletedQuestionIds": [], "expectedContentVersion": version},
            format="json"), 200)


def expect_contract_error(label: str, code: str, call) -> None:
    try:
        call()
    except ContractAPIException as error:
        check(error.contract_code == code, f"{label} -> {code}")
    else:
        raise AssertionError(f"{label} did not raise {code}")


try:
    client.force_authenticate(user=admin)

    # ── 1) The reported exam shape: "cef r c1" ────────────────────────────────
    # Multilevel practice exam with three sections: Listening has its six parts
    # but no questions and no audio, Reading is missing, Writing has one task
    # per group, Speaking has one response per part. Every blocker below is a
    # genuine authoring gap — none of them may be papered over.
    cefr_id = new_exam(title="READINESS CEFR C1")
    mock_authoring.multilevel_preset(cefr_id, ["listening", "writing", "speaking"])
    for section in MockSection.objects.filter(exam_id=cefr_id).order_by("sort_order", "id"):
        for index, group in enumerate(MockQuestionGroup.objects.filter(section_id=section.id).order_by("sort_order", "id")):
            if section.skill == "writing":
                kind = ["essay_task1", "essay_task1", "essay_task2"][index]
                MockQuestion.objects.create(
                    id=str(uuid4()), group_id=group.id, number=index + 1, sort_order=1,
                    type=kind, prompt="Write the letter.", options=[], correct_answers=[],
                    accepted_variants=[], points=5, word_limit=None, answer_rule=None,
                    created_at=timezone.now())
            elif section.skill == "speaking":
                MockQuestion.objects.create(
                    id=str(uuid4()), group_id=group.id, number=index + 1, sort_order=1,
                    type="speaking_task", prompt="Speak about the picture.", options=[],
                    correct_answers=[], accepted_variants=[], points=5, word_limit=None,
                    answer_rule=None, created_at=timezone.now())

    items, report = readiness(cefr_id)
    check(report["ready"] is False, "incomplete 'cef r c1' exam is not ready")
    check(items["listening_audio"]["ok"] is False
          and items["listening_audio"]["detail"] == "0/6 groups with audio",
          "Listening blocker names the exact audio gap")
    issues = items["multilevel_start"]["detail"]
    for expected in (
        "listening 1: requires 8 responses/questions",
        "listening 1: audio and matching part number required",
        "listening 1: positive audio duration required",
        "listening 6: requires 6 responses/questions",
        "speaking 1.1: requires 3 responses/questions",
        "speaking 1.2: requires 3 responses/questions",
        "speaking 1.2: two-picture asset required",
    ):
        check(expected in issues, f"blocker message is exact: {expected}")
    check("reading" not in issues,
          "a practice exam is not over-blocked for the missing Reading section")
    check(items["writing_content"]["ok"] is True, "authored Writing tasks pass their content check")

    publish = client.patch(f"/v1/mock/exams/{cefr_id}", {"isPublished": True}, format="json")
    error = publish.data.get("error", {})
    check(publish.status_code == 400 and error.get("code") == "MOCK_NOT_READY",
          "publishing the incomplete exam is rejected with MOCK_NOT_READY")
    check("speaking 1.2: two-picture asset required" in error.get("message", ""),
          "publish rejection repeats the real blocker, not a generic message")

    # Published-but-incomplete (the production state of f0bd1582): the
    # catalogue, the student detail and Start all agree it is not usable.
    MockExam.objects.filter(id=cefr_id).update(is_published=True)
    ensure_student()
    client.force_authenticate(user=admin)
    check(listed_ready(cefr_id) is False, "catalogue reports ready=false")
    # Clearing DRF forced authentication calls logout(), which imports Django's
    # session model. This JWT-only service intentionally has no sessions app.
    client = APIClient()
    anonymous_detail = response_data(client.get(f"/v1/mock/exams/{cefr_id}"), 200)
    check(anonymous_detail["ready"] is False, "student detail reports ready=false")
    client.force_authenticate(user=student)
    attempts_before = MockAttempt.objects.filter(exam_id=cefr_id).count()
    refused = client.post(f"/v1/mock/exams/{cefr_id}/start", {"mode": "practice"}, format="json")
    check(response_data(refused, 400).get("code") == "MOCK_NOT_READY",
          "Start is refused with MOCK_NOT_READY")
    check(MockAttempt.objects.filter(exam_id=cefr_id).count() == attempts_before,
          "the refused Start created no attempt")

    # ── 2) full_mock enforces the four-section blueprint ────────────────────
    client.force_authenticate(user=admin)
    full_id = new_exam(title="READINESS FULL MOCK", profile="full_mock")
    mock_authoring.multilevel_preset(full_id, ["listening", "writing", "speaking"])
    items, _report = readiness(full_id)
    check(items["reading_section"]["ok"] is False
          and items["reading_section"]["detail"] == "missing section",
          "full_mock names the missing Reading section explicitly")
    check("Full Multilevel mock requires all four sections" in items["multilevel_blueprint"]["detail"],
          "full_mock reports the four-section requirement")

    # ── 3) practice single-skill exam: publish and start when complete ──────
    speaking_id = new_exam(title="READINESS SPEAKING ONLY")
    author_speaking_only(speaking_id)
    items, report = readiness(speaking_id)
    check(report["ready"] is True,
          f"complete single-skill practice exam is ready: {[i for i in report['items'] if not i['ok']]}")
    published = response_data(client.patch(
        f"/v1/mock/exams/{speaking_id}", {"isPublished": True}, format="json"), 200)
    check(published["isPublished"] is True, "complete practice exam publishes")
    check(response_data(client.get(f"/v1/mock/exams/{speaking_id}"), 200)["ready"] is True,
          "published practice exam is ready for students")

    client.force_authenticate(user=student)
    started = response_data(client.post(
        f"/v1/mock/exams/{speaking_id}/start", {"mode": "practice"}, format="json"), 201)
    check(bool(started.get("attemptId")), "a student can start the ready exam")
    attempt_ids.append(started["attemptId"])

    # ── 4) IELTS keeps its NestJS catalogue semantics ───────────────────────
    client.force_authenticate(user=admin)
    ielts_id = new_exam(title="READINESS IELTS", exam_type="ielts_academic", profile="practice")
    items, report = readiness(ielts_id)
    check("multilevel_start" not in items, "IELTS review carries no Multilevel blueprint blocker")
    check(report["ready"] is False, "empty IELTS draft is not publishable")
    blocked = client.patch(f"/v1/mock/exams/{ielts_id}", {"isPublished": True}, format="json")
    check(blocked.status_code == 400 and blocked.data["error"]["code"] == "MOCK_NOT_READY",
          "IELTS publish uses the same strict Review checklist")
    check(listed_ready(ielts_id) is True,
          "IELTS catalogue readiness stays structural (documented NestJS behaviour)")

    # ── 5) an exam used by attempts is never rewritten in place ─────────────
    response_data(client.patch(
        f"/v1/mock/exams/{speaking_id}", {"isPublished": False}, format="json"), 200)
    before = MockExam.objects.get(id=speaking_id)
    snapshot = (before.specification_version, before.speaking_profile_version,
                before.content_version, before.is_published)
    section_id = MockSection.objects.filter(exam_id=speaking_id).values_list("id", flat=True).first()
    blocked_edit = client.patch(f"/v1/mock/sections/{section_id}", {"title": "Changed"}, format="json")
    check(blocked_edit.status_code == 409
          and blocked_edit.data["error"]["code"] == "EXAM_VERSION_IN_USE",
          "section edits are refused once attempts exist")
    expect_contract_error("repair of an attempted exam", "EXAM_VERSION_IN_USE",
                          lambda: mock_authoring.repair_multilevel_draft(admin, speaking_id))
    after = MockExam.objects.get(id=speaking_id)
    check(snapshot == (after.specification_version, after.speaking_profile_version,
                       after.content_version, after.is_published),
          "the historical exam definition is unchanged")
    check(MockAttempt.objects.filter(exam_id=speaking_id).count() == 1,
          "the attempt itself is preserved")

    print(f"SUMMARY {len(checks)}/{len(checks)} passed")
finally:
    if attempt_ids:
        MockAttempt.objects.filter(id__in=attempt_ids).delete()
    if exam_ids:
        MockExam.objects.filter(id__in=exam_ids).delete()
    if user_ids:
        User.objects.filter(id__in=user_ids).delete()
    AuditLog.objects.filter(user_id__in=[admin.id, student.id]).delete()
    from apps.core.mock_media import delete_unreferenced

    for key in media_keys:
        delete_unreferenced(key)
    print(f"CLEANUP disposable_exam_leftovers="
          f"{MockExam.objects.filter(id__in=exam_ids).count() if exam_ids else 0}")
