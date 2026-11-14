"""Versioned exam blueprints: the one description of what a full IELTS or Multilevel
exam looks like (sections, parts, question counts, timing, permitted question types,
word limits, score scale).

Every fact carries the id of the official source it was checked against (``SOURCES``).
A fact that could not be confirmed there is listed under ``unverified`` instead of
being stated; nothing here is filled in from memory. BestWay results are estimates
and never an official IELTS or agency result (``isOfficial`` is always False).

The Multilevel parts are not restated: they are read from ``multilevel.SPECS``, which
is what authoring, publication and the runner already enforce.
"""
from __future__ import annotations

from . import multilevel


# Multilevel CEFR levels on the 0-75 scale, from the mean of the four sections, highest first.
# Agency criteria (uzbmb.uz Multilevel-bm.pdf, Ilmiy-metodik kengash 2023-03-16, in force from
# March 2023; re-published on gov.uz 2026-01-26). The one table every level in BestWay is read
# from: mock_scoring.multilevel_level, prediction_service, and the web mirror (parity-tested).
MULTILEVEL_LEVELS = (
    {"level": "C1", "min": 65, "max": 75, "approxCorrect": [28, 35]},
    {"level": "B2", "min": 51, "max": 64, "approxCorrect": [18, 27]},
    {"level": "B1", "min": 38, "max": 50, "approxCorrect": [10, 17]},
    {"level": "BELOW_B1", "min": 0, "max": 37, "approxCorrect": [0, 9], "certificate": False},
)

BLUEPRINT_VERSION = "BESTWAY_EXAM_BLUEPRINT_2026_11_V1"
CHECKED_ON = "2026-11-12"

SOURCES = {
    "ielts-format": {
        "title": "IELTS Academic test format (Listening, Reading, Writing, Speaking pages)",
        "url": "https://ielts.org/take-a-test/test-types/ielts-academic-test",
    },
    "ielts-scoring": {
        "title": "IELTS scoring in detail",
        "url": "https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail",
    },
    "uzbmb-format": {
        "title": "Test sinovlari formati — Multilevel (ko'p darajali) test formati",
        "url": "https://uzbmb.uz/page/test_sinovlari_formati",
    },
    "uzbmb-criteria-2023": {
        "title": "Ko'p darajali test formati uchun baholash mezonlari (2023-yil 16-mart)",
        "url": "https://uzbmb.uz/upload/file/pdf/Multilevel-bm.pdf",
    },
    "uzbmb-writing-2025": {
        "title": "Multilevel yozish bo'limi uchun topshiriq tafsilotlari, yangi format (2025-10-13)",
        "url": "https://api-portal.gov.uz/uploads/165/2025/10/13/99dfbb36-0f1d-2c70-8a4e-e1382a5f255b_media_.pdf",
    },
    "uzbmb-speaking-format": {
        "title": "Ko'p darajali test sinovi gapirish ko'nikmasi yangi formati",
        "url": "https://uzbmb.uz/upload/file/pdf/phone/Speaking_format.pdf",
    },
    "uzbmb-speaking-criteria": {
        "title": "Rating scale for Multilevel speaking exams (yangi format)",
        "url": "https://uzbmb.uz/upload/file/pdf/phone/yangi_format_eng.pdf",
    },
}

SKILLS = ("listening", "reading", "writing", "speaking")

# ielts.org task types mapped onto the stored question types.
IELTS_LISTENING_TYPES = [
    "multiple_choice", "multi_select", "matching", "map_labelling", "note_completion",
    "table_completion", "summary_completion", "sentence_completion", "short_answer",
]
IELTS_READING_TYPES = [
    "multiple_choice", "multi_select", "true_false_notgiven", "yes_no_notgiven", "matching",
    "matching_headings", "sentence_completion", "summary_completion", "note_completion",
    "table_completion", "map_labelling", "short_answer",
]


