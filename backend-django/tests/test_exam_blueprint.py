"""Exam blueprint: verified structure, API exposure and the conformity check."""
from types import SimpleNamespace

from django.test import SimpleTestCase
from rest_framework.test import APIClient

from apps.core import exam_blueprint, multilevel
from apps.core.exam_blueprint import blueprint, conformity
from apps.legacy_schema.models import MockQuestionType


def section(spec, skill):
    return next(item for item in spec["sections"] if item["skill"] == skill)


def ielts_tree(listening=(10, 10, 10, 10), reading=(13, 13, 14), writing=("essay_task1", "essay_task2")):
    def questions(count, kind="multiple_choice"):
        return [{"type": kind, "points": 1} for _ in range(count)]
    return [
        {"skill": "listening", "duration_minutes": None, "groups": [{"questions": questions(n)} for n in listening]},
        {"skill": "reading", "duration_minutes": 60, "groups": [{"questions": questions(n, "true_false_notgiven")} for n in reading]},
        {"skill": "writing", "duration_minutes": 60, "groups": [{"questions": [{"type": kind, "points": 9}]} for kind in writing]},
    ]


def multilevel_tree():
    """A tree built from the enforced specification itself, so it must conform."""
    spec = multilevel.SPECS[multilevel.CURRENT_SPEC]
    sections = []
    for skill, data in spec.items():
        groups = []
        for index, (key, count, types, extra) in enumerate(data["parts"]):
            questions = []
            for number in range(count):
                kind = types[0]
                if skill == "reading" and key == "4":
                    kind = "multiple_choice" if number < 4 else "true_false_notgiven"
                if skill == "reading" and key == "5":
                    kind = "short_answer" if number < 4 else "multiple_choice"
                options = extra if skill in ("listening", "reading") and extra else (4 if skill == "reading" and kind == "multiple_choice" else 0)
                questions.append({"type": kind, "points": 1, "options": [str(n) for n in range(options)],
                                  "word_limit": 1 if kind in ("short_answer", "note_completion", "sentence_completion", "summary_completion") else None})
            groups.append({"sort_order": index, "part_number": index + 1, "audio_key": "audio", "audio_duration_sec": 60,
                           "image_key": "image", "max_score": extra if skill in ("writing", "speaking") else None,
                           "stimulus_ref": "shared" if skill == "writing" and index < 2 else None, "questions": questions})
        sections.append({"skill": skill, "duration_minutes": data["duration"], "groups": groups})
    return sections


class BlueprintFactsTests(SimpleTestCase):
    def test_ielts_structure_matches_the_official_format(self):
        for exam_type in ("ielts_academic", "ielts_general"):
            spec = blueprint(exam_type)
            listening, reading, writing, speaking = (section(spec, skill) for skill in exam_blueprint.SKILLS)
            self.assertEqual((listening["questionCount"], len(listening["parts"]), listening["audioPlays"]), (40, 4, 1))
            self.assertEqual([part["questionCount"] for part in listening["parts"]], [10, 10, 10, 10])
            self.assertEqual((reading["questionCount"], len(reading["parts"]), reading["durationSeconds"]), (40, 3, 3600))
            self.assertEqual([(part["wordMin"], part["weight"]) for part in writing["parts"]], [(150, 1), (250, 2)])
            self.assertEqual(writing["durationSeconds"], 3600)
            self.assertEqual((speaking["durationMinSeconds"], speaking["durationSeconds"], len(speaking["parts"])), (660, 840, 3))
            self.assertEqual((speaking["parts"][1]["prepSeconds"], speaking["parts"][1]["responseSeconds"]), (60, 120))
            self.assertEqual((spec["scale"]["max"], spec["scale"]["step"], spec["scale"]["objectiveMarks"]), (9, 0.5, 40))
        self.assertEqual(blueprint("ielts_academic")["scale"]["readingConversion"], "academic")
        self.assertEqual(blueprint("ielts_general")["scale"]["readingConversion"], "general_training")

    def test_multilevel_structure_matches_the_agency_format(self):
        spec = blueprint("multilevel")
        listening, reading, writing, speaking = (section(spec, skill) for skill in exam_blueprint.SKILLS)
        self.assertEqual((listening["questionCount"], listening["durationSeconds"], listening["audioPlays"]), (35, 45 * 60, 2))
        self.assertEqual([part["questionCount"] for part in listening["parts"]], [8, 6, 4, 5, 6, 6])
        self.assertEqual((reading["questionCount"], reading["durationSeconds"]), (35, 60 * 60))
        self.assertEqual([part["questionCount"] for part in reading["parts"]], [6, 8, 6, 9, 6])
        self.assertEqual(writing["durationSeconds"], 60 * 60)
        self.assertEqual([(part["wordMin"], part["wordMax"], part["rawMax"]) for part in writing["parts"]],
                         [(50, 50, 5), (120, 150, 5), (180, 200, 6)])
        self.assertEqual([part["key"] for part in speaking["parts"]], ["1.1", "1.2", "2", "3"])
        self.assertEqual([part["responseSeconds"] for part in speaking["parts"]], [[30, 30, 30], [45, 30, 30], [120], [120]])
        self.assertEqual([part["prepSeconds"] for part in speaking["parts"]], [[0, 0, 0], [0, 0, 0], [60], [60]])
        self.assertEqual([part["rawMax"] for part in speaking["parts"]], [5, 5, 5, 6])
        scale = spec["scale"]
        self.assertEqual((scale["max"], scale["objectiveMarks"], scale["writingRawMax"], scale["speakingRawMax"]), (75, 35, 16, 21))
        self.assertEqual([(row["level"], row["min"], row["max"]) for row in scale["levels"]],
                         [("C1", 65, 75), ("B2", 51, 64), ("B1", 38, 50), ("BELOW_B1", 0, 37)])
        self.assertIs(scale["levels"][-1]["certificate"], False)

    def test_every_fact_names_a_known_source_and_nothing_claims_to_be_official(self):
        data = exam_blueprint.all_blueprints()
        self.assertEqual(data["blueprintVersion"], exam_blueprint.BLUEPRINT_VERSION)
        for spec in data["exams"].values():
            self.assertIs(spec["isOfficial"], False)
            for item in [*spec["sections"], spec["scale"]]:
                self.assertTrue(item["sources"])
                self.assertTrue(set(item["sources"]) <= set(data["sources"]))
            self.assertTrue(all(row["field"] and row["note"] for row in spec["unverified"]))

    def test_unconfirmed_facts_are_listed_not_stated(self):
        ielts = blueprint("ielts_academic")
        self.assertNotIn("reviewSeconds", section(ielts, "listening"))
        self.assertIn("listening.reviewSeconds", [row["field"] for row in ielts["unverified"]])
        fields = [row["field"] for row in blueprint("multilevel")["unverified"]]
        self.assertIn("speaking.durationSeconds", fields)
        self.assertIn("scale.speakingRawToStandard", fields)

    def test_only_stored_question_types_are_permitted(self):
        known = set(MockQuestionType.values)
        for exam_type in ("ielts_academic", "ielts_general", "multilevel"):
            for item in blueprint(exam_type)["sections"]:
                for part in item["parts"]:
                    self.assertTrue(set(part["allowedTypes"]) <= known, (exam_type, item["skill"], part["key"]))

    def test_unknown_exam_type_has_no_blueprint(self):
        self.assertIsNone(blueprint("toefl"))


