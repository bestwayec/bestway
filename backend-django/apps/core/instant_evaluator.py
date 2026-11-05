"""Instant AI Writing and Speaking Evaluation Engine.
Provides instant, real-time rubric evaluation across the 4 official criteria:
- Task Achievement / Response
- Coherence & Cohesion
- Lexical Resource
- Grammatical Range & Accuracy
Includes red/green error corrections, vocabulary upgrades, and C1 model answers.
"""
from __future__ import annotations

import re
import os
import math
import time
from typing import Any, Dict, List, Optional, Tuple


# Common ESL Grammar Mistakes with explanations
GRAMMAR_PATTERNS: List[Dict[str, str]] = [
    {
        "pattern": r"\b(peoples? thinks?)\b",
        "original": "people thinks",
        "corrected": "people think",
        "explanation": "'People' is an irregular plural noun and requires the plural verb 'think' without '-s'."
    },
    {
        "pattern": r"\b(childs)\b",
        "original": "childs",
        "corrected": "children",
        "explanation": "The plural form of 'child' is irregular: 'children', not 'childs'."
    },
    {
        "pattern": r"\b(womans)\b",
        "original": "womans",
        "corrected": "women",
        "explanation": "The plural form of 'woman' is irregular: 'women'."
    },
    {
        "pattern": r"\b(mens)\b",
        "original": "mens",
        "corrected": "men",
        "explanation": "The plural form of 'man' is irregular: 'men'."
    },
    {
        "pattern": r"\b(informations?)\b",
        "original": "informations",
        "corrected": "information / pieces of information",
        "explanation": "'Information' is an uncountable noun in English and cannot be pluralized with '-s'."
    },
    {
        "pattern": r"\b(advices?)\b",
        "original": "advices",
        "corrected": "advice / words of advice",
        "explanation": "'Advice' is uncountable; use 'pieces of advice' for countable instances."
    },
    {
        "pattern": r"\b(discuss about)\b",
        "original": "discuss about",
        "corrected": "discuss",
        "explanation": "The verb 'discuss' is transitive and takes a direct object without the preposition 'about'."
    },
    {
        "pattern": r"\b(depend of)\b",
        "original": "depend of",
        "corrected": "depend on",
        "explanation": "The correct dependent preposition for 'depend' is 'on' (or 'upon'), not 'of'."
    },
    {
        "pattern": r"\b(according to my opinion)\b",
        "original": "according to my opinion",
        "corrected": "in my opinion / from my perspective",
        "explanation": "'According to' is used for third parties or authorities, not for one's own opinion."
    },
    {
        "pattern": r"\b(responsible of)\b",
        "original": "responsible of",
        "corrected": "responsible for",
        "explanation": "The adjective 'responsible' collocate with 'for' when referring to duties or causes."
    },
    {
        "pattern": r"\b(different than)\b",
        "original": "different than",
        "corrected": "different from",
        "explanation": "In standard academic English, 'different from' is preferred over 'different than'."
    },
    {
        "pattern": r"\b(interested for)\b",
        "original": "interested for",
        "corrected": "interested in",
        "explanation": "'Interested' takes the preposition 'in' when expressing attraction or curiosity."
    },
    {
        "pattern": r"\b(married with)\b",
        "original": "married with",
        "corrected": "married to",
        "explanation": "In English, a person is 'married to' someone, not 'married with'."
    },
    {
        "pattern": r"\b(despite of)\b",
        "original": "despite of",
        "corrected": "despite / in spite of",
        "explanation": "'Despite' is a preposition used without 'of'; use either 'despite' or 'in spite of'."
    },
    {
        "pattern": r"\b(in the another hand)\b",
        "original": "in the another hand",
        "corrected": "on the other hand",
        "explanation": "The fixed idiomatic contrast connector is 'on the other hand'."
    },
    {
        "pattern": r"\b(every students? have)\b",
        "original": "every student have",
        "corrected": "every student has",
        "explanation": "'Every' takes a singular noun ('student') and a singular verb ('has')."
    },
    {
        "pattern": r"\b(there is many)\b",
        "original": "there is many",
        "corrected": "there are many",
        "explanation": "'There are' must agree with the plural subject that follows ('many...')."
    },
    {
        "pattern": r"\b(more better)\b",
        "original": "more better",
        "corrected": "better / significantly better",
        "explanation": "'Better' is already the comparative form of 'good'; avoid double comparatives like 'more better'."
    },
    {
        "pattern": r"\b(did not went|didn\'t went)\b",
        "original": "didn't went",
        "corrected": "didn't go",
        "explanation": "The auxiliary verb 'did' must be followed by the base bare infinitive form ('go')."
    },
    {
        "pattern": r"\b(if I will)\b",
        "original": "if I will",
        "corrected": "if I",
        "explanation": "In first conditional clauses expressing future conditions, use Present Simple after 'if', not 'will'."
    },
]

