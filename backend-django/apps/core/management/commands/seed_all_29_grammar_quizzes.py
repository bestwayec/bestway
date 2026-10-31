# -*- coding: utf-8 -*-
"""Django Management Command to Seed ALL 29 Grammar Lessons and 348+ Error-Free Quizzes.

Combines Foundation Lessons 1-6 and Advanced Grammar Lessons 7-29.
Every lesson is tied directly to a QuizDeck with 12 solo question cards and 4 surprise cards for Bamboozle Arena.
"""

import uuid
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.core.models import CardType, Course, Lesson, QuizCard, QuizDeck
from apps.legacy_schema.models import User, VideoLesson

# ----------------------------------------------------------------------------
# 1. Lessons 1 - 6 (Nouns, Adjectives, Adverbs, Numerals, Articles)
# ----------------------------------------------------------------------------
LESSONS_PART_1 = [
                {
                    "title": "1. Nouns: Countable, Uncountable & Plural Forms",
                    "description": "Sanaladigan va sanalmaydigan otlar, ko'plik shakllari, irregular plurals va egalik kelishigi (-'s / -s').",
                    "duration": 1337,
                    "order_index": 1,
                    "video_file": "videos/grammar/1_nouns.mp4",
                    "thumbnail_key": "thumbnails/grammar/noun.jpg",
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
                    "thumbnail_key": "thumbnails/grammar/noun_test.jpg",
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
                    "thumbnail_key": "thumbnails/grammar/adjective.jpg",
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
                    "thumbnail_key": "thumbnails/grammar/adverb.jpg",
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
                    "thumbnail_key": "thumbnails/grammar/numeral.jpg",
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
                    "thumbnail_key": "thumbnails/grammar/article.jpg",
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

# ----------------------------------------------------------------------------
# 2. Lessons 7 - 29 (Tenses, Conditionals, Modals, Passive, Speech, etc.)
# ----------------------------------------------------------------------------
LESSONS_PART_2 = [
    {
        "title": "7. Future Continuous Tense",
        "description": "Kelasi davomli zamon: ma'lum bir kelajak paytda davom etayotgan harakatlar (will be + V-ing) va rejalashtirilgan voqealar.",
        "duration": 196,
        "order_index": 7,
        "video_file": "videos/grammar/Future Continuous.mp4",
        "thumbnail_key": None,
        "deck_title": "Future Continuous (Kelasi davomli zamon)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "At this time tomorrow, I ___ on a sunny beach in Antalya.", "options": ["will be lying", "will lie", "am lying", "lie"], "correct": "will be lying"},
            {"points": 10, "text": "Don't phone between 7 and 8 PM. We ___ dinner then.", "options": ["will be having", "will have", "have", "are having"], "correct": "will be having"},
            {"points": 15, "text": "This time next week, they ___ across the Atlantic.", "options": ["will be flying", "will fly", "are flying", "fly"], "correct": "will be flying"},
            {"points": 10, "text": "Will you ___ using the computer later this evening?", "options": ["be", "been", "being", "to be"], "correct": "be"},
            {"points": 15, "text": "She can't come at 3 PM because she ___ an important lecture.", "options": ["will be attending", "will attend", "attends", "attended"], "correct": "will be attending"},
            {"points": 20, "text": "Professor Brown ___ our exam papers throughout the weekend.", "options": ["will be grading", "will grade", "grades", "is grade"], "correct": "will be grading"},
            {"points": 15, "text": "What ___ you ___ at 10 PM tonight?", "options": ["will / be doing", "do / do", "are / do", "will / do"], "correct": "will / be doing"},
            {"points": 15, "text": "In five years' time, most city drivers ___ electric vehicles.", "options": ["will be driving", "will drive", "are driving", "drive"], "correct": "will be driving"},
            {"points": 20, "text": "I ___ to the supermarket anyway, so I can pick up some milk for you.", "options": ["will be going", "will go", "go", "have gone"], "correct": "will be going"},
            {"points": 10, "text": "Please be quiet when you arrive; the baby ___ .", "options": ["will be sleeping", "will sleep", "sleeps", "slept"], "correct": "will be sleeping"},
            {"points": 10, "text": "We ___ for you right outside the arrivals terminal.", "options": ["will be waiting", "will wait", "wait", "waited"], "correct": "will be waiting"},
            {"points": 15, "text": "They won't ___ working on the project after midnight.", "options": ["be", "been", "being", "have"], "correct": "be"},
        ]
    },
    {
        "title": "8. Future Perfect Continuous Tense",
        "description": "Kelasi tugallangan davomli zamon: kelajakdagi ma'lum bir nuqtagacha qancha vaqt davom etishini ifodalash (will have been + V-ing).",
        "duration": 134,
        "order_index": 8,
        "video_file": "videos/grammar/Future Perfect Continuous.mp4",
        "thumbnail_key": "thumbnails/grammar/futureperfectconteniues.jpg",
        "deck_title": "Future Perfect Continuous (Kelasi tugallangan davomli)",
        "category": "Grammar",
        "questions": [
            {"points": 15, "text": "By next month, she ___ at this university for ten full years.", "options": ["will have been teaching", "will teach", "will be teaching", "has been teaching"], "correct": "will have been teaching"},
            {"points": 15, "text": "By 2030, they ___ in Tashkent for twenty continuous years.", "options": ["will have been living", "will live", "will have lived", "live"], "correct": "will have been living"},
            {"points": 20, "text": "When he finishes his PhD, he ___ for seven years.", "options": ["will have been researching", "will research", "researches", "has researched"], "correct": "will have been researching"},
            {"points": 15, "text": "By midnight, we ___ on this essay for twelve continuous hours.", "options": ["will have been working", "will work", "will have worked", "are working"], "correct": "will have been working"},
            {"points": 10, "text": "Next Friday, she ___ driving lessons for six months.", "options": ["will have been taking", "will take", "takes", "has been taking"], "correct": "will have been taking"},
            {"points": 20, "text": "How long ___ you ___ English by the time you graduate?", "options": ["will / have been studying", "do / study", "will / study", "are / studying"], "correct": "will / have been studying"},
            {"points": 15, "text": "He will be exhausted because he ___ without a break.", "options": ["will have been driving", "will drive", "drives", "drove"], "correct": "will have been driving"},
            {"points": 10, "text": "By the end of this year, I ___ at this firm for 5 years.", "options": ["will have been working", "will work", "am working", "work"], "correct": "will have been working"},
            {"points": 15, "text": "They ___ for over an hour by the time the bus arrives.", "options": ["will have been waiting", "will wait", "waited", "have waited"], "correct": "will have been waiting"},
            {"points": 20, "text": "By 9 PM, she ___ piano for four hours straight.", "options": ["will have been practicing", "will practice", "practices", "practiced"], "correct": "will have been practicing"},
            {"points": 15, "text": "Next month, our company ___ this software for a full decade.", "options": ["will have been developing", "will develop", "develop", "are developing"], "correct": "will have been developing"},
            {"points": 10, "text": "By then, the athletes ___ under the hot sun all morning.", "options": ["will have been training", "will train", "train", "trained"], "correct": "will have been training"},
        ]
    },
    {
        "title": "9. Future Perfect Tense",
        "description": "Kelasi tugallangan zamon: kelajakdagi ma'lum bir muddatgacha tugallanadigan ish-harakatlar (will have + V3).",
        "duration": 139,
        "order_index": 9,
        "video_file": "videos/grammar/Future Perfect.mp4",
        "thumbnail_key": "thumbnails/grammar/futureperfect.jpg",
        "deck_title": "Future Perfect (Kelasi tugallangan zamon)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "By 5 o'clock tomorrow, I ___ the quarterly financial report.", "options": ["will have finished", "will finish", "finish", "am finishing"], "correct": "will have finished"},
            {"points": 15, "text": "By the time you return, we ___ all the furniture.", "options": ["will have assembled", "will assemble", "assembled", "assemble"], "correct": "will have assembled"},
            {"points": 15, "text": "She ___ from university by the end of next summer.", "options": ["will have graduated", "will graduate", "graduates", "graduated"], "correct": "will have graduated"},
            {"points": 15, "text": "The builders promise they ___ the bridge by December.", "options": ["will have completed", "will complete", "complete", "are completing"], "correct": "will have completed"},
            {"points": 10, "text": "Don't worry; the rain ___ before we start the picnic.", "options": ["will have stopped", "will stop", "stops", "stopped"], "correct": "will have stopped"},
            {"points": 20, "text": "By 2050, scientists ___ a cure for many common diseases.", "options": ["will have discovered", "will discover", "discover", "are discovering"], "correct": "will have discovered"},
            {"points": 15, "text": "Will you ___ your homework by the time dinner is ready?", "options": ["have completed", "complete", "completed", "be complete"], "correct": "have completed"},
            {"points": 10, "text": "They ___ all the tickets before the concert even begins.", "options": ["will have sold", "will sell", "sell", "sold"], "correct": "will have sold"},
            {"points": 15, "text": "By next Tuesday, the mechanic ___ my car engine.", "options": ["will have repaired", "will repair", "repairs", "repaired"], "correct": "will have repaired"},
            {"points": 10, "text": "I ___ three chapters of this novel by tonight.", "options": ["will have read", "will read", "read", "have been reading"], "correct": "will have read"},
            {"points": 20, "text": "By next year, he ___ 100,000 kilometers in his taxi.", "options": ["will have driven", "will drive", "drives", "is driving"], "correct": "will have driven"},
            {"points": 15, "text": "The delivery package ___ by the time we arrive at the office.", "options": ["will have arrived", "will arrive", "arrives", "arrived"], "correct": "will have arrived"},
        ]
    },
    {
        "title": "10. Future Simple & Future Forms",
        "description": "Oddiy kelasi zamon (will + V1), be going to bilan taxminlar, va'dalar, takliflar va spontan qarorlar farqi.",
        "duration": 292,
        "order_index": 10,
        "video_file": "videos/grammar/Future Simple.mp4",
        "thumbnail_key": "thumbnails/grammar/futuresimple.jpg",
        "deck_title": "Future Simple (Oddiy kelasi zamon)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "Look at those heavy black clouds! It ___ rain.", "options": ["is going to", "will", "shall", "may to"], "correct": "is going to"},
            {"points": 10, "text": "I'm really hungry. I think I ___ a chicken sandwich.", "options": ["will order", "am ordering", "order", "ordered"], "correct": "will order"},
            {"points": 10, "text": "Don't worry about the heavy suitcases, I ___ you carry them.", "options": ["will help", "help", "am helping", "helped"], "correct": "will help"},
            {"points": 10, "text": "The phone is ringing. - OK, I ___ it!", "options": ["will get", "get", "am getting", "got"], "correct": "will get"},
            {"points": 15, "text": "I promise I ___ tell anyone your confidential secret.", "options": ["won't", "don't", "am not", "haven't"], "correct": "won't"},
            {"points": 15, "text": "In my opinion, Brazil ___ the next World Cup.", "options": ["will win", "is winning", "wins", "won"], "correct": "will win"},
            {"points": 20, "text": "We ___ to Spain next Monday; our flight tickets are already booked.", "options": ["are flying", "will fly", "fly", "flew"], "correct": "are flying"},
            {"points": 15, "text": "Watch out! You ___ spill your cup of hot coffee!", "options": ["are going to", "will", "would", "shall"], "correct": "are going to"},
            {"points": 15, "text": "___ I open the window for some fresh cool air?", "options": ["Shall", "Will", "Would", "Must"], "correct": "Shall"},
            {"points": 10, "text": "I hope you ___ a wonderful time at the conference tomorrow.", "options": ["will have", "have had", "had", "having"], "correct": "will have"},
            {"points": 15, "text": "Perhaps we ___ see them at the wedding ceremony tonight.", "options": ["will", "shall to", "are going", "would to"], "correct": "will"},
            {"points": 10, "text": "She strongly believes that prices ___ down next quarter.", "options": ["will go", "go", "going", "are go"], "correct": "will go"},
        ]
    },
    {
        "title": "11. Gerund and Infinitive",
        "description": "Fe'llardan keyin Gerund (-ing) yoki to-Infinitive qo'llanilishi hamda ma'nosi o'zgaruvchi fe'llar tahlili.",
        "duration": 1000,
        "order_index": 11,
        "video_file": "videos/grammar/Gerund va Infinitive.mp4",
        "thumbnail_key": "thumbnails/grammar/geroundvainfinitive.jpg",
        "deck_title": "Gerund and Infinitive (Fe'l shakllari)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "She decided ___ abroad to continue her medical studies.", "options": ["to study", "studying", "study", "studied"], "correct": "to study"},
            {"points": 15, "text": "He admitted ___ the office window during the argument.", "options": ["breaking", "to break", "break", "broken"], "correct": "breaking"},
            {"points": 15, "text": "I clearly remember ___ off the gas before leaving the house.", "options": ["turning", "to turn", "turn", "turned"], "correct": "turning"},
            {"points": 10, "text": "Don't forget ___ the front door when you leave.", "options": ["to lock", "locking", "lock", "locked"], "correct": "to lock"},
            {"points": 20, "text": "They stopped ___ a coffee on their long way to Samarkand.", "options": ["to have", "having", "have", "had"], "correct": "to have"},
            {"points": 15, "text": "The doctor advised him to stop ___ immediately.", "options": ["smoking", "to smoke", "smoke", "smoked"], "correct": "smoking"},
            {"points": 15, "text": "She avoids ___ through the city center during rush hour.", "options": ["driving", "to drive", "drive", "drove"], "correct": "driving"},
            {"points": 10, "text": "He managed ___ the difficult entrance examination.", "options": ["to pass", "passing", "pass", "passed"], "correct": "to pass"},
            {"points": 15, "text": "I look forward to ___ from you soon.", "options": ["hearing", "hear", "to hear", "heard"], "correct": "hearing"},
            {"points": 20, "text": "It is no use ___ over spilt milk.", "options": ["crying", "to cry", "cry", "cried"], "correct": "crying"},
            {"points": 15, "text": "I suggest ___ by high-speed train because it is more comfortable.", "options": ["traveling", "to travel", "travel", "traveled"], "correct": "traveling"},
            {"points": 10, "text": "She refused ___ any questions without her lawyer present.", "options": ["to answer", "answering", "answer", "answered"], "correct": "to answer"},
        ]
    },
    {
        "title": "12. Conditionals (0, 1st, 2nd, 3rd & Mixed)",
        "description": "Shart ergash gaplar: Zero, First, Second, Third va Mixed Conditionals qoidalari va istisnolari.",
        "duration": 446,
        "order_index": 12,
        "video_file": "videos/grammar/If Conditionals.mp4",
        "thumbnail_key": "thumbnails/grammar/if.jpg",
        "deck_title": "Conditionals (Shart ergash gaplar)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "If water reaches 100 degrees Celsius, it ___ .", "options": ["boils", "will boil", "boiled", "would boil"], "correct": "boils"},
            {"points": 10, "text": "If it rains tomorrow, we ___ our trip to the mountains.", "options": ["will cancel", "cancel", "would cancel", "canceled"], "correct": "will cancel"},
            {"points": 15, "text": "If I ___ you, I would consult a professional physician.", "options": ["were", "was", "am", "will be"], "correct": "were"},
            {"points": 20, "text": "If she had studied harder, she ___ the bar exam.", "options": ["would have passed", "will pass", "would pass", "passed"], "correct": "would have passed"},
            {"points": 15, "text": "If I had a million dollars, I ___ a charity hospital.", "options": ["would build", "will build", "build", "have built"], "correct": "would build"},
            {"points": 15, "text": "Unless you ___ your ticket, you won't be allowed inside.", "options": ["show", "will show", "showed", "don't show"], "correct": "show"},
            {"points": 15, "text": "Provided that you ___ home on time, you can go to the party.", "options": ["come", "will come", "came", "would come"], "correct": "come"},
            {"points": 20, "text": "If he ___ earlier, he wouldn't have missed his flight.", "options": ["had left", "left", "has left", "leaves"], "correct": "had left"},
            {"points": 15, "text": "What would you do if you ___ a lost wallet on the street?", "options": ["found", "find", "will find", "had find"], "correct": "found"},
            {"points": 20, "text": "If they hadn't invited us, we ___ here right now.", "options": ["wouldn't be", "won't be", "aren't", "wouldn't have been"], "correct": "wouldn't be"},
            {"points": 10, "text": "I'll give you a call as soon as I ___ at the airport.", "options": ["arrive", "will arrive", "arrived", "am arriving"], "correct": "arrive"},
            {"points": 10, "text": "If you heat solid ice, it ___ into water.", "options": ["turns", "will turn", "turned", "would turn"], "correct": "turns"},
        ]
    },
    {
        "title": "13. Reported / Indirect Speech",
        "description": "O'zlashtirma gap: zamonlarning orqaga surilishi (tense backshift), olmoshlar va vaqt ko'rsatkichlarining o'zgarishi.",
        "duration": 1031,
        "order_index": 13,
        "video_file": "videos/grammar/Indirect Speech.mp4",
        "thumbnail_key": "thumbnails/grammar/indirectspeech.jpg",
        "deck_title": "Reported Speech (O'zlashtirma gap)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "'I am working on a new project,' said Anvar. -> Anvar said that he ___ on a new project.", "options": ["was working", "is working", "worked", "had worked"], "correct": "was working"},
            {"points": 15, "text": "'I have lost my passport,' she said. -> She said she ___ her passport.", "options": ["had lost", "lost", "has lost", "would lose"], "correct": "had lost"},
            {"points": 15, "text": "'We saw that film yesterday,' they said. -> They said they had seen that film ___ .", "options": ["the day before", "yesterday", "the next day", "tomorrow"], "correct": "the day before"},
            {"points": 15, "text": "'Will you help me?' he asked. -> He asked me if I ___ him.", "options": ["would help", "will help", "help", "helped"], "correct": "would help"},
            {"points": 15, "text": "'Where do you live?' she asked. -> She asked me where I ___ .", "options": ["lived", "did live", "live", "do live"], "correct": "lived"},
            {"points": 10, "text": "'Don't be late,' the teacher said. -> The teacher told us ___ late.", "options": ["not to be", "to not be", "don't be", "not be"], "correct": "not to be"},
            {"points": 15, "text": "'I can speak three languages,' he claimed. -> He claimed that he ___ three languages.", "options": ["could speak", "can speak", "speaks", "spoke"], "correct": "could speak"},
            {"points": 15, "text": "She asked me: 'Are you ready?' -> She asked me ___ I was ready.", "options": ["whether", "that", "what", "which"], "correct": "whether"},
            {"points": 15, "text": "'I will call you tomorrow,' he promised. -> He promised to call me ___ .", "options": ["the following day", "tomorrow", "yesterday", "the day before"], "correct": "the following day"},
            {"points": 10, "text": "The officer ordered the soldiers ___ forward.", "options": ["to march", "marching", "march", "marched"], "correct": "to march"},
            {"points": 20, "text": "'Why did you leave early?' he asked. -> He asked why I ___ early.", "options": ["had left", "left", "did leave", "have left"], "correct": "had left"},
            {"points": 15, "text": "He warned us ___ near the dangerous edge of the cliff.", "options": ["not to go", "don't go", "to not go", "not going"], "correct": "not to go"},
        ]
    },
    {
        "title": "14. Modal Verbs & Modal Perfects",
        "description": "Modal fe'llar: can, could, may, might, must, have to, should va o'tgan zamondagi modal perfect shakllari.",
        "duration": 1516,
        "order_index": 14,
        "video_file": "videos/grammar/Modal verbs.mp4",
        "thumbnail_key": "thumbnails/grammar/modalverbs.jpg",
        "deck_title": "Modal Verbs (Modal fe'llar)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "You ___ smoke inside the hospital; it is strictly prohibited by law.", "options": ["mustn't", "needn't", "don't have to", "shouldn't"], "correct": "mustn't"},
            {"points": 10, "text": "She ___ speak four languages fluently when she was only ten.", "options": ["could", "can", "might", "should"], "correct": "could"},
            {"points": 15, "text": "The lights are still on in his room. He ___ be studying for the finals.", "options": ["must", "can't", "should", "ought"], "correct": "must"},
            {"points": 20, "text": "The front door was locked from inside, so the thief ___ have come through the window.", "options": ["must", "should", "can", "would"], "correct": "must"},
            {"points": 20, "text": "You ___ have bought more bread; we already had three loaves in the kitchen.", "options": ["needn't", "mustn't", "couldn't", "can't"], "correct": "needn't"},
            {"points": 15, "text": "You ___ see a doctor if your persistent cough continues.", "options": ["ought to", "ought", "must to", "have"], "correct": "ought to"},
            {"points": 15, "text": "He hasn't eaten anything all day long. He ___ be starving.", "options": ["must", "can't", "needn't", "may not"], "correct": "must"},
            {"points": 15, "text": "She ___ have arrived by now; her flight landed two hours ago.", "options": ["should", "must to", "can", "would"], "correct": "should"},
            {"points": 10, "text": "I ___ find my keys anywhere; have you seen them?", "options": ["can't", "mustn't", "needn't", "may not"], "correct": "can't"},
            {"points": 15, "text": "You ___ wear a formal tie to the dinner; it's completely casual.", "options": ["don't have to", "mustn't", "can't", "ought not"], "correct": "don't have to"},
            {"points": 20, "text": "They ___ have known about the secret party; it was an absolute surprise.", "options": ["couldn't", "mustn't", "shouldn't", "needn't"], "correct": "couldn't"},
            {"points": 10, "text": "___ I borrow your pen for a few minutes, please?", "options": ["May", "Must", "Should", "Ought"], "correct": "May"},
        ]
    },
    {
        "title": "15. Numerals: Fractions, Decimals & Advanced Rules",
        "description": "Sonlar 2-qism: kasr sonlar, foizlar, sanalar, tartib sonlar va two hundred vs hundreds of farqi.",
        "duration": 497,
        "order_index": 15,
        "video_file": "videos/grammar/Numerals part 2.mp4",
        "thumbnail_key": "thumbnails/grammar/numeralspart2.jpg",
        "deck_title": "Numerals Part 2 (Sonlar 2-qism)",
        "category": "Grammar",
        "questions": [
            {"points": 15, "text": "Choose the correct fraction form for '2/3':", "options": ["two-thirds", "two-third", "second-three", "two-threes"], "correct": "two-thirds"},
            {"points": 10, "text": "Over three ___ people attended the international expo.", "options": ["hundred", "hundreds", "hundred of", "hundreds of"], "correct": "hundred"},
            {"points": 15, "text": "___ of students passed the exam with top scores.", "options": ["Hundreds", "Hundred", "A hundred", "Two hundreds"], "correct": "Hundreds"},
            {"points": 10, "text": "How is '1905' pronounced as a historical calendar year?", "options": ["nineteen oh five", "nineteen five", "one thousand nine hundred five", "nineteen hundred and five"], "correct": "nineteen oh five"},
            {"points": 15, "text": "Choose the correct decimal reading for '3.14':", "options": ["three point one four", "three dot fourteen", "three comma fourteen", "three point fourteen"], "correct": "three point one four"},
            {"points": 10, "text": "September is the ___ month of the calendar year.", "options": ["ninth", "nineth", "nine", "nineths"], "correct": "ninth"},
            {"points": 15, "text": "He gave me a ___ note to pay for the groceries.", "options": ["twenty-dollar", "twenty dollars", "twenty-dollars", "twenty dollar's"], "correct": "twenty-dollar"},
            {"points": 10, "text": "Choose the correct writing for the fraction '1/4':", "options": ["one-fourth", "one-four", "first-four", "one-fourths"], "correct": "one-fourth"},
            {"points": 15, "text": "The telephone number 770-0021 is typically read as:", "options": ["seven seven oh, double oh two one", "seven hundred seventy, twenty-one", "seven seven zero zero zero two one zero", "seven seventy double zero twenty-one"], "correct": "seven seven oh, double oh two one"},
            {"points": 15, "text": "About seventy ___ of the Earth's surface is covered by water.", "options": ["percent", "percents", "percentage", "percent of"], "correct": "percent"},
            {"points": 10, "text": "This is her ___ attempt to pass the official driving test.", "options": ["third", "three", "thirder", "threeth"], "correct": "third"},
            {"points": 10, "text": "There are five ___ books in the university archive.", "options": ["thousand", "thousands", "thousands of", "thousand of"], "correct": "thousand"},
        ]
    },
    {
        "title": "16. Passive Voice & Causative Forms",
        "description": "Majhul nisbat: barcha zamonlarda be + V3 qo'llanilishi, ikkita to'ldiruvchili fe'llar va have something done qoidalari.",
        "duration": 322,
        "order_index": 16,
        "video_file": "videos/grammar/Passive Voice.mp4",
        "thumbnail_key": "thumbnails/grammar/passivevoice.jpg",
        "deck_title": "Passive Voice (Majhul nisbat)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "The novel 'War and Peace' ___ by Leo Tolstoy.", "options": ["was written", "wrote", "is writing", "has written"], "correct": "was written"},
            {"points": 15, "text": "A modern sports complex ___ in our district right now.", "options": ["is being built", "is building", "was built", "has built"], "correct": "is being built"},
            {"points": 15, "text": "All the concert tickets ___ before Friday evening began.", "options": ["had been sold", "have sold", "had sold", "were selling"], "correct": "had been sold"},
            {"points": 10, "text": "English ___ as an official language in many countries.", "options": ["is spoken", "speaks", "is speaking", "spoke"], "correct": "is spoken"},
            {"points": 15, "text": "The stolen artwork ___ yet by the investigating police.", "options": ["hasn't been found", "didn't find", "isn't found", "wasn't finding"], "correct": "hasn't been found"},
            {"points": 20, "text": "She had her car ___ at the local service station yesterday.", "options": ["repaired", "repair", "repairing", "to repair"], "correct": "repaired"},
            {"points": 15, "text": "It is widely ___ that physical exercise improves memory.", "options": ["believed", "believe", "believing", "believes"], "correct": "believed"},
            {"points": 10, "text": "The urgent contract must ___ immediately without delay.", "options": ["be sent", "send", "have sent", "sent"], "correct": "be sent"},
            {"points": 15, "text": "He ___ a gold medal for his outstanding performance.", "options": ["was awarded", "awarded", "is awarding", "has awarded"], "correct": "was awarded"},
            {"points": 20, "text": "The new highway ___ by the end of next November.", "options": ["will have been completed", "will complete", "will be completed", "is completed"], "correct": "will have been completed"},
            {"points": 15, "text": "I really don't like ___ what to do by complete strangers.", "options": ["being told", "to tell", "telling", "be told"], "correct": "being told"},
            {"points": 10, "text": "The old barn was destroyed ___ a sudden lightning strike.", "options": ["by", "with", "from", "of"], "correct": "by"},
        ]
    },
    {
        "title": "17. Past Continuous Tense",
        "description": "O'tgan davomli zamon: o'tgan zamondagi ma'lum paytda davom etayotgan harakatlar, while va when bog'lovchilari.",
        "duration": 202,
        "order_index": 17,
        "video_file": "videos/grammar/Past Continuous.mp4",
        "thumbnail_key": "thumbnails/grammar/pastconteniues.jpg",
        "deck_title": "Past Continuous (O'tgan davomli zamon)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "I ___ a warm shower when the doorbell suddenly rang.", "options": ["was taking", "took", "am taking", "have taken"], "correct": "was taking"},
            {"points": 10, "text": "While they ___ tennis, it started to rain heavily.", "options": ["were playing", "played", "are playing", "play"], "correct": "were playing"},
            {"points": 10, "text": "At 8 PM yesterday, Lola ___ her mathematics homework.", "options": ["was doing", "did", "is doing", "has done"], "correct": "was doing"},
            {"points": 15, "text": "What ___ you ___ when the power outage occurred?", "options": ["were / doing", "did / do", "are / doing", "have / done"], "correct": "were / doing"},
            {"points": 15, "text": "While mother was cooking dinner, father ___ the news.", "options": ["was watching", "watched", "watches", "is watching"], "correct": "was watching"},
            {"points": 10, "text": "The sun ___ and birds were singing as we began our trek.", "options": ["was shining", "shone", "shines", "is shining"], "correct": "was shining"},
            {"points": 15, "text": "He ___ attention, so he bumped right into the lamp post.", "options": ["wasn't paying", "didn't pay", "isn't paying", "hasn't paid"], "correct": "wasn't paying"},
            {"points": 15, "text": "I saw Nodir yesterday. He ___ a stylish leather jacket.", "options": ["was wearing", "wore", "wears", "is wearing"], "correct": "was wearing"},
            {"points": 15, "text": "As I ___ across the street, I dropped my leather wallet.", "options": ["was walking", "walked", "walk", "am walking"], "correct": "was walking"},
            {"points": 15, "text": "They ___ about politics all through the evening dinner.", "options": ["were arguing", "argued", "argue", "are arguing"], "correct": "were arguing"},
            {"points": 15, "text": "Why ___ she ___ when I walked into the study room?", "options": ["was / crying", "did / cry", "is / crying", "were / crying"], "correct": "was / crying"},
            {"points": 10, "text": "We ___ for the express bus when the accident happened.", "options": ["were waiting", "waited", "wait", "are waiting"], "correct": "were waiting"},
        ]
    },
    {
        "title": "18. Past Perfect Continuous Tense",
        "description": "O'tgan tugallangan davomli zamon: o'tgan zamondagi boshqa bir hodisadan oldin boshlanib davom etgan harakatlar.",
        "duration": 232,
        "order_index": 18,
        "video_file": "videos/grammar/Past Perfect Continuous.mp4",
        "thumbnail_key": "thumbnails/grammar/pastperfectconteniues.jpg",
        "deck_title": "Past Perfect Continuous (O'tgan tugallangan davomli)",
        "category": "Grammar",
        "questions": [
            {"points": 15, "text": "He was exhausted because he ___ in the garden for five hours.", "options": ["had been working", "was working", "worked", "has been working"], "correct": "had been working"},
            {"points": 15, "text": "The ground was completely wet; it ___ all night long.", "options": ["had been raining", "was raining", "rained", "has rained"], "correct": "had been raining"},
            {"points": 15, "text": "They ___ for thirty minutes when the train finally arrived.", "options": ["had been waiting", "were waiting", "waited", "have been waiting"], "correct": "had been waiting"},
            {"points": 15, "text": "Her eyes were red and swollen because she ___ .", "options": ["had been crying", "was crying", "cried", "has cried"], "correct": "had been crying"},
            {"points": 20, "text": "How long ___ you ___ English before moving to London?", "options": ["had / been studying", "were / studying", "did / study", "have / studied"], "correct": "had / been studying"},
            {"points": 15, "text": "He failed the exam because he ___ to lectures regularly.", "options": ["hadn't been going", "wasn't going", "didn't go", "hasn't gone"], "correct": "hadn't been going"},
            {"points": 15, "text": "The orchestra ___ for months before giving the concert.", "options": ["had been rehearsing", "were rehearsing", "rehearsed", "have rehearsed"], "correct": "had been rehearsing"},
            {"points": 15, "text": "She had a severe headache because she ___ at the screen.", "options": ["had been staring", "was staring", "stared", "has stared"], "correct": "had been staring"},
            {"points": 20, "text": "They ___ about the budget for two hours before agreeing.", "options": ["had been debating", "debated", "were debating", "have debated"], "correct": "had been debating"},
            {"points": 15, "text": "The car broke down because it ___ strange noises for days.", "options": ["had been making", "was making", "made", "has made"], "correct": "had been making"},
            {"points": 20, "text": "He ___ for another job long before he handed in his notice.", "options": ["had been looking", "was looking", "looked", "has looked"], "correct": "had been looking"},
            {"points": 15, "text": "By the time she turned 20, she ___ piano for fifteen years.", "options": ["had been playing", "was playing", "played", "has been playing"], "correct": "had been playing"},
        ]
    },
    {
        "title": "19. Past Perfect Tense",
        "description": "O'tgan tugallangan zamon: o'tgan zamondagi biror payt yoki hodisadan oldin yuz bergan ish-harakatlar (had + V3).",
        "duration": 266,
        "order_index": 19,
        "video_file": "videos/grammar/Past Perfect.mp4",
        "thumbnail_key": "thumbnails/grammar/pastperfect.jpg",
        "deck_title": "Past Perfect (O'tgan tugallangan zamon)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "When we reached the cinema, the film ___ .", "options": ["had already started", "already started", "has already started", "was already starting"], "correct": "had already started"},
            {"points": 15, "text": "She didn't want to see the movie because she ___ the novel.", "options": ["had already read", "already read", "has read", "was reading"], "correct": "had already read"},
            {"points": 20, "text": "Hardly ___ the station when the train pulled out.", "options": ["had I reached", "I had reached", "did I reach", "I reached"], "correct": "had I reached"},
            {"points": 20, "text": "No sooner had he closed his eyes ___ the telephone rang.", "options": ["than", "when", "then", "that"], "correct": "than"},
            {"points": 15, "text": "By the time the ambulance arrived, the patient ___ .", "options": ["had recovered", "recovered", "has recovered", "was recovering"], "correct": "had recovered"},
            {"points": 10, "text": "I recognized her immediately because I ___ her before in Paris.", "options": ["had met", "met", "have met", "was meeting"], "correct": "had met"},
            {"points": 15, "text": "He realized that he ___ his keys inside the locked office.", "options": ["had forgotten", "forgot", "has forgotten", "was forgetting"], "correct": "had forgotten"},
            {"points": 10, "text": "They were very nervous because they ___ on an airplane before.", "options": ["had never flown", "never flew", "have never flown", "didn't fly"], "correct": "had never flown"},
            {"points": 15, "text": "After she ___ all her chores, she went out with friends.", "options": ["had completed", "completed", "has completed", "was completing"], "correct": "had completed"},
            {"points": 15, "text": "By 2018, he ___ three successful start-up ventures.", "options": ["had launched", "launched", "has launched", "was launching"], "correct": "had launched"},
            {"points": 15, "text": "Until yesterday, I ___ never ___ of that Uzbek author.", "options": ["had / heard", "have / heard", "did / hear", "was / hearing"], "correct": "had / heard"},
            {"points": 10, "text": "The lawn was yellow because there ___ no rain for weeks.", "options": ["had been", "was", "has been", "had being"], "correct": "had been"},
        ]
    },
    {
        "title": "20. Past Simple Tense & Used to",
        "description": "Oddiy o'tgan zamon: to'g'ri va noto'g'ri fe'llar, o'tgan zamon signallari hamda used to / would farqi.",
        "duration": 380,
        "order_index": 20,
        "video_file": "videos/grammar/Past Simple.mp4",
        "thumbnail_key": "thumbnails/grammar/pastsimple.jpg",
        "deck_title": "Past Simple (Oddiy o'tgan zamon)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "William Shakespeare ___ many world-famous tragedies.", "options": ["wrote", "has written", "had written", "writes"], "correct": "wrote"},
            {"points": 10, "text": "We ___ to Samarkand by high-speed train last weekend.", "options": ["traveled", "travel", "have traveled", "were traveling"], "correct": "traveled"},
            {"points": 10, "text": "Did you ___ the football match on television yesterday?", "options": ["watch", "watched", "watching", "watches"], "correct": "watch"},
            {"points": 15, "text": "My grandfather ___ live in a quiet countryside village.", "options": ["used to", "use to", "was used to", "got used to"], "correct": "used to"},
            {"points": 10, "text": "She ___ to work yesterday because she felt unwell.", "options": ["didn't go", "doesn't go", "didn't went", "wasn't go"], "correct": "didn't go"},
            {"points": 15, "text": "When ___ you ___ your official university diploma?", "options": ["did / receive", "have / received", "do / receive", "did / received"], "correct": "did / receive"},
            {"points": 10, "text": "He ___ a cup of hot green tea and left for the meeting.", "options": ["drank", "drunk", "drinks", "has drunk"], "correct": "drank"},
            {"points": 15, "text": "Two years ago, they ___ their family home in Bukhara.", "options": ["sold", "sell", "have sold", "had sold"], "correct": "sold"},
            {"points": 10, "text": "Where ___ you when the sudden thunderstorm began?", "options": ["were", "was", "are", "did you be"], "correct": "were"},
            {"points": 10, "text": "I ___ buy the watch because it was far too expensive.", "options": ["didn't", "don't", "wasn't", "haven't"], "correct": "didn't"},
            {"points": 15, "text": "They ___ in London for five years, but now live in Tashkent.", "options": ["lived", "have lived", "live", "were living"], "correct": "lived"},
            {"points": 10, "text": "How much ___ that designer leather briefcase cost?", "options": ["did", "was", "does", "is"], "correct": "did"},
        ]
    },
    {
        "title": "21. Personal & Possessive Pronouns",
        "description": "Kishilik va egalik olmoshlari: my vs mine, him vs himself, subject va object olmoshlarining to'g'ri qo'llanishi.",
        "duration": 599,
        "order_index": 21,
        "video_file": "videos/grammar/Personal and Posessive Pronouns.mp4",
        "thumbnail_key": "thumbnails/grammar/personalpossesivepronouns.jpg",
        "deck_title": "Pronouns (Kishilik va egalik olmoshlari)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "This handbag belongs to Lola. It is ___ .", "options": ["hers", "her", "she", "herself"], "correct": "hers"},
            {"points": 15, "text": "Neither John nor ___ was invited to the official dinner.", "options": ["I", "me", "myself", "mine"], "correct": "I"},
            {"points": 15, "text": "Strictly between you and ___ , our team will win the contest.", "options": ["me", "I", "my", "mine"], "correct": "me"},
            {"points": 10, "text": "He cut ___ while he was slicing fresh lemons.", "options": ["himself", "him", "his", "he"], "correct": "himself"},
            {"points": 10, "text": "Whose car is parked outside? - It is ___ .", "options": ["mine", "my", "me", "myself"], "correct": "mine"},
            {"points": 15, "text": "The cat licked ___ paws after finishing its warm milk.", "options": ["its", "it's", "its'", "itself"], "correct": "its"},
            {"points": 15, "text": "They repaired the garage roof all by ___ .", "options": ["themselves", "theirselves", "them", "theirs"], "correct": "themselves"},
            {"points": 10, "text": "Can you lend ___ your English dictionary for today?", "options": ["me", "I", "mine", "myself"], "correct": "me"},
            {"points": 15, "text": "Our house is much older and larger than ___ .", "options": ["theirs", "their", "them", "they"], "correct": "theirs"},
            {"points": 10, "text": "She looked at ___ carefully in the fitting mirror.", "options": ["herself", "her", "hers", "she"], "correct": "herself"},
            {"points": 15, "text": "Each candidate must submit ___ own portfolio.", "options": ["their", "theirs", "them", "themself"], "correct": "their"},
            {"points": 10, "text": "Don't worry about us; we can take good care of ___ .", "options": ["ourselves", "ourself", "us", "ours"], "correct": "ourselves"},
        ]
    },
    {
        "title": "22. Prepositions of Time, Place & Direction",
        "description": "Predloglar: vaqt (at, on, in), o'rin-joy va harakat yo'nalishi predloglari hamda bog'liq predloglar (dependent prepositions).",
        "duration": 899,
        "order_index": 22,
        "video_file": "videos/grammar/Prepositions.mp4",
        "thumbnail_key": "thumbnails/grammar/prepositions.jpg",
        "deck_title": "Prepositions (Predloglar)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "We are traveling to London ___ next Monday morning.", "options": ["on", "in", "at", "to"], "correct": "on"},
            {"points": 10, "text": "He was born ___ the 15th of May in 1998.", "options": ["on", "in", "at", "by"], "correct": "on"},
            {"points": 10, "text": "The express train departs sharply ___ 7:45 AM.", "options": ["at", "in", "on", "for"], "correct": "at"},
            {"points": 15, "text": "She is exceptionally good ___ solving difficult puzzles.", "options": ["at", "in", "with", "for"], "correct": "at"},
            {"points": 10, "text": "Are you interested ___ learning ancient world history?", "options": ["in", "at", "on", "about"], "correct": "in"},
            {"points": 15, "text": "He dived ___ the swimming pool to cool down.", "options": ["into", "in", "to", "onto"], "correct": "into"},
            {"points": 15, "text": "The airplane flew high ___ the mountain range.", "options": ["above", "over", "on", "upon"], "correct": "above"},
            {"points": 15, "text": "Divide the sweet melon ___ the four children.", "options": ["among", "between", "in", "with"], "correct": "among"},
            {"points": 15, "text": "The confidential secret was shared strictly ___ you and me.", "options": ["between", "among", "with", "to"], "correct": "between"},
            {"points": 15, "text": "He has been suffering ___ a bad toothache since yesterday.", "options": ["from", "of", "with", "at"], "correct": "from"},
            {"points": 15, "text": "We congratulated him ___ passing his university entrance exam.", "options": ["on", "for", "in", "at"], "correct": "on"},
            {"points": 15, "text": "She walked slowly ___ the dark underground tunnel.", "options": ["through", "across", "over", "along"], "correct": "through"},
        ]
    },
    {
        "title": "23. Present Continuous Tense",
        "description": "Hozirgi davomli zamon: ayni paytda sodir bo'layotgan ish-harakatlar, vaqtinchalik holatlar va stative verbs cheklovlari.",
        "duration": 622,
        "order_index": 23,
        "video_file": "videos/grammar/Present Continuous.mp4",
        "thumbnail_key": None,
        "deck_title": "Present Continuous (Hozirgi davomli zamon)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "Listen! Someone ___ the piano beautifully in the salon.", "options": ["is playing", "plays", "played", "has played"], "correct": "is playing"},
            {"points": 10, "text": "Right now, our team ___ an important research experiment.", "options": ["is conducting", "conducts", "conducted", "has conducted"], "correct": "is conducting"},
            {"points": 10, "text": "Why ___ you ___ dark sunglasses indoors today?", "options": ["are / wearing", "do / wear", "did / wear", "have / worn"], "correct": "are / wearing"},
            {"points": 15, "text": "I ___ what you mean, so no need to explain again.", "options": ["understand", "am understanding", "understood", "have understood"], "correct": "understand"},
            {"points": 15, "text": "He is always ___ his keys! It drives me crazy.", "options": ["losing", "loses", "lost", "lose"], "correct": "losing"},
            {"points": 15, "text": "The climate of our planet ___ warmer with every decade.", "options": ["is getting", "gets", "got", "has got"], "correct": "is getting"},
            {"points": 15, "text": "She ___ with her aunt in Samarkand until next term.", "options": ["is staying", "stays", "stayed", "has stayed"], "correct": "is staying"},
            {"points": 15, "text": "This luxurious villa ___ to a foreign diplomat.", "options": ["belongs", "is belonging", "belonged", "has belonged"], "correct": "belongs"},
            {"points": 10, "text": "Look at those kids! They ___ sandcastles on the shore.", "options": ["are building", "build", "built", "have built"], "correct": "are building"},
            {"points": 15, "text": "I ___ of buying an electric scooter next month.", "options": ["am thinking", "think", "thought", "have thought"], "correct": "am thinking"},
            {"points": 10, "text": "What ___ the chef ___ ? The aroma is wonderful!", "options": ["is / cooking", "does / cook", "did / cook", "has / cooked"], "correct": "is / cooking"},
            {"points": 15, "text": "Prices of organic vegetables ___ up rapidly these days.", "options": ["are going", "go", "went", "have gone"], "correct": "are going"},
        ]
    },
    {
        "title": "24. Present Perfect Continuous Tense",
        "description": "Hozirgi tugallangan davomli zamon: o'tmishda boshlanib hozirgacha davom etayotgan harakatlar (since, for) va ko'rinib turgan natija.",
        "duration": 285,
        "order_index": 24,
        "video_file": "videos/grammar/Present Perfect Continuous.mp4",
        "thumbnail_key": None,
        "deck_title": "Present Perfect Continuous (Hozirgi tugallangan davomli)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "It ___ without stopping since six o'clock this morning.", "options": ["has been raining", "is raining", "rained", "was raining"], "correct": "has been raining"},
            {"points": 15, "text": "I am completely out of breath because I ___ up the hill.", "options": ["have been running", "am running", "ran", "was running"], "correct": "have been running"},
            {"points": 15, "text": "How long ___ you ___ for this multinational company?", "options": ["have / been working", "are / working", "did / work", "do / work"], "correct": "have / been working"},
            {"points": 10, "text": "She ___ English for three years, and she speaks fluently.", "options": ["has been learning", "is learning", "learned", "learns"], "correct": "has been learning"},
            {"points": 15, "text": "His hands are dirty because he ___ his mountain bicycle.", "options": ["has been repairing", "repairs", "repaired", "is repairing"], "correct": "has been repairing"},
            {"points": 10, "text": "They ___ along the scenic coastline since early dawn.", "options": ["have been walking", "are walking", "walked", "were walking"], "correct": "have been walking"},
            {"points": 15, "text": "We ___ for the doctor in the lobby for over an hour.", "options": ["have been waiting", "are waiting", "waited", "were waiting"], "correct": "have been waiting"},
            {"points": 15, "text": "Why are your shoes wet? - I ___ the lawn in the garden.", "options": ["have been watering", "am watering", "watered", "water"], "correct": "have been watering"},
            {"points": 15, "text": "She is tired because she ___ all afternoon for the test.", "options": ["has been revising", "is revising", "revised", "revises"], "correct": "has been revising"},
            {"points": 10, "text": "The phone ___ for five minutes; why isn't anyone picking up?", "options": ["has been ringing", "is ringing", "rang", "rings"], "correct": "has been ringing"},
            {"points": 15, "text": "He ___ tennis since he was only seven years old.", "options": ["has been playing", "is playing", "played", "plays"], "correct": "has been playing"},
            {"points": 10, "text": "I ___ to reach your mobile phone all morning!", "options": ["have been trying", "am trying", "tried", "try"], "correct": "have been trying"},
        ]
    },
    {
        "title": "25. Present Perfect Tense",
        "description": "Hozirgi tugallangan zamon: tajriba (ever, never), yangi sodir bo'lgan voqealar (just, already, yet) va have been vs have gone farqi.",
        "duration": 369,
        "order_index": 25,
        "video_file": "videos/grammar/Present Perfect.mp4",
        "thumbnail_key": None,
        "deck_title": "Present Perfect (Hozirgi tugallangan zamon)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "Have you ___ visited the historic Registan square?", "options": ["ever", "never", "already", "yet"], "correct": "ever"},
            {"points": 10, "text": "I haven't received any confirmation email ___ .", "options": ["yet", "already", "still", "just"], "correct": "yet"},
            {"points": 10, "text": "She has ___ finished lunch, so she isn't hungry now.", "options": ["just", "yet", "ever", "never"], "correct": "just"},
            {"points": 15, "text": "Nodir is not at home. He has ___ to the central library.", "options": ["gone", "been", "went", "go"], "correct": "gone"},
            {"points": 15, "text": "I have ___ to Dubai three times on family holidays.", "options": ["been", "gone", "visited", "went"], "correct": "been"},
            {"points": 15, "text": "This is the most impressive historical museum I ___ .", "options": ["have ever seen", "ever saw", "saw", "see"], "correct": "have ever seen"},
            {"points": 10, "text": "We have lived in this cozy neighborhood ___ ten years.", "options": ["for", "since", "during", "from"], "correct": "for"},
            {"points": 10, "text": "She has worked as lead architect at this firm ___ 2015.", "options": ["since", "for", "in", "from"], "correct": "since"},
            {"points": 15, "text": "He ___ his smartphone; can you please call his number?", "options": ["has lost", "lost", "loses", "is losing"], "correct": "has lost"},
            {"points": 15, "text": "How many chapters of this textbook ___ you ___ so far?", "options": ["have / read", "did / read", "do / read", "are / reading"], "correct": "have / read"},
            {"points": 15, "text": "Scientists ___ an eco-friendly alternative to plastic.", "options": ["have developed", "developed", "develop", "are developing"], "correct": "have developed"},
            {"points": 10, "text": "I ___ seen Lola today; is she on holiday leave?", "options": ["haven't", "didn't", "don't", "wasn't"], "correct": "haven't"},
        ]
    },
    {
        "title": "26. Present Simple Tense",
        "description": "Oddiy hozirgi zamon: odatlar, doimiy qoidalar, tabiiy haqiqatlar, jadval bo'yicha harakatlar va 3-shaxs birlik qo'shimchalari.",
        "duration": 530,
        "order_index": 26,
        "video_file": "videos/grammar/Present Simple.mp4",
        "thumbnail_key": None,
        "deck_title": "Present Simple (Oddiy hozirgi zamon)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "The Earth ___ around the Sun once every 365 days.", "options": ["revolves", "is revolving", "revolved", "has revolved"], "correct": "revolves"},
            {"points": 10, "text": "The morning express train to Bukhara ___ at 07:30 AM.", "options": ["departs", "is departing", "departed", "depart"], "correct": "departs"},
            {"points": 10, "text": "My brother ___ coffee; he always drinks herbal tea.", "options": ["doesn't drink", "isn't drinking", "don't drink", "hasn't drunk"], "correct": "doesn't drink"},
            {"points": 10, "text": "Water ___ at zero degrees Celsius under normal pressure.", "options": ["freezes", "is freezing", "froze", "freeze"], "correct": "freezes"},
            {"points": 15, "text": "How often ___ you ___ the gym during the work week?", "options": ["do / visit", "are / visiting", "did / visit", "have / visited"], "correct": "do / visit"},
            {"points": 10, "text": "She ___ as a senior analyst in an investment bank.", "options": ["works", "is working", "work", "working"], "correct": "works"},
            {"points": 10, "text": "Vegetarians ___ any meat or poultry products.", "options": ["don't eat", "doesn't eat", "aren't eating", "haven't eaten"], "correct": "don't eat"},
            {"points": 10, "text": "What time ___ the grocery supermarket close on Sundays?", "options": ["does", "is", "do", "has"], "correct": "does"},
            {"points": 10, "text": "He usually ___ to the university campus by bicycle.", "options": ["goes", "is going", "go", "has gone"], "correct": "goes"},
            {"points": 10, "text": "Domestic cats ___ remarkable night vision for hunting.", "options": ["have", "has", "are having", "having"], "correct": "have"},
            {"points": 10, "text": "My parents ___ in a peaceful suburban neighborhood.", "options": ["live", "lives", "are living", "lived"], "correct": "live"},
            {"points": 10, "text": "I always ___ my teeth twice every single day.", "options": ["brush", "brushes", "am brushing", "brushed"], "correct": "brush"},
        ]
    },
    {
        "title": "27. Confusing Words: So, Such, Too, Enough, High & Tall",
        "description": "Chalkash so'zlar: so va such farqi, too va enough konstruksiyalari, elder vs older, high vs tall to'g'ri ishlatilishi.",
        "duration": 782,
        "order_index": 27,
        "video_file": "videos/grammar/so,such,enough,too,elder,high,tall.mp4",
        "thumbnail_key": None,
        "deck_title": "Confusing Words (So, Such, Too, Enough, Tall)",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "It was ___ a warm and sunny day that we went swimming.", "options": ["such", "so", "too", "very"], "correct": "such"},
            {"points": 10, "text": "The rocky mountain peak was ___ steep for tourists to climb.", "options": ["too", "so", "such", "enough"], "correct": "too"},
            {"points": 15, "text": "She is not experienced ___ to lead this global project.", "options": ["enough", "too", "so", "such"], "correct": "enough"},
            {"points": 10, "text": "The national pilaf in that restaurant was ___ delicious!", "options": ["so", "such", "too", "enough"], "correct": "so"},
            {"points": 15, "text": "They are ___ generous people that everyone respects them.", "options": ["such", "so", "too", "very"], "correct": "such"},
            {"points": 15, "text": "My ___ brother is an experienced civil engineer.", "options": ["elder", "older", "more old", "eldest"], "correct": "elder"},
            {"points": 10, "text": "Look at that modern skyscraper; it is remarkably ___ .", "options": ["tall", "high", "height", "taller"], "correct": "tall"},
            {"points": 15, "text": "The airplane flew at a very ___ altitude above the storm.", "options": ["high", "tall", "height", "higher"], "correct": "high"},
            {"points": 10, "text": "The heavy suitcase was ___ heavy that I couldn't lift it.", "options": ["so", "such", "too", "enough"], "correct": "so"},
            {"points": 15, "text": "We arrived early ___ to secure front-row theater seats.", "options": ["enough", "too", "so", "such"], "correct": "enough"},
            {"points": 10, "text": "He speaks ___ fast that it is difficult to follow him.", "options": ["so", "such", "too", "very"], "correct": "so"},
            {"points": 15, "text": "There was ___ much traffic that we were half an hour late.", "options": ["so", "such", "too", "enough"], "correct": "so"},
        ]
    },
    {
        "title": "28. Determiners: Some, Any, No & Compounds",
        "description": "Some va any aniqlovchilari, taklif va iltimoslarda some qo'llanilishi hamda hosil bo'lgan murakkab olmoshlar (someone, anything).",
        "duration": 519,
        "order_index": 28,
        "video_file": "videos/grammar/Some va Any.mp4",
        "thumbnail_key": None,
        "deck_title": "Some, Any and Compounds",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "Would you like ___ hot herbal tea with lemon?", "options": ["some", "any", "no", "none"], "correct": "some"},
            {"points": 10, "text": "I don't have ___ spare cash in my pocket right now.", "options": ["any", "some", "no", "none"], "correct": "any"},
            {"points": 10, "text": "There is ___ waiting for you at the reception desk.", "options": ["someone", "anyone", "no one", "everyone"], "correct": "someone"},
            {"points": 10, "text": "Did you find ___ interesting grammar books at the shop?", "options": ["any", "some", "none", "no"], "correct": "any"},
            {"points": 15, "text": "Can I have ___ more fresh salad, please?", "options": ["some", "any", "no", "none"], "correct": "some"},
            {"points": 15, "text": "There are ___ apples left in the basket; it is empty.", "options": ["no", "any", "some", "none"], "correct": "no"},
            {"points": 10, "text": "I looked everywhere, but couldn't find my keys ___ .", "options": ["anywhere", "somewhere", "nowhere", "everywhere"], "correct": "anywhere"},
            {"points": 15, "text": "Hardly ___ showed up to the early morning seminar.", "options": ["anybody", "somebody", "nobody", "everybody"], "correct": "anybody"},
            {"points": 15, "text": "She solved the difficult riddle without ___ help.", "options": ["any", "some", "no", "none"], "correct": "any"},
            {"points": 20, "text": "___ of the students could answer the tricky question.", "options": ["None", "No", "Any", "Some"], "correct": "None"},
            {"points": 10, "text": "We bought ___ fresh bread and fruit from the grocery.", "options": ["some", "any", "no", "none"], "correct": "some"},
            {"points": 15, "text": "If ___ calls while I am out, please take a note.", "options": ["anyone", "someone", "no one", "none"], "correct": "anyone"},
        ]
    },
    {
        "title": "29. Question Tags & Short Answers",
        "description": "Ajratuvchi savollar (Question Tags): tasdiq-inkor qoidalari, istisno holatlar (I am -> aren't I, Let's -> shall we) va qisqa javoblar.",
        "duration": 1001,
        "order_index": 29,
        "video_file": "videos/grammar/Tag questions va Short Answers.mp4",
        "thumbnail_key": None,
        "deck_title": "Question Tags & Short Answers",
        "category": "Grammar",
        "questions": [
            {"points": 10, "text": "You live in Tashkent, ___ ?", "options": ["don't you", "do you", "aren't you", "haven't you"], "correct": "don't you"},
            {"points": 10, "text": "She didn't attend yesterday's conference, ___ ?", "options": ["did she", "didn't she", "was she", "has she"], "correct": "did she"},
            {"points": 20, "text": "I am your mentor for this grammar course, ___ ?", "options": ["aren't I", "am not I", "amn't I", "don't I"], "correct": "aren't I"},
            {"points": 15, "text": "Let's take a short coffee break now, ___ ?", "options": ["shall we", "will we", "do we", "don't we"], "correct": "shall we"},
            {"points": 20, "text": "Nobody called while I was out at the bank, ___ ?", "options": ["did they", "didn't they", "did he", "didn't he"], "correct": "did they"},
            {"points": 15, "text": "Close the front door quietly, ___ ?", "options": ["will you", "do you", "shall you", "don't you"], "correct": "will you"},
            {"points": 10, "text": "He has already finished the assigned task, ___ ?", "options": ["hasn't he", "has he", "doesn't he", "didn't he"], "correct": "hasn't he"},
            {"points": 10, "text": "They were surprised by the unexpected announcement, ___ ?", "options": ["weren't they", "were they", "didn't they", "aren't they"], "correct": "weren't they"},
            {"points": 15, "text": "Nothing serious happened during the trip, ___ ?", "options": ["did it", "didn't it", "was it", "wasn't it"], "correct": "did it"},
            {"points": 10, "text": "You won't tell anyone my password, ___ ?", "options": ["will you", "won't you", "do you", "don't you"], "correct": "will you"},
            {"points": 10, "text": "There is enough milk left for breakfast, ___ ?", "options": ["isn't there", "is there", "isn't it", "is it"], "correct": "isn't there"},
            {"points": 10, "text": "She can speak Italian fluently, ___ ?", "options": ["can't she", "can she", "doesn't she", "couldn't she"], "correct": "can't she"},
        ]
    },
]


