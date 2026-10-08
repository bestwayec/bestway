"""Versioned Multilevel blueprint and its one canonical readiness check."""
from __future__ import annotations

CURRENT_SPEC = "UZBMB_MULTILEVEL_EN_2026_V2"
V1_SPEC = "UZBMB_MULTILEVEL_EN_2026_V1"
CURRENT_SPEAKING_PROFILE = "BESTWAY_MULTILEVEL_SPEAKING_2026_V3"


def _spec(part12_prep: list[int]) -> dict:
    return {
        "listening": {"duration": 45, "parts": [("1", 8, ["multiple_choice"], 3), ("2", 6, ["short_answer", "note_completion"], None), ("3", 4, ["matching"], 6), ("4", 5, ["matching"], 8), ("5", 6, ["multiple_choice"], 3), ("6", 6, ["short_answer", "note_completion"], None)]},
        "reading": {"duration": 60, "parts": [("1", 6, ["short_answer", "sentence_completion"], None), ("2", 8, ["matching"], 10), ("3", 6, ["matching_headings"], 8), ("4", 9, ["multiple_choice", "true_false_notgiven"], None), ("5", 6, ["short_answer", "summary_completion", "multiple_choice"], None)]},
        "writing": {"duration": 60, "parts": [("informal_email", 1, ["essay_task1"], 5), ("formal_email", 1, ["essay_task1"], 5), ("publication", 1, ["essay_task2"], 6)]},
        "speaking": {"duration": 11, "parts": [("1.1", 3, ["speaking_task"], 5), ("1.2", 3, ["speaking_task"], 5), ("2", 1, ["speaking_task"], 5), ("3", 1, ["speaking_task"], 6)], "part12Prep": part12_prep},
    }


SPECS = {V1_SPEC: _spec([15, 5, 5]), CURRENT_SPEC: _spec([0, 0, 0])}


def authored(items):
    return [item for _index, item in sorted(enumerate(items), key=lambda row: (
        row[1].get('sort_order', row[1].get('sortOrder')) if row[1].get('sort_order', row[1].get('sortOrder')) is not None else row[0], row[0]))]


def blueprint_issues(sections, full=True, specification_version=None, *, imported=False):
    spec = SPECS.get(specification_version) or SPECS[CURRENT_SPEC]
    if imported:
        sections = [dict(s, groups=[dict(g, sortOrder=i, audioKey=g.get('audioRef'), imageKey=g.get('imageRef'),
            audioDurationSec=None, maxScore=None, stimulusRef=None) for i, g in enumerate(s.get('groups') or []) if isinstance(g, dict)])
            for s in sections if isinstance(s, dict) and s.get('skill') in spec]
    issues: list[str] = []
    if full and len(sections) != 4:
        issues.append("Full Multilevel mock requires all four sections")
    for section in sections:
        skill = section.get("skill")
        if skill not in spec:
            issues.append(f"Unsupported section: {skill}")
            continue
        groups = authored(section.get("groups") or [])
        parts = spec[skill]["parts"]
        if len(groups) != len(parts):
            issues.append(f"{skill}: requires {len(parts)} parts")
        if skill == "writing" and (not groups or len(groups) < 2 or not (groups[0].get("stimulus_ref", groups[0].get("stimulusRef")) or '').strip() or groups[0].get("stimulus_ref", groups[0].get("stimulusRef")) != groups[1].get("stimulus_ref", groups[1].get("stimulusRef"))):
            issues.append("writing: informal and formal emails must share the same source stimulus")
        for index, group in enumerate(groups):
            if index >= len(parts):
                continue
            key, count, types, options = parts[index]
            label = f"{skill} {key}"
            questions = authored(group.get("questions") or [])
            if len(questions) != count:
                issues.append(f"{label}: requires {count} responses/questions")
            if skill == "listening" and (not group.get("audio_key", group.get("audioKey")) or group.get("part_number", group.get("partNumber")) != index + 1):
                issues.append(f"{label}: audio and matching part number required")
            duration = group.get("audio_duration_sec", group.get("audioDurationSec"))
            if skill == "listening" and (not isinstance(duration, (int, float)) or duration <= 0):
                issues.append(f"{label}: positive audio duration required")
            if skill == "speaking" and key == "1.2" and not group.get("image_key", group.get("imageKey")):
                issues.append(f"{label}: two-picture asset required")
            if skill in {"writing", "speaking"} and group.get("max_score", group.get("maxScore")) != options:
                issues.append(f"{label}: points must be {options}")
            for question_index, question in enumerate(questions):
                permitted = types
                if skill == "reading" and key == "4":
                    permitted = ["multiple_choice"] if question_index < 4 else ["true_false_notgiven"]
                if skill == "reading" and key == "5":
                    permitted = ["short_answer", "summary_completion"] if question_index < 4 else ["multiple_choice"]
                if question.get("type") not in permitted:
                    issues.append(f"{label} question {question_index + 1}: invalid type")
                if skill not in {"writing", "speaking"} and question.get("points") != 1:
                    issues.append(f"{label}: points must be 1")
                option_count = options if skill in {'listening', 'reading'} else None
                option_count = option_count or (4 if skill == "reading" and question.get("type") == "multiple_choice" else None)
                if option_count and len(question.get("options") or []) != option_count:
                    issues.append(f"{label}: requires {option_count} options")
                if question.get("type") in {"short_answer", "note_completion", "sentence_completion", "summary_completion"} and question.get("word_limit", question.get("wordLimit")) != 1:
                    issues.append(f"{label}: one-word/number answer required")
    return issues