# Academic Vocabulary Upgrades (C1/C2 Lexical Resource)
VOCABULARY_REPLACEMENTS: List[Dict[str, str]] = [
    {
        "pattern": r"\b(a lot of|lots of)\b",
        "original": "a lot of",
        "alternative": "a myriad of / a substantial proportion of",
        "explanation": "Replacing informal quantifiers with academic alternatives enhances Lexical Resource."
    },
    {
        "pattern": r"\b(very important)\b",
        "original": "very important",
        "alternative": "paramount / crucial / pivotal",
        "explanation": "Use high-tier adjectives to convey significance with greater precision."
    },
    {
        "pattern": r"\b(big problem)\b",
        "original": "big problem",
        "alternative": "pressing issue / formidable obstacle",
        "explanation": "'Pressing issue' is an academic collocation that conveys urgency and depth."
    },
    {
        "pattern": r"\b(good for)\b",
        "original": "good for",
        "alternative": "conducive to / beneficial for",
        "explanation": "'Conducive to' is an advanced academic collocation for positive influence."
    },
    {
        "pattern": r"\b(make better)\b",
        "original": "make better",
        "alternative": "ameliorate / enhance / optimize",
        "explanation": "Academic verbs elevate the formal register of your arguments."
    },
    {
        "pattern": r"\b(bad impact)\b",
        "original": "bad impact",
        "alternative": "detrimental repercussion / adverse effect",
        "explanation": "'Detrimental repercussion' demonstrates Band 8+ collocations."
    },
    {
        "pattern": r"\b(I think that)\b",
        "original": "I think that",
        "alternative": "It is my conviction that / I firmly contend that",
        "explanation": "Sophisticated stance markers clearly express your thesis statement."
    },
    {
        "pattern": r"\b(show that)\b",
        "original": "show that",
        "alternative": "elucidate / exemplify / substantiate that",
        "explanation": "Using precise reporting verbs strengthens Task Response and Lexical Resource."
    },
    {
        "pattern": r"\b(help)\b",
        "original": "help",
        "alternative": "facilitate / bolster / expedite",
        "explanation": "'Facilitate' or 'bolster' provide formal academic precision."
    },
    {
        "pattern": r"\b(nowadays)\b",
        "original": "nowadays",
        "alternative": "in contemporary society / in the present era",
        "explanation": "'Nowadays' is overused in student writing; modern contextual openers are preferred."
    },
]

# Discourse markers for Coherence & Cohesion evaluation
DISCOURSE_MARKERS = [
    "furthermore", "moreover", "consequently", "in addition", "nevertheless",
    "nonetheless", "conversely", "to illustrate", "for instance", "as a result",
    "on the contrary", "in contrast", "subsequently", "accordingly", "therefore",
    "thus", "notably", "significantly", "in conclusion", "to summarize"
]

# Complex syntactic structures for Grammatical Range
COMPLEX_STRUCTURES = [
    "although", "even though", "whereas", "while", "despite", "in spite of",
    "not only", "provided that", "unless", "in order to", "so as to",
    "which", "who", "whom", "whose", "whereby", "had it not been",
    "were it to", "it is evident that", "it is widely acknowledged"
]


def _round_to_half(val: float) -> float:
    """Round to nearest 0.5."""
    return round(val * 2) / 2


