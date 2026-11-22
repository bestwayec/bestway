"""Tests for Telegram Bot v0.7.0: Superadmin Panel, Writing Image OCR + AI Evaluation, and Real-Time Notifications."""
import os
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from django.utils import timezone

from apps.core import telegram_bot, telegram_delivery, telegram_menu
from apps.legacy_schema import models as m


class TelegramV070Tests(SimpleTestCase):

    def setUp(self):
        self.superadmin_id = "5582178765"  # an arbitrary linked admin chat used by the fixtures below
        self.bot_token = "test-bot-token-v070"

    def test_no_builtin_superadmin_identity_and_no_auto_provisioning(self):
        """Security: a Telegram id (even the one that used to be hard-coded) never grants super_admin or creates accounts."""
        for module in (telegram_menu, telegram_delivery):
            self.assertNotEqual(getattr(module, "SUPERADMIN_TELEGRAM_ID", ""), "5582178765")
        self.assertFalse(hasattr(telegram_bot, "SUPERADMIN_TELEGRAM_ID"))
        with patch.object(m.User.objects, "filter") as user_filter, patch.object(m.User.objects, "create") as user_create, \
                patch.object(m.StudentProfile.objects, "filter") as profile_filter:
            user_filter.return_value.first.return_value = None
            self.assertFalse(telegram_menu.is_superadmin(chat_id=5582178765))
            self.assertIsNone(telegram_menu.ensure_superadmin_user(5582178765, from_user={"first_name": "Komiljon"}))
            user_create.assert_not_called()
            user_filter.return_value.update.assert_not_called()
            profile_filter.return_value.update.assert_not_called()

    def test_a_student_linked_to_the_old_default_id_is_not_promoted(self):
        student = SimpleNamespace(id="u1", name="S", role="student", is_active=True, telegram_chat_id="5582178765")
        with patch.object(m.User.objects, "filter") as user_filter:
            user_filter.return_value.first.return_value = None  # the lookup requires role='super_admin' in the query
            self.assertFalse(telegram_menu.is_superadmin(chat_id="5582178765", user=student))
            kwargs = user_filter.call_args.kwargs
            self.assertEqual(kwargs.get("role"), "super_admin")
            self.assertIs(kwargs.get("is_active"), True)
        self.assertEqual(student.role, "student")

    def test_only_an_active_super_admin_user_object_or_link_is_authorised(self):
        active = SimpleNamespace(role="super_admin", is_active=True)
        inactive = SimpleNamespace(role="super_admin", is_active=False)
        with patch.object(m.User.objects, "filter") as user_filter:
            user_filter.return_value.first.return_value = None
            self.assertTrue(telegram_menu.is_superadmin(user=active))
            self.assertFalse(telegram_menu.is_superadmin(user=inactive))
            self.assertFalse(telegram_menu.is_superadmin(chat_id=None))

    def test_web_admin_sso_is_refused_without_a_linked_super_admin(self):
        sent = []
        with patch("apps.core.telegram_menu.linked_superadmin", return_value=None), \
                patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, reply_markup=None: sent.append(txt)), \
                patch("apps.core.telegram_menu.generate_sso_url") as sso:
            telegram_menu.send_web_admin_login(5582178765)
        sso.assert_not_called()
        self.assertTrue(sent and "superadmin" in sent[0].lower())

    def test_superadmin_start_and_panel_buttons(self):
        sent_menus = []
        sent_messages = []
        sa_user = SimpleNamespace(
            id="sa-5582178765",
            name="Superadmin User",
            role="super_admin",
            is_active=True,
            is_approved=True,
            telegram_chat_id="5582178765",
        )

        with patch("apps.core.telegram_menu.linked_superadmin", return_value=sa_user), \
             patch.object(telegram_delivery, "menu", side_effect=lambda cid, txt, kb: sent_menus.append((cid, txt, kb))), \
             patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, reply_markup=None: sent_messages.append((cid, txt, reply_markup))):
            # 1. /start auto-recognizes 5582178765 and shows Superadmin keyboard
            telegram_bot.handle_update({
                "message": {
                    "chat": {"id": 5582178765},
                    "from": {"id": 5582178765, "first_name": "Komiljon"},
                    "text": "/start",
                }
            })
            self.assertEqual(len(sent_menus), 1)
            cid, greeting, kb = sent_menus[0]
            self.assertEqual(cid, 5582178765)
            self.assertIn("Superadmin", greeting)
            flat_buttons = [btn["text"] for row in kb["keyboard"] for btn in row]
            self.assertIn("👑 Superadmin Panel", flat_buttons)
            self.assertIn("📊 Platforma statistikasi", flat_buttons)
            self.assertIn("👨‍🎓 Faol talabalar", flat_buttons)
            self.assertIn("📝 Bugungi testlar", flat_buttons)
            self.assertIn("🔐 Web Admin (1-Click Kirish)", flat_buttons)
            self.assertIn("✍️ Writing Rasm Tekshirish (AI)", flat_buttons)

            # 2. Clicking '👑 Superadmin Panel'
            telegram_bot.handle_update({
                "message": {
                    "chat": {"id": 5582178765},
                    "from": {"id": 5582178765, "first_name": "Komiljon"},
                    "text": "👑 Superadmin Panel",
                }
            })
            self.assertEqual(len(sent_messages), 1)
            self.assertIn("BestWay Superadmin Paneli", sent_messages[-1][1])
            self.assertIsNotNone(sent_messages[-1][2])

    def test_superadmin_stats_and_todays_tests_commands(self):
        sent_messages = []
        sa_user = SimpleNamespace(
            id="sa-5582178765",
            name="Superadmin User",
            role="super_admin",
            is_active=True,
            is_approved=True,
            telegram_chat_id="5582178765",
        )
        now = timezone.localtime()
        sample_attempt = SimpleNamespace(
            status="completed",
            overall_band=7.5,
            overall_score=None,
            started_at=now,
            student=SimpleNamespace(user=SimpleNamespace(name="Sardor Aliyev")),
            exam=SimpleNamespace(title="IELTS Academic Mock #4"),
        )

        with patch("apps.core.telegram_menu.linked_superadmin", return_value=sa_user), \
             patch.object(m.User.objects, "count", return_value=120), \
             patch.object(m.StudentProfile.objects, "filter") as mock_sp_filter, \
             patch.object(m.User.objects, "filter") as mock_u_filter, \
             patch.object(m.Group.objects, "count", return_value=8), \
             patch.object(m.MockAttempt.objects, "filter") as mock_ma_filter, \
             patch.object(m.TestAttempt.objects, "filter") as mock_ta_filter, \
             patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, reply_markup=None: sent_messages.append((cid, txt, reply_markup))):
            mock_sp_filter.return_value.count.return_value = 95
            mock_u_filter.return_value.count.return_value = 12
            mock_ma_filter.return_value.count.return_value = 340
            mock_ta_filter.return_value.count.return_value = 60

            # Platform stats button
            telegram_bot.handle_update({
                "message": {
                    "chat": {"id": 5582178765},
                    "from": {"id": 5582178765},
                    "text": "📊 Platforma statistikasi",
                }
            })
            self.assertEqual(len(sent_messages), 1)
            stats_text = sent_messages[-1][1]
            self.assertIn("Platforma statistikasi", stats_text)
            self.assertIn("120", stats_text)
            self.assertIn("95", stats_text)
            self.assertIn("400", stats_text)

            # Today's tests button
            mock_ma_filter.return_value.select_related.return_value.order_by.return_value = [sample_attempt]
            mock_ta_filter.return_value.select_related.return_value.order_by.return_value = []
            telegram_bot.handle_update({
                "message": {
                    "chat": {"id": 5582178765},
                    "from": {"id": 5582178765},
                    "text": "📝 Bugungi testlar",
                }
            })
            self.assertEqual(len(sent_messages), 2)
            today_text = sent_messages[-1][1]
            self.assertIn("Bugungi testlar", today_text)
            self.assertIn("Sardor Aliyev", today_text)
            self.assertIn("IELTS Academic Mock #4", today_text)
            self.assertIn("Band 7.5", today_text)

            # Web Admin 1-Click SSO button
            with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": self.bot_token, "FRONTEND_URL": "https://bestwayec.uz"}):
                telegram_bot.handle_update({
                    "message": {
                        "chat": {"id": 5582178765},
                        "from": {"id": 5582178765},
                        "text": "🔐 Web Admin (1-Click Kirish)",
                    }
                })
            self.assertEqual(len(sent_messages), 3)
            sso_text = sent_messages[-1][1]
            sso_markup = sent_messages[-1][2]
            self.assertIn("Superadmin SSO", sso_text)
            sso_url = sso_markup["inline_keyboard"][0][0]["url"]
            self.assertTrue(sso_url.startswith("https://bestwayec.uz/login?sso_token="))
            self.assertNotIn("5582178765", sso_url)

    def test_writing_photo_upload_ocr_and_ai_evaluation_reply(self):
        sent_messages = []
        fake_image_bytes = b"\xff\xd8\xff\xe0fake-jpeg-handwritten-essay"
        mock_ocr_result = {
            "ocrText": "Technology has changed how people learn. " * 12,
            "available": True,
            "ocrText": "Nowadays technology plays a crucial role in modern education and global communication.",
            "wordCount": 265,
            "overall_band": 7.0,
            "task_achievement": 7.0,
            "coherence_cohesion": 7.5,
            "lexical_resource": 7.0,
            "grammatical_range": 6.5,
            "strengths": [
                "Well-developed thesis statement and clear paragraphing",
                "Effective use of academic collocations",
            ],
            "weaknesses": [
                "Pay attention to punctuation in complex relative clauses",
            ],
            "feedback": "Strong Task 2 essay with coherent progression of ideas.",
        }

        student_user = SimpleNamespace(
            id="stu-101",
            name="Malika Karimova",
            role="student",
            is_active=True,
            telegram_chat_id="99887766",
        )

        mock_http_resp = MagicMock()
        mock_http_resp.__enter__.return_value.read.return_value = fake_image_bytes

        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": self.bot_token, "SUPERADMIN_TELEGRAM_ID": "5582178765"}), \
             patch("apps.core.telegram_links.find", return_value=student_user), \
             patch.object(telegram_delivery, "call", return_value={"file_path": "photos/file_42.jpg"}) as mock_tg_call, \
             patch("apps.core.telegram_bot.urlopen", return_value=mock_http_resp), \
             patch("apps.core.telegram_bot.writing_ocr.extract_and_evaluate_images", return_value=mock_ocr_result) as mock_eval, \
             patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, reply_markup=None: sent_messages.append((cid, txt, reply_markup))):
            telegram_bot.handle_update({
                "message": {
                    "chat": {"id": 99887766},
                    "from": {"id": 99887766, "first_name": "Malika", "last_name": "Karimova"},
                    "caption": "Some people think technology makes learning easier. Discuss.",
                    "photo": [
                        {"file_id": "low_res_id", "width": 320, "height": 240},
                        {"file_id": "high_res_id", "width": 1280, "height": 960},
                    ],
                }
            })

            # Verify highest-res photo was requested
            mock_tg_call.assert_called_once_with("getFile", {"file_id": "high_res_id"})
            mock_eval.assert_called_once_with(
                [(fake_image_bytes, "image/jpeg")],
                task_prompt="Some people think technology makes learning easier. Discuss.",
            )

            # 3 messages sent: 1) progress message to student, 2) evaluation report to student, 3) alert to superadmin 5582178765
            self.assertEqual(len(sent_messages), 3)

            prog_cid, prog_text, _ = sent_messages[0]
            self.assertEqual(prog_cid, 99887766)
            self.assertIn("Writing javobingiz o'qilmoqda (OCR)", prog_text)

            rep_cid, rep_text, _ = sent_messages[1]
            self.assertEqual(rep_cid, 99887766)
            self.assertIn("Ajratib olingan matn (OCR)", rep_text)
            self.assertIn("265 so'z", rep_text)
            self.assertIn("Overall Writing Band: 7.0", rep_text)
            self.assertIn("Task Achievement (TA): <b>7.0</b>", rep_text)
            self.assertIn("Coherence &amp; Cohesion (CC): <b>7.5</b>", rep_text)
            self.assertIn("Lexical Resource (LR): <b>7.0</b>", rep_text)
            self.assertIn("Grammatical Range &amp; Accuracy (GRA): <b>6.5</b>", rep_text)
            self.assertIn("Well-developed thesis statement", rep_text)
            self.assertIn("Pay attention to punctuation", rep_text)

            sa_cid, sa_text, _ = sent_messages[2]
            self.assertEqual(str(sa_cid), "5582178765")
            self.assertIn("Malika Karimova", sa_text)
            self.assertIn("7.0", sa_text)

    def test_notify_submission_result_sends_to_superadmin_and_group_teacher(self):
        sent_messages = []
        teacher_user = SimpleNamespace(
            id="teacher-7",
            name="Ustoz Javlonbek",
            telegram_chat_id="77665544",
        )
        group_obj = SimpleNamespace(
            id="grp-ielts-1",
            name="IELTS Intensive Morning",
            teacher=teacher_user,
        )
        student_prof = SimpleNamespace(
            user_id="student-99",
            user=SimpleNamespace(id="student-99", name="Aziza Rustamova"),
            group=group_obj,
        )
        attempt_obj = SimpleNamespace(
            id="att-writing-777",
            exam=SimpleNamespace(title="Official IELTS Mock #5"),
            student=student_prof,
        )
        job_obj = SimpleNamespace(
            id="job-writing-1",
            attempt_id="att-writing-777",
            attempt=attempt_obj,
            student=student_prof,
            skill="writing",
            final_score=6.5,
            ai_score=6.5,
            teacher_score=None,
            approved_feedback=None,
            final_result={
                "parts": [
                    {
                        "criteria": {"ta": 6.5, "cc": 7.0, "lr": 6.5, "gra": 6.0},
                        "feedback": {
                            "strengths": ["Clear main argument"],
                            "issues": ["Minor article omissions"],
                        },
                    }
                ],
                "overallStrengths": ["Clear main argument", "Good paragraph transitions"],
                "priorityImprovements": ["Review complex sentence punctuation"],
            },
        )

        with patch.dict(os.environ, {"SUPERADMIN_TELEGRAM_ID": "5582178765"}), \
                patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, reply_markup=None: sent_messages.append((cid, txt))):
            recipients = telegram_delivery.notify_submission_result(job_obj)
            self.assertEqual(recipients, ["5582178765", "77665544"])
            self.assertEqual(len(sent_messages), 2)

            sa_cid, sa_msg = sent_messages[0]
            t_cid, t_msg = sent_messages[1]
            self.assertEqual(sa_cid, "5582178765")
            self.assertEqual(t_cid, "77665544")
            self.assertEqual(sa_msg, t_msg)

            self.assertIn("Aziza Rustamova", sa_msg)
            self.assertIn("IELTS Intensive Morning", sa_msg)
            self.assertIn("Ustoz Javlonbek", sa_msg)
            self.assertIn("Official IELTS Mock #5", sa_msg)
            self.assertIn("Writing", sa_msg)
            self.assertIn("6.5", sa_msg)
            self.assertIn("TA: <b>6.5</b>", sa_msg)
            self.assertIn("CC: <b>7.0</b>", sa_msg)
            self.assertIn("https://bestwayec.uz/uz/results/att-writing-777", sa_msg)

    def test_without_an_alert_destination_only_the_teacher_is_notified(self):
        with patch.dict(os.environ, {"SUPERADMIN_TELEGRAM_ID": ""}):
            self.assertEqual(telegram_delivery._get_superadmin_id(), "")

    def test_writing_photo_fails_closed_when_ocr_or_ai_is_unavailable(self):
        student = SimpleNamespace(id="stu-1", name="Malika", role="student", is_active=True, telegram_chat_id="99887766")
        message = {"message": {"chat": {"id": 99887766}, "from": {"id": 99887766, "first_name": "M"},
                               "photo": [{"file_id": "f1"}], "caption": "Discuss."}}
        scenarios = {
            "no image bytes": (None, {}),
            "no text read": (b"img", {"ocrText": "", "available": False, "overall_band": None}),
            "no ai evaluation": (b"img", {"ocrText": "some text " * 30, "available": False, "overall_band": None}),
        }
        for name, (image, result) in scenarios.items():
            sent = []
            with self.subTest(name), patch.dict(os.environ, {"SUPERADMIN_TELEGRAM_ID": "5582178765"}), \
                    patch("apps.core.telegram_links.find", return_value=student), \
                    patch("apps.core.telegram_bot._download_telegram_photo", return_value=image), \
                    patch("apps.core.telegram_bot.writing_ocr.extract_and_evaluate_images", return_value=result), \
                    patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, reply_markup=None: sent.append((str(cid), txt))):
                telegram_bot.handle_update(message)
            texts = " ".join(text for _cid, text in sent)
            self.assertNotIn("Overall Writing Band", texts, name)
            self.assertNotIn("5582178765", [cid for cid, _ in sent], f"{name}: admin must not be alerted with a score")
            self.assertTrue(any(cid == "99887766" for cid, _ in sent))
