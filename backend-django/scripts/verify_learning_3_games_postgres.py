"""Learning 3.0 (PR C) on the real schema: teacher-chosen vocabulary question type, and
Vocab Battle scoring that the server times and locks.

Runs inside one transaction that is rolled back: nothing is left in the database."""
from datetime import timedelta

from verify_group_contract_postgres import actor, transaction

from django.utils import timezone

from apps.core.models import HomeworkAssignment, VocabBattleSession, VocabularyHomeworkSession

PASSED = []


def check(condition, label):
    assert condition, label
    PASSED.append(label)
    print("PASS", label)


@transaction.atomic
def verify():
    _, teacher = actor("teacher")
    student_id, student = actor("student")
    second_id, second = actor("student")
    group = teacher.post("/v1/groups", {"name": "Learning 3 class"}, format="json").json()["data"]
    for sid in (student_id, second_id):
        assert teacher.post(f"/v1/groups/{group['id']}/students", {"studentId": sid}, format="json").status_code == 201
    words = [{"english": f"word{i}", "uzbek": f"so'z {i}", "contextSentence": f"I wrote word{i} today."} for i in range(6)]
    created = teacher.post("/v1/vocabulary/sets", {"title": "L3 set", "words": words, "isPublic": False}, format="json")
    assert created.status_code == 201, created.data
    set_id = created.json()["data"]["id"]

    # ---------------------------------------------------------- teacher-chosen question type
    hw_url = f"/v1/teacher/workspace/groups/{group['id']}/homework"
    deadline = (timezone.now() + timedelta(days=2)).isoformat()
    body = dict(type="vocabulary", vocabularySetId=set_id, title="Fill the gap", deadline=deadline, minPassPercent=60)
    bad = teacher.post(hw_url, dict(body, vocabularyMode="antonym"), format="json")
    check(bad.status_code == 400, "an unknown question type is refused")
    no_data = teacher.post(hw_url, dict(body, vocabularyMode="synonym"), format="json")
    check(no_data.status_code == 400, "a type the words have no data for (no synonyms stored) is refused")
    made = teacher.post(hw_url, dict(body, vocabularyMode="fill_blank"), format="json")
    check(made.status_code == 201, "a grounded type (sentences exist) is accepted")
    assignment_id = made.json()["data"]["id"]
    check(HomeworkAssignment.objects.get(id=assignment_id).vocabulary_mode == "fill_blank", "the type is stored on the assignment")
    path = f"/v1/student/assignments/{assignment_id}/vocabulary"
    settings = student.get(path + "/settings").json()["data"]
    check(settings == {"mode": "fill_blank", "startedMode": None}, "the learner sees the teacher's type before starting")
    session = student.post(path, {"mode": "eng_uzb"}, format="json").json()["data"]
    check(session["mode"] == "fill_blank" and {q["type"] for q in session["questions"]} == {"fill_blank"},
          "the server ignores the learner's request and issues the teacher's type")
    check(all("word" not in (q.get("prompt") or "").split() for q in session["questions"]),
          "fill-in-the-blank prompts never show the answer")
    check(VocabularyHomeworkSession.objects.get(id=session["sessionId"]).mode == "fill_blank", "the session snapshot keeps the type")

    # ---------------------------------------------------------- Vocab Battle: server timing
    battle = teacher.post("/v1/vocabulary/battle/create", {"setId": set_id, "questionCount": 3}, format="json")
    assert battle.status_code == 201, battle.data
    pin = battle.json()["data"]["pin"]
    for client in (student, second):
        assert client.post("/v1/vocabulary/battle/join", {"pin": pin}, format="json").status_code == 200
    assert teacher.post(f"/v1/vocabulary/battle/{pin}/next", format="json").status_code == 200
    row = VocabBattleSession.objects.get(pin=pin)
    check(bool(row.questions[0].get("startedAt")), "opening a question stamps the server start time")
    correct = row.questions[0]["correctIndex"]
    wrong = (correct + 1) % len(row.questions[0]["options"])

    cheat = student.post(f"/v1/vocabulary/battle/{pin}/answer",
                         {"questionIndex": 0, "selectedIndex": correct, "elapsedSec": -100000}, format="json").json()["data"]
    check(cheat["isCorrect"] and cheat["pointsGained"] <= 100 + 150 + 20,
          f"a negative client time cannot inflate points (got {cheat['pointsGained']})")
    other = second.post(f"/v1/vocabulary/battle/{pin}/answer",
                        {"questionIndex": 0, "selectedIndex": wrong}, format="json").json()["data"]
    check(not other["isCorrect"] and other["pointsGained"] == 0, "a wrong answer scores nothing")
    parts = VocabBattleSession.objects.get(pin=pin).participants
    check(parts[str(student_id)]["score"] == cheat["pointsGained"] and parts[str(second_id)]["score"] == 0,
          "both players' answers are kept (row lock, no lost update)")
    invalid = student.post(f"/v1/vocabulary/battle/{pin}/answer", {"questionIndex": 0, "selectedIndex": "x"}, format="json")
    check(invalid.status_code == 400, "a malformed answer is a 400, not a 500")

    # A question opened 60 s ago: answers are late and score nothing.
    assert teacher.post(f"/v1/vocabulary/battle/{pin}/next", format="json").status_code == 200   # leaderboard
    assert teacher.post(f"/v1/vocabulary/battle/{pin}/next", format="json").status_code == 200   # question 2
    row = VocabBattleSession.objects.get(pin=pin)
    questions = list(row.questions)
    questions[1] = dict(questions[1], startedAt=(timezone.now() - timedelta(seconds=60)).isoformat())
    VocabBattleSession.objects.filter(pin=pin).update(questions=questions)
    late = second.post(f"/v1/vocabulary/battle/{pin}/answer",
                       {"questionIndex": 1, "selectedIndex": questions[1]["correctIndex"], "elapsedSec": 1}, format="json").json()["data"]
    check(late["late"] and not late["isCorrect"] and late["pointsGained"] == 0, "an answer after the time limit scores nothing")

    print(f"{len(PASSED)}/{len(PASSED)} Learning 3.0 games/teacher checks passed")
    transaction.set_rollback(True)


if __name__ == "__main__":
    verify()
