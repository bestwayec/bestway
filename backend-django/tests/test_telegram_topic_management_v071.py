"""Tests for Telegram Bot v0.7.1: Superadmin Topic Management FSM Dialogs & Security.

Covers:
1. Telegram FSM State Transitions (get_state, set_state, update_state_data, clear_state).
2. Security Guards (Non-superadmin 403 rejection on callbacks, text commands, and FSM inputs).
3. Superadmin Navigation & Multi-step Dialog Flows:
   - Writing Task 1 with photo upload & diagram saving.
   - Writing Task 2 without photo (direct confirmation).
   - Speaking Part 2 cue card with bullet points.
   - Speaking Part 1 & Part 3 with numbered/bulleted questions.
   - Listing recent topics, viewing details, and deleting a topic.
   - Universal Cancellation (/cancel and btn:topic_cancel) at intermediate steps.
   - Back navigation across flow steps.
"""
from __future__ import annotations

import io
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.core import telegram_bot, telegram_delivery, telegram_fsm as fsm, telegram_menu as menu


class TelegramTopicManagementV071Tests(SimpleTestCase):

    def setUp(self):
        self.superadmin_id = "5582178765"
        self.unauthorized_chat_id = "9988776655"
        # Always start with clean in-memory & cache state
        fsm.clear_state(self.superadmin_id)
        fsm.clear_state(self.unauthorized_chat_id)

    def tearDown(self):
        fsm.clear_state(self.superadmin_id)
        fsm.clear_state(self.unauthorized_chat_id)

    # =========================================================================
    # 1. FSM State Transitions
    # =========================================================================

    def test_fsm_state_lifecycle_transitions(self):
        """Test set_state, get_state, update_state_data, and clear_state."""
        # 1. Initial state is empty
        state = fsm.get_state(self.superadmin_id)
        self.assertEqual(state, {})

        # 2. Set state for Superadmin
        session = fsm.set_state(
            self.superadmin_id,
            fsm.STATE_WRITING_TYPE,
            {"skill": "writing", "step": 1},
        )
        self.assertEqual(session["chat_id"], self.superadmin_id)
        self.assertEqual(session["state"], fsm.STATE_WRITING_TYPE)
        self.assertEqual(session["data"]["skill"], "writing")
        self.assertEqual(session["data"]["step"], 1)

        # 3. get_state returns active session
        current = fsm.get_state(self.superadmin_id)
        self.assertEqual(current["state"], fsm.STATE_WRITING_TYPE)
        self.assertEqual(current["data"]["step"], 1)

        # 4. update_state_data adds new keys and preserves existing
        updated = fsm.update_state_data(
            self.superadmin_id,
            task_type="task1",
            title="Line Graph Population",
        )
        self.assertEqual(updated["data"]["skill"], "writing")
        self.assertEqual(updated["data"]["task_type"], "task1")
        self.assertEqual(updated["data"]["title"], "Line Graph Population")
        self.assertEqual(updated["data"]["step"], 1)

        # 5. clear_state removes session completely
        fsm.clear_state(self.superadmin_id)
        cleared = fsm.get_state(self.superadmin_id)
        self.assertEqual(cleared, {})

    # =========================================================================
    # 2. Security Verification (Superadmin Guard & RBAC)
    # =========================================================================

    def test_non_superadmin_fsm_set_state_rejected(self):
        """Non-superadmin user attempting to enter a topic state must be rejected."""
        sent_messages = []
        with patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, **kw: sent_messages.append((cid, txt))):
            session = fsm.set_state(
                self.unauthorized_chat_id,
                fsm.STATE_WRITING_TYPE,
                {"skill": "writing"},
            )
            # Must return empty dict and clear state
            self.assertEqual(session, {})
            self.assertEqual(fsm.get_state(self.unauthorized_chat_id), {})

            # Must have sent rejection alert
            self.assertEqual(len(sent_messages), 1)
            cid, msg = sent_messages[0]
            self.assertEqual(str(cid), self.unauthorized_chat_id)
            self.assertIn("faqat Superadmin uchun", msg)

    def test_non_superadmin_callbacks_rejected(self):
        """Unauthorized callbacks from non-superadmin return 403 / permission denied."""
        unauthorized_user = SimpleNamespace(
            id="u-student-99",
            name="Regular Student",
            role="student",
            is_active=True,
            telegram_chat_id=self.unauthorized_chat_id,
        )

        callbacks_to_test = [
            "btn:topic_menu",
            "btn:topic_add_writing",
            "btn:topic_add_speaking",
            "btn:topic_list_recent",
            "btn:topic_w_type:task1",
            "btn:topic_s_part:part2",
            "btn:topic_confirm_save_writing",
            "btn:topic_confirm_save_speaking",
            "btn:topic_del_topic-12345",
            "btn:topic_del_confirm_topic-12345",
            "btn:topic_view_topic-12345",
        ]

        for cb_data in callbacks_to_test:
            sent_messages = []
            answered_callbacks = []
            with patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, **kw: sent_messages.append((cid, txt))), \
                 patch.object(telegram_delivery, "answer_callback", side_effect=lambda cbid: answered_callbacks.append(cbid)), \
                 patch("apps.core.telegram_bot._find_user", return_value=unauthorized_user):
                telegram_bot.handle({
                    "callback_query": {
                        "id": "cb-unauth-1",
                        "from": {"id": int(self.unauthorized_chat_id), "first_name": "Student"},
                        "message": {"chat": {"id": int(self.unauthorized_chat_id)}},
                        "data": cb_data,
                    }
                })

                self.assertGreaterEqual(len(sent_messages), 1, f"Expected rejection for callback {cb_data}")
                self.assertIn("faqat Superadmin uchun", sent_messages[0][1])
                self.assertIn("cb-unauth-1", answered_callbacks)

    def test_non_superadmin_topic_text_commands_rejected(self):
        """Non-superadmin typing /topics or /mavzular gets permission denied."""
        unauthorized_user = SimpleNamespace(
            id="u-student-99",
            name="Regular Student",
            role="student",
            is_active=True,
            telegram_chat_id=self.unauthorized_chat_id,
        )

        for cmd in ("/topics", "/mavzular"):
            sent_messages = []
            with patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, **kw: sent_messages.append((cid, txt))), \
                 patch("apps.core.telegram_bot._find_user", return_value=unauthorized_user):
                telegram_bot.handle({
                    "message": {
                        "chat": {"id": int(self.unauthorized_chat_id)},
                        "from": {"id": int(self.unauthorized_chat_id), "first_name": "Student"},
                        "text": cmd,
                    }
                })
                self.assertEqual(len(sent_messages), 1)
                self.assertIn("faqat Superadmin uchun", sent_messages[0][1])

    def test_non_superadmin_input_while_state_tampered_rejected(self):
        """Even if state memory is tampered with, non-superadmin message is rejected and cleared."""
        # Artificially inject topic state for unauthorized user
        fsm._FSM_MEMORY[self.unauthorized_chat_id] = {
            "chat_id": self.unauthorized_chat_id,
            "state": fsm.STATE_WRITING_PROMPT,
            "data": {"task_type": "task2"},
            "updated_at": 1234567,
        }

        sent_messages = []
        with patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, **kw: sent_messages.append((cid, txt))):
            telegram_bot.handle({
                "message": {
                    "chat": {"id": int(self.unauthorized_chat_id)},
                    "from": {"id": int(self.unauthorized_chat_id), "first_name": "Intruder"},
                    "text": "Some unauthorized writing prompt",
                }
            })

            # Must reject and wipe state
            self.assertEqual(fsm.get_state(self.unauthorized_chat_id), {})
            self.assertEqual(len(sent_messages), 1)
            self.assertIn("faqat Superadmin uchun", sent_messages[0][1])

    # =========================================================================
    # 3. Superadmin Navigation Flows
    # =========================================================================

    def test_superadmin_open_topic_management_menu(self):
        """Superadmin can open topic management via button, callback, and command."""
        sa_user = SimpleNamespace(
            id="sa-5582178765",
            name="Superadmin",
            role="super_admin",
            is_active=True,
            is_approved=True,
            telegram_chat_id=self.superadmin_id,
        )

        sent_messages = []
        with patch("apps.core.telegram_menu.ensure_superadmin_user", return_value=sa_user), \
             patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, **kw: sent_messages.append((cid, txt, kw.get("reply_markup")))):
            # 1. Via Text command /topics
            telegram_bot.handle({
                "message": {
                    "chat": {"id": int(self.superadmin_id)},
                    "from": {"id": int(self.superadmin_id), "first_name": "Komiljon"},
                    "text": "/topics",
                }
            })
            self.assertEqual(len(sent_messages), 1)
            cid, text, kb = sent_messages[-1]
            self.assertEqual(str(cid), self.superadmin_id)
            self.assertIn("Mavzular Boshqaruvi", text)
            flat_cb = [btn["callback_data"] for row in kb["inline_keyboard"] for btn in row]
            self.assertIn("btn:topic_add_writing", flat_cb)
            self.assertIn("btn:topic_add_speaking", flat_cb)
            self.assertIn("btn:topic_list_recent", flat_cb)

            # 2. Via Callback query btn:topic_menu
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-menu-1",
                    "from": {"id": int(self.superadmin_id), "first_name": "Komiljon"},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_menu",
                }
            })
            self.assertEqual(len(sent_messages), 2)
            self.assertIn("Mavzular Boshqaruvi", sent_messages[-1][1])

    def test_superadmin_writing_task1_flow_with_photo(self):
        """Full interactive flow for Writing Task 1 with photo diagram upload."""
        sent_messages = []
        sa_user = SimpleNamespace(id="sa-1", name="Superadmin", role="super_admin", is_active=True, telegram_chat_id=self.superadmin_id)

        fake_created_topic = {
            "id": "top-writing-t1-999",
            "skill": "writing",
            "type": "task1",
            "title": "Household Waste Trends in 2020",
            "prompt_text": "The charts below show the percentage of household waste in five countries in 2020.",
            "image_key": "topics/chart_diagram.jpg",
            "image_url": "/media/topics/chart_diagram.jpg",
            "target_band_level": "7.0",
            "is_active": True,
        }

        with patch("apps.core.telegram_menu.ensure_superadmin_user", return_value=sa_user), \
             patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, **kw: sent_messages.append((cid, txt, kw.get("reply_markup")))), \
             patch.object(telegram_delivery, "answer_callback", return_value=True), \
             patch("apps.core.telegram_bot._download_telegram_photo", return_value=b"\xff\xd8\xff\xe0FAKE_CHART_BYTES"), \
             patch("apps.core.telegram_menu.save_topic_image_helper", return_value="topics/chart_diagram.jpg"), \
             patch("apps.core.telegram_menu.create_writing_topic_helper", return_value=fake_created_topic):

            # Step 1: Click 'btn:topic_add_writing'
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-w1",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_add_writing",
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_WRITING_TYPE)
            self.assertIn("Qaysi vazifa turi", sent_messages[-1][1])

            # Step 2: Select Task 1
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-w2",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_w_type:task1",
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_WRITING_PROMPT)
            self.assertEqual(st["data"]["task_type"], "task1")
            self.assertIn("Task 1 (Report/Chart)", sent_messages[-1][1])

            # Step 3: Send Prompt text
            prompt_input = "The charts below show the percentage of household waste in five countries in 2020."
            telegram_bot.handle({
                "message": {
                    "chat": {"id": int(self.superadmin_id)},
                    "from": {"id": int(self.superadmin_id)},
                    "text": prompt_input,
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_WRITING_IMAGE)
            self.assertEqual(st["data"]["prompt_text"], prompt_input)
            self.assertIn("Grafik / Diagramma rasmi", sent_messages[-1][1])

            # Step 4: Upload Photo
            telegram_bot.handle({
                "message": {
                    "chat": {"id": int(self.superadmin_id)},
                    "from": {"id": int(self.superadmin_id)},
                    "photo": [{"file_id": "file-chart-123", "width": 800, "height": 600}],
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_WRITING_CONFIRM)
            self.assertEqual(st["data"]["image_key"], "topics/chart_diagram.jpg")
            confirm_msg = sent_messages[-1][1]
            self.assertIn("Writing Mavzu Xulosasi", confirm_msg)
            self.assertIn("Rasm biriktirildi", confirm_msg)

            # Step 5: Confirm and Save
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-w3",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_confirm_save_writing",
                }
            })
            # State cleared upon successful save
            self.assertEqual(fsm.get_state(self.superadmin_id), {})
            success_msg = sent_messages[-1][1]
            self.assertIn("muvaffaqiyatli saqlandi", success_msg)
            self.assertIn("top-writing-t1-999", success_msg)

    def test_superadmin_writing_task2_flow_without_photo(self):
        """Full interactive flow for Writing Task 2 (Essay) which requires no photo."""
        sent_messages = []
        sa_user = SimpleNamespace(id="sa-1", name="Superadmin", role="super_admin", is_active=True, telegram_chat_id=self.superadmin_id)

        fake_created_topic = {
            "id": "top-writing-t2-777",
            "skill": "writing",
            "type": "task2",
            "title": "Artificial Intelligence in Education",
            "prompt_text": "Some people believe that AI will soon replace classroom teachers. To what extent do you agree?",
            "image_key": None,
            "target_band_level": "7.0",
            "is_active": True,
        }

        with patch("apps.core.telegram_menu.ensure_superadmin_user", return_value=sa_user), \
             patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, **kw: sent_messages.append((cid, txt, kw.get("reply_markup")))), \
             patch.object(telegram_delivery, "answer_callback", return_value=True), \
             patch("apps.core.telegram_menu.create_writing_topic_helper", return_value=fake_created_topic):

            # Step 1: Click 'btn:topic_add_writing'
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-w-t2-1",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_add_writing",
                }
            })

            # Step 2: Select Task 2
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-w-t2-2",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_w_type:task2",
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_WRITING_PROMPT)
            self.assertEqual(st["data"]["task_type"], "task2")

            # Step 3: Send Task 2 prompt text -> transitions directly to CONFIRM (no image required)
            prompt_input = "Some people believe that AI will soon replace classroom teachers. To what extent do you agree?"
            telegram_bot.handle({
                "message": {
                    "chat": {"id": int(self.superadmin_id)},
                    "from": {"id": int(self.superadmin_id)},
                    "text": prompt_input,
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_WRITING_CONFIRM)
            confirm_msg = sent_messages[-1][1]
            self.assertIn("Writing Mavzu Xulosasi", confirm_msg)
            self.assertIn("Rasmsiz", confirm_msg)

            # Step 4: Confirm and Save
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-w-t2-3",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_confirm_save_writing",
                }
            })
            self.assertEqual(fsm.get_state(self.superadmin_id), {})
            success_msg = sent_messages[-1][1]
            self.assertIn("Yangi Writing Task 2 mavzusi muvaffaqiyatli saqlandi", success_msg)
            self.assertIn("top-writing-t2-777", success_msg)

    def test_superadmin_speaking_part2_cue_card_flow(self):
        """Full interactive flow for Speaking Part 2 Cue Card with bullet points."""
        sent_messages = []
        sa_user = SimpleNamespace(id="sa-1", name="Superadmin", role="super_admin", is_active=True, telegram_chat_id=self.superadmin_id)

        fake_created_topic = {
            "id": "top-speaking-p2-888",
            "skill": "speaking",
            "type": "part2",
            "title": "Describe a memorable journey you have been on",
            "cue_card": [
                "Where you went",
                "Who you went with",
                "What you did there",
                "And explain why it was memorable",
            ],
            "target_band_level": "7.0",
            "is_active": True,
        }

        with patch("apps.core.telegram_menu.ensure_superadmin_user", return_value=sa_user), \
             patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, **kw: sent_messages.append((cid, txt, kw.get("reply_markup")))), \
             patch.object(telegram_delivery, "answer_callback", return_value=True), \
             patch("apps.core.telegram_menu.create_speaking_topic_helper", return_value=fake_created_topic):

            # Step 1: Click 'btn:topic_add_speaking'
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-sp2-1",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_add_speaking",
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_SPEAKING_PART)

            # Step 2: Select Part 2
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-sp2-2",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_s_part:part2",
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_SPEAKING_TITLE)
            self.assertEqual(st["data"]["part"], "part2")

            # Step 3: Send Title
            title_input = "Describe a memorable journey you have been on"
            telegram_bot.handle({
                "message": {
                    "chat": {"id": int(self.superadmin_id)},
                    "from": {"id": int(self.superadmin_id)},
                    "text": title_input,
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_SPEAKING_CUES)
            self.assertIn("Cue Card punktlari", sent_messages[-1][1])

            # Step 4: Send Multiline Bullet Points
            cues_text = (
                "• Where you went\n"
                "• Who you went with\n"
                "• What you did there\n"
                "• And explain why it was memorable"
            )
            telegram_bot.handle({
                "message": {
                    "chat": {"id": int(self.superadmin_id)},
                    "from": {"id": int(self.superadmin_id)},
                    "text": cues_text,
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_SPEAKING_CONFIRM)
            self.assertEqual(len(st["data"]["cue_card"]), 4)
            self.assertEqual(st["data"]["cue_card"][0], "Where you went")

            confirm_msg = sent_messages[-1][1]
            self.assertIn("Speaking Mavzu Xulosasi", confirm_msg)
            self.assertIn("Part 2", confirm_msg)
            self.assertIn("Where you went", confirm_msg)

            # Step 5: Confirm and Save
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-sp2-3",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_confirm_save_speaking",
                }
            })
            self.assertEqual(fsm.get_state(self.superadmin_id), {})
            success_msg = sent_messages[-1][1]
            self.assertIn("Yangi Speaking Part 2 mavzusi muvaffaqiyatli saqlandi", success_msg)
            self.assertIn("top-speaking-p2-888", success_msg)

    def test_superadmin_speaking_part1_and_part3_questions_flow(self):
        """Full interactive flow for Speaking Part 1 / Part 3 with questions list."""
        sent_messages = []
        sa_user = SimpleNamespace(id="sa-1", name="Superadmin", role="super_admin", is_active=True, telegram_chat_id=self.superadmin_id)

        fake_created_topic = {
            "id": "top-speaking-p1-555",
            "skill": "speaking",
            "type": "part1",
            "title": "Hometown & Neighborhood",
            "questions": [
                "Where is your hometown?",
                "What do you like most about your hometown?",
                "Has your hometown changed much since childhood?",
            ],
            "target_band_level": "6.5",
            "is_active": True,
        }

        with patch("apps.core.telegram_menu.ensure_superadmin_user", return_value=sa_user), \
             patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, **kw: sent_messages.append((cid, txt, kw.get("reply_markup")))), \
             patch.object(telegram_delivery, "answer_callback", return_value=True), \
             patch("apps.core.telegram_menu.create_speaking_topic_helper", return_value=fake_created_topic):

            # 1. Select Part 1
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-sp1-1",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_s_part:part1",
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_SPEAKING_TITLE)

            # 2. Send Title
            telegram_bot.handle({
                "message": {
                    "chat": {"id": int(self.superadmin_id)},
                    "from": {"id": int(self.superadmin_id)},
                    "text": "Hometown & Neighborhood",
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_SPEAKING_QUESTIONS)
            self.assertIn("Savollar", sent_messages[-1][1])

            # 3. Send Questions List
            questions_text = (
                "1. Where is your hometown?\n"
                "2. What do you like most about your hometown?\n"
                "3. Has your hometown changed much since childhood?"
            )
            telegram_bot.handle({
                "message": {
                    "chat": {"id": int(self.superadmin_id)},
                    "from": {"id": int(self.superadmin_id)},
                    "text": questions_text,
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_SPEAKING_CONFIRM)
            self.assertEqual(len(st["data"]["questions"]), 3)
            self.assertEqual(st["data"]["questions"][0], "Where is your hometown?")

            # 4. Confirm and Save
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-sp1-2",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_confirm_save_speaking",
                }
            })
            self.assertEqual(fsm.get_state(self.superadmin_id), {})
            success_msg = sent_messages[-1][1]
            self.assertIn("Yangi Speaking Part 1 mavzusi muvaffaqiyatli saqlandi", success_msg)

    def test_superadmin_recent_topics_list_view_and_delete_flow(self):
        """Superadmin can list topics, view full details, and delete with confirmation."""
        sent_messages = []
        sa_user = SimpleNamespace(id="sa-1", name="Superadmin", role="super_admin", is_active=True, telegram_chat_id=self.superadmin_id)

        sample_topics = [
            {
                "id": "tid-101",
                "skill": "writing",
                "task_type": "task1",
                "type": "task1",
                "title": "Global Energy Consumption Trends",
                "prompt": "The bar chart illustrates energy consumption...",
                "image_key": "topics/energy.png",
                "created_at": "2026-10-16 10:00:00",
                "is_active": True,
            },
            {
                "id": "tid-102",
                "skill": "speaking",
                "part": "part2",
                "type": "part2",
                "title": "Describe a historical building you visited",
                "cue_card": ["Where it was", "When you visited", "Why it was special"],
                "created_at": "2026-10-16 11:00:00",
                "is_active": True,
            },
        ]

        deleted_ids = []

        with patch("apps.core.telegram_menu.ensure_superadmin_user", return_value=sa_user), \
             patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, **kw: sent_messages.append((cid, txt, kw.get("reply_markup")))), \
             patch.object(telegram_delivery, "answer_callback", return_value=True), \
             patch("apps.core.telegram_menu.list_recent_topics_helper", return_value=sample_topics), \
             patch("apps.core.telegram_menu.get_topic_helper", side_effect=lambda tid: next((t for t in sample_topics if t["id"] == tid), None)), \
             patch("apps.core.telegram_menu.delete_topic_helper", side_effect=lambda tid: deleted_ids.append(tid) or True):

            # 1. Click 'btn:topic_list_recent'
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-list-1",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_list_recent",
                }
            })
            list_text, list_kb = sent_messages[-1][1], sent_messages[-1][2]
            self.assertIn("Oxirgi Mavzular", list_text)
            self.assertIn("Global Energy Consumption Trends", list_text)
            self.assertIn("Describe a historical building", list_text)

            # Check view & delete inline buttons
            flat_cb = [btn["callback_data"] for row in list_kb["inline_keyboard"] for btn in row]
            self.assertIn("btn:topic_view_tid-101", flat_cb)
            self.assertIn("btn:topic_del_tid-101", flat_cb)

            # 2. View topic details
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-view-1",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_view_tid-101",
                }
            })
            detail_text = sent_messages[-1][1]
            self.assertIn("Mavzu Ma'lumotlari", detail_text)
            self.assertIn("IELTS Writing (Task 1", detail_text)
            self.assertIn("tid-101", detail_text)

            # 3. Click delete -> confirmation prompt
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-del-1",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_del_tid-101",
                }
            })
            del_prompt_text, del_prompt_kb = sent_messages[-1][1], sent_messages[-1][2]
            self.assertIn("Haqiqatdan ham ushbu mavzuni o'chirmoqchimisiz?", del_prompt_text)
            flat_del_cb = [btn["callback_data"] for row in del_prompt_kb["inline_keyboard"] for btn in row]
            self.assertIn("btn:topic_del_confirm_tid-101", flat_del_cb)

            # 4. Confirm delete
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-del-confirm-1",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_del_confirm_tid-101",
                }
            })
            self.assertIn("tid-101", deleted_ids)
            self.assertIn("muvaffaqiyatli o'chirildi", sent_messages[-2][1])

    def test_cancellation_at_any_intermediate_step(self):
        """Sending /cancel or clicking 'btn:topic_cancel' clears state cleanly at any step."""
        sent_messages = []
        sa_user = SimpleNamespace(id="sa-1", name="Superadmin", role="super_admin", is_active=True, telegram_chat_id=self.superadmin_id)

        with patch("apps.core.telegram_menu.ensure_superadmin_user", return_value=sa_user), \
             patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, **kw: sent_messages.append((cid, txt))), \
             patch.object(telegram_delivery, "answer_callback", return_value=True):

            # 1. Cancel via callback in Writing Type state
            fsm.set_state(self.superadmin_id, fsm.STATE_WRITING_TYPE, {"skill": "writing"})
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-cancel-1",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_cancel",
                }
            })
            self.assertEqual(fsm.get_state(self.superadmin_id), {})
            self.assertIn("Amal bekor qilindi", sent_messages[-1][1])

            # 2. Cancel via command /cancel in Speaking Cues state
            fsm.set_state(self.superadmin_id, fsm.STATE_SPEAKING_CUES, {"part": "part2", "title": "Test Title"})
            telegram_bot.handle({
                "message": {
                    "chat": {"id": int(self.superadmin_id)},
                    "from": {"id": int(self.superadmin_id)},
                    "text": "/cancel",
                }
            })
            self.assertEqual(fsm.get_state(self.superadmin_id), {})
            self.assertIn("Amal bekor qilindi", sent_messages[-1][1])

            # 3. Sending /cancel when idle states "Faol jarayon mavjud emas"
            telegram_bot.handle({
                "message": {
                    "chat": {"id": int(self.superadmin_id)},
                    "from": {"id": int(self.superadmin_id)},
                    "text": "/cancel",
                }
            })
            self.assertIn("Faol jarayon mavjud emas", sent_messages[-1][1])

    def test_back_navigation_between_dialog_steps(self):
        """Universal Back buttons return to previous step with preserved context."""
        sent_messages = []
        sa_user = SimpleNamespace(id="sa-1", name="Superadmin", role="super_admin", is_active=True, telegram_chat_id=self.superadmin_id)

        with patch("apps.core.telegram_menu.ensure_superadmin_user", return_value=sa_user), \
             patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, **kw: sent_messages.append((cid, txt, kw.get("reply_markup")))), \
             patch.object(telegram_delivery, "answer_callback", return_value=True):

            # 1. Back from Writing Image step to Writing Prompt
            fsm.set_state(self.superadmin_id, fsm.STATE_WRITING_IMAGE, {"skill": "writing", "task_type": "task1"})
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-b1",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_w_back_prompt",
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_WRITING_PROMPT)
            self.assertIn("Task 1 (Report/Chart)", sent_messages[-1][1])

            # 2. Back from Speaking Content step to Speaking Title
            fsm.set_state(self.superadmin_id, fsm.STATE_SPEAKING_CUES, {"skill": "speaking", "part": "part2"})
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-b2",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_s_back_title",
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_SPEAKING_TITLE)
            self.assertIn("Mavzu sarlavhasini", sent_messages[-1][1])

            # 3. Back from Speaking Confirm to Content
            fsm.set_state(self.superadmin_id, fsm.STATE_SPEAKING_CONFIRM, {"skill": "speaking", "part": "part2", "title": "Tradition"})
            telegram_bot.handle({
                "callback_query": {
                    "id": "cb-b3",
                    "from": {"id": int(self.superadmin_id)},
                    "message": {"chat": {"id": int(self.superadmin_id)}},
                    "data": "btn:topic_s_back_content",
                }
            })
            st = fsm.get_state(self.superadmin_id)
            self.assertEqual(st["state"], fsm.STATE_SPEAKING_CUES)
            self.assertIn("Cue Card punktlari", sent_messages[-1][1])
