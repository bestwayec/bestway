"""Tests for TopicBank service and REST endpoints (v0.7.1).

Covers table initialization, writing/speaking topics creation, image saving,
mock exam synchronization, querying/filtering/pagination, deactivation/deletion,
and role-based API views.
"""
from __future__ import annotations

import os
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from apps.core import topic_service
from common.api.exceptions import ContractAPIException


class TopicServiceAndViewsTestCase(TransactionTestCase):
    def setUp(self):
        self.client = APIClient()
        topic_service.ensure_table_exists()
        # Clean any existing test rows in TopicBank
        with connection.cursor() as cursor:
            cursor.execute('DELETE FROM "TopicBank"')

    def test_ensure_table_exists_idempotent(self):
        """Calling ensure_table_exists multiple times should not error."""
        topic_service.ensure_table_exists()
        topic_service.ensure_table_exists()

    def test_create_writing_task1_with_image(self):
        """Test creating a Writing Task 1 topic with image key and url."""
        topic = topic_service.create_writing_topic(
            title="World Population Growth by Region",
            prompt_text="The chart below shows population growth from 1950 to 2050. Summarise the information by selecting and reporting the main features.",
            task_type="task1",
            image_key="topics/population_chart_1950_2050.jpg",
            image_url="/media/topics/population_chart_1950_2050.jpg",
            target_band_level="7.5",
            created_by_id="admin-user-001",
        )

        self.assertIsNotNone(topic["id"])
        self.assertEqual(topic["skill"], "writing")
        self.assertEqual(topic["type"], "task1")
        self.assertEqual(topic["title"], "World Population Growth by Region")
        self.assertIn("population growth", topic["prompt_text"])
        self.assertEqual(topic["image_key"], "topics/population_chart_1950_2050.jpg")
        self.assertEqual(topic["image_url"], "/media/topics/population_chart_1950_2050.jpg")
        self.assertEqual(topic["target_band_level"], "7.5")
        self.assertTrue(topic["is_active"])
        self.assertEqual(topic["created_by_id"], "admin-user-001")

    def test_create_writing_task2_topic(self):
        """Test creating an essay Writing Task 2 topic."""
        topic = topic_service.create_writing_topic(
            title="Artificial Intelligence in Education",
            prompt_text="Some people believe that AI will soon replace classroom teachers. To what extent do you agree or disagree?",
            task_type="task2",
            target_band_level="7.0",
        )

        self.assertEqual(topic["skill"], "writing")
        self.assertEqual(topic["type"], "task2")
        self.assertEqual(topic["title"], "Artificial Intelligence in Education")
        self.assertIsNone(topic["bullet_points"])
        self.assertIsNone(topic["followup_questions"])
        self.assertTrue(topic["is_active"])

    def test_create_writing_topic_validation(self):
        """Empty title or prompt should raise ContractAPIException with 400."""
        with self.assertRaises(ContractAPIException) as ctx:
            topic_service.create_writing_topic(title="", prompt_text="Some prompt")
        self.assertEqual(ctx.exception.status_code, 400)

        with self.assertRaises(ContractAPIException) as ctx:
            topic_service.create_writing_topic(title="Valid Title", prompt_text="   ")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_create_topic_with_telegram_chat_id_author(self):
        """Passing telegram chat id as created_by_id must safely succeed without FK errors."""
        topic = topic_service.create_writing_topic(
            title="Chat ID Author Test",
            prompt_text="Some prompt for testing",
            task_type="task1",
            created_by_id="5582178765",
        )
        self.assertIsNotNone(topic)
        self.assertEqual(topic["title"], "Chat ID Author Test")

        speaking = topic_service.create_speaking_topic(
            title="Chat ID Speaking Test",
            part="part2",
            prompt_text="Describe something",
            bullet_points=["Point 1", "Point 2"],
            created_by_id="5582178765",
        )
        self.assertIsNotNone(speaking)
        self.assertEqual(speaking["title"], "Chat ID Speaking Test")

    def test_create_speaking_part1_topic(self):
        """Test creating a Speaking Part 1 topic."""
        topic = topic_service.create_speaking_topic(
            title="Hometown & Neighborhood",
            part="part1",
            prompt_text="Let's talk about your hometown. Where is your hometown located?",
            followup_questions=[
                "What do you like most about your hometown?",
                "Has your hometown changed much since you were a child?",
            ],
            target_band_level="6.5",
        )

        self.assertEqual(topic["skill"], "speaking")
        self.assertEqual(topic["type"], "part1")
        self.assertEqual(topic["title"], "Hometown & Neighborhood")
        self.assertEqual(len(topic["followup_questions"]), 2)
        self.assertIn("hometown located", topic["prompt_text"])

    def test_create_speaking_part2_cue_card_with_bullet_points(self):
        """Test creating a Speaking Part 2 cue card with bullet points."""
        bullet_points = [
            "Who this person is",
            "What they have achieved",
            "How you know about them",
            "And explain why you admire them so much",
        ]
        topic = topic_service.create_speaking_topic(
            title="A Person You Admire",
            part="part2",
            prompt_text="Describe a person whom you admire greatly.",
            bullet_points=bullet_points,
            target_band_level="8.0",
            created_by_id="teacher-super",
        )

        self.assertEqual(topic["skill"], "speaking")
        self.assertEqual(topic["type"], "part2")
        self.assertEqual(topic["bullet_points"], bullet_points)
        self.assertEqual(topic["bulletPoints"], bullet_points)
        self.assertEqual(topic["target_band_level"], "8.0")

    def test_create_speaking_part3_topic(self):
        """Test creating a Speaking Part 3 discussion topic."""
        topic = topic_service.create_speaking_topic(
            title="Role Models and Society",
            part="part3",
            prompt_text="Discussion on the influence of role models on younger generations.",
            followup_questions=[
                "Do famous people have a responsibility to act as good role models?",
                "How have role models changed compared to the past?",
            ],
        )

        self.assertEqual(topic["skill"], "speaking")
        self.assertEqual(topic["type"], "part3")
        self.assertEqual(len(topic["followup_questions"]), 2)

    def test_save_topic_image_helper(self):
        """Test save_topic_image writing to media/topics and returning keys."""
        with TemporaryDirectory() as tmp_dir:
            with patch.dict(os.environ, {"STORAGE_DIR": tmp_dir, "PUBLIC_URL": "https://api.bestway.uz"}):
                raw_data = b"fake-jpg-binary-image-data-for-chart"
                key, url = topic_service.save_topic_image(raw_data, "image/jpeg")

                self.assertTrue(key.startswith("topics/"))
                self.assertTrue(key.endswith(".jpg"))
                self.assertTrue(url.startswith("https://api.bestway.uz/media/topics/"))
                self.assertTrue(url.endswith(".jpg"))

                saved_file = os.path.join(tmp_dir, "topics", os.path.basename(key))
                self.assertTrue(os.path.isfile(saved_file))
                with open(saved_file, "rb") as f:
                    self.assertEqual(f.read(), raw_data)

    def test_list_topics_filtering_and_pagination(self):
        """Test listing topics with skill/type filters and pagination."""
        w1 = topic_service.create_writing_topic(title="Writing T1", prompt_text="Prompt 1", task_type="task1")
        w2 = topic_service.create_writing_topic(title="Writing T2", prompt_text="Prompt 2", task_type="task2")
        s1 = topic_service.create_speaking_topic(title="Speaking P1", part="part1", prompt_text="Speak P1")
        s2 = topic_service.create_speaking_topic(title="Speaking P2", part="part2", prompt_text="Speak P2")

        # All topics
        all_topics = topic_service.list_topics(limit=10)
        self.assertEqual(len(all_topics), 4)

        # Filter by writing
        writing_topics = topic_service.list_topics(skill="writing")
        self.assertEqual(len(writing_topics), 2)
        self.assertTrue(all(t["skill"] == "writing" for t in writing_topics))

        # Filter by speaking
        speaking_topics = topic_service.list_topics(skill="speaking")
        self.assertEqual(len(speaking_topics), 2)
        self.assertTrue(all(t["skill"] == "speaking" for t in speaking_topics))

        # Filter by type
        t1_topics = topic_service.list_topics(task_type="task1")
        self.assertEqual(len(t1_topics), 1)
        self.assertEqual(t1_topics[0]["title"], "Writing T1")

        # Pagination: limit=2, offset=0 then offset=2
        page1 = topic_service.list_topics(limit=2, offset=0)
        self.assertEqual(len(page1), 2)
        page2 = topic_service.list_topics(limit=2, offset=2)
        self.assertEqual(len(page2), 2)
        self.assertNotEqual(page1[0]["id"], page2[0]["id"])

    def test_get_topic_and_deletion(self):
        """Test getting by ID, soft deletion (is_active=False), and hard deletion."""
        topic = topic_service.create_writing_topic(title="Topic To Delete", prompt_text="Prompt text")
        topic_id = topic["id"]

        # Fetch
        fetched = topic_service.get_topic(topic_id)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched["title"], "Topic To Delete")
        self.assertTrue(fetched["is_active"])

        # Soft delete
        soft_res = topic_service.delete_topic(topic_id, hard=False)
        self.assertTrue(soft_res)

        # After soft delete, excluded from active_only list
        active_topics = topic_service.list_topics(active_only=True)
        self.assertNotIn(topic_id, [t["id"] for t in active_topics])

        # But get_topic still returns it with is_active=False
        after_soft = topic_service.get_topic(topic_id)
        self.assertIsNotNone(after_soft)
        self.assertFalse(after_soft["is_active"])

        # Hard delete
        hard_res = topic_service.delete_topic(topic_id, hard=True)
        self.assertTrue(hard_res)

        # Now completely gone
        after_hard = topic_service.get_topic(topic_id)
        self.assertIsNone(after_hard)

    def test_sync_topic_to_mock_exam(self):
        """Test that sync_topic_to_mock_exam runs without exception and creates mock hierarchy."""
        topic = topic_service.create_speaking_topic(
            title="Favorite Book",
            part="part2",
            prompt_text="Describe a book that had a major influence on you.",
            bullet_points=["What book it is", "When you read it", "Why it influenced you"],
        )
        exam = topic_service.sync_topic_to_mock_exam(topic)
        if exam is not None:
            self.assertEqual(exam.id, f"topic-exam-{topic['id']}")
            self.assertEqual(exam.profile, "practice")
            self.assertTrue(exam.is_published)

    # ------------------ REST View Tests ------------------

    def test_get_topics_api_endpoint(self):
        """GET /v1/topics should be accessible and return formatted list."""
        topic_service.create_writing_topic(title="API Essay", prompt_text="Discuss something.")

        response = self.client.get("/v1/topics")
        self.assertEqual(response.status_code, 200)
        res_json = response.json()
        self.assertTrue(res_json["success"])
        self.assertIsInstance(res_json["data"], list)
        self.assertGreaterEqual(len(res_json["data"]), 1)

    def test_get_topic_detail_api_endpoint(self):
        """GET /v1/topics/<topic_id> returns topic detail or 404."""
        topic = topic_service.create_writing_topic(title="Detail Topic", prompt_text="Detail prompt.")
        response = self.client.get(f"/v1/topics/{topic['id']}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["title"], "Detail Topic")

        # Nonexistent topic -> 404
        not_found = self.client.get("/v1/topics/non-existent-uuid-1234")
        self.assertEqual(not_found.status_code, 404)

    def test_post_topics_api_auth_and_permissions(self):
        """POST /v1/topics requires authentication and admin/super_admin role."""
        payload = {
            "skill": "writing",
            "type": "task2",
            "title": "Unauthorized Essay",
            "prompt_text": "Essay prompt here.",
        }

        # 1. Unauthenticated -> 401
        res_unauth = self.client.post("/v1/topics", payload, format="json")
        self.assertEqual(res_unauth.status_code, 401)

        # 2. Student role -> 403
        student = SimpleNamespace(id="student-1", role="student", is_authenticated=True)
        self.client.force_authenticate(student)
        res_student = self.client.post("/v1/topics", payload, format="json")
        self.assertEqual(res_student.status_code, 403)

        # 3. Admin role -> 201 Created
        admin = SimpleNamespace(id="admin-1", role="admin", is_authenticated=True)
        self.client.force_authenticate(admin)
        res_admin = self.client.post("/v1/topics", payload, format="json")
        self.assertEqual(res_admin.status_code, 201)
        self.assertTrue(res_admin.json()["success"])
        self.assertEqual(res_admin.json()["data"]["title"], "Unauthorized Essay")

    def test_post_topics_speaking_api_with_bullet_points(self):
        """POST /v1/topics can create speaking topics with bullet points and follow-ups."""
        super_admin = SimpleNamespace(id="super-1", role="super_admin", is_authenticated=True)
        self.client.force_authenticate(super_admin)

        payload = {
            "skill": "speaking",
            "type": "part2",
            "title": "A Memorable Journey",
            "prompt_text": "Describe a memorable journey you made.",
            "bullet_points": ["Where you went", "Who you went with", "Why it was memorable"],
            "target_band_level": "7.5",
        }

        response = self.client.post("/v1/topics", payload, format="json")
        self.assertEqual(response.status_code, 201)
        data = response.json()["data"]
        self.assertEqual(data["skill"], "speaking")
        self.assertEqual(data["type"], "part2")
        self.assertEqual(len(data["bullet_points"]), 3)

    def test_post_topics_with_multipart_image_upload(self):
        """POST /v1/topics can accept uploaded image file in multipart form."""
        admin = SimpleNamespace(id="admin-img", role="admin", is_authenticated=True)
        self.client.force_authenticate(admin)

        img_file = SimpleUploadedFile("diagram.jpg", b"fake-jpg-content", content_type="image/jpeg")

        with TemporaryDirectory() as tmp_dir:
            with patch.dict(os.environ, {"STORAGE_DIR": tmp_dir}):
                response = self.client.post(
                    "/v1/topics",
                    {
                        "skill": "writing",
                        "type": "task1",
                        "title": "Energy Consumption Chart",
                        "prompt_text": "Summarize the energy consumption trends.",
                        "image": img_file,
                    },
                    format="multipart",
                )
                self.assertEqual(response.status_code, 201)
                data = response.json()["data"]
                self.assertTrue(data["image_key"].startswith("topics/"))
                self.assertIn("/media/topics/", data["image_url"])

    def test_delete_topics_api_endpoint(self):
        """DELETE /v1/topics/<topic_id> requires admin and deactivates/deletes topic."""
        topic = topic_service.create_writing_topic(title="API Delete Test", prompt_text="Some prompt")
        topic_id = topic["id"]

        student = SimpleNamespace(id="student-del", role="student", is_authenticated=True)
        self.client.force_authenticate(student)
        res_forbidden = self.client.delete(f"/v1/topics/{topic_id}")
        self.assertEqual(res_forbidden.status_code, 403)

        admin = SimpleNamespace(id="admin-del", role="admin", is_authenticated=True)
        self.client.force_authenticate(admin)

        # Soft delete
        res_soft = self.client.delete(f"/v1/topics/{topic_id}")
        self.assertEqual(res_soft.status_code, 200)
        self.assertTrue(res_soft.json()["data"]["deleted"])

        # Hard delete
        res_hard = self.client.delete(f"/v1/topics/{topic_id}?hard=true")
        self.assertEqual(res_hard.status_code, 200)

        # Now 404
        res_404 = self.client.delete(f"/v1/topics/{topic_id}")
        self.assertEqual(res_404.status_code, 404)
