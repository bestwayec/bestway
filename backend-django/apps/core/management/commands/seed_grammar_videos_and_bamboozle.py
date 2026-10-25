"""Django Management Command to Seed Grammar Video Lessons & Error-Free Bamboozle Quizzes."""

import uuid
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.core.models import CardType, Course, Lesson, QuizCard, QuizDeck
from apps.legacy_schema.models import User, VideoLesson


class Command(BaseCommand):
    help = "Seed Grammar Video Lessons (Nouns to Articles) and 100% Error-Free Bamboozle Quiz Decks."

    def handle(self, *args, **options):
        self.stdout.write("Starting Grammar Lessons & Bamboozle Quiz Seeding...")

        with transaction.atomic():
            # 1. Course Creation / Update
            course, _ = Course.objects.update_or_create(
                title="English Grammar Foundation: Nouns to Articles",
                defaults={
                    "description": "Ingliz tili grammatikasining asosiy bo'limlari: video darslar va jamoaviy Bamboozle bellashuvlari.",
                    "thumbnail_url": "/static/images/grammar_foundation.jpg",
                },
            )
            self.stdout.write(f"Course ready: {course.title} ({course.id})")

            # 2. System / Admin user for created_by
            admin_user = User.objects.filter(role__in=["admin", "super_admin"]).first()

            # 3. Lessons Data
            lessons_meta = [
                {
                    "title": "1. Nouns: Countable, Uncountable & Plural Forms",
                    "description": "Sanaladigan va sanalmaydigan otlar, ko'plik shakllari, irregular plurals va egalik kelishigi (-'s / -s').",
                    "duration": 1337,
                    "order_index": 1,
                    "video_file": "videos/grammar/1_nouns.mp4",
                    "deck_title": "Nouns (Otlar — Countable, Uncountable & Plurals)",
                    "category": "Grammar",
                    "cards": [
                        {"points": 10, "text": "Choose the correct plural form of 'child':", "options": ["children", "childs", "childrens", "childes"], "correct": "children", "type": CardType.QUESTION},
                        {"points": 10, "text": "Which of the following nouns is UNCOUNTABLE?", "options": ["furniture", "chair", "table", "coin"], "correct": "furniture", "type": CardType.QUESTION},
                        {"points": 0, "text": "🔄 SYURPRIZ: Ballarni Almashtirish (Swap)!", "options": [], "correct": "", "type": CardType.SWAP},
                        {"points": 15, "text": "Choose the grammatically correct sentence:", "options": ["The news is very surprising.", "The news are very surprising.", "A news is very surprising.", "Many news are very surprising."], "correct": "The news is very surprising.", "type": CardType.QUESTION},
                        {"points": 20, "text": "What is the plural form of 'phenomenon'?", "options": ["phenomena", "phenomenons", "phenomenas", "phenomeni"], "correct": "phenomena", "type": CardType.QUESTION},
                        {"points": 15, "text": "Choose the correct possessive form: 'The ___ toys are in the box.' (two boys)", "options": ["boys'", "boy's", "boys's", "boys"], "correct": "boys'", "type": CardType.QUESTION},
                        {"points": 0, "text": "🥷 SYURPRIZ: Raqibdan 15 Ball O'g'irlash (Steal)!", "options": [], "correct": "", "type": CardType.STEAL},
                        {"points": 10, "text": "How ___ information did you get from the report?", "options": ["much", "many", "few", "a few"], "correct": "much", "type": CardType.QUESTION},
                        {"points": 15, "text": "Which pair of nouns has the SAME singular and plural form?", "options": ["sheep / sheep", "tooth / teeth", "ox / oxen", "mouse / mice"], "correct": "sheep / sheep", "type": CardType.QUESTION},
                        {"points": 10, "text": "Choose the correct plural form of 'knife':", "options": ["knives", "knifes", "knifees", "knivs"], "correct": "knives", "type": CardType.QUESTION},
                        {"points": 0, "text": "⚡️ SYURPRIZ: 2x Multiplier Ball!", "options": [], "correct": "", "type": CardType.DOUBLE},
                        {"points": 20, "text": "All of the following are uncountable nouns EXCEPT:", "options": ["suitcase", "luggage", "baggage", "advice"], "correct": "suitcase", "type": CardType.QUESTION},
                        {"points": 15, "text": "Choose the correct noun form: 'Her ___ of English surprised everyone.'", "options": ["knowledge", "knowledges", "knowledging", "knowledged"], "correct": "knowledge", "type": CardType.QUESTION},
                        {"points": 20, "text": "Choose the correct plural form of 'crisis':", "options": ["crises", "crisises", "crisis", "crisi"], "correct": "crises", "type": CardType.QUESTION},
                        {"points": 0, "text": "💣 BOMBA: -15 Ball Jarima!", "options": [], "correct": "", "type": CardType.BOMB},
                        {"points": 15, "text": "Choose the correct verb form: 'These scissors ___ very sharp.'", "options": ["are", "is", "was", "has been"], "correct": "are", "type": CardType.QUESTION},
                    ],
                },
                {
                    "title": "2. Noun Test & Practical Analysis",
                    "description": "Otlar va asosiy grammatik strukturalar bo'yicha amaliy test tahlili va eng keng tarqalgan xatolar.",
                    "duration": 446,
                    "order_index": 2,
                    "video_file": "videos/grammar/1_1_noun_test.mp4",
                    "deck_title": "Noun Test & Practical Mastery",
                    "category": "Grammar",
                    "cards": [
                        {"points": 10, "text": "Choose the correct noun form: 'I need some ___ on this issue.'", "options": ["advice", "advices", "advises", "advicing"], "correct": "advice", "type": CardType.QUESTION},
                        {"points": 15, "text": "Choose the correct plural: 'passer-by' ->", "options": ["passers-by", "passer-bys", "passers-bys", "passer-byes"], "correct": "passers-by", "type": CardType.QUESTION},
                        {"points": 0, "text": "🔄 SYURPRIZ: Ballarni Almashtirish (Swap)!", "options": [], "correct": "", "type": CardType.SWAP},
                        {"points": 15, "text": "'The police ___ looking for the missing wallet.'", "options": ["are", "is", "was", "has"], "correct": "are", "type": CardType.QUESTION},
                        {"points": 20, "text": "Plural form of 'criterion' is:", "options": ["criteria", "criterions", "criterias", "criterii"], "correct": "criteria", "type": CardType.QUESTION},
                        {"points": 10, "text": "Which word is ALWAYS singular?", "options": ["information", "clothes", "glasses", "trousers"], "correct": "information", "type": CardType.QUESTION},
                        {"points": 0, "text": "🥷 SYURPRIZ: Raqibdan 15 Ball O'g'irlash (Steal)!", "options": [], "correct": "", "type": CardType.STEAL},
                        {"points": 15, "text": "'A ten-___ walk' (compound adjective rule):", "options": ["minute", "minutes", "minute's", "minutes'"], "correct": "minute", "type": CardType.QUESTION},
                        {"points": 10, "text": "Plural form of 'leaf':", "options": ["leaves", "leafs", "leafes", "leavs"], "correct": "leaves", "type": CardType.QUESTION},
                        {"points": 15, "text": "'Mathematics ___ my favorite subject in school.'", "options": ["is", "are", "were", "have been"], "correct": "is", "type": CardType.QUESTION},
                        {"points": 0, "text": "⚡️ SYURPRIZ: 2x Multiplier Ball!", "options": [], "correct": "", "type": CardType.DOUBLE},
                        {"points": 20, "text": "Plural of 'mother-in-law':", "options": ["mothers-in-law", "mother-in-laws", "mothers-in-laws", "mother-ins-law"], "correct": "mothers-in-law", "type": CardType.QUESTION},
                        {"points": 10, "text": "Which noun is countable?", "options": ["sandwich", "bread", "butter", "traffic"], "correct": "sandwich", "type": CardType.QUESTION},
                        {"points": 15, "text": "'Where ___ my glasses? I can't find them.'", "options": ["are", "is", "was", "has been"], "correct": "are", "type": CardType.QUESTION},
                        {"points": 0, "text": "💣 BOMBA: -15 Ball Jarima!", "options": [], "correct": "", "type": CardType.BOMB},
                        {"points": 20, "text": "Plural form of 'goose':", "options": ["geese", "gooses", "geeses", "goosies"], "correct": "geese", "type": CardType.QUESTION},
                    ],
                },
                {
                    "title": "3. Adjectives & Degrees of Comparison",
                    "description": "Sifat darajalari (Positive, Comparative, Superlative), sifatlar tartibi (OSASCOMP) va istisno shakllar.",
                    "duration": 1124,
                    "order_index": 3,
                    "video_file": "videos/grammar/2_adjectives.mp4",
                    "deck_title": "Adjectives & Degrees of Comparison (2.1. Adjective Test)",
                    "category": "Grammar",
                    "cards": [
                        {"points": 10, "text": "Choose the correct comparative: 'This task is ___ than the previous one.'", "options": ["more difficult", "difficulter", "most difficult", "as difficult"], "correct": "more difficult", "type": CardType.QUESTION},
                        {"points": 10, "text": "Mount Everest is the ___ mountain in the world.", "options": ["highest", "higher", "most high", "high"], "correct": "highest", "type": CardType.QUESTION},
                        {"points": 0, "text": "🔄 SYURPRIZ: Ballarni Almashtirish (Swap)!", "options": [], "correct": "", "type": CardType.SWAP},
                        {"points": 15, "text": "Her English is getting ___ and ___ every day.", "options": ["better / better", "good / good", "more good / more good", "best / best"], "correct": "better / better", "type": CardType.QUESTION},
                        {"points": 20, "text": "The ___ you study, the ___ your score will be.", "options": ["harder / higher", "hard / high", "hardest / highest", "more hard / more high"], "correct": "harder / higher", "type": CardType.QUESTION},
                        {"points": 20, "text": "Choose the correct order of adjectives:", "options": ["a beautiful old Italian car", "an Italian old beautiful car", "a old beautiful Italian car", "an old Italian beautiful car"], "correct": "a beautiful old Italian car", "type": CardType.QUESTION},
                        {"points": 0, "text": "🥷 SYURPRIZ: Raqibdan 15 Ball O'g'irlash (Steal)!", "options": [], "correct": "", "type": CardType.STEAL},
                        {"points": 15, "text": "Choose the superlative form of 'far' (referring to greatest distance):", "options": ["furthest", "farthest", "most far", "farrest"], "correct": "furthest", "type": CardType.QUESTION},
                        {"points": 15, "text": "She is ___ taller than her elder sister.", "options": ["slightly", "more", "very", "as"], "correct": "slightly", "type": CardType.QUESTION},
                        {"points": 10, "text": "This is the ___ film I have ever watched.", "options": ["worst", "baddest", "worse", "most bad"], "correct": "worst", "type": CardType.QUESTION},
                        {"points": 0, "text": "⚡️ SYURPRIZ: 2x Multiplier Ball!", "options": [], "correct": "", "type": CardType.DOUBLE},
                        {"points": 10, "text": "He is not as ___ as his brother.", "options": ["clever", "cleverer", "cleverest", "more clever"], "correct": "clever", "type": CardType.QUESTION},
                        {"points": 15, "text": "Choose the correct sentence:", "options": ["Gold is much heavier than silver.", "Gold is more heavier than silver.", "Gold is very heavier than silver.", "Gold is as heavier than silver."], "correct": "Gold is much heavier than silver.", "type": CardType.QUESTION},
                        {"points": 20, "text": "Choose the correct adjective order: 'a ___ table'", "options": ["small round wooden", "wooden small round", "round wooden small", "small wooden round"], "correct": "small round wooden", "type": CardType.QUESTION},
                        {"points": 0, "text": "💣 BOMBA: -15 Ball Jarima!", "options": [], "correct": "", "type": CardType.BOMB},
                        {"points": 20, "text": "Of the two sisters, Lola is the ___.", "options": ["taller", "tallest", "most tall", "more tallest"], "correct": "taller", "type": CardType.QUESTION},
                    ],
                },
                {
                    "title": "4. Adverbs: Formation, Types & Usage",
                    "description": "Ravishlarning yasalishi (-ly), irregular adverbs (fast, hard, late, well) hamda sifat va ravish farqi.",
                    "duration": 909,
                    "order_index": 4,
                    "video_file": "videos/grammar/3_adverbs.mp4",
                    "deck_title": "Adverbs & Sentence Positions (3. Adverbs)",
                    "category": "Grammar",
                    "cards": [
                        {"points": 10, "text": "He speaks English very ___.", "options": ["fluently", "fluent", "more fluent", "fluency"], "correct": "fluently", "type": CardType.QUESTION},
                        {"points": 10, "text": "Be careful! He drives very ___.", "options": ["fast", "fastly", "fasterly", "more fastly"], "correct": "fast", "type": CardType.QUESTION},
                        {"points": 0, "text": "🔄 SYURPRIZ: Ballarni Almashtirish (Swap)!", "options": [], "correct": "", "type": CardType.SWAP},
                        {"points": 20, "text": "She worked ___ to pass the exam, whereas her brother ___ studied at all.", "options": ["hard / hardly", "hardly / hard", "hard / hard", "harder / hardest"], "correct": "hard / hardly", "type": CardType.QUESTION},
                        {"points": 20, "text": "The soup tastes ___. Did you add fresh herbs?", "options": ["wonderful", "wonderfully", "more wonderfully", "wonder"], "correct": "wonderful", "type": CardType.QUESTION},
                        {"points": 10, "text": "I have ___ finished my homework.", "options": ["already", "yet", "still", "ago"], "correct": "already", "type": CardType.QUESTION},
                        {"points": 0, "text": "🥷 SYURPRIZ: Raqibdan 15 Ball O'g'irlash (Steal)!", "options": [], "correct": "", "type": CardType.STEAL},
                        {"points": 15, "text": "He arrived ___ because his train was delayed.", "options": ["late", "lately", "more lately", "latest"], "correct": "late", "type": CardType.QUESTION},
                        {"points": 15, "text": "Have you seen Anvar ___?", "options": ["lately", "late", "latest", "later"], "correct": "lately", "type": CardType.QUESTION},
                        {"points": 10, "text": "She sings really ___.", "options": ["well", "good", "goodly", "more well"], "correct": "well", "type": CardType.QUESTION},
                        {"points": 0, "text": "⚡️ SYURPRIZ: 2x Multiplier Ball!", "options": [], "correct": "", "type": CardType.DOUBLE},
                        {"points": 10, "text": "The children were playing ___ in the yard.", "options": ["happily", "happy", "happiness", "more happy"], "correct": "happily", "type": CardType.QUESTION},
                        {"points": 15, "text": "Choose the correct adverb of frequency position:", "options": ["She always arrives on time.", "She arrives always on time.", "Always she arrives on time.", "She arrives on time always."], "correct": "She always arrives on time.", "type": CardType.QUESTION},
                        {"points": 15, "text": "He explained the problem as ___ as he could.", "options": ["clearly", "clear", "clearest", "clearness"], "correct": "clearly", "type": CardType.QUESTION},
                        {"points": 0, "text": "💣 BOMBA: -15 Ball Jarima!", "options": [], "correct": "", "type": CardType.BOMB},
                        {"points": 15, "text": "The exam was ___ difficult, but everyone passed.", "options": ["extremely", "extreme", "extremeness", "more extreme"], "correct": "extremely", "type": CardType.QUESTION},
                    ],
                },
                {
                    "title": "5. Numerals: Cardinal, Ordinal & Fractions",
                    "description": "Sanoq va tartib sonlar, kasrlar, sanalar o'qilishi hamda hundred, thousand, million so'zlarining ishlatilish qoidalari.",
                    "duration": 1097,
                    "order_index": 5,
                    "video_file": "videos/grammar/4_numerals.mp4",
                    "deck_title": "Numerals (Sonlar — Cardinal, Ordinal & Fractions)",
                    "category": "Grammar",
                    "cards": [
                        {"points": 15, "text": "Choose the correct spelling of '40th':", "options": ["fortieth", "fourtieth", "fortyeth", "fourtyth"], "correct": "fortieth", "type": CardType.QUESTION},
                        {"points": 15, "text": "There were ___ people at the stadium.", "options": ["thousands of", "five thousands", "thousand of", "five thousands of"], "correct": "thousands of", "type": CardType.QUESTION},
                        {"points": 0, "text": "🔄 SYURPRIZ: Ballarni Almashtirish (Swap)!", "options": [], "correct": "", "type": CardType.SWAP},
                        {"points": 15, "text": "The company paid three ___ dollars for the new equipment.", "options": ["million", "millions", "millions of", "a million of"], "correct": "million", "type": CardType.QUESTION},
                        {"points": 20, "text": "How do we read the fraction '2/3'?", "options": ["two-thirds", "two-third", "second-thirds", "two-threes"], "correct": "two-thirds", "type": CardType.QUESTION},
                        {"points": 10, "text": "Today is the ___ of October.", "options": ["twenty-fifth", "twenty-five", "twentieth-five", "twenty-fiveth"], "correct": "twenty-fifth", "type": CardType.QUESTION},
                        {"points": 0, "text": "🥷 SYURPRIZ: Raqibdan 15 Ball O'g'irlash (Steal)!", "options": [], "correct": "", "type": CardType.STEAL},
                        {"points": 10, "text": "Choose the correct form: 'Page ___'", "options": ["twenty", "twentieth", "the twentieth", "twenties"], "correct": "twenty", "type": CardType.QUESTION},
                        {"points": 15, "text": "How do we say the year '1905'?", "options": ["nineteen oh five", "nineteen five", "one thousand nine hundred five", "nineteen hundred zero five"], "correct": "nineteen oh five", "type": CardType.QUESTION},
                        {"points": 20, "text": "Choose the correct ordinal numeral:", "options": ["twelfth", "twelveth", "twelth", "twelvth"], "correct": "twelfth", "type": CardType.QUESTION},
                        {"points": 0, "text": "⚡️ SYURPRIZ: 2x Multiplier Ball!", "options": [], "correct": "", "type": CardType.DOUBLE},
                        {"points": 15, "text": "How do we read the decimal '3.75'?", "options": ["three point seven five", "three point seventy-five", "three comma seven five", "three dot seventy-five"], "correct": "three point seven five", "type": CardType.QUESTION},
                        {"points": 10, "text": "Choose the correct spelling for '9th':", "options": ["ninth", "nineth", "nint", "nienth"], "correct": "ninth", "type": CardType.QUESTION},
                        {"points": 15, "text": "There were ___ books on the shelf.", "options": ["hundreds of", "two hundreds", "hundred of", "two hundreds of"], "correct": "hundreds of", "type": CardType.QUESTION},
                        {"points": 0, "text": "💣 BOMBA: -15 Ball Jarima!", "options": [], "correct": "", "type": CardType.BOMB},
                        {"points": 10, "text": "Choose the correct ordinal form of '8th':", "options": ["eighth", "eightth", "eighthth", "eith"], "correct": "eighth", "type": CardType.QUESTION},
                    ],
                },
                {
                    "title": "6. Articles: A, An, The & Zero Article",
                    "description": "Noaniq (a/an) va aniq (the) artikllar, zero article qoidalari, geografik nomlar, kasblar va istisnolar.",
                    "duration": 1436,
                    "order_index": 6,
                    "video_file": "videos/grammar/5_articles.mp4",
                    "deck_title": "Articles (a / an / the / zero article)",
                    "category": "Grammar",
                    "cards": [
                        {"points": 15, "text": "He is studying at ___ university in ___ United Kingdom.", "options": ["a / the", "an / the", "the / -", "a / -"], "correct": "a / the", "type": CardType.QUESTION},
                        {"points": 15, "text": "She plays ___ piano beautifully, while her brother prefers playing ___ football.", "options": ["the / -", "a / a", "the / the", "- / -"], "correct": "the / -", "type": CardType.QUESTION},
                        {"points": 0, "text": "🔄 SYURPRIZ: Ballarni Almashtirish (Swap)!", "options": [], "correct": "", "type": CardType.SWAP},
                        {"points": 20, "text": "___ Lake Baikal is the deepest lake in ___ world.", "options": ["- / the", "The / the", "A / the", "The / a"], "correct": "- / the", "type": CardType.QUESTION},
                        {"points": 10, "text": "It took us ___ hour and ___ half to reach the airport.", "options": ["an / a", "a / a", "an / an", "the / a"], "correct": "an / a", "type": CardType.QUESTION},
                        {"points": 15, "text": "___ rich should help ___ poor.", "options": ["The / the", "- / -", "A / a", "The / a"], "correct": "The / the", "type": CardType.QUESTION},
                        {"points": 0, "text": "🥷 SYURPRIZ: Raqibdan 15 Ball O'g'irlash (Steal)!", "options": [], "correct": "", "type": CardType.STEAL},
                        {"points": 10, "text": "___ Moon revolves around ___ Earth.", "options": ["The / the", "A / the", "- / -", "The / an"], "correct": "The / the", "type": CardType.QUESTION},
                        {"points": 10, "text": "She goes to work by ___ bus every morning.", "options": ["-", "a", "the", "an"], "correct": "-", "type": CardType.QUESTION},
                        {"points": 15, "text": "Have you ever been to ___ Netherlands?", "options": ["the", "a", "an", "-"], "correct": "the", "type": CardType.QUESTION},
                        {"points": 0, "text": "⚡️ SYURPRIZ: 2x Multiplier Ball!", "options": [], "correct": "", "type": CardType.DOUBLE},
                        {"points": 10, "text": "Breakfast is ___ most important meal of the day.", "options": ["the", "a", "an", "-"], "correct": "the", "type": CardType.QUESTION},
                        {"points": 15, "text": "I had ___ lunch at an Italian restaurant yesterday.", "options": ["-", "a", "the", "an"], "correct": "-", "type": CardType.QUESTION},
                        {"points": 15, "text": "___ Alps are a popular destination for skiing.", "options": ["The", "A", "An", "-"], "correct": "The", "type": CardType.QUESTION},
                        {"points": 0, "text": "💣 BOMBA: -15 Ball Jarima!", "options": [], "correct": "", "type": CardType.BOMB},
                        {"points": 20, "text": "He was elected ___ president of the club.", "options": ["-", "the", "a", "an"], "correct": "-", "type": CardType.QUESTION},
                    ],
                },
            ]

            for l_data in lessons_meta:
                lesson, _ = Lesson.objects.update_or_create(
                    course=course,
                    order_index=l_data["order_index"],
                    defaults={
                        "title": l_data["title"],
                        "description": l_data["description"],
                        "duration": l_data["duration"],
                        "xp_reward": 50,
                        "video_file": l_data["video_file"],
                    },
                )
                VideoLesson.objects.update_or_create(
                    id=str(lesson.id),
                    defaults={
                        "title": l_data["title"],
                        "description": l_data["description"],
                        "price": 0,
                        "is_free_for_approved": True,
                        "file_key": l_data["video_file"],
                        "mime_type": "video/mp4",
                        "thumbnail_key": None,
                        "created_at": timezone.now(),
                    },
                )
                self.stdout.write(f"  -> Lesson #{lesson.order_index}: {lesson.title}")

                # Create or update tied QuizDeck
                deck, _ = QuizDeck.objects.update_or_create(
                    title=l_data["deck_title"],
                    defaults={
                        "category": l_data["category"],
                        "is_lesson_tied": True,
                        "lesson": lesson,
                        "created_by": admin_user,
                    },
                )

                # Sync cards: remove old and populate fresh 16 cards
                deck.cards.all().delete()
                for c_idx, c_data in enumerate(l_data["cards"], start=1):
                    QuizCard.objects.create(
                        id=str(uuid.uuid4()),
                        quiz_deck=deck,
                        question_text=c_data["text"],
                        points=c_data["points"],
                        options=c_data["options"],
                        correct_answer=c_data["correct"],
                        card_type=c_data["type"],
                        order_index=c_idx,
                        created_at=timezone.now(),
                    )
                self.stdout.write(f"     Deck ready: '{deck.title}' ({deck.cards.count()} cards)")

        self.stdout.write(self.style.SUCCESS("All Grammar Lessons & Bamboozle Decks seeded successfully!"))
