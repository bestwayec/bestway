"""Schema 1.0 package validation. Reuses authoring question/gap primitives."""
import hashlib
import json
import math
import re
import unicodedata

from .mock_content import LAYOUTS, sanitize_content, gap_numbers
from .mock_parse import build_correct_answers
from .mock_rules import (ANSWER_RULES, MANUAL_TYPES, QUESTION_TYPES, TEXT_TYPES,
                         canonical_decision, objective_question_issues, objective_group_issues)

KEY = re.compile(r'^[a-z][a-z0-9_-]{0,79}$')
SKILLS = ('listening', 'reading', 'writing', 'speaking')
EXAM_TYPES = ('ielts_academic', 'ielts_general', 'multilevel')
ISSUE_CODES = ('MISSING_ANSWER', 'AMBIGUOUS_TEXT', 'MISSING_MEDIA', 'UNSUPPORTED_LAYOUT', 'NUMBERING_REVIEW', 'OTHER')


def canonical_stringify(value):
    if isinstance(value, dict):
        return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + canonical_stringify(value[k])
                              for k in sorted(value, key=lambda k: k.encode('utf-16-be', errors='surrogatepass'))) + '}'
    if isinstance(value, list):
        return '[' + ','.join(map(canonical_stringify, value)) + ']'
    if isinstance(value, float):
        if not math.isfinite(value):
            return 'null'
        if value == int(value) and abs(value) < 1e21:
            return str(int(value))
        output = repr(value)
        if 1e-6 <= abs(value) < 1e21 and 'e' in output:
            from decimal import Decimal
            return format(Decimal(output), 'f')
        return re.sub(r'e([+-])0+(\d+)$', r'e\1\2', output)
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def canonical_checksum(value):
    return hashlib.sha256(canonical_stringify(value).encode('utf-8')).hexdigest()


def duplicate_keys(raw):
    # Port the reference raw-body scanner (including its array/path semantics).
    stack, found, pending, i = [], [], None, 0
    def path(key):
        return (stack[-1]['path'] if stack else '') + '/' + key.replace('~', '~0').replace('/', '~1')
    while i < len(raw):
        char = raw[i]
        if char == '"':
            value, i = '', i + 1
            while i < len(raw):
                if raw[i] == '\\':
                    value += raw[i + 1] if i + 1 < len(raw) else ''
                    i += 2
                elif raw[i] == '"':
                    i += 1
                    break
                else:
                    value += raw[i]
                    i += 1
            while i < len(raw) and raw[i].isspace():
                i += 1
            pending = value if i < len(raw) and raw[i] == ':' else None
            if pending is not None and stack:
                if pending in stack[-1]['keys']:
                    found.append(path(pending))
                else:
                    stack[-1]['keys'].add(pending)
            continue
        if char == '{':
            stack.append({'keys': set(), 'path': path(pending) if pending is not None else stack[-1]['path'] if stack else ''})
            pending = None
        elif char == '}':
            if stack:
                stack.pop()
            pending = None
        elif char in '[]':
            pending = None
        i += 1
    return found


def resolve_pointer(root, pointer):
    if pointer in ('', '/'):
        return True
    if not isinstance(pointer, str) or not pointer.startswith('/'):
        return False
    value = root
    for part in pointer[1:].split('/'):
        part = part.replace('~1', '/').replace('~0', '~')
        if isinstance(value, list):
            try:
                index = float(part or '0')
                if not index.is_integer() or not 0 <= index < len(value):
                    return False
                value = value[int(index)]
            except ValueError:
                return False
        elif isinstance(value, dict) and part in value:
            value = value[part]
        else:
            return False
    return True


def js_string(value):
    if value is None:
        return 'null'
    if value is True:
        return 'true'
    if value is False:
        return 'false'
    if isinstance(value, dict):
        return '[object Object]'
    if isinstance(value, list):
        return ','.join('' if v is None else js_string(v) for v in value)
    return str(value)


