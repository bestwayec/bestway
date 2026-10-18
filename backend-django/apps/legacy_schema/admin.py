"""Read-only Django Admin for the Prisma-owned (``managed=False``) tables.

These tables belong to Prisma/NestJS and to the running application: Django
must never create, mutate or delete their rows. Every registration therefore
disables add/change/delete and the bulk actions machinery, so the Admin can be
used to *inspect* production-shaped data safely (readiness, attempts, audit
trails) without any write surface.

Access itself is limited to active ``admin`` / ``super_admin`` accounts by
``common.auth.admin_backend``.
"""
from __future__ import annotations

from django.contrib import admin

from .models import (
    Answer,
    Article,
    AssessmentEvaluation,
    AssessmentJob,
    Attendance,
    AuditLog,
    GalleryImage,
    Group,
    MockAnswer,
    MockAttempt,
    MockExam,
    MockExamImport,
    MockImportReviewIssue,
    MockPurchase,
    MockQuestion,
    MockQuestionGroup,
    MockSection,
    MonthlyPointsArchive,
    Notification,
    ParentStudent,
    Payment,
    PointsLog,
    Question,
    Setting,
    SpeechTranscript,
    StudentProfile,
    Teacher,
    Test,
    TestAttempt,
    User,
    VideoLesson,
    VideoPurchase,
)


class ReadOnlyModelAdmin(admin.ModelAdmin):
    """View-only ModelAdmin: no add/change/delete, no bulk actions."""

    actions = None
    show_full_result_count = False

    def has_module_permission(self, request):
        # Site access is already limited to active administrative accounts by
        # common.auth.admin_backend; Prisma models are view-only for every one
        # of them, so the module must be listed even for a non-superuser.
        return True

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(User)
class UserAdmin(ReadOnlyModelAdmin):
    list_display = ("phone", "name", "role", "is_active", "created_at")
    list_filter = ("role", "is_active")
    search_fields = ("phone", "name", "email", "id")
    ordering = ("created_at",)


@admin.register(StudentProfile)
class StudentProfileAdmin(ReadOnlyModelAdmin):
    list_display = ("user_id", "is_approved", "active_program", "current_points", "group_id")
    list_filter = ("is_approved", "active_program")
    search_fields = ("user_id", "link_code")
    ordering = ("user_id",)


@admin.register(Group)
class GroupAdmin(ReadOnlyModelAdmin):
    list_display = ("name", "teacher_id", "id")
    search_fields = ("name", "id")
    ordering = ("name",)


@admin.register(ParentStudent)
class ParentStudentAdmin(ReadOnlyModelAdmin):
    list_display = ("parent_user_id", "student_id", "created_at")
    search_fields = ("parent_user_id", "student_id")
    ordering = ("parent_user_id",)


@admin.register(Attendance)
class AttendanceAdmin(ReadOnlyModelAdmin):
    list_display = ("date", "student_id", "group_id", "state", "marked_by_id")
    list_filter = ("state",)
    ordering = ("-date",)


@admin.register(Payment)
class PaymentAdmin(ReadOnlyModelAdmin):
    list_display = ("student_id", "year", "month", "state", "amount", "method")
    list_filter = ("state", "method", "year")
    ordering = ("-year", "-month")


@admin.register(PointsLog)
class PointsLogAdmin(ReadOnlyModelAdmin):
    list_display = ("student_id", "change", "reason", "created_at")
    search_fields = ("student_id", "reason")
    ordering = ("-created_at",)


@admin.register(MonthlyPointsArchive)
class MonthlyPointsArchiveAdmin(ReadOnlyModelAdmin):
    list_display = ("student_id", "year", "month", "points", "qualified")
    ordering = ("-year", "-month")


@admin.register(MockExam)
class MockExamAdmin(ReadOnlyModelAdmin):
    list_display = ("title", "type", "profile", "is_published", "is_demo", "content_version", "updated_at")
    list_filter = ("type", "profile", "is_published", "is_demo")
    search_fields = ("title", "id")
    ordering = ("-updated_at",)


@admin.register(MockSection)
class MockSectionAdmin(ReadOnlyModelAdmin):
    list_display = ("skill", "exam_id", "sort_order", "duration_minutes", "title")
    list_filter = ("skill",)
    search_fields = ("exam_id", "id")
    ordering = ("exam_id", "sort_order")


@admin.register(MockQuestionGroup)
class MockQuestionGroupAdmin(ReadOnlyModelAdmin):
    list_display = ("section_id", "sort_order", "part_number", "title", "has_audio")
    search_fields = ("section_id", "id", "title")
    ordering = ("section_id", "sort_order")

    @admin.display(boolean=True, description="audio")
    def has_audio(self, obj):
        return bool(obj.audio_key)


@admin.register(MockQuestion)
class MockQuestionAdmin(ReadOnlyModelAdmin):
    list_display = ("group_id", "number", "type", "points", "word_limit")
    list_filter = ("type",)
    search_fields = ("group_id", "id")
    ordering = ("group_id", "sort_order", "number")


@admin.register(MockAttempt)
class MockAttemptAdmin(ReadOnlyModelAdmin):
    list_display = ("id", "exam_id", "student_id", "status", "mode", "started_at", "submitted_at")
    list_filter = ("status", "mode")
    search_fields = ("id", "exam_id", "student_id")
    ordering = ("-started_at",)