def assemble_bamboozle_deck(questions):
    """Inject 4 standard surprise cards at slots 3, 7, 11, 15 into 12 question cards."""
    surprises = [
        (3, {"points": 0, "text": "🔄 SYURPRIZ: Ballarni Almashtirish (Swap)!", "options": [], "correct": "", "type": CardType.SWAP}),
        (7, {"points": 0, "text": "🥷 SYURPRIZ: Raqibdan 15 Ball O'g'irlash (Steal)!", "options": [], "correct": "", "type": CardType.STEAL}),
        (11, {"points": 0, "text": "⚡️ SYURPRIZ: 2x Multiplier Ball!", "options": [], "correct": "", "type": CardType.DOUBLE}),
        (15, {"points": 0, "text": "💣 BOMBA: -15 Ball Jarima!", "options": [], "correct": "", "type": CardType.BOMB}),
    ]
    cards = []
    q_idx = 0
    surprise_dict = {pos: data for pos, data in surprises}

    for slot in range(1, 17):
        if slot in surprise_dict:
            cards.append(surprise_dict[slot])
        else:
            if q_idx < len(questions):
                q = dict(questions[q_idx])
                q["type"] = CardType.QUESTION
                cards.append(q)
                q_idx += 1
    return cards


class Command(BaseCommand):
    help = "Seed ALL 29 Grammar Video Lessons, tied QuizDecks and error-free solo/bamboozle cards."

    def handle(self, *args, **options):
        self.stdout.write("Starting Master Grammar Seeding for all 29 lessons...")

        with transaction.atomic():
            course, _ = Course.objects.update_or_create(
                title="English Grammar Foundation: Nouns to Articles",
                defaults={
                    "description": "Ingliz tili grammatikasining to'liq amaliy kursi: barcha 29 ta mavzu bo'yicha video darslar, yakkaxon testlar va jamoaviy Bamboozle bellashuvlari.",
                    "thumbnail_url": "/static/images/grammar_foundation.jpg",
                },
            )
            self.stdout.write(f"Course ready: {course.title} ({course.id})")

            admin_user = User.objects.filter(role__in=["admin", "super_admin"]).first()

            # Process Part 1 (Lessons 1-6)
            for l_data in LESSONS_PART_1:
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
                        "thumbnail_key": l_data.get("thumbnail_key"),
                        "created_at": timezone.now(),
                    },
                )

                deck, _ = QuizDeck.objects.update_or_create(
                    title=l_data["deck_title"],
                    defaults={
                        "category": l_data["category"],
                        "is_lesson_tied": True,
                        "lesson": lesson,
                        "created_by": admin_user,
                    },
                )
                if deck.lesson_id != lesson.id:
                    deck.lesson = lesson
                    deck.is_lesson_tied = True
                    deck.save(update_fields=["lesson", "is_lesson_tied"])

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
                self.stdout.write(f"  -> Lesson #{lesson.order_index}: '{lesson.title}' - Deck: {deck.cards.count()} cards")

            # Process Part 2 (Lessons 7-29)
            for l_data in LESSONS_PART_2:
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
                        "thumbnail_key": l_data.get("thumbnail_key"),
                        "created_at": timezone.now(),
                    },
                )

                deck, _ = QuizDeck.objects.update_or_create(
                    title=l_data["deck_title"],
                    defaults={
                        "category": l_data["category"],
                        "is_lesson_tied": True,
                        "lesson": lesson,
                        "created_by": admin_user,
                    },
                )
                if deck.lesson_id != lesson.id:
                    deck.lesson = lesson
                    deck.is_lesson_tied = True
                    deck.save(update_fields=["lesson", "is_lesson_tied"])

                deck.cards.all().delete()
                deck_cards = assemble_bamboozle_deck(l_data["questions"])
                for c_idx, c_data in enumerate(deck_cards, start=1):
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
                self.stdout.write(f"  -> Lesson #{lesson.order_index}: '{lesson.title}' - Deck: {deck.cards.count()} cards")

        self.stdout.write(self.style.SUCCESS("All 29 Grammar Video Lessons and Quizzes successfully seeded!"))