class ConformityTests(SimpleTestCase):
    def test_a_full_ielts_mock_with_the_official_structure_conforms(self):
        self.assertEqual(conformity("ielts_academic", "full_mock", ielts_tree())["issues"], [])

    def test_a_full_ielts_mock_with_wrong_counts_is_reported(self):
        issues = conformity("ielts_academic", "full_mock", ielts_tree(listening=(10, 10, 9), reading=(13, 13, 13)))["issues"]
        self.assertIn("listening: 3 parts, blueprint has 4", issues)
        self.assertIn("listening: 29 questions, blueprint has 40", issues)
        self.assertIn("listening part 3: 9 questions, blueprint has 10", issues)
        self.assertIn("reading: 39 questions, blueprint has 40", issues)

    def test_a_missing_section_and_a_wrong_duration_are_reported(self):
        tree = [item for item in ielts_tree() if item["skill"] != "writing"]
        tree[1]["duration_minutes"] = 45
        issues = conformity("ielts_general", "full_mock", tree)["issues"]
        self.assertIn("writing: section is missing", issues)
        self.assertIn("reading: duration is 45 min, blueprint is 60 min", issues)

    def test_a_question_type_outside_the_section_is_reported_even_in_practice(self):
        tree = [{"skill": "listening", "groups": [{"questions": [{"type": "true_false_notgiven"}, {"type": "multiple_choice"}]}]}]
        result = conformity("ielts_academic", "practice", tree)
        self.assertEqual(result["issues"], ["listening: question types not in the blueprint: true_false_notgiven"])
        self.assertIs(result["full"], False)

    def test_a_short_practice_set_is_not_a_structure_difference(self):
        tree = [{"skill": "reading", "groups": [{"questions": [{"type": "multiple_choice"}] * 6}]}]
        self.assertEqual(conformity("ielts_academic", "practice", tree)["issues"], [])
        self.assertEqual(conformity("multilevel", "practice", tree, multilevel.CURRENT_SPEC)["issues"], [])

    def test_a_full_multilevel_mock_built_from_the_specification_conforms(self):
        self.assertEqual(conformity("multilevel", "full_mock", multilevel_tree(), multilevel.CURRENT_SPEC)["issues"], [])

    def test_a_full_multilevel_mock_with_a_short_part_is_reported(self):
        tree = multilevel_tree()
        tree[0]["groups"][0]["questions"].pop()
        tree[1]["duration_minutes"] = 50
        issues = conformity("multilevel", "full_mock", tree, multilevel.CURRENT_SPEC)["issues"]
        self.assertIn("listening 1: requires 8 responses/questions", issues)
        self.assertIn("reading: duration is 50 min, blueprint is 60 min", issues)

    def test_an_unknown_exam_type_is_not_checked(self):
        self.assertIs(conformity("toefl", "full_mock", [])["checked"], False)


class BlueprintApiTests(SimpleTestCase):
    def api(self, role="student"):
        client = APIClient()
        client.force_authenticate(SimpleNamespace(id="u-1", role=role, is_authenticated=True))
        return client

    def test_anonymous_request_is_rejected(self):
        self.assertEqual(APIClient().get("/v1/exam-blueprints").status_code, 401)

    def test_all_blueprints_are_served_to_a_signed_in_user(self):
        response = self.api().get("/v1/exam-blueprints")
        self.assertEqual(response.status_code, 200)
        data = response.data["data"]
        self.assertEqual(sorted(data["exams"]), ["ielts_academic", "ielts_general", "multilevel"])
        self.assertEqual(data["blueprintVersion"], exam_blueprint.BLUEPRINT_VERSION)

    def test_one_blueprint_and_unknown_type(self):
        response = self.api("teacher").get("/v1/exam-blueprints/multilevel")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["exam"]["version"], multilevel.CURRENT_SPEC)
        self.assertEqual(self.api().get("/v1/exam-blueprints/toefl").status_code, 404)
