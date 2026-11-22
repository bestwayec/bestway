"""ORIGINAL BESTWAY Listening for Mock 27 (replacement path when supplied material cannot be published).

Four spoken scripts (the owner or a voice artist records them) and 40 questions written for BESTWAY.
Every answer is spoken in its script. Persons and places are fictional. Unofficial practice material.
No audio is generated here: the Listening exam stays blocked until real recordings are uploaded and verified.
"""
from __future__ import annotations

import re
from html import escape

from . import EXAM_TITLE
from .common_parse import gap_token
from .original_content import DESCRIPTION, ORIGINAL_SOURCE

SRC = 'BESTWAY original Listening'

SCRIPT_1 = """Receptionist: Harbourside Arts Centre, good morning.
Caller: Good morning. I'd like some information about the pottery course for beginners, please.
Receptionist: Of course. The next beginners' course starts on the fourth of March. It runs on Thursday evenings.
Caller: Thursdays? I thought it was Tuesdays.
Receptionist: That was last year's timetable. It's definitely Thursday now.
Caller: What time does it start?
Receptionist: Seven o'clock... no, sorry, I'm looking at the old timetable again. It starts at 7.30 and finishes at 9.30.
Caller: And how long does the course last?
Receptionist: Eight weeks. There used to be a ten-week version, but it was shortened.
Caller: How much does it cost?
Receptionist: The course fee is £90, but that doesn't include the materials fee, so the total is £96.
Caller: What do the materials cover?
Receptionist: You get all the clay you need, and the glaze for your finished pieces. Firing is free as well.
Caller: Who teaches the course?
Receptionist: Mrs Halloran. That's H-A-L-L-O-R-A-N.
Caller: Do I need to bring anything?
Receptionist: Wear old clothes, and bring an apron. We have a few spare ones, but not many. Please don't bring your own tools; we supply those.
Caller: Where exactly is the studio?
Receptionist: It's in the old mill, at the end of the quay. It isn't in the main arts centre, so people sometimes go to the wrong building.
Caller: Is there anywhere to park?
Receptionist: There's a car park behind the library, about five minutes' walk away. The one beside the mill is for residents only.
Caller: Good. And how do I book?
Receptionist: You can book online or by phone. There are only twelve places, and booking closes on Monday.
Caller: I'll do it today. Thank you very much."""

SCRIPT_2 = """Good morning, everyone, and welcome to Greenfield Botanic Garden. My name is Sam, and I'll take a few minutes to explain what is open today and how to make the most of your visit.

First, the main attractions. Many people ask about the glasshouse. Unfortunately it is closed for repairs at the moment, because the roof is being replaced, and we expect it to reopen in June. In the meantime, I'd suggest the Rose Garden. It is lovely all day, but the scent is strongest early on, so it is best visited in the morning, before it gets warm.

If you have children with you, there is a children's trail with twelve numbered stops. Please pick up an activity sheet at the entrance. It is very popular, so we only run it during school holidays. Outside those times the signs are covered up and the trail is not open.

If you get hungry, the tea pavilion beside the lake serves sandwiches, cakes and hot drinks. One thing to remember: it accepts cash payments only, because the card machine is not working. There is a cash machine at the main gate if you need one.

Next to the pavilion is our plant shop. Every day at twelve noon, one of our gardeners gives a free talk there, usually about planting for the season. You don't need to book. Groups of ten or more do need to book in advance, but that applies to group tours, not to the talk.

Now, some practical points. If you came here by bus, don't throw your ticket away. Show it at the entrance desk and you'll receive a quarter off the entry price. Parking, I should say, is charged separately by the hour.

This year, our new attraction is the insect hotel, which is built from old wooden pallets and bamboo canes and stands at the far end of the meadow. Children love it, and so do the bees.

A word about paths. The lake path is flat and surfaced, so wheelchairs and pushchairs are fine. It is the woodland path that gets muddy after rain, so please wear sensible shoes if you plan to go that way.

On photography: you are very welcome to take photos, but please leave tripods in the cloakroom, because the paths are narrow and a tripod can block them.

Finally, one request. We have very few bins, so please take your litter home with you. Thank you, and enjoy your visit."""

