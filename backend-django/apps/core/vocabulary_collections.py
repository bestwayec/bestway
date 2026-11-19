"""Collection editing and durable revisions for classroom vocabulary."""
from urllib.parse import urlsplit

from django.db import transaction

from common.api.exceptions import ContractAPIException

from .domain_contracts import invalid
from .models import HomeworkAssignment, VocabularyLevel, VocabularySet, VocabularyWord


MAX_WORDS = 500
WORD_FIELDS = {
    "english": ("english", 255),
    "uzbek": ("uzbek", 255),
    "contextSentence": ("context_sentence", 2000),
    "partOfSpeech": ("part_of_speech", 50),
    "definition": ("definition", 2000),
    "pronunciation": ("pronunciation", 255),
    "audioUrl": ("audio_url", 500),
}


def word_payload(word):
    return {
        "id": word.id,
        **{key: getattr(word, field) for key, (field, _) in WORD_FIELDS.items()},
        "synonyms": word.synonyms,
        "level": word.level,
    }


def snapshot(vocab_set):
    return {
        "revision": vocab_set.revision,
        "title": vocab_set.title,
        "level": vocab_set.level,
        "words": [word_payload(row) for row in vocab_set.words.filter(is_archived=False)],
    }


def assignment_revision(assignment):
    if assignment.vocabulary_revision is not None:
        return assignment.vocabulary_revision
    vocab_set = VocabularySet.objects.select_for_update().get(id=assignment.vocabulary_set_id)
    existing = HomeworkAssignment.objects.filter(id=assignment.id).values_list("vocabulary_revision", flat=True).get()
    if existing is not None:
        return existing
    current = snapshot(vocab_set)
    HomeworkAssignment.objects.filter(id=assignment.id).update(vocabulary_revision=current)
    return current


def text(value, label, limit, required=False):
    if not isinstance(value, str) or len(value.strip()) > limit or (required and not value.strip()):
        invalid(f"Invalid {label}")
    return value.strip()


def clean_words(words):
    if not isinstance(words, list) or not 1 <= len(words) <= MAX_WORDS:
        invalid(f"Provide 1–{MAX_WORDS} words")
    cleaned = []
    unique = set()
    seen_ids = set()
    for row in words:
        if not isinstance(row, dict) or set(row) - (WORD_FIELDS.keys() | {"id", "synonyms", "level"}):
            invalid("Invalid word data")
        word_id = row.get("id")
        if word_id is not None:
            if not isinstance(word_id, str) or not word_id or word_id in seen_ids:
                invalid("Word IDs must be unique")
            seen_ids.add(word_id)
        entry = {
            field: text(row.get(key) if row.get(key) is not None else "", key, limit, key in ("english", "uzbek"))
            for key, (field, limit) in WORD_FIELDS.items()
        }
        pair = tuple(" ".join(entry[key].casefold().split()) for key in ("english", "uzbek"))
        if pair in unique:
            invalid("Duplicate word and translation")
        unique.add(pair)
        synonyms = row.get("synonyms", [])
        if not isinstance(synonyms, list) or len(synonyms) > 20:
            invalid("Provide up to 20 synonyms")
        entry["synonyms"] = [text(value, "synonym", 255, True) for value in synonyms]
        level = row.get("level", "")
        if level and level not in VocabularyLevel.values:
            invalid("Invalid word level")
        entry["level"] = level or ""
        if entry["audio_url"]:
            try:
                audio = urlsplit(entry["audio_url"])
                valid = audio.scheme == "https" and audio.hostname and audio.username is None and not audio.fragment
            except ValueError:
                valid = False
            if not valid:
                invalid("Audio URL must be HTTPS")
        cleaned.append((word_id, entry))
    return cleaned


@transaction.atomic
def edit_collection(vocab_set, data):
    locked = VocabularySet.objects.select_for_update().get(id=vocab_set.id)
    revision = data.get("revision")
    if type(revision) is not int or revision != locked.revision:
        raise ContractAPIException("VOCABULARY_REVISION_CONFLICT", "Reload the collection before editing again", 409)
    # Legacy assignments retain the last known pre-edit collection.
    legacy = HomeworkAssignment.objects.filter(vocabulary_set=locked, vocabulary_revision__isnull=True)
    if legacy.exists():
        legacy.update(vocabulary_revision=snapshot(locked))
    fields = []
    if "title" in data:
        locked.title = text(data["title"], "title", 255, True)
        fields.append("title")
    if "description" in data:
        locked.description = text(data["description"], "description", 4000)
        fields.append("description")
    if "level" in data:
        if data["level"] not in VocabularyLevel.values:
            invalid("Invalid collection level")
        locked.level = data["level"]
        fields.append("level")
    if "isPublic" in data:
        if type(data["isPublic"]) is not bool:
            invalid("isPublic must be boolean")
        locked.is_public = data["isPublic"]
        fields.append("is_public")

    if "words" in data:
        words = clean_words(data["words"])
        active = {row.id for row in locked.words.filter(is_archived=False)}
        retained = {identifier for identifier, _ in words if identifier is not None}
        if not retained <= active:
            invalid("A word does not belong to this collection revision")
        locked.words.filter(id__in=active - retained).update(is_archived=True)
        for identifier, fields_for_word in words:
            if identifier:
                locked.words.filter(id=identifier).update(**fields_for_word)
            else:
                VocabularyWord.objects.create(set=locked, **fields_for_word)
    locked.revision += 1
    locked.save(update_fields=[*fields, "revision", "updated_at"])
    return locked