def _ielts(exam_type: str) -> dict:
    academic = exam_type == "ielts_academic"
    return {
        "examType": exam_type,
        "family": "ielts",
        "version": "IELTS_COMPUTER_2026_V1",
        "isOfficial": False,
        "sections": [
            {
                "skill": "listening", "durationSeconds": 30 * 60, "durationApproximate": True,
                "questionCount": 40, "audioPlays": 1, "sources": ["ielts-format"],
                "parts": [{"key": str(n), "questionCount": 10, "allowedTypes": IELTS_LISTENING_TYPES} for n in (1, 2, 3, 4)],
            },
            {
                "skill": "reading", "durationSeconds": 60 * 60, "durationApproximate": False,
                "questionCount": 40, "sources": ["ielts-format"],
                # Three texts; how the 40 questions split between them varies by test.
                "parts": [{"key": str(n), "questionCount": None, "allowedTypes": IELTS_READING_TYPES} for n in (1, 2, 3)],
            },
            {
                "skill": "writing", "durationSeconds": 60 * 60, "durationApproximate": False,
                "questionCount": 2, "sources": ["ielts-format", "ielts-scoring"],
                "parts": [
                    {"key": "1", "questionCount": 1, "allowedTypes": ["essay_task1"], "wordMin": 150, "wordMax": None,
                     "suggestedSeconds": 20 * 60, "weight": 1},
                    {"key": "2", "questionCount": 1, "allowedTypes": ["essay_task2"], "wordMin": 250, "wordMax": None,
                     "suggestedSeconds": 40 * 60, "weight": 2},
                ],
            },
            {
                "skill": "speaking", "durationSeconds": 14 * 60, "durationMinSeconds": 11 * 60, "durationApproximate": True,
                "questionCount": None, "sources": ["ielts-format"],
                "parts": [
                    {"key": "1", "questionCount": None, "allowedTypes": ["speaking_task"], "minSeconds": 4 * 60, "maxSeconds": 5 * 60},
                    {"key": "2", "questionCount": None, "allowedTypes": ["speaking_task"], "prepSeconds": 60,
                     "responseSeconds": 120, "minSeconds": 3 * 60, "maxSeconds": 4 * 60},
                    {"key": "3", "questionCount": None, "allowedTypes": ["speaking_task"], "minSeconds": 4 * 60, "maxSeconds": 5 * 60},
                ],
            },
        ],
        "scale": {
            "type": "band", "min": 0, "max": 9, "step": 0.5, "sectionScale": "band",
            "objectiveMarks": 40,
            "readingConversion": "academic" if academic else "general_training",
            "overall": "MEAN_OF_FOUR_SECTIONS_ROUNDED_TO_NEAREST_HALF_BAND",
            "rounding": "an average ending in .25 goes up to the next half band, .75 up to the next whole band",
            "sources": ["ielts-scoring"],
        },
        "unverified": [
            {"field": "listening.reviewSeconds",
             "note": "Two minutes to check answers at the end of Listening on computer: not stated on the ielts.org pages checked."},
            {"field": "scale.rawToBand",
             "note": "ielts.org publishes only average marks for bands 5-8 (4-7 for General Training Reading) and says the "
                     "marks needed vary between test versions; the other rows of BestWay's tables are approximate."},
        ],
    }


def _multilevel() -> dict:
    version = multilevel.CURRENT_SPEC
    spec = multilevel.specification_payload(version)
    sections = []
    for skill in SKILLS:
        section = spec[skill]
        parts = []
        for part in section["parts"]:
            item = {"key": part["key"], "questionCount": part["count"], "allowedTypes": part["types"]}
            for field in ("options", "rawMax", "wordMin", "wordMax", "prepSeconds", "responseSeconds"):
                if field in part:
                    item[field] = part[field]
            parts.append(item)
        entry = {
            "skill": skill, "durationSeconds": section["durationSeconds"], "durationApproximate": False,
            "questionCount": sum(part["count"] for part in section["parts"]), "parts": parts,
            "sources": {"listening": ["uzbmb-format"], "reading": ["uzbmb-format"],
                        "writing": ["uzbmb-writing-2025"], "speaking": ["uzbmb-speaking-format", "uzbmb-speaking-criteria"]}[skill],
        }
        if skill == "listening":
            entry.update(audioPlays=2, previewSecondsMin=15, previewSecondsMax=30)
        if skill == "speaking":
            # The agency documents give per-question timings only, no total length.
            entry["durationApproximate"] = True
        sections.append(entry)
    return {
        "examType": "multilevel",
        "family": "multilevel",
        "version": version,
        "isOfficial": False,
        "sections": sections,
        "scale": {
            "type": "standard_score", "min": 0, "max": 75, "sectionScale": "0-75",
            "objectiveMarks": 35,
            "objectiveMethod": "OFFICIAL_RASCH_BESTWAY_ESTIMATE",
            "writingRawMax": 16, "speakingRawMax": 21,
            "overall": "MEAN_OF_FOUR_SECTIONS",
            "levels": [dict(level) for level in MULTILEVEL_LEVELS],
            "sources": ["uzbmb-criteria-2023", "uzbmb-writing-2025", "uzbmb-speaking-criteria"],
        },
        "unverified": [
            {"field": "speaking.durationSeconds",
             "note": "No total Speaking length in the agency documents checked; only per-question times are official."},
            {"field": "speaking.delivery",
             "note": "Computer delivery of Speaking is not stated in the agency documents checked."},
            {"field": "scale.speakingRawToStandard",
             "note": "No published agency table converts the 21 Speaking points to the 0-75 scale; BestWay's table is unconfirmed."},
            {"field": "scale.objective",
             "note": "Official Listening/Reading scores use a Rasch model; BestWay's raw-score table is an estimate only."},
        ],
    }


