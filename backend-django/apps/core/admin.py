"""Django Admin for Computer-Delivered (CD) Exam Models."""
from __future__ import annotations

from django.contrib import admin
from .models import Exam, Section, QuestionGroup, Question, AnswerKey


class AnswerKeyInline(admin.StackedInline):
    model = AnswerKey
    can_delete = False
    extra = 1
    classes = ["collapse"]


class QuestionInline(admin.StackedInline):
    model = Question
    extra = 0
    show_change_link = True
    fields = ("order", "question_type", "prompt", "points", "word_limit", "payload_json")


class QuestionGroupInline(admin.StackedInline):
    model = QuestionGroup
    extra = 0
    show_change_link = True
    fields = ("part_number", "sort_order", "title", "audio_url", "media_image", "instructions")


class SectionInline(admin.TabularInline):
    model = Section
    extra = 0
    show_change_link = True
    fields = ("order", "title", "section_type", "time_limit")


@admin.register(Exam)
class ExamAdmin(admin.ModelAdmin):
    list_display = ("code", "title", "exam_type", "duration_minutes", "is_cd_format", "is_published", "updated_at")
    list_filter = ("exam_type", "is_cd_format", "is_published")
    search_fields = ("title", "code", "description")
    ordering = ("code",)
    inlines = [SectionInline]


@admin.register(Section)
class SectionAdmin(admin.ModelAdmin):
    list_display = ("exam", "order", "title", "section_type", "time_limit", "updated_at")
    list_filter = ("section_type", "exam")
    search_fields = ("title", "exam__title", "exam__code")
    ordering = ("exam", "order")
    inlines = [QuestionGroupInline]


@admin.register(QuestionGroup)
class QuestionGroupAdmin(admin.ModelAdmin):
    list_display = ("section", "part_number", "sort_order", "title", "has_audio", "has_image", "question_count")
    list_filter = ("section__section_type", "section__exam")
    search_fields = ("title", "section__title", "section__exam__code")
    ordering = ("section__exam", "section__order", "sort_order")
    inlines = [QuestionInline]

    @admin.display(boolean=True, description="Audio")
    def has_audio(self, obj):
        return bool(obj.audio_url)

    @admin.display(boolean=True, description="Image")
    def has_image(self, obj):
        return bool(obj.media_image)

    @admin.display(description="Questions")
    def question_count(self, obj):
        return obj.questions.count()


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ("order", "group", "question_type", "points", "word_limit", "short_prompt")
    list_filter = ("question_type", "group__section__section_type", "group__section__exam")
    search_fields = ("prompt", "group__title", "group__section__exam__code")
    ordering = ("group__section__exam", "group__section__order", "group__sort_order", "order")
    inlines = [AnswerKeyInline]

    @admin.display(description="Prompt")
    def short_prompt(self, obj):
        return (obj.prompt[:60] + "...") if len(obj.prompt) > 60 else obj.prompt


@admin.register(AnswerKey)
class AnswerKeyAdmin(admin.ModelAdmin):
    list_display = ("question", "valid_answers_list", "case_sensitive", "updated_at")
    list_filter = ("case_sensitive", "question__group__section__section_type")
    search_fields = ("valid_answers_list", "explanation", "question__prompt")
