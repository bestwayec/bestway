"""Storage and authorized URLs for handwritten exam evidence."""
from pathlib import Path
from urllib.parse import quote

from .content_media import storage_path


def page_urls(attempt_id, question_id, keys):
    prefix = f"/api/backend/mock/attempts/{quote(attempt_id, safe='')}/writing-pages/{quote(question_id, safe='')}"
    return [f"{prefix}/{index}" for index, _ in enumerate(keys)]


def page_file(attempt_id, key):
    if not isinstance(key, str):
        return None
    relative = Path(key)
    roots = (Path("writing-ocr") / attempt_id, Path("private/writing-ocr") / attempt_id)
    mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
    if relative.parent not in roots or relative.suffix.lower() not in mime:
        return None
    file = storage_path(key).resolve()
    if file.parent != storage_path(str(relative.parent)).resolve() or not file.is_file():
        return None
    return file, mime[relative.suffix.lower()]


def handwriting_fields(rubric):
    if not isinstance(rubric, dict):
        return {}
    return {field: rubric[field] for field in ("imageKeys", "ocrText", "wordCount") if field in rubric}