def _map_band_to_cefr(band: float) -> str:
    """Convert IELTS/Multilevel band to CEFR level."""
    if band >= 8.0:
        return "C2"
    if band >= 7.0:
        return "C1"
    if band >= 5.5:
        return "B2"
    if band >= 4.0:
        return "B1"
    return "A2"


def _generate_c1_model_answer(prompt: str, user_text: str, skill: str = "writing") -> str:
    """Generate an authentic C1 academic model answer tailored to the topic."""
    # Detect theme from prompt or user text
    combined = (prompt + " " + user_text).lower()
    
    if any(k in combined for k in ["tech", "ai", "computer", "internet", "phone", "digital", "robot"]):
        topic_title = "Technological Advancement and Human Society"
        intro = (
            "In contemporary society, the relentless progression of digital technology and automation "
            "has fundamentally reshaped both commercial landscapes and interpersonal dynamics. While "
            "skeptics express legitimate reservations regarding diminished human interaction and employment volatility, "
            "I firmly contend that the overarching societal dividends of technological innovation substantially "
            "outweigh these transient challenges."
        )
        body1 = (
            "Primarily, technological integration acts as a powerful catalyst for unprecedented global efficiency "
            "and information democratization. Cloud infrastructure, telecommunications, and artificial intelligence "
            "tools have revolutionized scientific research and healthcare diagnostics, facilitating breakthroughs "
            "that were previously inconceivable. To illustrate, telemedicine now enables specialized practitioners "
            "to administer vital clinical consultations to underserved rural demographics, thereby bridging historical "
            "disparities in healthcare accessibility."
        )
        body2 = (
            "Furthermore, while critics caution that pervasive automation risks displacing manual labor sectors, "
            "empirical evidence demonstrates that technological revolutions consistently cultivate sophisticated "
            "new employment paradigms. Industries focusing on cybersecurity, green energy engineering, and digital "
            "ethics are expanding rapidly. Consequently, rather than eliminating human enterprise, technological tools "
            "serve to emancipate individuals from hazardous, repetitive tasks, allowing workforce capital to pivot "
            "toward strategic, creative, and intellectual pursuits."
        )
        conclusion = (
            "In conclusion, while mindful policy regulation is undoubtedly imperative to address ethical parameters "
            "and data confidentiality, technological integration remains a cornerstone of collective prosperity. "
            "By fostering adaptive education and equitable technological infrastructure, society can harness these "
            "innovations to bolster global socioeconomic resilience."
        )
    elif any(k in combined for k in ["educat", "school", "universit", "study", "student", "teacher", "learn"]):
        topic_title = "Academic Theory vs. Practical Workforce Preparedness"
        intro = (
            "The quintessential purpose of tertiary education remains a matter of intense academic deliberation. "
            "While some maintain that universities should prioritize specialized vocational competencies tailored "
            "for immediate market absorption, others assert that institutions must foster comprehensive critical "
            "inquiry and intellectual curiosity. It is my conviction that a harmonious synthesis of both paradigms "
            "yields the most resilient academic framework."
        )
        body1 = (
            "On the one hand, equipping undergraduates with pragmatic, employment-oriented capabilities is undeniably "
            "crucial in modern competitive economies. Rapidly evolving industries—such as software architecture and financial "
            "analytics—demand graduates who possess immediate operational literacy without requiring protracted corporate "
            "onboarding. When educational curricula incorporate mandatory apprenticeships and real-world project simulations, "
            "graduates exhibit heightened employability metrics, directly benefiting commercial productivity."
        )
        body2 = (
            "Nonetheless, subordinating university education entirely to transitory corporate demands risks eroding "
            "fundamental scholarly inquiry. Higher education must cultivate analytical acumen, moral reasoning, and interdisciplinary "
            "problem-solving. For instance, studying classical philosophy or theoretical physics imparts cognitive adaptability, "
            "enabling scholars to navigate novel existential paradigms rather than merely executing prescribed vocational protocols. "
            "This intellectual breadth forms the bedrock of visionary leadership."
        )
        conclusion = (
            "To encapsulate, modern universities must transcend the binary distinction between vocational utility and "
            "theoretical scholarship. By embedding practical market competencies within a rigorous bedrock of academic "
            "inquiry, academic institutions can cultivate enlightened, versatile professionals prepared to spearhead future innovation."
        )
    elif any(k in combined for k in ["environment", "climate", "pollut", "plastic", "green", "energy", "planet"]):
        topic_title = "Environmental Sustainability and Global Responsibility"
        intro = (
            "Environmental degradation and climate variability undoubtedly constitute the defining existential challenges "
            "of the twenty-first century. While substantial debate centers on whether the onus of remediation lies with "
            "individual consumers or sovereign governmental entities, I contend that coordinated governmental intervention "
            "provides the indispensable legislative leverage required to achieve tangible planetary rejuvenation."
        )
        body1 = (
            "Principally, sovereign legislative bodies possess the regulatory authority to enact sweeping systemic reforms "
            "that transcend individual goodwill. Governments can enforce punitive carbon taxation on multinational conglomerates, "
            "mandate sustainable manufacturing standards, and allocate state funding toward renewable energy infrastructure such "
            "as solar and offshore wind farms. Denmark serves as a compelling archetype, having transformed its national energy "
            "matrix through decisive statutory commitments to green technologies."
        )
        body2 = (
            "Conversely, consumer habits without systemic scaffolding yield localized rather than macroscopic solutions. "
            "While conscientious individuals can minimize household waste or utilize public transit, their efforts are frequently "
            "neutralized if industrial supply chains remain reliant on fossil combustibles. Nevertheless, grassroots consumer advocacy "
            "remains vital as a democratic catalyst that compels corporations to embrace circular economic principles and ethical transparency."
        )
        conclusion = (
            "In conclusion, while civic environmental stewardship is commendable, meaningful mitigation of ecological crises "
            "necessitates aggressive legislative leadership and international treaties. Only through authoritative governmental "
            "policy can global economic incentives align seamlessly with environmental preservation."
        )
    else:
        topic_title = "Contemporary Societal Dynamics and Progress"
        intro = (
            "Across the globe, rapid socioeconomic transformations have stimulated vibrant discourse regarding the optimal "
            "balance between individual autonomy and collective communal welfare. While divergent viewpoints persist, "
            "a nuanced examination demonstrates that fostering inclusive institutions and equitable opportunity remains "
            "the preeminent prerequisite for sustainable communal development."
        )
        body1 = (
            "From an institutional perspective, equitable access to civic resources—including healthcare, high-caliber education, "
            "and legal protection—substantially diminishes systemic friction and social alienation. When marginalized demographics "
            "are empowered to participate constructively in public discourse, economies experience multifaceted enrichment. "
            "Historical evidence across Nordic economies affirms that strong social safety nets correlate directly with heightened "
            "entrepreneurship and subjective well-being."
        )
        body2 = (
            "Furthermore, modern progress necessitates transparent democratic governance coupled with technological literacy. "
            "Encouraging civic dialogue ensures that policy measures resonate with grassroots realities rather than bureaucratic "
            "abstractions. Consequently, societal harmony is bolstered when individuals feel valued both as autonomous agents "
            "and as vital contributors to a cohesive civil collective."
        )
        conclusion = (
            "Ultimately, advancing societal resilience requires harmonizing individual enterprise with robust civic infrastructure. "
            "By investing in human capital and ethical institutional frameworks, communities can navigate future uncertainties "
            "with confidence and shared purpose."
        )

    return f"### {topic_title} (C1 Academic Model Answer)\n\n{intro}\n\n{body1}\n\n{body2}\n\n{conclusion}"


def evaluate_text_instant(
    text: str,
    prompt: str = "",
    skill: str = "writing",
    task_type: str = "task2",
    program: str = "IELTS",
) -> Dict[str, Any]:
    """Fail closed until an evidence-backed instant assessment is available."""
    from common.api.exceptions import ContractAPIException

    raise ContractAPIException(
        'INSTANT_ASSESSMENT_UNAVAILABLE',
        'Tezkor baholash vaqtincha mavjud emas. Imtihon natijalari sahifasidan foydalaning.',
        503,
    )
