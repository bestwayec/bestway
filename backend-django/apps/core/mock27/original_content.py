"""Original BESTWAY Writing and Speaking content for Full Mock Test 27 (schema-1.0 packages).

Unofficial practice material written for BESTWAY; not IELTS content.
"""
from __future__ import annotations

from . import EXAM_TITLE

ORIGINAL_SOURCE = dict(kind='original_practice', label='BESTWAY original practice content',
                       notes='Written by BESTWAY for this mock. Unofficial; not affiliated with IELTS.')
DESCRIPTION = 'IELTS Academic practice mock prepared by BESTWAY. Unofficial: not affiliated with or endorsed by IELTS.'

TASK1_PROMPT = ('The two maps show Riverside Park in 2005 and in 2025. Summarise the information by selecting and '
                'reporting the main features, and make comparisons where relevant.')
TASK2_PROMPT = ("Some people believe that online learning resources are more effective than traditional homework, while "
                "others argue that they reduce students' ability to learn independently.")

SPEAKING_PART1 = [
    'What subjects are you studying at the moment?',
    'Which subject do you enjoy most, and why?',
    'Do you prefer studying alone or with others?',
    'How do you usually organise your study time?',
    'Do you use technology for learning?',
    'What kind of educational apps do you find helpful?',
    'Do you prefer handwritten or digital notes?',
    'What skill would you like to improve?',
]
SPEAKING_CUE = ('Describe a useful skill you learned outside a classroom.', [
    'What the skill was.', 'How you learned it.', 'What difficulties you faced.', 'Why the skill has been useful.'])
SPEAKING_PART3 = [
    'Why are practical skills important?',
    'How has technology changed education?',
    'Should schools teach more practical skills?',
    'What are the advantages of independent learning?',
    'How can teachers motivate students?',
    'How might artificial intelligence change education?',
]


def _package(package_id, skill, title, minutes, instructions, groups, media):
    return dict(schemaVersion='1.0', packageId=package_id, revision=1, profile='full_mock', source=ORIGINAL_SOURCE,
                exam=dict(type='ielts_academic', title=EXAM_TITLE, description=DESCRIPTION, level='IELTS Academic',
                          isDemo=False, price=0, isFreeForApproved=True,
                          sections=[dict(key=skill, skill=skill, title=title, instructions=instructions,
                                         durationMinutes=minutes, groups=groups)]),
                media=media, reviewIssues=[])


def _task(key, number, qtype, prompt):
    return dict(key=key, number=number, type=qtype, prompt=prompt, options=[], correctAnswers=[], acceptedVariants=[],
                points=9, sourceRef='BESTWAY original')


def writing_package() -> dict:
    groups = [
        dict(key='w1', title='Writing Task 1 — Maps', passageText='', contentHtml='', contentLayout='document', audioScript='',
             instructions=('You should spend about 20 minutes on this task.\n\n' + TASK1_PROMPT + '\n\nWrite at least 150 words.'),
             imageRef='task1_maps', questions=[_task('w1q1', 1, 'essay_task1', TASK1_PROMPT + ' (Write at least 150 words.)')]),
        dict(key='w2', title='Writing Task 2 — Essay', passageText='', contentHtml='', contentLayout='document', audioScript='',
             instructions=('You should spend about 40 minutes on this task.\n\nWrite about the following topic:\n\n' + TASK2_PROMPT
                           + '\n\nDiscuss both views and give your own opinion.\n\nGive reasons for your answer and include any '
                           'relevant examples from your own knowledge or experience.\n\nWrite at least 250 words.'),
             questions=[_task('w2q2', 2, 'essay_task2', TASK2_PROMPT + ' Discuss both views and give your own opinion. (Write at least 250 words.)')]),
    ]
    media = [dict(key='task1_maps', kind='image', fileName='riverside-park-maps.png', requiredForPublish=True,
                  description='Riverside Park, 2005 and 2025 (original BESTWAY maps)')]
    return _package('bw-mock27-writing', 'writing', 'Writing', 60,
                    'The Writing test has two tasks. You have 60 minutes. Task 2 carries more weight than Task 1.', groups, media)


def speaking_package() -> dict:
    part1 = 'Part 1 questions:\n' + '\n'.join(f'{i}. {q}' for i, q in enumerate(SPEAKING_PART1, 1))
    cue = 'CUE CARD:\n' + SPEAKING_CUE[0] + '\nYou should say:\n' + '\n'.join(f'- {p}' for p in SPEAKING_CUE[1])
    part3 = 'Part 3 discussion questions:\n' + '\n'.join(f'{i}. {q}' for i, q in enumerate(SPEAKING_PART3, 1))
    base = dict(passageText='', contentHtml='', contentLayout='document', audioScript='')
    groups = [
        dict(key='s1', title='Speaking Part 1 — Studies and daily learning', **base,
             instructions='Answer the examiner\'s questions about your studies and daily learning (4–5 minutes).',
             questions=[_task('s1q1', 1, 'speaking_task', part1)]),
        dict(key='s2', title='Speaking Part 2 — Cue card', **base,
             instructions='You have 1 minute to prepare and make notes, then speak for up to 2 minutes (3–4 minutes with follow-up questions).',
             questions=[_task('s2q2', 2, 'speaking_task', cue)]),
        dict(key='s3', title='Speaking Part 3 — Education and skills', **base,
             instructions='Discuss the examiner\'s questions on education and skills in more depth (4–5 minutes).',
             questions=[_task('s3q3', 3, 'speaking_task', part3)]),
    ]
    return _package('bw-mock27-speaking', 'speaking', 'Speaking', 15,
                    'The Speaking test has three parts and lasts 11–14 minutes. Your answers are recorded.', groups, [])