def readiness(exam):
    version = exam.get('specification_version', exam.get('specificationVersion'))
    if version not in SPECS:
        return dict(supported=False, issues=['Unsupported Multilevel specification'])
    return dict(supported=True, issues=blueprint_issues(exam.get('sections') or [], exam.get('profile') == 'full_mock', version))


def specification_payload(version):
    spec = SPECS.get(version)
    if spec is None:
        return None
    result = {}
    for skill, section in spec.items():
        parts = []
        for index, (key, count, types, extra) in enumerate(section['parts']):
            part = dict(key=key, count=count, types=types)
            if skill in ('listening', 'reading') and extra:
                part['options'] = extra
            if skill in ('writing', 'speaking'):
                part['rawMax'] = extra
            if skill == 'writing':
                part.update(wordMin=[50, 120, 180][index], wordMax=[50, 150, 200][index])
            if skill == 'speaking':
                part.update(prepSeconds=[[0, 0, 0], section['part12Prep'], [60], [60]][index],
                            responseSeconds=[[30, 30, 30], [45, 30, 30], [120], [120]][index])
            parts.append(part)
        result[skill] = dict(durationSeconds=section['duration'] * 60, parts=parts)
    return result


def speaking_profile(version):
    if version not in ('BESTWAY_MULTILEVEL_SPEAKING_2026_V2', CURRENT_SPEAKING_PROFILE):
        return None
    old = version == 'BESTWAY_MULTILEVEL_SPEAKING_2026_V2'
    return dict(version=version, isOfficialTiming=False, parts=[dict(key=key, prepSeconds=prep, responseSeconds=response)
        for key, prep, response in [('1.1', [5, 5, 5] if old else [0, 0, 0], [30, 30, 30]),
            ('1.2', [10, 5, 5] if old else [0, 0, 0], [45, 30, 30]), ('2', [60], [120]), ('3', [60], [120])]])


def task_guidance(skill, part_index, question_index, profile_version, version):
    parts = (specification_payload(version) or specification_payload(CURRENT_SPEC))[skill]['parts']
    if part_index >= len(parts):
        return None
    part = parts[part_index]
    label = {'informal_email': 'Task 1.1 — Informal Letter', 'formal_email': 'Task 1.2 — Formal Letter', 'publication': 'Task 2 — Publication'}.get(part['key'], f'Part {part["key"]}')
    value = dict(taskKey=part['key'], displayLabel=label)
    for field in ('wordMin', 'wordMax', 'rawMax'):
        if field in part:
            value[field] = part[field]
    if skill == 'speaking':
        value.update(speakingProfileVersion=profile_version, profileLabel='BestWay product timing profile' if profile_version else 'Historical Multilevel timing profile')
        profile = speaking_profile(profile_version)
        timing = profile['parts'][part_index] if profile else part
        for field in ('prepSeconds', 'responseSeconds'):
            if question_index < len(timing[field]):
                value[field] = timing[field][question_index]
    return value
