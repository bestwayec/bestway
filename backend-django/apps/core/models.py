"""Vocabulary and Spaced Repetition (SRS) models."""
import uuid
from django.db import models
from apps.legacy_schema.models import Group, User


def uuid4_str() -> str:
    return str(uuid.uuid4())


class VocabularyLevel(models.TextChoices):
    A1 = "A1", "A1"
    A2 = "A2", "A2"
    B1 = "B1", "B1"
    B2 = "B2", "B2"
    C1 = "C1", "C1"
    IELTS = "IELTS", "IELTS"


class QuizMode(models.TextChoices):
    MIXED = "mixed", "Mixed (Aralash)"
    ENG_UZB = "eng_uzb", "English -> Uzbek"
    UZB_ENG = "uzb_eng", "Uzbek -> English"
    SPELLING = "spelling", "Spelling (Yozish)"


class VocabularySet(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid4_str)
    title = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    group = models.ForeignKey(
        Group,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        db_constraint=False,
        related_name="vocabulary_sets",
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        db_constraint=False,
        related_name="created_vocabulary_sets",
    )
    level = models.CharField(
        max_length=20,
        choices=VocabularyLevel.choices,
        default=VocabularyLevel.B1,
    )
    is_public = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "VocabularySet"
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class VocabularyWord(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid4_str)
    set = models.ForeignKey(
        VocabularySet,
        on_delete=models.CASCADE,
        related_name="words",
    )
    english = models.CharField(max_length=255)
    uzbek = models.CharField(max_length=255)
    context_sentence = models.TextField(null=True, blank=True)
    part_of_speech = models.CharField(max_length=50, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "VocabularyWord"
        ordering = ["english", "id"]

    def __str__(self):
        return f"{self.english} - {self.uzbek}"


class VocabularyAttempt(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid4_str)
    student = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        db_constraint=False,
        related_name="vocabulary_attempts",
    )
    set = models.ForeignKey(
        VocabularySet,
        on_delete=models.CASCADE,
        related_name="attempts",
    )
    score = models.IntegerField(default=0)
    total_words = models.IntegerField(default=0)
    percentage = models.FloatField(default=0.0)
    points_awarded = models.IntegerField(default=0)
    mode = models.CharField(
        max_length=20,
        choices=QuizMode.choices,
        default=QuizMode.MIXED,
    )
    wrong_answers = models.JSONField(default=list, blank=True)
    completed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "VocabularyAttempt"
        ordering = ["-completed_at"]

    def __str__(self):
        return f"{self.student_id} - {self.set_id} ({self.score}/{self.total_words})"


class UserWeakWord(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid4_str)
    student = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        db_constraint=False,
        related_name="weak_words",
    )
    word = models.ForeignKey(
        VocabularyWord,
        on_delete=models.CASCADE,
        related_name="weak_instances",
    )
    mistake_count = models.IntegerField(default=1)
    correct_streak = models.IntegerField(default=0)
    is_mastered = models.BooleanField(default=False)
    last_reviewed = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "UserWeakWord"
        unique_together = ("student", "word")
        ordering = ["-mistake_count", "-last_reviewed"]

    def __str__(self):
        return f"{self.student_id} - {self.word_id} (mistakes: {self.mistake_count})"


class ParentTelegramLink(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid4_str)
    student = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        db_constraint=False,
        related_name="parent_links",
    )
    invite_code = models.CharField(max_length=32, unique=True, db_index=True)
    parent_chat_id = models.CharField(max_length=64, null=True, blank=True, db_index=True)
    parent_name = models.CharField(max_length=255, null=True, blank=True)
    parent_phone = models.CharField(max_length=64, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    linked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ParentTelegramLink"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.student_id} -> {self.parent_chat_id or 'NOT_LINKED'} ({self.invite_code})"


class BattleStatus(models.TextChoices):
    WAITING = "WAITING", "Waiting for players"
    QUESTION = "QUESTION", "Question active"
    LEADERBOARD = "LEADERBOARD", "Leaderboard review"
    FINISHED = "FINISHED", "Battle finished"


class VocabBattleSession(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid4_str)
    pin = models.CharField(max_length=10, unique=True, db_index=True)
    set = models.ForeignKey(
        VocabularySet,
        on_delete=models.CASCADE,
        related_name="battle_sessions",
    )
    host = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        db_constraint=False,
        related_name="hosted_battles",
    )
    status = models.CharField(
        max_length=20,
        choices=BattleStatus.choices,
        default=BattleStatus.WAITING,
    )
    current_question_index = models.IntegerField(default=0)
    questions = models.JSONField(default=list, blank=True)
    participants = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "VocabBattleSession"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Battle {self.pin} ({self.status}) - {self.set.title}"