def blueprint(exam_type: str) -> dict | None:
    if exam_type in ("ielts_academic", "ielts_general"):
        return _ielts(exam_type)
    if exam_type == "multilevel":
        return _multilevel()
    return None


def all_blueprints() -> dict:
    return {
        "blueprintVersion": BLUEPRINT_VERSION,
        "checkedOn": CHECKED_ON,
        "sources": SOURCES,
        "exams": {exam_type: blueprint(exam_type) for exam_type in ("ielts_academic", "ielts_general", "multilevel")},
    }


def _get(item: dict, snake: str, camel: str):
    return item.get(snake, item.get(camel))


def conformity(exam_type: str, profile: str, sections: list[dict], specification_version: str | None = None) -> dict:
    """Compare one exam tree (``mock_authoring._exam_tree`` shape) with its blueprint.

    Only a full mock is expected to match the official structure. A practice set is
    allowed to be shorter, so for it only out-of-place question types are reported.
    """
    spec = blueprint(exam_type)
    if spec is None:
        return {"examType": exam_type, "checked": False, "full": False, "issues": [f"no blueprint for {exam_type}"]}
    full = profile == "full_mock"
    issues: list[str] = []
    by_skill = {section["skill"]: section for section in spec["sections"]}
    present = {section.get("skill"): section for section in sections}
    if exam_type == "multilevel":
        if full:
            issues.extend(multilevel.readiness({"specification_version": specification_version, "profile": profile, "sections": sections})["issues"])
    elif full:
        # BestWay runs IELTS Speaking outside the timed mock; the other three are required.
        for skill in ("listening", "reading", "writing"):
            if skill not in present:
                issues.append(f"{skill}: section is missing")
    for skill, section in present.items():
        expected = by_skill.get(skill)
        if expected is None:
            issues.append(f"unsupported section: {skill}")
            continue
        groups = section.get("groups") or []
        questions = [question for group in groups for question in (group.get("questions") or [])]
        allowed = {kind for part in expected["parts"] for kind in part["allowedTypes"]}
        wrong = sorted({question.get("type") for question in questions if question.get("type") not in allowed})
        if wrong:
            issues.append(f"{skill}: question types not in the blueprint: {', '.join(map(str, wrong))}")
        if not full:
            continue
        duration = _get(section, "duration_minutes", "durationMinutes")
        if duration is not None and duration * 60 != expected["durationSeconds"] and not expected["durationApproximate"]:
            issues.append(f"{skill}: duration is {duration} min, blueprint is {expected['durationSeconds'] // 60} min")
        if exam_type == "multilevel":
            continue  # parts and counts were checked by the Multilevel readiness above
        if len(groups) != len(expected["parts"]):
            issues.append(f"{skill}: {len(groups)} parts, blueprint has {len(expected['parts'])}")
        if expected["questionCount"] is not None and len(questions) != expected["questionCount"]:
            issues.append(f"{skill}: {len(questions)} questions, blueprint has {expected['questionCount']}")
        for index, part in enumerate(expected["parts"]):
            if index >= len(groups) or part["questionCount"] is None:
                continue
            count = len(groups[index].get("questions") or [])
            if count != part["questionCount"]:
                issues.append(f"{skill} part {part['key']}: {count} questions, blueprint has {part['questionCount']}")
    return {"examType": exam_type, "checked": True, "full": full, "issues": issues}
