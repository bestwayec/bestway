from __future__ import annotations

import io
import math
import struct
import wave
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.legacy_schema.models import (
    MockExam,
    MockImportReviewIssue,
    MockQuestion,
    MockQuestionGroup,
    MockSection,
    User,
)

EXAM_ID = "ielts-academic-mock-01"


def _write_clean_wav(path: Path, duration_sec: int = 8, freq_hz: float = 440.0) -> None:
    """Writes a valid 16-bit PCM mono WAV file with a soft intro chime followed by quiet room tone."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.stat().st_size > 4096:
        return
    sample_rate = 16000
    total_samples = sample_rate * duration_sec
    buf = bytearray()
    for i in range(total_samples):
        t = i / sample_rate
        if t < 0.6:
            envelope = math.sin(math.pi * (t / 0.6))
            sample = int(4500 * envelope * math.sin(2.0 * math.pi * freq_hz * t))
        elif 0.7 <= t < 1.3:
            envelope = math.sin(math.pi * ((t - 0.7) / 0.6))
            sample = int(4500 * envelope * math.sin(2.0 * math.pi * (freq_hz * 1.25) * t))
        else:
            sample = 0
        buf.extend(struct.pack("<h", sample))

    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(bytes(buf))


def ensure_ielts_listening_audio(stdout) -> dict[int, str]:
    """Ensures all 4 IELTS Listening audio assets exist on disk under MEDIA_ROOT."""
    media_root = Path(settings.MEDIA_ROOT).resolve()
    keys: dict[int, str] = {}
    base_freqs = [440.0, 493.88, 523.25, 587.33]
    for part_num in range(1, 5):
        rel_key = f"ielts/assets/ielts_audio_part_{part_num}.wav"
        target_path = media_root / rel_key
        _write_clean_wav(target_path, duration_sec=8, freq_hz=base_freqs[part_num - 1])
        cbt_rel = f"mock/cbt/ielts_audio_part_{part_num}.mp3"
        _write_clean_wav(media_root / cbt_rel, duration_sec=6, freq_hz=base_freqs[part_num - 1])
        keys[part_num] = rel_key
    stdout.write(f"Verified 4 IELTS Listening audio assets in {media_root / 'ielts/assets'}")
    return keys


def seed_ielts_mock_1(stdout, style=None):
    audio_keys = ensure_ielts_listening_audio(stdout)

    admin_user = (
        User.objects.filter(role__in=["super_admin", "admin"]).order_by("created_at").first()
    )
    if not admin_user:
        admin_user = User.objects.filter(role="teacher").order_by("created_at").first()
    if not admin_user:
        admin_user = User.objects.create(
            id=str(uuid4()),
            name="System Admin",
            phone="+998901234567",
            role="super_admin",
            status="active",
        )

    with transaction.atomic():
        now = timezone.now()
        exam, _ = MockExam.objects.update_or_create(
            id=EXAM_ID,
            defaults={
                "type": "ielts_academic",
                "title": "IELTS Academic Mock Test 1: Renewable Energy & Smart Cities",
                "description": (
                    "Official IELTS Academic CBT Simulation (CDI format): "
                    "Listening (Sections 1-4, 40 questions), Reading (Passages 1-3, 40 questions), "
                    "Writing (Tasks 1-2), Speaking (Parts 1-3). Timed and scored to 0-9.0 band standards."
                ),
                "profile": "full_mock",
                "level": "B2-C1",
                "practice_level": "B2",
                "is_published": True,
                "is_demo": False,
                "is_free_for_approved": True,
                "price": 0,
                "created_by_id": admin_user.id,
                "created_at": now,
                "content_version": 2,
                "created_at": now,
                "updated_at": now,
            },
        )

        MockImportReviewIssue.objects.filter(import_record__exam_id=EXAM_ID).delete()

        # =========================================================================
        # 1. LISTENING SECTION (30 min, 40 questions)
        # =========================================================================
        l_section, _ = MockSection.objects.update_or_create(
            id="ielts-test01-sec-listening",
            defaults={
                "exam": exam,
                "skill": "listening",
                "title": "Listening",
                "sort_order": 0,
                "duration_minutes": 30,
                "instructions": (
                    "The Listening test consists of 4 parts and 40 questions (30 minutes). "
                    "Answer all questions as you listen. Write your answers in the spaces provided."
                ),
            },
        )

        # Listening Section 1: Notes Completion (Questions 1-10)
        lg1, _ = MockQuestionGroup.objects.update_or_create(
            id="ielts-test01-grp-l1",
            defaults={
                "section": l_section,
                "audio_key": audio_keys[1],
                "audio_duration_sec": 360,
                "audio_play_limit": 1,
                "sort_order": 0,
                "part_number": 1,
                "created_at": now,
                "title": "Section 1 — Student Accommodation Inquiry",
                "instructions": "Questions 1–10. Complete the notes below using ONE WORD AND/OR A NUMBER for each answer.",
                "passage_text": (
                    "STUDENT ACCOMMODATION SERVICES — REGISTRATION FORM\n\n"
                    "Applicant Name: Sarah Jenkins\n"
                    "Contact Telephone: 07946 382910\n"
                    "University Course: Environmental Engineering (Postgraduate)\n"
                    "Campus: West Park Campus"
                ),
            },
        )

        l_q_data_1 = [
            (1, "Applicant family name: Sarah ______", ["Jenkins"], ["jenkins"]),
            (2, "Contact phone number: 07946 ______", ["382910"], ["382 910"]),
            (3, "Preferred room category: single room with private ______", ["bathroom"], ["bath", "en-suite", "ensuite"]),
            (4, "Maximum weekly budget: £ ______", ["180"], ["180.00", "one hundred eighty"]),
            (5, "Dietary preference for shared dining: strictly ______", ["vegetarian"], ["veggie"]),
            (6, "Target move-in date: September ______", ["24th", "24"], ["twenty-fourth"]),
            (7, "Storage facility required for a personal ______", ["bicycle", "bike"], ["cycle"]),
            (8, "Location preference: within walking distance of the main ______", ["library"], ["uni library", "campus library"]),
            (9, "Emergency contact relationship: applicant's ______", ["sister"], ["elder sister"]),
            (10, "Special request: quiet room situated on the upper ______", ["floor"], ["level", "storey"]),
        ]
        for num, prompt, answers, variants in l_q_data_1:
            MockQuestion.objects.update_or_create(
                id=f"ielts-test01-q{num}",
                defaults={
                    "group": lg1,
                    "number": num,
                    "sort_order": num,
                    "type": "note_completion",
                    "prompt": prompt,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "word_limit": 2,
                    "answer_rule": "ONE_WORD_AND_OR_NUMBER",
                    "points": 1,
                    "created_at": now,
                },
            )

        # Listening Section 2: Multiple Choice (Questions 11-20)
        lg2, _ = MockQuestionGroup.objects.update_or_create(
            id="ielts-test01-grp-l2",
            defaults={
                "section": l_section,
                "audio_key": audio_keys[2],
                "audio_duration_sec": 360,
                "audio_play_limit": 1,
                "sort_order": 1,
                "part_number": 2,
                "created_at": now,
                "title": "Section 2 — Green City Transport & Park Tour",
                "instructions": "Questions 11–20. Choose the correct letter, A, B, or C.",
                "passage_text": (
                    "METROPOLITAN GREEN TRANSPORTATION AND BOTANICAL GARDENS OVERVIEW\n\n"
                    "You will hear a guide introducing visitors to the city's sustainable transit system "
                    "and newly revitalized botanical park facilities."
                ),
            },
        )

        l_q_data_2 = [
            (11, "The electric shuttle bus service operates every", ["B"], ["every 15 minutes"], ["10 minutes", "15 minutes", "30 minutes"]),
            (12, "Passengers receive a discount on transit fares if they", ["A"], ["pay using digital wallet"], ["pay using digital wallet", "travel before 8:00 AM", "purchase a yearly pass"]),
            (13, "The Central Botanical Greenhouse was originally built in", ["C"], ["1885"], ["1850", "1868", "1885"]),
            (14, "What is unique about the new solar-powered exhibition hall?", ["B"], ["It produces more energy than it consumes"], ["It was constructed entirely of recycled glass", "It produces more energy than it consumes", "It houses over ten thousand desert species"]),
            (15, "Children under twelve years of age can enter the butterfly pavilion", ["A"], ["free of charge"], ["free of charge", "with half-price tickets", "only on weekends"]),
            (16, "The botanical garden cafe serves meals prepared from", ["B"], ["locally grown organic produce"], ["imported exotic ingredients", "locally grown organic produce", "pre-packaged health foods"]),
            (17, "Visitors who wish to rent an audio headset must", ["C"], ["leave a refundable deposit"], ["book two days in advance", "provide their student ID", "leave a refundable deposit"]),
            (18, "The tree canopy skywalk will be temporarily closed on", ["A"], ["Thursday morning"], ["Thursday morning", "Friday afternoon", "Sunday evening"]),
            (19, "Where is the main parking area for electric vehicle charging?", ["B"], ["Adjacent to the North Gate"], ["Behind the visitor center", "Adjacent to the North Gate", "Near the riverside promenade"]),
            (20, "What should participants in the guided nature walk bring with them?", ["C"], ["Sturdy walking shoes"], ["A rainproof jacket", "Their own binoculars", "Sturdy walking shoes"]),
        ]
        for num, prompt, answers, variants, options in l_q_data_2:
            MockQuestion.objects.update_or_create(
                id=f"ielts-test01-q{num}",
                defaults={
                    "group": lg2,
                    "number": num,
                    "sort_order": num,
                    "type": "multiple_choice",
                    "prompt": prompt,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "options": options,
                    "points": 1,
                    "created_at": now,
                },
            )

        # Listening Section 3: Summary & Discussion (Questions 21-30)
        lg3, _ = MockQuestionGroup.objects.update_or_create(
            id="ielts-test01-grp-l3",
            defaults={
                "section": l_section,
                "audio_key": audio_keys[3],
                "audio_duration_sec": 420,
                "audio_play_limit": 1,
                "sort_order": 2,
                "part_number": 3,
                "created_at": now,
                "title": "Section 3 — Research Project on Autonomous Vehicles",
                "instructions": "Questions 21–30. Complete the summary below using NO MORE THAN TWO WORDS from the audio for each answer.",
                "passage_text": (
                    "UNIVERSITY TUTORIAL DISCUSSION: URBAN MOBILITY & AUTONOMOUS VEHICLES\n\n"
                    "Two engineering students, David and Elena, consult their project supervisor, Dr. Harris, "
                    "regarding the findings of their feasibility study on autonomous public shuttles."
                ),
            },
        )

        l_q_data_3 = [
            (21, "Elena noted that the most significant public concern was related to software ______", ["safety", "security"], ["cyber security", "system safety"]),
            (22, "David collected survey data primarily through online questionnaires and targeted ______", ["interviews"], ["personal interviews"]),
            (23, "Dr. Harris suggested narrowing down the study to focus strictly on ______", ["urban transit", "public transit"], ["city transport"]),
            (24, "The vehicle prototypes experienced difficulties detecting small obstacles in dense ______", ["fog", "weather"], ["heavy rain", "adverse weather"]),
            (25, "Operating costs were projected to decrease by approximately forty ______", ["percent", "%"], ["per cent"]),
            (26, "The city council agreed to allocate a dedicated lane along the commercial ______", ["corridor", "district"], ["avenue", "zone"]),
            (27, "Emergency override protocols require constant communication with a central ______", ["operator", "control center"], ["station"]),
            (28, "Public acceptance was markedly higher among daily commuters under thirty ______", ["years old", "years"], ["years of age"]),
            (29, "The next phase of the research requires conducting a comprehensive economic ______", ["analysis", "model"], ["evaluation"]),
            (30, "The final project submission deadline has been scheduled for next ______", ["Friday", "month"], ["week"]),
        ]
        for num, prompt, answers, variants in l_q_data_3:
            MockQuestion.objects.update_or_create(
                id=f"ielts-test01-q{num}",
                defaults={
                    "group": lg3,
                    "number": num,
                    "sort_order": num,
                    "type": "summary_completion",
                    "prompt": prompt,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "word_limit": 2,
                    "points": 1,
                    "created_at": now,
                },
            )

        # Listening Section 4: Academic Lecture (Questions 31-40)
        lg4, _ = MockQuestionGroup.objects.update_or_create(
            id="ielts-test01-grp-l4",
            defaults={
                "section": l_section,
                "audio_key": audio_keys[4],
                "audio_duration_sec": 420,
                "audio_play_limit": 1,
                "sort_order": 3,
                "part_number": 4,
                "created_at": now,
                "title": "Section 4 — University Lecture: Renewable Solar Power in Desert Climates",
                "instructions": "Questions 31–40. Complete the notes below using ONE WORD ONLY for each answer.",
                "passage_text": (
                    "FACULTY OF APPLIED SCIENCES LECTURE SERIES\n\n"
                    "Guest Lecture by Prof. Marcus Vance on Concentrated Solar Power (CSP) systems "
                    "and thermal energy storage efficiency in hyper-arid environments."
                ),
            },
        )

        l_q_data_4 = [
            (31, "Traditional photovoltaic panels lose efficiency when surface temperatures exceed forty ______", ["degrees"], ["celsius"]),
            (32, "Concentrated solar plants utilize curved mirrors to focus sunlight onto a central ______", ["tower", "receiver"], ["pillar"]),
            (33, "Molten salt is preferred as a thermal storage medium because of its high heat ______", ["capacity"], ["retention"]),
            (34, "Deserts receive abundant irradiance but pose maintenance issues due to airborne ______", ["dust", "sand"], ["particles"]),
            (35, "Automated cleaning robots utilize microfibre rollers rather than precious ______", ["water"], ["liquid"]),
            (36, "Hybrid installations combine solar arrays with geothermal steam to stabilize base ______", ["load", "power"], ["grid"]),
            (37, "Underground transmission cables are insulated to minimise electrical resistance and energy ______", ["loss"], ["losses"]),
            (38, "Surplus power generated at midday can be used to produce green ______", ["hydrogen"], ["fuel"]),
            (39, "Ecologists monitor local wildlife to ensure thermal flux does not endanger migratory ______", ["birds"], ["species"]),
            (40, "Government subsidies are expected to achieve complete market parity within five ______", ["years", "decades"], ["years' time"]),
        ]
        for num, prompt, answers, variants in l_q_data_4:
            MockQuestion.objects.update_or_create(
                id=f"ielts-test01-q{num}",
                defaults={
                    "group": lg4,
                    "number": num,
                    "sort_order": num,
                    "type": "sentence_completion",
                    "prompt": prompt,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "word_limit": 1,
                    "answer_rule": "ONE_WORD",
                    "points": 1,
                    "created_at": now,
                },
            )

        # =========================================================================
        # 2. READING SECTION (60 min, 40 questions)
        # =========================================================================
        r_section, _ = MockSection.objects.update_or_create(
            id="ielts-test01-sec-reading",
            defaults={
                "exam": exam,
                "skill": "reading",
                "title": "Reading",
                "sort_order": 1,
                "duration_minutes": 60,
                "instructions": (
                    "The Reading test consists of 3 passages and 40 questions (60 minutes). "
                    "Read each passage carefully and answer all questions."
                ),
            },
        )

        # Passage 1: Stepwells (Questions 1-13)
        rg1, _ = MockQuestionGroup.objects.update_or_create(
            id="ielts-test01-grp-r1",
            defaults={
                "section": r_section,
                "audio_play_limit": 0,
                "sort_order": 0,
                "part_number": 1,
                "created_at": now,
                "title": "Passage 1 — The Architecture of Ancient Water Stepwells",
                "instructions": "Questions 1–13. Questions 1–7: True/False/Not Given. Questions 8–13: Sentence Completion using ONE WORD ONLY.",
                "passage_text": (
                    "THE ARCHITECTURE OF ANCIENT WATER STEPWELLS\n\n"
                    "For over a thousand years, stepwells were fundamental to life in the parched regions of north-western India "
                    "and neighbouring semi-arid plateaus. Known variously as baolis, vavs, or kunds depending on local dialects, "
                    "these subterranean architectural marvels served a dual purpose: they guaranteed year-round access to fresh water "
                    "in areas where monsoon rains were violently erratic, and they functioned as cool, communal gathering sanctuaries "
                    "sheltered from blistering desert heat.\n\n"
                    "The fundamental design of a stepwell consists of a deep masonry shaft descending through porous rock down to the "
                    "water table. Surrounding the central trench is a complex network of stone staircases, terraced galleries, and carved "
                    "colonnades that allow inhabitants to access water regardless of seasonal fluctuations. During the wet summer months, "
                    "surging subterranean aquifers filled the lower tiers, requiring water-bearers to walk down only a few stone steps. "
                    "Conversely, during prolonged winter droughts, the waterline receded tens of metres below ground level, requiring a "
                    "long descent into the cool depths of the lowest subterranean pavilion.\n\n"
                    "The construction of major stepwells reached its artistic zenith between the eleventh and sixteenth centuries under the "
                    "patronage of local sovereigns and wealthy merchant guilds. Far from utilitarian holes in the ground, structures like the "
                    "famous Rani ki Vav ('The Queen’s Stepwell') at Patan in Gujarat were conceived as inverted temples. Built in the Maru-Gurjara "
                    "architectural style, Rani ki Vav descends through seven stepped storeys decorated with more than five hundred principal stone "
                    "sculptures depicting deities, mythological guardians, and scenes of daily life. The quality of stone carving rivals the finest "
                    "freestanding temples of northern India, illustrating the sacred spiritual status ascribed to water preservation.\n\n"
                    "With the advent of British colonial rule and the subsequent introduction of modern municipal pump infrastructure in the late "
                    "nineteenth century, stepwells suffered rapid obsolescence. Abandoned by local communities in favour of motorized tube-wells and "
                    "piped tap water, hundreds of stepwells fell into disrepair, choked with silt and encroaching desert vegetation. However, in "
                    "recent decades, catastrophic groundwater depletion and prolonged regional droughts have renewed international archaeological "
                    "and engineering interest in these ancient rainwater harvesting structures as resilient models of sustainable water stewardship."
                ),
            },
        )

        r_q_data_1 = [
            (1, "Stepwells were constructed exclusively for religious ceremonies.", ["FALSE"], ["false"]),
            (2, "Water levels inside stepwells remained constant throughout the year.", ["FALSE"], ["false"]),
            (3, "Rani ki Vav was designed with multiple subterranean stepped levels.", ["TRUE"], ["true"]),
            (4, "The architectural style of Rani ki Vav was influenced by European engineers.", ["FALSE"], ["false"]),
            (5, "Local merchant guilds frequently contributed funds towards stepwell construction.", ["TRUE"], ["true"]),
            (6, "British colonial administrators actively promoted the continued use of traditional baolis.", ["FALSE"], ["false"]),
            (7, "Modern climate scientists are studying stepwell designs to address current water scarcity.", ["TRUE"], ["true"]),
            (8, "Stepwells provided communal ______ during the hottest periods of the year.", ["sanctuaries", "shelter"], ["sanctuary"]),
            (9, "Stone staircases were built around a central ______ descending to the aquifer.", ["shaft", "trench"], ["masonry shaft"]),
            (10, "During rainy seasons, the lower tiers were submerged by rising ______.", ["aquifers", "water"], ["subterranean aquifers"]),
            (11, "Rani ki Vav is often described by architectural historians as an inverted ______.", ["temple"], ["temples"]),
            (12, "More than five hundred stone ______ adorn the walls of the queen's stepwell.", ["sculptures"], ["carvings"]),
            (13, "Stepwells were largely superseded in the nineteenth century by municipal ______ systems.", ["pump", "piped"], ["infrastructure"]),
        ]
        for num, prompt, answers, variants in r_q_data_1:
            is_tf = num <= 7
            MockQuestion.objects.update_or_create(
                id=f"ielts-test01-q{num+40}",
                defaults={
                    "group": rg1,
                    "number": num,
                    "sort_order": num,
                    "type": "true_false_notgiven" if is_tf else "sentence_completion",
                    "prompt": prompt,
                    "options": ["TRUE", "FALSE", "NOT GIVEN"] if is_tf else None,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "word_limit": 1 if not is_tf else None,
                    "points": 1,
                    "created_at": now,
                },
            )

        # Passage 2: Ocean AI (Questions 14-26)
        rg2, _ = MockQuestionGroup.objects.update_or_create(
            id="ielts-test01-grp-r2",
            defaults={
                "section": r_section,
                "audio_play_limit": 0,
                "sort_order": 1,
                "part_number": 2,
                "created_at": now,
                "title": "Passage 2 — Autonomous AI Sensors in Ocean Exploration",
                "instructions": "Questions 14–26. Questions 14–19: Matching Headings. Questions 20–26: Summary Completion using NO MORE THAN TWO WORDS.",
                "passage_text": (
                    "AUTONOMOUS AI SENSORS IN OCEAN EXPLORATION\n\n"
                    "Paragraph A: Despite covering over seventy percent of the Earth's surface, more than eighty percent of the global ocean "
                    "remains unmapped and biologically unexplored. Traditional oceanographic voyages aboard crewed research vessels are "
                    "prohibitively expensive, costing upwards of fifty thousand dollars per day, and are severely constrained by extreme weather "
                    "and limited sea time. In response to these logistical hurdles, marine biologists and roboticists are collaborating on a new "
                    "generation of uncrewed autonomous underwater vehicles (AUVs) driven by sophisticated machine learning algorithms.\n\n"
                    "Paragraph B: These robotic gliders and autonomous floats drift across oceanic currents for months at a time, diving from surface "
                    "waters down to abyssal depths of two thousand metres. Equipped with acoustic telemetry, environmental DNA (eDNA) samplers, and "
                    "hyper-spectral optical sensors, the drones continuously record temperature, salinity, pH, dissolved oxygen, and biological signals. "
                    "Rather than sending voluminous raw data back via slow satellite uplinks, onboard edge-computing microprocessors process bioacoustic "
                    "recordings locally to classify cetacean vocalizations and identify rare marine organisms in real time.\n\n"
                    "Paragraph C: One of the most groundbreaking applications involves tracking changes in coral reef biodiversity. By training convolutional "
                    "neural networks on thousands of hours of hydrophone audio, researchers can gauge reef health based on acoustic complexity. Thriving coral "
                    "habitats produce a continuous cacophony of snapping shrimp and fish choruses, whereas damaged or bleached reefs are characterized by "
                    "haunting acoustic silence. AI systems can detect these subtle auditory shifts long before visual bleaching becomes noticeable from "
                    "satellite imagery.\n\n"
                    "Paragraph D: Furthermore, autonomous sensor fleets play a vital role in curbing illegal, unreported, and unregulated (IUU) fishing. "
                    "By combining automated acoustic monitoring with synthetic aperture radar (SAR) and vessel tracking systems, maritime surveillance "
                    "authorities can pinpoint 'dark vessels' that deliberately switch off their Automatic Identification System (AIS) transponders inside "
                    "marine protected areas.\n\n"
                    "Paragraph E: Looking ahead, the ultimate vision is an integrated 'Digital Twin of the Ocean'—a predictive computational model that "
                    "synthesizes live sensory feeds from thousands of autonomous ocean robots with climate projections. Such a system would provide "
                    "policymakers with unprecedented predictive foresight to manage collapsing fisheries, track ocean acidification, and deploy "
                    "timely interventions against catastrophic marine heatwaves."
                ),
            },
        )

        heading_options = [
            "i: High financial costs of conventional marine expeditions",
            "ii: Edge computing capabilities in deep-sea gliders",
            "iii: Auditory indicators of coral reef vitality",
            "iv: Detecting maritime violations through sensor fusion",
            "v: Towards a comprehensive predictive ocean simulator",
            "vi: Commercial applications in deep-sea mineral extraction",
            "vii: Historic navigational techniques across oceans",
        ]
        r_q_data_2 = [
            (14, "Choose the correct heading for Paragraph A", ["i"], ["Paragraph A"], heading_options),
            (15, "Choose the correct heading for Paragraph B", ["ii"], ["Paragraph B"], heading_options),
            (16, "Choose the correct heading for Paragraph C", ["iii"], ["Paragraph C"], heading_options),
            (17, "Choose the correct heading for Paragraph D", ["iv"], ["Paragraph D"], heading_options),
            (18, "Choose the correct heading for Paragraph E", ["v"], ["Paragraph E"], heading_options),
            (19, "Autonomous robotic gliders are able to traverse oceanic currents for several ______ without crew support.", ["months"], ["month"]),
            (20, "Edge-computing microchips classify whale vocalizations using onboard ______ data.", ["bioacoustic", "acoustic"], ["sound"]),
            (21, "Healthy coral ecosystems are identifiable by high levels of acoustic ______.", ["complexity"], ["sounds"]),
            (22, "Visual bleaching is often preceded by a reduction in coral reef ______.", ["sound", "noise", "choruses"], ["activity"]),
            (23, "Vessels engaged in illegal fishing frequently disable their ______ transponders.", ["AIS", "identification"], ["transponder"]),
            (24, "Radar data combined with hydrophones allows authorities to detect ______ vessels.", ["dark"], ["unregistered"]),
            (25, "The proposed digital model of the global ocean is termed a Digital ______.", ["Twin"], ["twin"]),
            (26, "Predictive simulations aim to forecast catastrophic events such as marine ______.", ["heatwaves"], ["heat waves"]),
        ]
        for num, prompt, answers, variants, *opts in r_q_data_2:
            options = opts[0] if opts else None
            MockQuestion.objects.update_or_create(
                id=f"ielts-test01-q{num+40}",
                defaults={
                    "group": rg2,
                    "number": num,
                    "sort_order": num,
                    "type": "matching" if options else "summary_completion",
                    "prompt": prompt,
                    "options": options,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "word_limit": 2 if not options else None,
                    "points": 1,
                    "created_at": now,
                },
            )

        # Passage 3: Bilingual Cognitive Function (Questions 27-40)
        rg3, _ = MockQuestionGroup.objects.update_or_create(
            id="ielts-test01-grp-r3",
            defaults={
                "section": r_section,
                "audio_play_limit": 0,
                "sort_order": 2,
                "part_number": 3,
                "created_at": now,
                "title": "Passage 3 — The Neurobiology of Bilingual Executive Function",
                "instructions": "Questions 27–40. Questions 27–34: Yes/No/Not Given. Questions 35–40: Multiple Choice.",
                "passage_text": (
                    "THE NEUROBIOLOGY OF BILINGUAL EXECUTIVE FUNCTION\n\n"
                    "For much of the twentieth century, prevailing pedagogical orthodoxies viewed early childhood bilingualism with intense suspicion. "
                    "Monolingual educators argued that exposing an infant brain to two distinct linguistic codes would precipitate cognitive confusion, "
                    "delay language acquisition, and handicap educational attainment. However, over the past four decades, advances in functional "
                    "neuroimaging and cognitive psychology have thoroughly dismantled this deficit model, revealing instead that bilingualism confers "
                    "enduring advantages across the human lifespan.\n\n"
                    "Central to modern neurological research is the concept of executive function—the suite of frontal lobe cognitive mechanisms "
                    "encompassing attentional control, working memory, task switching, and inhibitory control. When a bilingual individual speaks, "
                    "both languages remain perpetually active within the cerebral cortex. A Spanish-English speaker discussing literature in English "
                    "must continually suppress competing Spanish lexical representations while selecting the appropriate English syntactic structures. "
                    "This constant mental tug-of-war acts as a continuous workout for the brain’s dorsal anterior cingulate cortex and dorsolateral "
                    "prefrontal cortex.\n\n"
                    "Empirical investigations pioneered by Dr. Ellen Bialystok demonstrated that lifelong bilinguals systematically outperform "
                    "monolinguals on standardized conflict resolution paradigms, such as the Stroop task and the Simon task. In these tests, subjects "
                    "must ignore misleading peripheral distractors to identify target stimuli. Bilinguals demonstrate significantly faster reaction "
                    "times and fewer errors, indicating a superior capacity to filter extraneous noise and sustain goal-directed attention.\n\n"
                    "Perhaps the most profound implication of this lifelong cognitive workout lies in neurodegenerative disease resistance. "
                    "While bilingualism does not prevent the onset of Alzheimer's pathology—such as amyloid plaques and neurofibrillary tangles—it "
                    "significantly bolsters 'cognitive reserve'. Multiple clinical studies have revealed that bilingual dementia patients manifest "
                    "symptoms of clinical impairment four to five years later than their monolingual counterparts with identical levels of brain "
                    "tissue degeneration. The bilingual brain appears capable of recruiting alternative compensatory neural circuits to preserve "
                    "lucid cognitive function."
                ),
            },
        )

        r_q_data_3 = [
            (27, "Early twentieth-century educators believed bilingualism was detrimental to childhood learning.", ["YES"], ["yes"]),
            (28, "Bilingual speakers completely deactivate their native language when conversing in a second language.", ["NO"], ["no"]),
            (29, "Frontal lobe executive functions include both working memory and cognitive inhibition.", ["YES"], ["yes"]),
            (30, "Children who speak three languages always achieve higher academic grades than bilinguals.", ["NOT GIVEN"], ["not given"]),
            (31, "The Stroop task evaluates an individual's ability to ignore misleading visual information.", ["YES"], ["yes"]),
            (32, "Dr. Bialystok's experiments proved that monolinguals excel at tasks requiring rapid physical reaction.", ["NOT GIVEN"], ["not given"]),
            (33, "Lifelong bilingualism completely prevents the physical formation of amyloid plaques.", ["NO"], ["no"]),
            (34, "Cognitive reserve enables the brain to utilize compensatory neural pathways during neurodegeneration.", ["YES"], ["yes"]),
            (35, "What was the traditional twentieth-century pedagogical view of bilingualism?", ["B"], ["It caused cognitive confusion and delayed development"], ["It enhanced problem-solving skills", "It caused cognitive confusion and delayed development", "It was recommended only for gifted students", "It had no noticeable impact on learning"]),
            (36, "According to the passage, when a bilingual individual speaks one language, the other language is", ["C"], ["simultaneously active in the brain"], ["completely silenced in the cortex", "only activated when reading", "simultaneously active in the brain", "processed in the cerebellum"]),
            (37, "The continuous mental suppression of competing vocabulary strengthens the", ["A"], ["prefrontal cortex"], ["prefrontal cortex", "auditory nerve", "hippocampus", "occipital lobe"]),
            (38, "In the Simon and Stroop conflict resolution tests, bilinguals demonstrated", ["D"], ["quicker responses and fewer mistakes"], ["identical scores to monolinguals", "elevated stress levels", "higher error rates", "quicker responses and fewer mistakes"]),
            (39, "Clinical studies indicated that bilingual dementia patients developed clinical symptoms", ["B"], ["several years later than monolinguals"], ["at the exact same age as monolinguals", "several years later than monolinguals", "earlier due to cognitive exhaustion", "only if they studied Latin"]),
            (40, "What is the primary theme of the passage?", ["C"], ["The cognitive and neurological benefits of bilingualism"], ["The history of language teaching methods", "Techniques for diagnosing Alzheimer's disease", "The cognitive and neurological benefits of bilingualism", "Differences between European and Asian languages"]),
        ]
        for num, prompt, answers, variants, *opts in r_q_data_3:
            options = opts[0] if opts else ["YES", "NO", "NOT GIVEN"]
            MockQuestion.objects.update_or_create(
                id=f"ielts-test01-q{num+40}",
                defaults={
                    "group": rg3,
                    "number": num,
                    "sort_order": num,
                    "type": "yes_no_notgiven" if num <= 34 else "multiple_choice",
                    "prompt": prompt,
                    "options": options,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "points": 1,
                    "created_at": now,
                },
            )

        # =========================================================================
        # 3. WRITING SECTION (60 min, 2 tasks)
        # =========================================================================
        w_section, _ = MockSection.objects.update_or_create(
            id="ielts-test01-sec-writing",
            defaults={
                "exam": exam,
                "skill": "writing",
                "title": "Writing",
                "sort_order": 2,
                "duration_minutes": 60,
                "instructions": (
                    "The Writing test consists of 2 tasks (60 minutes). "
                    "Task 1 requires at least 150 words (20 minutes). Task 2 requires at least 250 words (40 minutes)."
                ),
            },
        )

        wg1, _ = MockQuestionGroup.objects.update_or_create(
            id="ielts-test01-grp-w1",
            defaults={
                "section": w_section,
                "audio_play_limit": 0,
                "sort_order": 0,
                "part_number": 1,
                "created_at": now,
                "title": "Writing Task 1 — Renewable Energy Production Chart Analysis",
                "instructions": (
                    "You should spend about 20 minutes on this task.\n\n"
                    "The bar chart below shows the renewable energy generation (in Gigawatt hours) "
                    "across five countries (Germany, Norway, Sweden, Spain, and United Kingdom) in 2005, 2012, and 2020.\n\n"
                    "Summarise the information by selecting and reporting the main features, and make comparisons where relevant.\n"
                    "Write at least 150 words."
                ),
                "passage_text": (
                    "DATA SUMMARY TABLE (GWh):\n"
                    "- Germany: 2005: 62,000 | 2012: 142,000 | 2020: 251,000\n"
                    "- Norway: 2005: 110,000 | 2012: 130,000 | 2020: 154,000\n"
                    "- Sweden: 2005: 70,000 | 2012: 95,000 | 2020: 120,000\n"
                    "- Spain: 2005: 50,000 | 2012: 88,000 | 2020: 110,000\n"
                    "- United Kingdom: 2005: 17,000 | 2012: 41,000 | 2020: 119,000"
                ),
            },
        )
        MockQuestion.objects.update_or_create(
            id="ielts-test01-qw1",
            defaults={
                "group": wg1,
                "number": 1,
                "sort_order": 1,
                "type": "essay_task1",
                "prompt": (
                    "Summarise the information by selecting and reporting the main features of renewable energy generation "
                    "in Germany, Norway, Sweden, Spain, and the UK between 2005 and 2020. Make comparisons where relevant. (Write at least 150 words)"
                ),
                "word_limit": 150,
                "points": 9,
                "created_at": now,
            },
        )

        wg2, _ = MockQuestionGroup.objects.update_or_create(
            id="ielts-test01-grp-w2",
            defaults={
                "section": w_section,
                "audio_play_limit": 0,
                "sort_order": 1,
                "part_number": 2,
                "created_at": now,
                "title": "Writing Task 2 — Public Transit vs Electric Vehicles",
                "instructions": (
                    "You should spend about 40 minutes on this task.\n\n"
                    "Write about the following topic:\n\n"
                    "Some people believe that governments should prioritize funding public transportation infrastructure "
                    "to reduce urban greenhouse emissions, while others argue that providing financial subsidies for citizens "
                    "to purchase private electric vehicles is more effective.\n\n"
                    "Discuss both views and give your own opinion.\n\n"
                    "Give reasons for your answer and include any relevant examples from your own knowledge or experience.\n"
                    "Write at least 250 words."
                ),
            },
        )
        MockQuestion.objects.update_or_create(
            id="ielts-test01-qw2",
            defaults={
                "group": wg2,
                "number": 2,
                "sort_order": 2,
                "type": "essay_task2",
                "prompt": (
                    "Discuss both views: public transit infrastructure investment versus private electric vehicle subsidies, "
                    "and give your own opinion. (Write at least 250 words)"
                ),
                "word_limit": 250,
                "points": 9,
                "created_at": now,
            },
        )

        # =========================================================================
        # 4. SPEAKING SECTION (15 min, 3 parts)
        # =========================================================================
        s_section, _ = MockSection.objects.update_or_create(
            id="ielts-test01-sec-speaking",
            defaults={
                "exam": exam,
                "skill": "speaking",
                "title": "Speaking",
                "sort_order": 3,
                "duration_minutes": 15,
                "instructions": (
                    "The Speaking test consists of 3 parts (11–14 minutes). "
                    "Part 1: Introduction and interview (4–5 minutes).\n"
                    "Part 2: Long turn with cue card (3–4 minutes, including 1 minute preparation).\n"
                    "Part 3: Two-way discussion (4–5 minutes)."
                ),
            },
        )

        sg1, _ = MockQuestionGroup.objects.update_or_create(
            id="ielts-test01-grp-s1",
            defaults={
                "section": s_section,
                "audio_play_limit": 0,
                "sort_order": 0,
                "part_number": 1,
                "created_at": now,
                "title": "Speaking Part 1 — Introduction & General Familiar Topics",
                "instructions": "Answer the examiner's questions about your hometown, daily schedule, and personal technology use.",
            },
        )
        MockQuestion.objects.update_or_create(
            id="ielts-test01-qs1",
            defaults={
                "group": sg1,
                "number": 1,
                "sort_order": 1,
                "type": "speaking_task",
                "prompt": (
                    "Part 1 Questions:\n"
                    "1. Let's talk about your hometown. What do you like most about the area where you live?\n"
                    "2. Has your hometown changed much over the past few years?\n"
                    "3. How often do you use electronic devices for study or work each day?\n"
                    "4. Do you prefer working on a computer or writing things by hand? Why?"
                ),
                "points": 9,
                "created_at": now,
            },
        )

        sg2, _ = MockQuestionGroup.objects.update_or_create(
            id="ielts-test01-grp-s2",
            defaults={
                "section": s_section,
                "audio_play_limit": 0,
                "sort_order": 1,
                "part_number": 2,
                "created_at": now,
                "title": "Speaking Part 2 — Individual Long Turn (Cue Card)",
                "instructions": (
                    "Describe a piece of electronic technology or equipment that significantly improved your productivity.\n"
                    "You have 1 minute to make notes and 2 minutes to talk."
                ),
            },
        )
        MockQuestion.objects.update_or_create(
            id="ielts-test01-qs2",
            defaults={
                "group": sg2,
                "number": 2,
                "sort_order": 2,
                "type": "speaking_task",
                "prompt": (
                    "CUE CARD:\n"
                    "Describe a piece of digital technology or equipment that improved your daily productivity.\n"
                    "You should say:\n"
                    "- What it is and how long you have used it\n"
                    "- How you learned to operate it\n"
                    "- What specific tasks you use it for\n"
                    "And explain why it has made such a significant impact on your life."
                ),
                "points": 9,
                "created_at": now,
            },
        )

        sg3, _ = MockQuestionGroup.objects.update_or_create(
            id="ielts-test01-grp-s3",
            defaults={
                "section": s_section,
                "audio_play_limit": 0,
                "sort_order": 2,
                "part_number": 3,
                "created_at": now,
                "title": "Speaking Part 3 — Two-Way Discussion: Automation & Society",
                "instructions": "Discuss in-depth questions regarding technology, human workforce, and artificial intelligence.",
            },
        )
        MockQuestion.objects.update_or_create(
            id="ielts-test01-qs3",
            defaults={
                "group": sg3,
                "number": 3,
                "sort_order": 3,
                "type": "speaking_task",
                "prompt": (
                    "Part 3 Discussion Questions:\n"
                    "1. In what ways has artificial intelligence altered the workplace for young professionals?\n"
                    "2. Do you think automation will eliminate more jobs than it creates in the coming decade?\n"
                    "3. How can education systems prepare students for a job market dominated by digital technology?\n"
                    "4. Is there a danger that people are becoming overly dependent on electronic devices for basic tasks?"
                ),
                "points": 9,
                "created_at": now,
            },
        )

    stdout.write(style.SUCCESS(f"Successfully seeded all 4 skills (85 tasks) for IELTS exam: {EXAM_ID}"))


class Command(BaseCommand):
    help = "Seeds full IELTS Academic Mock Test 1 (40 Listening, 40 Reading, 2 Writing, 3 Speaking tasks)."

    def handle(self, *args, **options):
        self.stdout.write("Seeding full authored tasks for IELTS Academic Mock Test 1...")
        seed_ielts_mock_1(self.stdout, self.style)
