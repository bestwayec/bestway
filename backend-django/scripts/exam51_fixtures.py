"""Synthetic classroom fixtures for the BESTWAY 5.1 PostgreSQL checks. No real student data.

Every row is tagged with the run id and removed by ``cleanup``.
"""
import datetime as _dt
from types import SimpleNamespace
from uuid import uuid4

from django.db import connection
from django.utils import timezone

from apps.core.models import (ClassroomEnrollment, Cohort, ExamReportState, HomeworkAssignment, HomeworkSubmission,
                              TelegramOutbox, TelegramPreference)
from apps.legacy_schema.models import (AssessmentJob, Group, MockAnswer, MockAttempt, MockExam, MockQuestion,
                                       MockQuestionGroup, MockSection, User)


class Fixture:
    def __init__(self, tag='x51'):
        self.run = uuid4().hex[:8]
        self.tag = tag
        self.users, self.groups, self.exams = [], [], []

    def user(self, role, name=None, chat=None):
        now = timezone.now()
        uid = f'{self.tag}-{role}-{uuid4().hex[:6]}-{self.run}'
        User.objects.create(id=uid, name=name or f'{self.tag} {role}', phone='+99877' + uuid4().hex[:7], role=role,
                            password_hash='x', is_active=True, telegram_chat_id=chat, created_at=now, updated_at=now)
        self.users.append(uid)
        TelegramPreference.objects.update_or_create(user_id=uid, defaults=dict(quiet_start=_dt.time(0, 0), quiet_end=_dt.time(0, 0)))
        return SimpleNamespace(id=uid, role=role, is_authenticated=True, name=name)

    def group(self, teacher, name='Synthetic Group'):
        gid = f'{self.tag}-grp-{uuid4().hex[:6]}-{self.run}'
        Group.objects.create(id=gid, name=name, teacher_id=teacher.id, created_at=timezone.now())
        self.groups.append(gid)
        return gid

    def student(self, group_id, name=None, chat=None):
        student = self.user('student', name=name, chat=chat)
        with connection.cursor() as cursor:
            cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
                           "VALUES (%s, ARRAY['IELTS','MULTILEVEL']::\"ExamProgram\"[], 'IELTS', true, %s, 0, %s, NOW(), NULL, false, NULL)",
                           [student.id, group_id, 'X5' + uuid4().hex[:8].upper()])
        if group_id:
            ClassroomEnrollment.objects.create(group_id=group_id, student_id=student.id, started_at=timezone.now())
        return student

    def reading_exam(self, answers=('blue', 'green', 'red', 'black'), exam_type='ielts_academic', profile='practice', minutes=60):
        """A published, free, objective-only Reading exam; returns (exam_id, [question ids])."""
        now = timezone.now()
        exam_id = f'{self.tag}-exam-{uuid4().hex[:6]}-{self.run}'
        MockExam.objects.create(id=exam_id, title=f'Synthetic Reading {self.run}', type=exam_type, profile=profile,
                                is_published=True, is_demo=True, price=0, is_free_for_approved=True, content_version=1,
                                created_at=now, updated_at=now)
        self.exams.append(exam_id)
        section = MockSection.objects.create(id=str(uuid4()), exam_id=exam_id, skill='reading', title='Reading', sort_order=0,
                                             duration_minutes=minutes)
        group = MockQuestionGroup.objects.create(id=str(uuid4()), section_id=section.id, sort_order=0, title='Passage 1',
                                                 passage_text='Synthetic passage about colours.', audio_play_limit=1, created_at=now)
        ids = []
        for number, answer in enumerate(answers, start=1):
            qid = str(uuid4())
            MockQuestion.objects.create(id=qid, group_id=group.id, number=number, sort_order=number, type='short_answer',
                                        prompt=f'Question {number}', points=1, options=None, correct_answers=[answer],
                                        accepted_variants=[], word_limit=2, created_at=now)
            ids.append(qid)
        return exam_id, ids

    def cleanup(self):
        attempts = list(MockAttempt.objects.filter(student_id__in=self.users).values_list('id', flat=True))
        from apps.core.models import SubmissionHandoff
        SubmissionHandoff.objects.filter(attempt_id__in=attempts).delete()
        AssessmentJob.objects.filter(attempt_id__in=attempts).delete()
        MockAnswer.objects.filter(attempt_id__in=attempts).delete()
        MockAttempt.objects.filter(id__in=attempts).delete()
        for exam_id in self.exams:
            MockQuestion.objects.filter(group__section__exam_id=exam_id).delete()
            MockQuestionGroup.objects.filter(section__exam_id=exam_id).delete()
            MockSection.objects.filter(exam_id=exam_id).delete()
        cohorts = Cohort.objects.filter(classroom_id__in=self.groups)
        ExamReportState.objects.filter(assignment__cohort__in=cohorts).delete()
        HomeworkSubmission.objects.filter(assignment__cohort__in=cohorts).delete()
        HomeworkAssignment.objects.filter(cohort__in=cohorts).delete()
        cohorts.delete()
        MockExam.objects.filter(id__in=self.exams).delete()
        TelegramOutbox.objects.filter(recipient_id__in=self.users).delete()
        TelegramOutbox.objects.filter(group_id__in=self.groups).delete()
        ClassroomEnrollment.objects.filter(student_id__in=self.users).delete()
        TelegramPreference.objects.filter(user_id__in=self.users).delete()
        with connection.cursor() as cursor:
            cursor.execute('DELETE FROM "AuditLog" WHERE "entityId" = ANY(%s)', [attempts or ['-']])
            cursor.execute('DELETE FROM "Notification" WHERE "userId" = ANY(%s)', [self.users or ['-']])
            cursor.execute('DELETE FROM "StudentProfile" WHERE "userId" = ANY(%s)', [self.users or ['-']])
        Group.objects.filter(id__in=self.groups).delete()
        User.objects.filter(id__in=self.users).delete()
