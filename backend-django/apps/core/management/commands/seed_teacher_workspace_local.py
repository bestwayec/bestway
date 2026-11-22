"""Seed SYNTHETIC Teacher Workspace data for a disposable local database (run ``seed_local_dev`` first).

Same guards as ``seed_local_dev``: DEBUG on, loopback host, database name ending in ``_local``. Never real data.

Creates for the local teacher (+998900000003): three groups scheduled today/tomorrow with 20 synthetic students
each (phones +99890010GNNN, password LocalDev-2026!, no Telegram link so nothing can ever be delivered), a
vocabulary set, and in group 2 a finished grammar quiz with mixed results plus an overdue lesson task — so the
dashboard, results and student pages show realistic completed / pending / overdue states. Idempotent.
"""
from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.utils import timezone

from apps.core import class_quiz as cq
from apps.core import teacher_workspace as tw
from apps.core.models import ClassQuizAssignment, HomeworkAssignment, VocabularySet, VocabularyWord
from apps.legacy_schema.models import Group, StudentProfile, User
from common.auth.passwords import hash_password

PASSWORD = "LocalDev-2026!"
TEACHER_PHONE = "+998900000003"
GROUPS = (("B1 Kechki", 0, "18:00", "19:30"), ("A2 Ertalabki", 0, "09:00", "10:30"), ("IELTS 6.5", 1, "15:00", "16:30"))
FIRST = ("Aziza", "Bekzod", "Dilnoza", "Jasur", "Kamola", "Laziz", "Madina", "Nodir", "Oydin", "Rustam",
         "Sevara", "Temur", "Umida", "Farrux", "Xurshida", "Shoxrux", "Gulnora", "Eldor", "Zarina", "Akmal")
LAST = ("Karimova", "Toshmatov", "Yusupova", "Rahimov", "Aliyeva", "Saidov", "Ergasheva", "Qodirov", "Nazarova", "Ismoilov")
QUIZ_TEXT = '\n'.join(f'{i}. By next year the bridge ___ .\nA) will have been built\nB) builds\nC) is build\nD) building' for i in range(1, 11))
QUIZ_KEY = '\n'.join(f'{i} A' for i in range(1, 11))


class Command(BaseCommand):
    help = "Synthetic Teacher Workspace data (3 groups x 20 students). Only for a disposable *_local database on loopback."

    def handle(self, *args, **options):
        db = connection.settings_dict
        if not settings.DEBUG:
            raise CommandError("Refusing: DEBUG is off.")
        if db["HOST"] not in ("127.0.0.1", "localhost", "::1") or not str(db["NAME"]).endswith("_local"):
            raise CommandError("Refusing: database must be loopback and named *_local.")
        teacher = User.objects.filter(phone=TEACHER_PHONE, role="teacher").first()
        if teacher is None:
            raise CommandError("Run seed_local_dev first (local teacher missing).")
        actor = SimpleNamespace(id=teacher.id, role="teacher", is_authenticated=True, name=teacher.name)
        now = timezone.now()
        today = timezone.localdate()
        group_ids = []
        for g_index, (name, offset, start, end) in enumerate(GROUPS):
            day = tw.WEEKDAYS[(today.weekday() + offset) % 7]
            group = Group.objects.filter(name=name, teacher_id=teacher.id).first()
            if group is None:
                group = Group.objects.create(id=str(uuid4()), name=name, teacher_id=teacher.id, created_at=now,
                                             schedule=[dict(day=day, startTime=start, endTime=end)])
            else:
                Group.objects.filter(id=group.id).update(schedule=[dict(day=day, startTime=start, endTime=end)])
            group_ids.append(group.id)
            for n in range(20):
                phone = f"+99890010{g_index + 1}{n:03d}"
                user = User.objects.filter(phone=phone).first()
                if user is None:
                    user = User.objects.create(id=str(uuid4()), name=f"{FIRST[n]} {LAST[(n + g_index) % len(LAST)]}", phone=phone,
                                               email=f"tw{g_index}{n}@local.test", password_hash=hash_password(PASSWORD), role="student",
                                               is_active=True, created_at=now, updated_at=now)
                if not StudentProfile.objects.filter(user_id=user.id).exists():
                    with connection.cursor() as cursor:
                        cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
                                       "VALUES (%s, ARRAY['IELTS']::\"ExamProgram\"[], 'IELTS', true, %s, 0, %s, NOW(), NULL, false, NULL)",
                                       [user.id, group.id, f"TW{g_index}{n:02d}{uuid4().hex[:4].upper()}"])
            self.stdout.write(f"group {name}: 20 students ({day} {start}-{end})")

        g1, g2 = group_ids[0], group_ids[1]
        vset = VocabularySet.objects.filter(title="Unit 7 — Travel", created_by_id=teacher.id).first()
        if vset is None:
            vset = VocabularySet.objects.create(title="Unit 7 — Travel", created_by_id=teacher.id, group_id=g1, is_public=True)
            for en, uz in (("journey", "safar"), ("luggage", "yuk"), ("ticket", "chipta"), ("departure", "jo'nash"), ("arrival", "kelish"),
                           ("passport", "pasport"), ("customs", "bojxona"), ("delay", "kechikish"), ("platform", "platforma"), ("destination", "manzil")):
                VocabularyWord.objects.create(set=vset, english=en, uzbek=uz)
        if not ClassQuizAssignment.objects.filter(group_id=g2).exists():
            deadline = (now + timedelta(days=1)).isoformat()
            made = tw.assign_homework(actor, g2, dict(type="quiz", title="Future Perfect Passive — 10 savol", deadline=deadline,
                                                      timeLimitMinutes=20, maxAttempts=1,
                                                      newQuiz=dict(questionsText=QUIZ_TEXT, answerKey=QUIZ_KEY, category="grammar")))
            students = list(StudentProfile.objects.filter(group_id=g2).order_by("user__name").values_list("user_id", flat=True))
            for i, student_id in enumerate(students[:14]):         # 14 of 20 finished with mixed scores, 2 still working
                learner = SimpleNamespace(id=student_id, role="student", is_authenticated=True)
                attempt = cq.start_attempt(learner, made["id"])
                for k, q in enumerate(attempt["questions"]):
                    cq.save_answer(learner, attempt["attemptId"], q["id"], 0 if k < 10 - (i % 5) else 1)
                cq.finish_attempt(learner, attempt["attemptId"])
            for student_id in students[14:16]:
                learner = SimpleNamespace(id=student_id, role="student", is_authenticated=True)
                attempt = cq.start_attempt(learner, made["id"])
                cq.save_answer(learner, attempt["attemptId"], attempt["questions"][0]["id"], 0)
            self.stdout.write("group A2: quiz with 14 finished, 2 in progress, 4 not started")
        cohort_task = HomeworkAssignment.objects.filter(cohort__classroom_id=g2, title="Essay: My favourite place").first()
        if cohort_task is None:
            made = tw.assign_homework(actor, g2, dict(type="lesson", title="Essay: My favourite place",
                                                      deadline=(now + timedelta(hours=1)).isoformat(), minPassPercent=50))
            HomeworkAssignment.objects.filter(id=made["id"]).update(deadline=now - timedelta(days=1))   # already overdue
            self.stdout.write("group A2: overdue lesson task")
        self.stdout.write(self.style.SUCCESS(f"Teacher Workspace demo ready. Teacher {TEACHER_PHONE}, student +998900101000 / {PASSWORD}"))
