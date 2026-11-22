"""Join the two independently developed ``core`` branches that both started from 0017.

* ``0018_mock_exam_gate_and_listening_audio`` — IELTS Mock 27 publication gate (PR #209)
* ``0018_telegram_update_receipts`` … ``0025_telegram_outbox`` — Telegram Bot 2.0 (PR #210)

The two branches touch disjoint tables (``core_mockexamgate`` / ``core_mocklisteningaudio`` versus the
Telegram/ClassQuiz tables), so this node has no operations: it only gives Django a single leaf. It is safe on a
database where either branch was applied first, because Django applies whichever parent is still missing before it.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0018_mock_exam_gate_and_listening_audio"),
        ("core", "0025_telegram_outbox"),
    ]

    operations = []
