"""Vocabulary and Spaced Repetition (SRS) models."""
import uuid
from django.db import models
from apps.legacy_schema.models import Group, User, MockExam


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


# ============================================================================
# UNIFIED LMS & BAMBOOZLE ARENA MODELS
# ============================================================================

class Course(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid4_str)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    thumbnail_url = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "Course"
        ordering = ["title"]

    def __str__(self):
        return self.title


class Lesson(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid4_str)
    course = models.ForeignKey(
        Course,
        on_delete=models.CASCADE,
        related_name="lessons",
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    video_file = models.CharField(max_length=500, blank=True, default="")
    video_url = models.CharField(max_length=500, blank=True, default="")
    hls_playlist_url = models.CharField(max_length=500, blank=True, default="")
    duration = models.IntegerField(default=0)  # in seconds
    xp_reward = models.IntegerField(default=50)
    order_index = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "Lesson"
        ordering = ["order_index", "created_at"]

    def __str__(self):
        return f"{self.course.title} - {self.title}"


class QuizDeck(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid4_str)
    title = models.CharField(max_length=255)
    category = models.CharField(max_length=100, default="General")
    is_lesson_tied = models.BooleanField(default=False)
    lesson = models.ForeignKey(
        Lesson,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="quiz_decks",
    )
    created_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        db_constraint=False,
        related_name="created_quiz_decks",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "QuizDeck"
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class CardType(models.TextChoices):
    QUESTION = "question", "Oddiy Savol"
    SWAP = "swap", "Ballarni Almashtirish (Swap)"
    STEAL = "steal", "Ball O'g'irlash (Steal)"
    DOUBLE = "double", "2x Ball (Double)"
    BOMB = "bomb", "Tuzoq / Bomba (Bomb)"


class QuizCard(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid4_str)
    quiz_deck = models.ForeignKey(
        QuizDeck,
        on_delete=models.CASCADE,
        related_name="cards",
    )
    question_text = models.TextField()
    points = models.IntegerField(default=10)  # 10, 15, 20
    options = models.JSONField(default=list, blank=True)
    correct_answer = models.CharField(max_length=255, blank=True, default="")
    card_type = models.CharField(
        max_length=20,
        choices=CardType.choices,
        default=CardType.QUESTION,
    )
    order_index = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "QuizCard"
        ordering = ["order_index", "id"]

    def __str__(self):
        return f"{self.quiz_deck.title} - Card #{self.order_index} ({self.card_type})"


class UserLessonProgress(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid4_str)
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        db_constraint=False,
        related_name="lesson_progress",
    )
    lesson = models.ForeignKey(
        Lesson,
        on_delete=models.CASCADE,
        related_name="user_progress",
    )
    is_completed = models.BooleanField(default=False)
    watched_seconds = models.IntegerField(default=0)
    max_watched_seconds = models.IntegerField(default=0)
    earned_xp = models.IntegerField(default=0)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "UserLessonProgress"
        unique_together = [("user", "lesson")]
        ordering = ["-updated_at"]

    def __str__(self):
        status = "COMPLETED" if self.is_completed else f"{self.watched_seconds}s"
        return f"{self.user_id} - {self.lesson.title} ({status})"


# ============================================================================
# TEACHER WORKSPACE: COHORTS & HOMEWORK ASSIGNMENTS
# ============================================================================

class Cohort(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid4_str)
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        db_constraint=False,
        related_name="teacher_cohorts",
    )
    name = models.CharField(max_length=255)
    invite_code = models.CharField(max_length=16, unique=True, db_index=True)
    description = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "Cohort"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.invite_code})"


class CohortMembership(models.Model):
    STATUS_CHOICES = [
        ("active", "Active"),
        ("archived", "Archived"),
    ]
    id = models.CharField(primary_key=True, max_length=255, default=uuid4_str)
    cohort = models.ForeignKey(
        Cohort,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    student = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        db_constraint=False,
        related_name="cohort_memberships",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "CohortMembership"
        unique_together = [("cohort", "student")]
        ordering = ["-joined_at"]

    def __str__(self):
        return f"{self.student_id} in {self.cohort.name} ({self.status})"


class HomeworkAssignment(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid4_str)
    cohort = models.ForeignKey(
        Cohort,
        on_delete=models.CASCADE,
        related_name="assignments",
    )
    title = models.CharField(max_length=255)
    lesson = models.ForeignKey(
        Lesson,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="homework_assignments",
    )
    exam = models.ForeignKey(
        MockExam,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        db_constraint=False,
        related_name="homework_assignments",
    )
    deadline = models.DateTimeField()
    min_pass_percent = models.IntegerField(default=80)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "HomeworkAssignment"
        ordering = ["-deadline", "-created_at"]

    def __str__(self):
        return f"{self.cohort.name} - {self.title}"


class HomeworkSubmission(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid4_str)
    assignment = models.ForeignKey(
        HomeworkAssignment,
        on_delete=models.CASCADE,
        related_name="submissions",
    )
    student = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        db_constraint=False,
        related_name="homework_submissions",
    )
    score_percent = models.IntegerField(default=0)
    is_passed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "HomeworkSubmission"
        unique_together = [("assignment", "student")]
        ordering = ["-completed_at"]

    def __str__(self):
        status = "PASSED" if self.is_passed else "FAILED"
        return f"{self.student_id} - {self.assignment.title}: {self.score_percent}% ({status})"