def integer(value):
    return type(value) in (int, float) and math.isfinite(value) and value == int(value)


def _words(value):
    value = unicodedata.normalize('NFKC', value).lower()
    value = re.sub('[‘’‚‛`´]', "'", value)
    value = re.sub('[“”„‟]', '"', value)
    value = re.sub('[–—―−]', '-', value)
    return len(re.sub(r'[.,/#!$%^&*;:{}=`~()"?\[\]<>+@\\|]', ' ', value).split())


def validate_package(pkg, media_bindings=None, raw_text=None):
    issues, notes = [], []
    counts = dict(sections=0, skills=0, groups=0, questions=0, media=0)
    bindings = media_bindings or {}
    def add(code, path, message, blocks=('import',), source=None):
        if len(issues) < 500:
            issues.append(dict(code=code, path=path, message=message, blocks=list(blocks), **({'sourceKey': source} if source else {})))
    def finish():
        ordered = sorted(issues, key=lambda x: (x['path'], x['code']))
        can_import = not any('import' in x['blocks'] for x in ordered)
        return dict(checksum=canonical_checksum(pkg), issues=ordered, counts=counts,
                    canImport=can_import, canPublish=can_import and not any('publish' in x['blocks'] for x in ordered),
                    sanitizerNotes=notes, truncated=len(issues) >= 500, totalIssues=len(issues))
    def unknown(value, allowed, path, label):
        for key in value:
            if key not in allowed:
                add('UNKNOWN_FIELD', path + '/' + key, f'Unknown {label} field "{key}"')
    def nonblank(value):
        return isinstance(value, str) and bool(value.strip())
    def key_check(value, label, base, seen):
        if not isinstance(value, str) or not KEY.fullmatch(value):
            add('KEY_FORMAT', base + '/key', f'{label}.key format invalid')
        elif value in seen:
            add('KEY_DUPLICATE', base + '/key', f'duplicate {label} key "{value}"')
        else:
            seen.add(value)
    if raw_text:
        for path in duplicate_keys(raw_text):
            add('DUPLICATE_KEY', path or '/', f'Duplicate JSON object key at {path or "/"}')
        size = len(raw_text.encode('utf-8'))
        if size > 2 * 1024 * 1024:
            add('SIZE_LIMIT', '', f'Package exceeds 2 MiB ({size} bytes)')
    if not isinstance(pkg, dict):
        add('JSON_PARSE', '', 'Package must be a JSON object')
        return finish()
    unknown(pkg, ('schemaVersion', 'packageId', 'revision', 'profile', 'source', 'exam', 'media', 'reviewIssues'), '', 'top-level')
    if pkg.get('schemaVersion') != '1.0':
        add('SCHEMA_VERSION', '/schemaVersion', 'schemaVersion must be exactly "1.0"')
    if not isinstance(pkg.get('packageId'), str) or not KEY.fullmatch(pkg['packageId']):
        add('PACKAGE_ID', '/packageId', 'packageId must match ^[a-z][a-z0-9_-]{0,79}$')
    if not integer(pkg.get('revision')) or pkg['revision'] < 1:
        add('REVISION', '/revision', 'revision must be an integer >= 1')
    profile = pkg.get('profile')
    if profile not in ('practice', 'full_mock'):
        add('ENUM_INVALID', '/profile', 'profile must be practice or full_mock')
    source = pkg.get('source')
    if not isinstance(source, dict):
        add('SOURCE', '/source', 'source object is required')
    else:
        unknown(source, ('kind', 'label', 'notes'), '/source', 'source')
        if source.get('kind') not in ('provided_material', 'original_practice'):
            add('ENUM_INVALID', '/source/kind', 'source.kind is invalid')
        if not nonblank(source.get('label')):
            add('SOURCE_LABEL', '/source/label', 'source.label must be non-blank')
    exam = pkg.get('exam')
    section_keys, group_keys, question_keys, skills = set(), set(), set(), set()
    numbers, declarations, refs = {}, {}, []
    if not isinstance(exam, dict):
        add('EXAM', '/exam', 'exam object is required')
    else:
        unknown(exam, ('type', 'title', 'description', 'level', 'practiceLevel', 'isDemo', 'price', 'isFreeForApproved', 'sections'), '/exam', 'exam')
        if exam.get('type') not in EXAM_TYPES:
            add('ENUM_INVALID', '/exam/type', 'exam.type is invalid')
        if not isinstance(exam.get('title'), str) or len(exam['title'].strip()) < 3:
            add('EXAM_TITLE', '/exam/title', 'exam.title must be at least 3 non-blank chars')
        for field, code, message in [('description', 'EXAM_DESC', 'exam.description must be a string'), ('level', 'EXAM_LEVEL', 'exam.level must be a string')]:
            if not isinstance(exam.get(field), str):
                add(code, '/exam/' + field, message)
        if exam.get('practiceLevel') is not None:
            if js_string(exam['practiceLevel']) not in ('A1', 'A2', 'B1', 'B2', 'C1'):
                add('ENUM_INVALID', '/exam/practiceLevel', 'practiceLevel must be A1, A2, B1, B2 or C1')
            if exam.get('type') != 'multilevel' or profile != 'practice':
                add('PRACTICE_LEVEL', '/exam/practiceLevel', 'practiceLevel is only available for Multilevel practice packages')
        for field, code, message in [('isDemo', 'EXAM_DEMO', 'exam.isDemo must be boolean'), ('isFreeForApproved', 'EXAM_FREE', 'exam.isFreeForApproved must be boolean')]:
            if type(exam.get(field)) is not bool:
                add(code, '/exam/' + field, message)
        if not integer(exam.get('price')) or exam['price'] < 0:
            add('EXAM_PRICE', '/exam/price', 'exam.price must be a non-negative integer')
        if 'isPublished' in exam:
            add('PUBLISH_INJECTION', '/exam/isPublished', 'Package must not set publication state')
        sections = exam.get('sections')
        if not isinstance(sections, list) or not 1 <= len(sections) <= 4:
            add('COUNT_LIMIT', '/exam/sections', 'exam.sections must contain 1-4 sections')
        else:
            counts['sections'] = len(sections)
            for si, section in enumerate(sections):
                base = f'/exam/sections/{si}'
                if not isinstance(section, dict):
                    add('SECTION', base, 'section must be an object')
                    continue
                unknown(section, ('key', 'skill', 'title', 'instructions', 'durationMinutes', 'groups'), base, 'section')
                key_check(section.get('key'), 'section', base, section_keys)
                skill = section.get('skill')
                if skill not in SKILLS:
                    add('ENUM_INVALID', base + '/skill', 'section.skill is invalid')
                elif skill in skills:
                    add('SKILL_DUPLICATE', base + '/skill', f'skill "{skill}" appears more than once')
                else:
                    skills.add(skill)
                if not nonblank(section.get('title')):
                    add('SECTION_TITLE', base + '/title', 'section.title must be non-blank')
                if not isinstance(section.get('instructions'), str):
                    add('SECTION_INSTR', base + '/instructions', 'section.instructions must be a string')
                if 'durationMinutes' in section and (not integer(section['durationMinutes']) or not 1 <= section['durationMinutes'] <= 300):
                    add('DURATION', base + '/durationMinutes', 'durationMinutes must be 1-300')
                groups = section.get('groups')
                if not isinstance(groups, list) or not 1 <= len(groups) <= 50:
                    add('COUNT_LIMIT', base + '/groups', 'section.groups must contain 1-50 groups')
                    continue
                for gi, group in enumerate(groups):
                    gb = base + f'/groups/{gi}'
                    if not isinstance(group, dict):
                        add('GROUP', gb, 'group must be an object')
                        continue
                    unknown(group, ('key', 'title', 'instructions', 'passageText', 'contentHtml', 'contentLayout', 'optionsReusable', 'audioScript', 'partNumber', 'audioPlayLimit', 'audioRef', 'imageRef', 'questions'), gb, 'group')
                    key_check(group.get('key'), 'group', gb, group_keys)
                    if not nonblank(group.get('title')):
                        add('GROUP_TITLE', gb + '/title', 'group.title must be non-blank')
                    for field, code, message in [('instructions', 'GROUP_INSTR', 'group.instructions must be a string'), ('passageText', 'GROUP_PASSAGE', 'group.passageText must be a string'), ('contentHtml', 'GROUP_HTML', 'group.contentHtml must be a string'), ('audioScript', 'GROUP_SCRIPT', 'group.audioScript must be a string')]:
                        if not isinstance(group.get(field), str):
                            add(code, gb + '/' + field, message)
                    if group.get('contentLayout') not in LAYOUTS:
                        add('ENUM_INVALID', gb + '/contentLayout', 'group.contentLayout is invalid')
                    if group.get('optionsReusable') is not None and type(group['optionsReusable']) is not bool:
                        add('OPTION_REUSE', gb + '/optionsReusable', 'optionsReusable must be boolean or null')
                    if 'partNumber' in group:
                        if skill != 'listening':
                            add('PART_NUMBER', gb + '/partNumber', 'partNumber is only allowed for listening groups')
                        if not integer(group['partNumber']) or not 1 <= group['partNumber'] <= (6 if exam.get('type') == 'multilevel' else 4):
                            add('PART_NUMBER', gb + '/partNumber', 'partNumber outside program range')
                    if 'audioPlayLimit' in group and (not integer(group['audioPlayLimit']) or not 1 <= group['audioPlayLimit'] <= 10):
                        add('PLAY_LIMIT', gb + '/audioPlayLimit', 'audioPlayLimit must be 1-10')
                    for field, kind in [('audioRef', 'audio'), ('imageRef', 'image')]:
                        if isinstance(group.get(field), str):
                            refs.append(dict(key=group[field], kind=kind, path=gb + '/' + field))
                    rich = group.get('contentHtml')
                    for field in ('contentHtml', 'audioScript'):
                        raw = group.get(field)
                        if isinstance(raw, str) and raw:
                            clean = sanitize_content(raw)
                            notes.append(dict(path=gb + '/' + field, changed=(clean or '') != raw))
                            if field == 'contentHtml' and clean is None:
                                add('HTML_UNSAFE', gb + '/contentHtml', 'contentHtml was fully stripped by the sanitizer')
                    questions = group.get('questions')
                    if not isinstance(questions, list) or not 1 <= len(questions) <= 200:
                        add('COUNT_LIMIT', gb + '/questions', 'group.questions must contain 1-200 questions')
                        continue
                    q_nums = []
                    for qi, question in enumerate(questions):
                        qb = gb + f'/questions/{qi}'
                        if not isinstance(question, dict):
                            add('QUESTION', qb, 'question must be an object')
                            continue
                        unknown(question, ('key', 'number', 'type', 'prompt', 'options', 'correctAnswers', 'acceptedVariants', 'points', 'wordLimit', 'answerRule', 'sourceRef'), qb, 'question')
                        key_check(question.get('key'), 'question', qb, question_keys)
                        number = question.get('number')
                        if isinstance(number, str):
                            add('NUMBER_TYPE', qb + '/number', 'question.number must be a number, not a string')
                        elif not integer(number) or not 1 <= number <= 200:
                            add('NUMBER_RANGE', qb + '/number', 'question.number must be 1-200')
                        else:
                            q_nums.append(number)
                            nk = f'{js_string(skill)}:{number}' if exam.get('type') == 'multilevel' else number
                            if nk in numbers:
                                add('NUMBER_COLLISION', qb + '/number', f'question number {number} collides with {numbers[nk]}')
                            else:
                                numbers[nk] = qb
                        qt = question.get('type')
                        if not isinstance(qt, str) or qt not in QUESTION_TYPES:
                            add('ENUM_INVALID', qb + '/type', 'question.type is invalid')
                            continue
                        manual = qt in MANUAL_TYPES
                        if skill in ('listening', 'reading') and manual:
                            add('TYPE_SKILL_MISMATCH', qb + '/type', f'type "{qt}" is not allowed for {skill}')
                        if skill == 'writing' and qt not in ('essay_task1', 'essay_task2'):
                            add('TYPE_SKILL_MISMATCH', qb + '/type', 'writing groups accept only essay tasks')
                        if skill == 'speaking' and qt != 'speaking_task':
                            add('TYPE_SKILL_MISMATCH', qb + '/type', 'speaking groups accept only speaking_task')
                        if not nonblank(question.get('prompt')):
                            add('PROMPT', qb + '/prompt', 'question.prompt must be non-blank')
                        options = question.get('options')
                        if not isinstance(options, list):
                            add('OPTIONS', qb + '/options', 'question.options must be an array')
                        else:
                            trimmed = [o.strip() if isinstance(o, str) else '' for o in options]
                            if '' in trimmed:
                                add('OPTION_EMPTY', qb + '/options', 'options must not contain blank entries')
                            if len(set(trimmed)) != len(trimmed):
                                add('OPTION_DUPLICATE', qb + '/options', 'options contain duplicates after trimming')
                            for option in trimmed:
                                if re.match(r'^[A-Z][).]\s', option):
                                    add('OPTION_FORMAT', qb + '/options', 'options must be plain text without "A) " prefixes')
                            if qt in ('multiple_choice', 'multi_select', 'matching', 'matching_headings') and len(options) < 2:
                                add('OPTIONS_REQUIRED', qb + '/options', 'choice questions require at least 2 options')
                            if qt in ('multiple_choice', 'matching', 'matching_headings') and len(options) > 26:
                                add('COUNT_LIMIT', qb + '/options', 'options limited to 26')
                            if qt in ('true_false_notgiven', 'yes_no_notgiven'):
                                expected = ['TRUE', 'FALSE', 'NOT_GIVEN'] if qt == 'true_false_notgiven' else ['YES', 'NO', 'NOT_GIVEN']
                                if len(options) != 3 or [canonical_decision(o) if isinstance(o, str) else '' for o in options] != expected:
                                    code, label = ('TFNG_OPTIONS', 'TFNG') if qt == 'true_false_notgiven' else ('YNNG_OPTIONS', 'YNNG')
                                    display = '["TRUE","FALSE","NOT GIVEN"]' if label == 'TFNG' else '["YES","NO","NOT GIVEN"]'
                                    add(code, qb + '/options', f'{label} options must be exactly {display}')
                            if qt in TEXT_TYPES and options:
                                add('OPTIONS_FORBIDDEN', qb + '/options', f'type "{qt}" must have empty options')
                            if manual and options:
                                add('OPTIONS_FORBIDDEN', qb + '/options', 'manual tasks must have empty options')
                        correct = question.get('correctAnswers')
                        if not isinstance(correct, list):
                            add('CORRECT', qb + '/correctAnswers', 'correctAnswers must be an array')
                        else:
                            if not manual and not correct:
                                add('MISSING_ANSWER', qb + '/correctAnswers', 'auto-graded questions require at least one key')
                            if manual and correct:
                                add('MANUAL_KEY', qb + '/correctAnswers', 'manual tasks must have empty correctAnswers')
                            if qt in ('multiple_choice', 'matching', 'matching_headings', 'multi_select'):
                                multi = qt == 'multi_select'
                                if (multi and len(correct) < 2) or (not multi and len(correct) > 1):
                                    add('CORRECT_COUNT', qb + '/correctAnswers', 'multi-select requires at least two letters' if multi else 'single-choice questions accept exactly one letter')
                                for key in correct:
                                    if not isinstance(key, str) or not re.fullmatch('[A-Z]', key):
                                        label = 'multi-select key' if multi else 'correct answer'
                                        add('CORRECT_LETTER', qb + '/correctAnswers', f'{label} "{js_string(key)}" must be a single uppercase letter')
                                    elif isinstance(options, list) and (ord(key) - 65 >= len(options) if multi else len(build_correct_answers(qt, options, key)) == 1):
                                        add('OPTION_LETTER_RANGE', qb + '/correctAnswers', f'letter "{key}" is beyond the options array')
                                if multi and len({canonical_stringify(c) for c in correct}) != len(correct):
                                    add('CORRECT_DUPLICATE', qb + '/correctAnswers', 'correctAnswers contain duplicates')
                            if qt in ('true_false_notgiven', 'yes_no_notgiven'):
                                permitted = ('TRUE', 'FALSE', 'NOT_GIVEN') if qt == 'true_false_notgiven' else ('YES', 'NO', 'NOT_GIVEN')
                                for key in correct:
                                    if not isinstance(key, str) or canonical_decision(key) not in permitted:
                                        add('CORRECT_VALUE', qb + '/correctAnswers', 'TFNG key must be TRUE, FALSE or NOT GIVEN' if qt == 'true_false_notgiven' else 'YNNG key must be YES, NO or NOT GIVEN')
                        variants = question.get('acceptedVariants')
                        if not isinstance(variants, list):
                            add('VARIANTS', qb + '/acceptedVariants', 'acceptedVariants must be an array')
                        else:
                            if qt in ('multiple_choice', 'multi_select', 'matching', 'matching_headings', 'true_false_notgiven', 'yes_no_notgiven', *MANUAL_TYPES) and variants:
                                add('VARIANT_MISUSE', qb + '/acceptedVariants', 'acceptedVariants is reserved for text answers')
                            for variant in variants:
                                if not nonblank(variant) or len(variant) > 1000:
                                    add('VARIANT_VALUE', qb + '/acceptedVariants', 'each variant must be 1-1000 chars')
                                if isinstance(variant, str) and '/' in variant:
                                    add('VARIANT_FORMAT', qb + '/acceptedVariants', 'variants must not use a/b syntax')
                        points = question.get('points')
                        if not integer(points) or not 1 <= points <= 20:
                            add('POINTS_INVALID', qb + '/points', 'points must be 1-20')
                        elif exam.get('type') in ('ielts_academic', 'ielts_general') and manual and points != 9:
                            add('POINTS_INVALID', qb + '/points', 'IELTS manual tasks use 9 points')
                        if 'wordLimit' in question:
                            limit = question['wordLimit']
                            needs = qt in TEXT_TYPES or (qt == 'map_labelling' and isinstance(options, list) and not options)
                            if not needs:
                                add('WORD_LIMIT', qb + '/wordLimit', 'wordLimit is only allowed for text completion answers')
                            elif not integer(limit) or not 1 <= limit <= 50:
                                add('WORD_LIMIT', qb + '/wordLimit', 'wordLimit must be 1-50')
                            elif question.get('answerRule') is None:
                                for answer in (correct if isinstance(correct, list) else []) + (variants if isinstance(variants, list) else []):
                                    if isinstance(answer, str) and _words(answer) > limit:
                                        add('WORD_LIMIT', qb + '/correctAnswers', f'answer "{answer}" exceeds wordLimit {limit}')
                        if question.get('answerRule') is not None and question['answerRule'] not in tuple(ANSWER_RULES):
                            add('ANSWER_RULE', qb + '/answerRule', 'answerRule is invalid')
                        for issue in objective_question_issues(question, skill in ('reading', 'listening')):
                            add('QUESTION_ENGINE', qb, issue)
                        if not nonblank(question.get('sourceRef')):
                            add('SOURCE_REF', qb + '/sourceRef', 'question.sourceRef must be non-blank')
                    counts['questions'] += len(questions)
                    for issue in objective_group_issues(dict(contentLayout=group.get('contentLayout'), optionsReusable=group.get('optionsReusable'), imageKey=group.get('imageRef'), questions=[q for q in questions if isinstance(q, dict)]), skill in ('reading', 'listening')):
                        add('QUESTION_ENGINE', gb, issue, ('publish',) if 'require an image' in issue else ('import',))
                    gaps = gap_numbers(sanitize_content(rich)) if isinstance(rich, str) and rich else []
                    if isinstance(rich, str) and rich and (gaps or group.get('contentLayout') in ('document', 'table', 'notes', 'summary', 'sentences')):
                        dup = [n for i, n in enumerate(gaps) if n in gaps[:i]]
                        joined = lambda seq: ', '.join(str(n) for n in dict.fromkeys(seq))
                        if dup:
                            add('GAP_TOKEN_DUPLICATE', gb + '/contentHtml', f'duplicate gap tokens: {joined(dup)}')
                        missing_q, missing_t = [n for n in gaps if n not in q_nums], [n for n in q_nums if n not in gaps]
                        if missing_q or missing_t or len(set(q_nums)) != len(q_nums):
                            message = 'gap mapping mismatch' + (f'; savolsiz gaplar: {joined(missing_q)}' if missing_q else '') + (f'; gapsiz savollar: {joined(missing_t)}' if missing_t else '')
                            add('GAP_QUESTION_MISMATCH', gb + '/contentHtml', message, source=group.get('key') if isinstance(group.get('key'), str) else None)
                        if any(isinstance(q, dict) and q.get('type') not in tuple(TEXT_TYPES) for q in questions):
                            add('RICH_TYPE', gb + '/contentHtml', 'rich groups support text completion answers only')
            counts.update(groups=len(group_keys), skills=len(skills), media=len(pkg['media']) if isinstance(pkg.get('media'), list) else 0)
            if counts['groups'] > 50:
                add('COUNT_LIMIT', '/exam/sections', 'total groups exceed 50')
            if counts['questions'] > 200:
                add('COUNT_LIMIT', '/exam/sections', 'total questions exceed 200')
    media = pkg.get('media')
    if not isinstance(media, list):
        add('MEDIA', '/media', 'media must be an array')
    else:
        if len(media) > 20:
            add('COUNT_LIMIT', '/media', 'media declarations exceed 20')
        for mi, item in enumerate(media):
            mb = f'/media/{mi}'
            if not isinstance(item, dict):
                add('MEDIA', mb, 'media entry must be an object')
                continue
            unknown(item, ('key', 'kind', 'fileName', 'requiredForPublish', 'description'), mb, 'media')
            key = item.get('key')
            if not isinstance(key, str) or not KEY.fullmatch(key):
                add('KEY_FORMAT', mb + '/key', 'media.key format invalid')
            elif key in declarations:
                add('KEY_DUPLICATE', mb + '/key', f'duplicate media key "{key}"')
            elif isinstance(item.get('kind'), str) and isinstance(item.get('fileName'), str):
                declarations[key] = dict(item, path=mb)
            if item.get('kind') not in ('audio', 'image'):
                add('ENUM_INVALID', mb + '/kind', 'media.kind must be audio or image')
            filename = item.get('fileName')
            if not nonblank(filename) or len(filename) > 255 or re.search(r'[/\\:\x00-\x1f\x7f]|^\.\.?$', filename):
                add('MEDIA_FILENAME', mb + '/fileName', 'fileName must be a plain basename without paths or URLs')
            if type(item.get('requiredForPublish')) is not bool:
                add('MEDIA_REQUIRED', mb + '/requiredForPublish', 'requiredForPublish must be boolean')
        for ref in refs:
            declaration = declarations.get(ref['key'])
            if declaration is None:
                add('MEDIA_REF', ref['path'], f'media reference "{ref["key"]}" has no declaration')
            elif declaration['kind'] != ref['kind']:
                add('MEDIA_REF', ref['path'], f'media reference "{ref["key"]}" needs kind {declaration["kind"]}')
        for key, declaration in declarations.items():
            if key not in [r['key'] for r in refs]:
                add('MEDIA_UNUSED', declaration['path'], f'media declaration "{key}" is never referenced')
            if declaration.get('requiredForPublish') is True and not bindings.get(key):
                add('MISSING_MEDIA', declaration['path'], f'media "{key}" requires an uploaded binding before publish', ('publish',))
    review = pkg.get('reviewIssues')
    if not isinstance(review, list):
        add('ISSUES', '/reviewIssues', 'reviewIssues must be an array')
    else:
        if len(review) > 200:
            add('COUNT_LIMIT', '/reviewIssues', 'reviewIssues exceed 200')
        seen = set()
        for ri, item in enumerate(review):
            rb = f'/reviewIssues/{ri}'
            if not isinstance(item, dict):
                add('ISSUE', rb, 'issue must be an object')
                continue
            unknown(item, ('key', 'code', 'path', 'message', 'sourceRef'), rb, 'issue')
            key_check(item.get('key'), 'issue', rb, seen)
            if item.get('code') not in ISSUE_CODES:
                add('ENUM_INVALID', rb + '/code', 'issue.code is invalid')
            if not isinstance(item.get('path'), str) or not resolve_pointer(pkg, item['path']):
                label = js_string(item['path']) if 'path' in item else 'undefined'
                add('REVIEW_PATH', rb + '/path', f'issue path "{label}" does not resolve in the package')
            if not nonblank(item.get('message')):
                add('ISSUE_MESSAGE', rb + '/message', 'issue.message must be non-blank')
            if not nonblank(item.get('sourceRef')):
                add('ISSUE_SOURCEREF', rb + '/sourceRef', 'issue.sourceRef must be non-blank')
        if review:
            add('REVIEW_OPEN', '/reviewIssues', f'{len(review)} review issue(s) must be resolved before publish', ('publish',))
    if isinstance(exam, dict) and profile in ('practice', 'full_mock'):
        if profile == 'practice' and not skills:
            add('PROFILE_BLUEPRINT', '/profile', 'practice packages need at least one skill', ('publish',))
        elif profile == 'full_mock':
            from .multilevel import blueprint_issues
            if exam.get('type') == 'multilevel':
                for issue in blueprint_issues(exam.get('sections') or [], imported=True):
                    add('PROFILE_BLUEPRINT', '/exam/sections', issue, ('publish',))
            else:
                by_skill = {}
                for section in exam.get('sections') or []:
                    if not isinstance(section, dict):
                        continue
                    groups = section.get('groups') or []
                    by_skill[section.get('skill')] = dict(groups=len(groups), questions=sum(len(g.get('questions') or []) for g in groups if isinstance(g, dict)),
                        parts={g['partNumber'] for g in groups if isinstance(g, dict) and type(g.get('partNumber')) in (int, float)},
                        types={q.get('type') for g in groups if isinstance(g, dict) for q in g.get('questions') or [] if isinstance(q, dict) and isinstance(q.get('type'), str)})
                for skill, count, group_count, parts in [('listening', 40, 4, True), ('reading', 40, 3, False)]:
                    entry = by_skill.get(skill, dict(groups=0, questions=0, parts=set()))
                    if entry['groups'] != group_count or entry['questions'] != count or (parts and entry['parts'] != {1, 2, 3, 4}):
                        add('PROFILE_BLUEPRINT', '/exam/sections', f'full_mock {skill} needs {group_count} {"parts" if parts else "groups"} / {count} questions (found {entry["groups"]} groups, {entry["questions"]} questions)', ('publish',))
                writing = by_skill.get('writing', dict(questions=0, types=set()))
                if writing['questions'] != 2 or not {'essay_task1', 'essay_task2'} <= writing['types']:
                    add('PROFILE_BLUEPRINT', '/exam/sections', 'full_mock writing needs task 1 and task 2', ('publish',))
    return finish()
