"""Writing and Speaking topic bank management service with mock exam synchronization.

Provides reliable storage, querying, and practice synchronization for IELTS topics.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
import uuid

from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone

from common.api.exceptions import ContractAPIException

logger = logging.getLogger(__name__)

_table_ensured = False


def ensure_table_exists() -> None:
    """Ensures the TopicBank table and necessary indexes exist."""
    global _table_ensured
    with connection.cursor() as cursor:
        if connection.vendor == "postgresql":
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS "TopicBank" (
                    "id" VARCHAR(255) PRIMARY KEY,
                    "skill" VARCHAR(30) NOT NULL,
                    "type" VARCHAR(30) NOT NULL,
                    "title" TEXT NOT NULL,
                    "prompt_text" TEXT NOT NULL,
                    "image_url" TEXT,
                    "image_key" TEXT,
                    "bullet_points" JSONB,
                    "followup_questions" JSONB,
                    "target_band_level" VARCHAR(30) DEFAULT '7.0',
                    "is_active" BOOLEAN DEFAULT TRUE,
                    "created_by_id" VARCHAR(255),
                    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS "idx_topicbank_skill_type" ON "TopicBank" ("skill", "type", "is_active");
                CREATE INDEX IF NOT EXISTS "idx_topicbank_created_at" ON "TopicBank" ("created_at" DESC);
            """)
        else:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS "TopicBank" (
                    "id" VARCHAR(255) PRIMARY KEY,
                    "skill" VARCHAR(30) NOT NULL,
                    "type" VARCHAR(30) NOT NULL,
                    "title" TEXT NOT NULL,
                    "prompt_text" TEXT NOT NULL,
                    "image_url" TEXT,
                    "image_key" TEXT,
                    "bullet_points" JSON,
                    "followup_questions" JSON,
                    "target_band_level" VARCHAR(30) DEFAULT '7.0',
                    "is_active" BOOLEAN DEFAULT 1,
                    "created_by_id" VARCHAR(255),
                    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS "idx_topicbank_skill_type" ON "TopicBank" ("skill", "type", "is_active");
                CREATE INDEX IF NOT EXISTS "idx_topicbank_created_at" ON "TopicBank" ("created_at" DESC);
            """)
    _table_ensured = True


def _check_table() -> None:
    global _table_ensured
    if not _table_ensured:
        ensure_table_exists()


def _row_to_dict(row) -> dict | None:
    if not row:
        return None

    bp = row[7]
    if isinstance(bp, str):
        try:
            bp = json.loads(bp)
        except Exception:
            pass

    fq = row[8]
    if isinstance(fq, str):
        try:
            fq = json.loads(fq)
        except Exception:
            pass

    c_at = row[12].isoformat() if hasattr(row[12], "isoformat") else (str(row[12]) if row[12] is not None else None)
    u_at = row[13].isoformat() if hasattr(row[13], "isoformat") else (str(row[13]) if row[13] is not None else None)

    return {
        "id": row[0],
        "skill": row[1],
        "type": row[2],
        "title": row[3],
        "prompt_text": row[4],
        "promptText": row[4],
        "image_url": row[5],
        "imageUrl": row[5],
        "image_key": row[6],
        "imageKey": row[6],
        "bullet_points": bp,
        "bulletPoints": bp,
        "followup_questions": fq,
        "followupQuestions": fq,
        "target_band_level": row[9],
        "targetBandLevel": row[9],
        "is_active": bool(row[10]),
        "isActive": bool(row[10]),
        "created_by_id": row[11],
        "createdById": row[11],
        "created_at": c_at,
        "createdAt": c_at,
        "updated_at": u_at,
        "updatedAt": u_at,
    }


def create_writing_topic(
    title: str,
    prompt_text: str,
    task_type: str = "task2",
    image_key: str = None,
    image_url: str = None,
    target_band_level: str = "7.0",
    created_by_id: str = None,
) -> dict:
    """Creates a new Writing topic (Task 1 or Task 2) and synchronizes with mock exam."""
    _check_table()

    title_clean = str(title or "").strip()
    if not title_clean:
        raise ContractAPIException("VALIDATION_ERROR", "Mavzu sarlavhasi kiritilishi shart", 400)

    prompt_clean = str(prompt_text or "").strip()
    if not prompt_clean:
        raise ContractAPIException("VALIDATION_ERROR", "Mavzu topshirig'i (prompt) kiritilishi shart", 400)

    normalized_type = str(task_type or "task2").strip().lower()
    if "1" in normalized_type:
        normalized_type = "task1"
    else:
        normalized_type = "task2"

    topic_id = str(uuid.uuid4())

    with connection.cursor() as cursor:
        if connection.vendor == "postgresql":
            cursor.execute(
                """
                INSERT INTO "TopicBank" (
                    "id", "skill", "type", "title", "prompt_text",
                    "image_url", "image_key", "bullet_points", "followup_questions",
                    "target_band_level", "is_active", "created_by_id", "created_at", "updated_at"
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, NULL, NULL,
                    %s, TRUE, %s, NOW(), NOW()
                )
                """,
                [topic_id, "writing", normalized_type, title_clean, prompt_clean, image_url, image_key, target_band_level or "7.0", created_by_id],
            )
        else:
            cursor.execute(
                """
                INSERT INTO "TopicBank" (
                    "id", "skill", "type", "title", "prompt_text",
                    "image_url", "image_key", "bullet_points", "followup_questions",
                    "target_band_level", "is_active", "created_by_id", "created_at", "updated_at"
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, NULL, NULL,
                    %s, 1, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """,
                [topic_id, "writing", normalized_type, title_clean, prompt_clean, image_url, image_key, target_band_level or "7.0", created_by_id],
            )

    topic_dict = get_topic(topic_id)
    sync_topic_to_mock_exam(topic_dict)
    return topic_dict


def create_speaking_topic(
    title: str,
    part: str = "part2",
    prompt_text: str = "",
    bullet_points: list = None,
    followup_questions: list = None,
    target_band_level: str = "7.0",
    created_by_id: str = None,
) -> dict:
    """Creates a new Speaking topic (Part 1, Part 2, or Part 3) and synchronizes with mock exam."""
    _check_table()

    title_clean = str(title or "").strip()
    if not title_clean:
        raise ContractAPIException("VALIDATION_ERROR", "Mavzu sarlavhasi kiritilishi shart", 400)

    part_clean = str(part or "part2").strip().lower()
    if "1" in part_clean:
        normalized_part = "part1"
    elif "3" in part_clean:
        normalized_part = "part3"
    else:
        normalized_part = "part2"

    prompt_clean = str(prompt_text or "").strip()
    if not prompt_clean:
        if normalized_part == "part2":
            prompt_clean = f"Describe {title_clean}."
        else:
            prompt_clean = title_clean

    bp_json = json.dumps(bullet_points) if bullet_points is not None else None
    fq_json = json.dumps(followup_questions) if followup_questions is not None else None

    topic_id = str(uuid.uuid4())

    with connection.cursor() as cursor:
        if connection.vendor == "postgresql":
            cursor.execute(
                """
                INSERT INTO "TopicBank" (
                    "id", "skill", "type", "title", "prompt_text",
                    "image_url", "image_key", "bullet_points", "followup_questions",
                    "target_band_level", "is_active", "created_by_id", "created_at", "updated_at"
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    NULL, NULL, %s::jsonb, %s::jsonb,
                    %s, TRUE, %s, NOW(), NOW()
                )
                """,
                [topic_id, "speaking", normalized_part, title_clean, prompt_clean, bp_json, fq_json, target_band_level or "7.0", created_by_id],
            )
        else:
            cursor.execute(
                """
                INSERT INTO "TopicBank" (
                    "id", "skill", "type", "title", "prompt_text",
                    "image_url", "image_key", "bullet_points", "followup_questions",
                    "target_band_level", "is_active", "created_by_id", "created_at", "updated_at"
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    NULL, NULL, %s, %s,
                    %s, 1, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """,
                [topic_id, "speaking", normalized_part, title_clean, prompt_clean, bp_json, fq_json, target_band_level or "7.0", created_by_id],
            )

    topic_dict = get_topic(topic_id)
    sync_topic_to_mock_exam(topic_dict)
    return topic_dict


def list_topics(
    skill: str = None,
    task_type: str = None,
    active_only: bool = True,
    limit: int = 10,
    offset: int = 0,
) -> list[dict]:
    """Lists topics with optional filtering and pagination."""
    _check_table()

    where_clauses = []
    params = []

    if active_only:
        where_clauses.append('"is_active" = TRUE' if connection.vendor == "postgresql" else '"is_active" = 1')
    if skill:
        where_clauses.append('"skill" = %s')
        params.append(skill.strip().lower())
    if task_type:
        where_clauses.append('"type" = %s')
        params.append(task_type.strip().lower())

    where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    sql = f"""
        SELECT "id", "skill", "type", "title", "prompt_text",
               "image_url", "image_key", "bullet_points", "followup_questions",
               "target_band_level", "is_active", "created_by_id", "created_at", "updated_at"
        FROM "TopicBank"
        {where_sql}
        ORDER BY "created_at" DESC
        LIMIT %s OFFSET %s
    """
    params.extend([max(1, int(limit)), max(0, int(offset))])

    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        rows = cursor.fetchall()
        return [_row_to_dict(row) for row in rows]


def get_topic(topic_id: str) -> dict | None:
    """Retrieves a single topic by ID."""
    _check_table()

    sql = """
        SELECT "id", "skill", "type", "title", "prompt_text",
               "image_url", "image_key", "bullet_points", "followup_questions",
               "target_band_level", "is_active", "created_by_id", "created_at", "updated_at"
        FROM "TopicBank"
        WHERE "id" = %s
    """
    with connection.cursor() as cursor:
        cursor.execute(sql, [str(topic_id)])
        row = cursor.fetchone()
        return _row_to_dict(row)


def delete_topic(topic_id: str, hard: bool = False) -> bool:
    """Deletes or deactivates a topic. Returns True if found and updated/deleted."""
    _check_table()

    with connection.cursor() as cursor:
        if hard:
            cursor.execute('DELETE FROM "TopicBank" WHERE "id" = %s', [str(topic_id)])
        else:
            if connection.vendor == "postgresql":
                cursor.execute('UPDATE "TopicBank" SET "is_active" = FALSE, "updated_at" = NOW() WHERE "id" = %s', [str(topic_id)])
            else:
                cursor.execute('UPDATE "TopicBank" SET "is_active" = 0, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = %s', [str(topic_id)])
        return cursor.rowcount > 0


def save_topic_image(raw_bytes: bytes, mime_type: str = "image/jpeg") -> tuple[str, str]:
    """Saves image bytes under storage /media/topics/<uuid>.<ext> and returns (storage_key, public_url)."""
    if not raw_bytes:
        raise ContractAPIException("VALIDATION_ERROR", "Rasm fayli bo'sh bo'lishi mumkin emas", 400)

    ext_map = {
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
    }
    ext = ext_map.get((mime_type or "").lower(), ".jpg")
    file_id = str(uuid.uuid4())
    filename = f"{file_id}{ext}"

    root = Path(os.environ.get("STORAGE_DIR", getattr(settings, "MEDIA_ROOT", "/app/storage"))).resolve()
    topics_dir = root / "topics"
    topics_dir.mkdir(parents=True, exist_ok=True)
    media_topics_dir = root / "media" / "topics"
    media_topics_dir.mkdir(parents=True, exist_ok=True)

    (topics_dir / filename).write_bytes(raw_bytes)
    (media_topics_dir / filename).write_bytes(raw_bytes)

    storage_key = f"topics/{filename}"
    public_base = os.environ.get("PUBLIC_URL", "").rstrip("/")
    if public_base:
        public_url = f"{public_base}/media/topics/{filename}"
    else:
        public_url = f"/media/topics/{filename}"

    return storage_key, public_url


def sync_topic_to_mock_exam(topic_dict: dict):
    """Ensures topic is synchronized into MockExam/MockQuestion so students can practice."""
    if not topic_dict or not topic_dict.get("id"):
        return None

    try:
        from apps.legacy_schema.models import MockExam, MockQuestion, MockQuestionGroup, MockSection

        topic_id = topic_dict["id"]
        skill = topic_dict["skill"]
        task_type = topic_dict.get("type")
        title = topic_dict["title"]
        prompt_text = topic_dict.get("prompt_text") or topic_dict.get("promptText") or title
        image_key = topic_dict.get("image_key") or topic_dict.get("imageKey")
        bullet_points = topic_dict.get("bullet_points") or topic_dict.get("bulletPoints")
        followup_questions = topic_dict.get("followup_questions") or topic_dict.get("followupQuestions")
        created_by_id = topic_dict.get("created_by_id") or topic_dict.get("createdById")

        exam_id = f"topic-exam-{topic_id}"
        section_id = f"topic-sec-{topic_id}"
        group_id = f"topic-grp-{topic_id}"
        question_id = f"topic-q-{topic_id}"

        with transaction.atomic():
            exam, _ = MockExam.objects.update_or_create(
                id=exam_id,
                defaults={
                    "type": "ielts_academic",
                    "title": f"Practice: {title}",
                    "description": f"IELTS {skill.capitalize()} practice topic: {title}",
                    "profile": "practice",
                    "is_published": True,
                    "is_demo": True,
                    "price": 0,
                    "is_free_for_approved": True,
                    "created_by_id": created_by_id,
                    "content_version": 1,
                    "assessment_policy": "PRACTICE_AUTO_AI",
                    "blueprint_ref": f"topic:{topic_id}",
                    "created_at": timezone.now(),
                    "updated_at": timezone.now(),
                },
            )

            section, _ = MockSection.objects.update_or_create(
                id=section_id,
                defaults={
                    "exam": exam,
                    "skill": skill,
                    "title": f"{skill.capitalize()} Section",
                    "sort_order": 0,
                    "duration_minutes": 40 if skill == "writing" else 15,
                    "instructions": "Complete the practice task.",
                },
            )

            part_number = 1
            if task_type in ("task2", "part2"):
                part_number = 2
            elif task_type == "part3":
                part_number = 3

            content_html = None
            if bullet_points and isinstance(bullet_points, list):
                bullets_li = "".join(f"<li>{bp}</li>" for bp in bullet_points)
                content_html = f"<p>You should say:</p><ul>{bullets_li}</ul>"

            group, _ = MockQuestionGroup.objects.update_or_create(
                id=group_id,
                defaults={
                    "section": section,
                    "sort_order": 0,
                    "title": title,
                    "instructions": prompt_text,
                    "image_key": image_key,
                    "part_number": part_number,
                    "audio_play_limit": 1,
                    "content_html": content_html,
                    "created_at": timezone.now(),
                },
            )

            if skill == "writing":
                q_type = "essay_task1" if task_type == "task1" else "essay_task2"
                word_limit = 150 if task_type == "task1" else 250
            else:
                q_type = "speaking_task"
                word_limit = None

            full_prompt = prompt_text
            if bullet_points and isinstance(bullet_points, list):
                full_prompt += "\n\nYou should say:\n" + "\n".join(f"- {bp}" for bp in bullet_points)
            if followup_questions and isinstance(followup_questions, list):
                full_prompt += "\n\nFollow-up questions:\n" + "\n".join(f"- {fq}" for fq in followup_questions)

            question, _ = MockQuestion.objects.update_or_create(
                id=question_id,
                defaults={
                    "group": group,
                    "number": 1,
                    "sort_order": 0,
                    "type": q_type,
                    "prompt": full_prompt,
                    "points": 9,
                    "word_limit": word_limit,
                    "created_at": timezone.now(),
                },
            )
            return exam
    except Exception as exc:
        logger.warning("MockExam sync skipped or failed for topic %s: %s", topic_dict.get("id"), exc)
        return None