SCRIPT_3 = """Dr Evans: Come in, both of you. How is the packaging project going?
Priya: Quite well, Dr Evans. We've decided to compare paper, plastic and cornstarch packaging for strawberries.
Dr Evans: Good. Any problems so far?
Marcus: My main worry is time. Strawberries only last about ten days, we've got three weeks in total, and that leaves very little room for mistakes.
Priya: I'm not worried about equipment. The department lends us the scales, and the fruit itself is cheap.
Dr Evans: Fair enough. How many packages are you planning to test?
Priya: Five of each material.
Dr Evans: Five is fine. What I'd like is for you to repeat each test three times, so that one odd result doesn't mislead you.
Marcus: All right. We'll do that. And what about the survey? We want to ask students which packaging they prefer.
Priya: I think we should put it online rather than hand out paper forms. It will reach more people, and we won't have to type in the answers.
Marcus: Paper is easier to hand out, but you're right, online is quicker. Online it is.
Dr Evans: Agreed. Now, your draft report. It's well organised, and the introduction is clear. The diagrams are good, too. My concern is that it is too descriptive. You explain what you did, but you don't discuss why the results matter.
Priya: Right. We'll add a discussion section.
Dr Evans: Before you go, let's check the procedure so I know it's clear.
Priya: First, we choose a supplier. We've found one that sells all three materials, so the comparison is fair.
Marcus: Then every package gets a label with a code on it, so nobody knows which material it is when we make our judgements.
Priya: Each day we measure the weight of each package, because the fruit loses weight as it dries, and we record it in a table.
Marcus: All the packages stay in the cold room at a constant temperature of four degrees.
Priya: At the end of each week we take photographs of the fruit, to show any mould.
Marcus: And finally we write everything up and hand it in before the deadline.
Dr Evans: Which is the end of next month. Good. That all sounds sensible. Send me the revised draft next week."""

SCRIPT_4 = """Today I'd like to talk about sleep and learning, a subject that matters to every student in this room.

For a long time, people believed that sleep was simply a period when the brain was inactive, a kind of switching off. That view changed in the 1950s, when researchers noticed that during part of the night the sleeper's eyes move rapidly beneath the lids. This stage, called rapid eye movement sleep, is closely linked with dreaming, and it showed that the sleeping brain is far from idle.

Later work focused on memory. In one well-known study, students learned a long list of words and were then tested. Those who slept after learning remembered about twenty per cent more words than those who stayed awake. What is more, the students who lost a night's sleep never completely made up the difference, even after two nights of recovery. The lesson is clear: sleep soon after learning, and do not rely on catching up afterwards.

What about naps? A nap of about twenty minutes improves alertness for several hours. A longer nap, however, can leave you feeling heavy and confused when you wake, a feeling known as sleep inertia. So if you need to nap before an exam, keep it short.

Teenagers face a particular problem. During adolescence the body clock shifts later, so that a teenager may not feel sleepy until well after eleven at night, yet most schools start early in the morning. Several schools have tried starting an hour later. The result was better attendance, and exam results improved as well.

Light also matters. The blue light from phones and tablets delays the release of melatonin, the hormone that tells the body it is time to sleep. Looking at a screen late at night can therefore keep you awake.

Finally, some practical advice. Go to bed at the same time each night. Keep your bedroom cool and dark. And avoid caffeine after midday, because it stays in the body for many hours. Thank you for listening."""


def _q(n, qtype, prompt, answers, options=(), variants=(), limit=None, rule=None):
    value = dict(key=f'q{n}', number=n, type=qtype, prompt=prompt, options=list(options), correctAnswers=list(answers),
                 acceptedVariants=list(variants), points=1, sourceRef=SRC)
    if limit:
        value['wordLimit'] = limit
        if rule:
            value['answerRule'] = rule
    return value