@admin.register(MockAnswer)
class MockAnswerAdmin(ReadOnlyModelAdmin):
    list_display = ("attempt_id", "question_id", "is_graded", "score", "updated_at")
    list_filter = ("is_graded",)
    search_fields = ("attempt_id", "question_id")
    ordering = ("-updated_at",)


@admin.register(MockExamImport)
class MockExamImportAdmin(ReadOnlyModelAdmin):
    list_display = ("exam_id", "package_id", "revision", "schema_version", "created_at")
    search_fields = ("exam_id", "package_id", "id")
    ordering = ("-created_at",)


@admin.register(MockImportReviewIssue)
class MockImportReviewIssueAdmin(ReadOnlyModelAdmin):
    list_display = ("entity_kind", "code", "status", "import_record_id", "created_at")
    list_filter = ("status", "entity_kind")
    search_fields = ("import_record_id", "message", "path")
    ordering = ("-created_at",)


@admin.register(MockPurchase)
class MockPurchaseAdmin(ReadOnlyModelAdmin):
    list_display = ("user_id", "exam_id", "status", "amount", "method", "created_at")
    list_filter = ("status", "method")
    search_fields = ("user_id", "exam_id")
    ordering = ("-created_at",)


@admin.register(AssessmentJob)
class AssessmentJobAdmin(ReadOnlyModelAdmin):
    list_display = ("attempt_id", "skill", "status", "final_score", "final_score_source", "created_at")
    list_filter = ("status", "skill", "final_score_source")
    search_fields = ("attempt_id", "student_id", "id")
    ordering = ("-created_at",)


@admin.register(AssessmentEvaluation)
class AssessmentEvaluationAdmin(ReadOnlyModelAdmin):
    list_display = ("job_id", "role", "attempt_number", "status", "provider", "confidence", "started_at")
    list_filter = ("status", "provider", "role")
    search_fields = ("job_id", "id")
    ordering = ("-started_at",)


@admin.register(SpeechTranscript)
class SpeechTranscriptAdmin(ReadOnlyModelAdmin):
    list_display = ("job_id", "question_id", "status", "attempt_number", "provider", "started_at")
    list_filter = ("status", "provider")
    search_fields = ("job_id", "question_id")
    ordering = ("-started_at",)


@admin.register(Test)
class TestAdmin(ReadOnlyModelAdmin):
    list_display = ("title", "type", "level", "is_active", "is_demo", "duration_minutes")
    list_filter = ("type", "is_active", "is_demo")
    search_fields = ("title", "id")
    ordering = ("-created_at",)


@admin.register(Question)
class QuestionAdmin(ReadOnlyModelAdmin):
    list_display = ("test_id", "section", "type", "max_score")
    list_filter = ("section", "type")
    search_fields = ("test_id", "id")
    ordering = ("test_id", "section")


@admin.register(TestAttempt)
class TestAttemptAdmin(ReadOnlyModelAdmin):
    list_display = ("id", "test_id", "student_id", "status", "started_at", "finished_at")
    list_filter = ("status",)
    search_fields = ("id", "test_id", "student_id")
    ordering = ("-started_at",)


@admin.register(Answer)
class AnswerAdmin(ReadOnlyModelAdmin):
    list_display = ("attempt_id", "question_id", "is_graded", "score", "updated_at")
    list_filter = ("is_graded",)
    search_fields = ("attempt_id", "question_id")
    ordering = ("-updated_at",)


@admin.register(Article)
class ArticleAdmin(ReadOnlyModelAdmin):
    list_display = ("title", "category", "author_id", "created_at")
    list_filter = ("category",)
    search_fields = ("title", "id")
    ordering = ("-created_at",)


@admin.register(Teacher)
class TeacherAdmin(ReadOnlyModelAdmin):
    list_display = ("name", "specialty", "is_active", "sort_order")
    list_filter = ("is_active",)
    search_fields = ("name", "id")
    ordering = ("sort_order",)


@admin.register(GalleryImage)
class GalleryImageAdmin(ReadOnlyModelAdmin):
    list_display = ("label", "alt", "is_active", "sort_order")
    list_filter = ("is_active",)
    search_fields = ("label", "alt", "id")
    ordering = ("sort_order",)


@admin.register(VideoLesson)
class VideoLessonAdmin(ReadOnlyModelAdmin):
    list_display = ("title", "price", "is_free_for_approved", "mime_type")
    search_fields = ("title", "id")
    ordering = ("-created_at",)


@admin.register(VideoPurchase)
class VideoPurchaseAdmin(ReadOnlyModelAdmin):
    list_display = ("user_id", "video_id", "status", "method", "confirmed_by_id")
    list_filter = ("status",)
    search_fields = ("user_id", "video_id")
    ordering = ("-created_at",)


@admin.register(Notification)
class NotificationAdmin(ReadOnlyModelAdmin):
    list_display = ("user_id", "type", "read", "created_at")
    list_filter = ("type", "read")
    search_fields = ("user_id", "text")
    ordering = ("-created_at",)


@admin.register(Setting)
class SettingAdmin(ReadOnlyModelAdmin):
    list_display = ("key",)
    search_fields = ("key",)
    ordering = ("key",)


@admin.register(AuditLog)
class AuditLogAdmin(ReadOnlyModelAdmin):
    list_display = ("action", "entity", "user_id", "entity_id", "created_at")
    list_filter = ("entity",)
    search_fields = ("user_id", "entity_id", "action")
    ordering = ("-created_at",)
