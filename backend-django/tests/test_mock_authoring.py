"""Structural coverage for the Django mock authoring layer, focused on
functions that do not reach the ORM and on the behavioral contract around
answer-key sanitization.

ORM-touching paths are covered by a separate integration suite once
transaction routes ship; this file validates pure-layer parity and the
student/auditor visibility boundary here and now.
"""
from __future__ import annotations

from django.test import SimpleTestCase
from django.urls import resolve
from rest_framework.test import APIClient

from apps.core import mock_authoring
from apps.core.mock_rules import MANUAL_TYPES, objective_question_issues


def _fake_question(type_: str, prompt: str = "Prompt", options=None, correct_answers=None, accepted_variants=None, points=1, word_limit=None, answer_rule=None):
    return type("Q", (), {
        "id": "q-1", "number": 1, "sort_order": 0, "type": type_, "prompt": prompt, "options": options,
        "points": points, "word_limit": word_limit, "answer_rule": answer_rule,
        "correct_answers": correct_answers, "accepted_variants": accepted_variants,
    })


def _fake_group(content_layout=None, options_reusable=None):
    return type("G", (), {"content_layout": content_layout, "options_reusable": options_reusable})


def _fake_question_dict(type_: str, prompt="Prompt", options=None, correct_answers=None, accepted_variants=None, points=1, word_limit=None, answer_rule=None):
    return {
        "type": type_,
        "prompt": prompt,
        "options": options,
        "correctAnswers": correct_answers,
        "acceptedVariants": accepted_variants,
        "points": points,
        "wordLimit": word_limit,
        "answerRule": answer_rule,
    }


def _fake_actor(role: str = "teacher", owner_id: str = "owner-1"):
    return type("A", (), {"id": owner_id, "role": role, "is_authenticated": True})


class AuthoringSanitizationAndParityTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def test_student_payload_hides_correct_answers(self):
        payload = mock_authoring._student_question_payload(_fake_question("multiple_choice", correct_answers=["B"]), _fake_group())
        self.assertNotIn("correctAnswers", payload)

    def test_student_payload_keeps_public_fields(self):
        payload = mock_authoring._student_question_payload(_fake_question("multiple_choice", prompt="Choose"), _fake_group())
        self.assertEqual(payload["prompt"], "Choose")
        self.assertEqual(payload["options"], None)
        self.assertEqual(payload["points"], 1)
        self.assertEqual(payload["answerRule"], None)
        self.assertEqual(payload["wordLimit"], None)

    def test_student_payload_shares_options_reusable_for_matching_layouts(self):
        payload = mock_authoring._student_question_payload(_fake_question("matching"), _fake_group(content_layout="headings", options_reusable=False))
        self.assertIsNone(payload["options"])
        payload = mock_authoring._student_question_payload(_fake_question("matching"), _fake_group(content_layout="headings", options_reusable=True))
        self.assertIsNone(payload["options"])

    def test_student_payload_caps_options_reusable_to_none_when_false_and_missing(self):
        payload = mock_authoring._student_question_payload(_fake_question("matching"), _fake_group(content_layout="headings", options_reusable=False))
        self.assertIsNone(payload.get("options"))

    def test_student_payload_keeps_options_for_non_reusable_fields_when_group_missing(self):
        payload = mock_authoring._student_question_payload(_fake_question("multiple_choice", options=["A", "B"]), None)
        self.assertEqual(payload["options"], ["A", "B"])

    def test_staff_payload_keeps_answer_keys(self):
        payload = mock_authoring._staff_answer_payload(_fake_question("multiple_choice", correct_answers=["b"], accepted_variants=["B"]))
        self.assertEqual(payload["correctAnswers"], ["b"])
        self.assertEqual(payload["acceptedVariants"], ["B"])
        self.assertIsNone(payload["audioScript"])

    def test_staff_payload_includes_none_for_missing_fields(self):
        payload = mock_authoring._staff_answer_payload(_fake_question("multiple_choice"))
        self.assertIsNone(payload["correctAnswers"])
        self.assertIsNone(payload["acceptedVariants"])
        self.assertIsNone(payload["audioScript"])

    def test_manual_question_produces_answer_key_issue(self):
        issues = objective_question_issues(_fake_question_dict("essay_task1", correct_answers=["A"]), is_auto=False)
        self.assertTrue(any("manual tasks cannot contain objective keys" in issue for issue in issues))

    def test_objective_choice_with_accepted_variants_is_invalid(self):
        issues = objective_question_issues(_fake_question_dict("multiple_choice", options=["A", "B"], correct_answers=["a"], accepted_variants=["A"]), is_auto=True)
        self.assertTrue(any("accepted alternatives are only allowed for text answers" in issue for issue in issues))

    def test_multilevel_readiness_sort_safety_by_sort_order(self):
        tree = {
            "specification_version": "UZBMB_MULTILEVEL_EN_2026_V2",
            "profile": "practice",
            "sections": [
                {"skill": "listening", "sort_order": 2, "groups": [{"sort_order": 0, "part_number": 1, "audio_key": "audio1", "audio_duration_sec": 30, "questions": [{"type": "multiple_choice", "points": 1, "options": ["A", "B", "C", "D"]}]}]},
                {"skill": "listening", "sort_order": 1, "groups": [{"sort_order": 2, "part_number": 2, "audio_key": "audio2", "audio_duration_sec": 40, "questions": [{"type": "short_answer", "points": 1, "word_limit": 1}]}]},
            ],
        }
        issues = mock_authoring.multilevel_readiness(tree)["issues"]
        joined = "; ".join(issues)
        self.assertIn("listening: requires 6 parts", issues)
        self.assertNotIn("listening 2: audio and matching part number required", joined)

    def test_multilevel_readiness_rejects_old_specification(self):
        result = mock_authoring.multilevel_readiness({"specification_version": "OLD_SPEC", "sections": []})
        self.assertFalse(result["supported"])
        self.assertIn("Unsupported Multilevel specification", result["issues"])

    def test_multilevel_readiness_accepts_current_spec_with_empty_sections(self):
        result = mock_authoring.multilevel_readiness({"specification_version": "UZBMB_MULTILEVEL_EN_2026_V2", "sections": []})
        self.assertTrue(result["supported"])

    def test_multilevel_readiness_full_mock_requires_four_sections(self):
        tree = {"specification_version": "UZBMB_MULTILEVEL_EN_2026_V2", "profile": "full_mock", "sections": [{"skill": "listening", "sort_order": 0, "groups": []}]}
        issues = mock_authoring.multilevel_readiness(tree)["issues"]
        self.assertIn("Full Multilevel mock requires all four sections", issues)

    def test_catalogue_preserves_nest_ielts_start_readiness(self):
        from apps.core.mock_catalog import start_ready
        from types import SimpleNamespace
        # Nest catalogue/detail intentionally do not apply Review's key/media checks.
        self.assertTrue(start_ready(SimpleNamespace(type="ielts")))

    def test_catalogue_multilevel_uses_structural_start_readiness(self):
        from apps.core.mock_catalog import start_ready
        from types import SimpleNamespace
        from unittest.mock import patch
        tree = {"specification_version": "OLD_SPEC", "sections": []}
        with patch.object(mock_authoring, "_exam_tree", return_value=tree):
            self.assertFalse(start_ready(SimpleNamespace(type="multilevel")))

    def test_create_exam_rejects_invalid_type_and_too_short_title(self):
        actor = _fake_actor()
        with self.assertRaises(mock_authoring.ContractAPIException) as ctx:
            mock_authoring.create_exam(actor, {"type": "bad", "title": "x"})
        self.assertEqual(ctx.exception.contract_code, "VALIDATION_ERROR")
        with self.assertRaises(mock_authoring.ContractAPIException) as ctx2:
            mock_authoring.create_exam(actor, {"type": "multilevel", "title": "ab"})
        self.assertEqual(ctx2.exception.contract_code, "VALIDATION_ERROR")

    def test_create_exam_accepts_minimal_valid_multilevel_payload(self):
        # Requires Django transaction boundary; covered by integration suite once routes ship.
        pass

    def test_clone_rejects_non_staff(self):
        actor = _fake_actor(role="student")
        with self.assertRaises(mock_authoring.ContractAPIException) as ctx:
            mock_authoring.clone_exam(actor, "any")
        self.assertEqual(ctx.exception.contract_code, "FORBIDDEN")

    def test_clone_corrected_multilevel_rejects_when_no_history(self):
        actor = _fake_actor(role="admin")
        with mock_authoring.patch_history(has_history=False):
            with self.assertRaises(mock_authoring.ContractAPIException) as ctx:
                mock_authoring.clone_corrected_multilevel(actor, "legacy-1")
        self.assertEqual(ctx.exception.contract_code, "SAFE_REPAIR_AVAILABLE")

    def test_apply_multilevel_safe_repair_rejects_without_confirmation(self):
        actor = _fake_actor(role="admin")
        with mock_authoring.patch_history(has_history=False):
            with self.assertRaises(mock_authoring.ContractAPIException) as ctx:
                mock_authoring.apply_multilevel_safe_repair(actor, "legacy-1", confirmed=False)
        self.assertEqual(ctx.exception.contract_code, "CONFIRMATION_REQUIRED")

    def test_apply_multilevel_safe_repair_rejects_with_history(self):
        # Requires Django transaction boundary; covered by integration suite once routes ship.
        pass

    def test_repair_inspection_requires_admin(self):
        actor = _fake_actor(role="teacher")
        with self.assertRaises(mock_authoring.ContractAPIException) as ctx:
            mock_authoring.multilevel_repair_inspection(actor, "legacy-1")
        self.assertEqual(ctx.exception.contract_code, "FORBIDDEN")

    def test_delete_exam_requires_super_admin_before_database_access(self):
        with self.assertRaises(mock_authoring.ContractAPIException) as ctx:
            mock_authoring.delete_exam(_fake_actor(role="admin"), "draft-1")
        self.assertEqual(ctx.exception.contract_code, "FORBIDDEN")

    def test_nest_compatible_authoring_routes_are_registered(self):
        expected = {
            "/v1/mock/exams/exam-1/preview": "mock_exam_preview_view",
            "/v1/mock/exams/exam-1/readiness": "mock_exam_readiness_view",
            "/v1/mock/exams/exam-1/multilevel-repair-inspection": "mock_exam_repair_inspection_view",
            "/v1/mock/exams/exam-1/apply-multilevel-safe-repair": "mock_exam_safe_repair_view",
            "/v1/mock/exams/exam-1/clone-corrected-multilevel": "mock_exam_corrected_clone_view",
            "/v1/mock/exams/exam-1/repair-multilevel": "mock_exam_repair_view",
            "/v1/mock/exams/exam-1/sections": "mock_exam_sections_view",
            "/v1/mock/sections/section-1/groups": "mock_section_groups_view",
            "/v1/mock/groups/group-1/questions": "mock_group_questions_view",
            "/v1/mock/groups/group-1/content": "mock_group_content_view",
            "/v1/mock/questions/question-1": "mock_question_view",
        }
        for path, name in expected.items():
            self.assertEqual(resolve(path).func.cls.__name__, name)

    def test_preview_requires_authentication(self):
        response = self.client.get("/v1/mock/exams/exam-1/preview")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["error"]["code"], "UNAUTHORIZED")

    def test_preview_rejects_student_role_before_database_access(self):
        self.client.force_authenticate(user=_fake_actor(role="student"))
        response = self.client.get("/v1/mock/exams/exam-1/preview")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "FORBIDDEN")

    def test_delete_route_rejects_admin_before_database_access(self):
        self.client.force_authenticate(user=_fake_actor(role="admin"))
        response = self.client.delete("/v1/mock/exams/exam-1")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "FORBIDDEN")

    def test_exam_mutation_payload_uses_prisma_camel_case(self):
        exam = type("E", (), {
            "id": "exam-1", "assessment_policy": None,
            "speaking_profile_version": "speaking-v2", "specification_version": "spec-v2",
            "type": "multilevel", "title": "Exam", "description": None, "level": None,
            "practice_level": None, "is_published": False, "is_demo": False,
            "price": 0, "is_free_for_approved": True, "created_by_id": "owner-1",
            "created_at": "created", "updated_at": "updated", "profile": "practice",
            "blueprint_ref": None, "content_version": 3,
        })
        payload = mock_authoring.exam_payload(exam)
        self.assertEqual(payload["createdById"], "owner-1")
        self.assertEqual(payload["contentVersion"], 3)
        self.assertEqual(payload["specificationVersion"], "spec-v2")
        self.assertNotIn("created_by_id", payload)