def _notes(items, first):
    """items: ('h', text) | ('li', depth, text-with-{n}-markers). Returns (html, prompts-by-number)."""
    from .common_parse import nested_list_html
    html, buffer, prompts = [], [], {}

    def flush():
        if buffer:
            html.append(nested_list_html(buffer.copy()))
            buffer.clear()

    for item in items:
        if item[0] == 'h':
            flush()
            html.append(f'<h4>{escape(item[1], quote=False)}</h4>')
            continue
        text = item[2]
        parts = re.split(r'\{(\d+)\}', text)
        rendered = ''.join(escape(p, quote=False) if i % 2 == 0 else gap_token(int(p)) for i, p in enumerate(parts))
        for n in re.findall(r'\{(\d+)\}', text):
            prompts[int(n)] = re.sub(r'\{(\d+)\}', lambda m: '______' if m.group(1) == n else f'({m.group(1)}) ______', text)
        buffer.append((item[1], rendered))
    flush()
    return ''.join(html), prompts


def groups() -> list[dict]:
    num = lambda n, p, a, v=(): _q(n, 'note_completion', p[n], [a], variants=v, limit=2,
                                    rule=None if v else 'ONE_WORD_AND_OR_NUMBER')
    html1, p1 = _notes([
        ('h', 'Pottery course for beginners'),
        ('li', 0, 'Day of the lessons: {1}'),
        ('li', 0, 'Start time: {2} p.m.'),
        ('li', 0, 'Length of course: {3} weeks'),
        ('li', 0, 'Total cost: £{4}'),
        ('li', 0, 'The fee includes clay and {5}'),
        ('li', 0, 'Tutor: Mrs {6}'),
        ('h', 'Practical details'),
        ('li', 0, 'Students should bring an {7}'),
        ('li', 0, 'The studio is in the old {8}, at the end of the quay'),
        ('li', 0, 'The nearest car park is behind the {9}'),
        ('li', 0, 'Booking closes on {10}'),
    ], 1)
    g1 = [num(1, p1, 'Thursday'), num(2, p1, '7.30', ['7:30']), num(3, p1, '8', ['eight']), num(4, p1, '96', ['£96']),
          num(5, p1, 'glaze'), num(6, p1, 'Halloran'), num(7, p1, 'apron'), num(8, p1, 'mill'), num(9, p1, 'library'),
          num(10, p1, 'Monday')]
    bank2 = ['closed for repairs', 'a free talk at midday', 'best visited in the morning', 'a separate entrance fee',
             'open only in school holidays', 'cash payments only', 'booking required in advance']
    mc = lambda n, prompt, options, key: _q(n, 'multiple_choice', prompt, [key], options)
    g2 = [
        _q(11, 'matching', 'Glasshouse', ['A'], bank2), _q(12, 'matching', 'Rose Garden', ['C'], bank2),
        _q(13, 'matching', "Children's trail", ['E'], bank2), _q(14, 'matching', 'Tea pavilion', ['F'], bank2),
        _q(15, 'matching', 'Plant shop', ['B'], bank2),
        mc(16, 'Visitors who arrive by bus should', ['buy their ticket on the bus.', 'show their bus ticket for a discount.', 'use the south gate.'], 'B'),
        mc(17, "This year's new attraction is", ['a butterfly house.', 'a bird hide.', 'an insect hotel.'], 'C'),
        mc(18, 'What does the speaker say about the lake path?', ['It is suitable for wheelchairs.', 'It is often muddy.', 'It is closed in winter.'], 'A'),
        mc(19, 'Photography in the garden', ['is not allowed on narrow paths.', 'needs a permit.', 'is welcome, but tripods are not.'], 'C'),
        mc(20, 'The speaker asks visitors to', ['take their litter home.', 'buy a map.', 'keep to the lake path.'], 'A'),
    ]
    g3 = [
        mc(21, 'Marcus is concerned that the experiment', ['may take longer than the time available.', 'needs expensive equipment.', 'may not have enough fruit.'], 'A'),
        mc(22, 'Dr Evans advises the students to', ['use a smaller sample.', 'repeat each test three times.', 'choose a different fruit.'], 'B'),
        mc(23, 'Priya thinks the survey should be', ['given to more students.', 'shorter.', 'online.'], 'C'),
        mc(24, 'What is Dr Evans\'s main criticism of the draft report?', ['The introduction is unclear.', 'It has too few diagrams.', 'It is too descriptive.'], 'C'),
    ]
    bank3 = ['temperature', 'questionnaire', 'photographs', 'weight', 'supplier', 'label', 'budget', 'deadline', 'storage']
    flow = lambda n, prompt, key: _q(n, 'matching', prompt, [key], bank3)
    g3 += [
        flow(25, 'First, the students choose a ______ for all three materials.', 'E'),
        flow(26, 'Each package is given a code on a ______.', 'F'),
        flow(27, 'Every day the ______ of each package is recorded.', 'D'),
        flow(28, 'The packages are kept at a constant ______ in the cold room.', 'A'),
        flow(29, 'At the end of each week ______ of the fruit are taken.', 'C'),
        flow(30, 'The report is handed in before the ______.', 'H'),
    ]
    html4, p4 = _notes([
        ('h', 'Sleep and learning'),
        ('li', 0, 'Early view: during sleep the brain was thought to be {31}'),
        ('li', 0, 'Rapid eye movement sleep is linked with {32}'),
        ('h', 'Sleep and memory'),
        ('li', 0, 'Students who slept after learning remembered about 20% more {33}'),
        ('li', 0, 'Lost sleep was not fully made up, even after two nights of {34}'),
        ('h', 'Naps and teenagers'),
        ('li', 0, 'A nap of about twenty {35} improves alertness'),
        ('li', 0, 'Longer naps may cause sleep {36}'),
        ('li', 0, "A teenager's body clock shifts {37}"),
        ('li', 0, 'Later school start times improved {38} and exam results'),
        ('h', 'Light and advice'),
        ('li', 0, 'Blue light from screens delays the hormone {39}'),
        ('li', 0, 'Avoid {40} after midday'),
    ], 31)
    one = lambda n, a: _q(n, 'note_completion', p4[n], [a], limit=1, rule='ONE_WORD')
    g4 = [one(31, 'inactive'), one(32, 'dreaming'), one(33, 'words'), one(34, 'recovery'), one(35, 'minutes'),
          one(36, 'inertia'), one(37, 'later'), one(38, 'attendance'), one(39, 'melatonin'), one(40, 'caffeine')]

    def group(part, key, title, instructions, script, html, questions, reusable=None):
        value = dict(key=key, title=title, instructions='\n\n'.join(instructions), passageText='', contentHtml=html,
                     contentLayout='notes' if html else 'document', audioScript=script, partNumber=part, audioPlayLimit=1,
                     audioRef=f'part{part}_audio', questions=questions)
        if reusable is not None:
            value['optionsReusable'] = reusable
        return value

    return [
        group(1, 'l1', 'Listening Part 1', ['Questions 1–10\nComplete the notes below. Write ONE WORD AND/OR A NUMBER for each answer.'], SCRIPT_1, html1, g1),
        group(2, 'l2', 'Listening Part 2', [
            'Questions 11–15\nWhat information is given about each of the following facilities?\nChoose FIVE answers from the box and write the correct letter, A–G, next to the questions.',
            'Questions 16–20\nChoose the correct letter, A, B or C.'], SCRIPT_2, '', g2, reusable=False),
        group(3, 'l3', 'Listening Part 3', [
            'Questions 21–24\nChoose the correct letter, A, B or C.',
            'Questions 25–30\nComplete the flow chart below.\nChoose SIX answers from the box and write the correct letter, A–I, next to the questions.\nStages of the experiment'],
              SCRIPT_3, '', g3, reusable=False),
        group(4, 'l4', 'Listening Part 4', ['Questions 31–40\nComplete the notes below. Write ONE WORD ONLY for each answer.'], SCRIPT_4, html4, g4),
    ]


def listening_package() -> dict:
    media = [dict(key=f'part{n}_audio', kind='audio', fileName=f'listening-part-{n}.mp3', requiredForPublish=True,
                  description=f'Recording for Listening Part {n} — awaiting upload') for n in range(1, 5)]
    return dict(schemaVersion='1.0', packageId='bw-mock27-original-listening', revision=1, profile='full_mock', source=ORIGINAL_SOURCE,
                exam=dict(type='ielts_academic', title=EXAM_TITLE, description=DESCRIPTION, level='IELTS Academic', isDemo=False, price=0,
                          isFreeForApproved=True,
                          sections=[dict(key='listening', skill='listening', title='Listening', durationMinutes=30,
                                         instructions='The Listening test has four parts and 40 questions. You hear each recording once.',
                                         groups=groups())]),
                media=media, reviewIssues=[])
