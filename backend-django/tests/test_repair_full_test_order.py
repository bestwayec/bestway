import io
from types import SimpleNamespace
from unittest.mock import patch

from django.core.management import call_command

from apps.core.management.commands.repair_full_test_order import expected_skill, plan_repairs

ORDER = ["listening", "reading", "writing", "speaking"]


def att(i, current, submitted):
    return SimpleNamespace(id=f"a{i}", exam_id="E", current_skill=current, submitted_sections=submitted)


def test_expected_skill_is_first_unsubmitted_section_in_exam_order():
    assert expected_skill(ORDER, []) == "listening"
    assert expected_skill(ORDER, ["listening", "reading"]) == "writing"
    assert expected_skill(ORDER, ORDER) is None


def test_plan_flags_back_switch_skip_and_unknown_but_not_correct_attempts():
    plan = plan_repairs([
        att(1, "reading", ["listening"]),            # correct
        att(2, "listening", ["listening"]),          # went back to a submitted section
        att(3, "writing", ["listening"]),            # skipped reading
        att(4, None, []),                            # unknown
    ], {"E": ORDER})
    assert [(p["attempt"], p["expected"]) for p in plan] == [("a2", "reading"), ("a3", "reading"), ("a4", "listening")]
    assert plan[0]["reason"] == "current section was already submitted"
    assert plan[1]["reason"] == "current section skips an unsubmitted earlier section"


def test_dry_run_is_default_and_writes_nothing():
    attempts = [att(2, "listening", ["listening"])]
    sections = [SimpleNamespace(exam_id="E", skill=s) for s in ORDER]
    with patch("apps.core.management.commands.repair_full_test_order.MockAttempt.objects") as objects, \
         patch("apps.core.management.commands.repair_full_test_order.MockSection.objects") as section_objects:
        objects.filter.return_value = attempts
        section_objects.filter.return_value.order_by.return_value = sections
        out = io.StringIO()
        call_command("repair_full_test_order", stdout=out)
        call_command("repair_full_test_order", "--dry-run", stdout=out)
    assert "a2 exam=E current=listening -> reading" in out.getvalue()
    assert "Dry run: nothing changed" in out.getvalue()
    assert objects.filter.call_count == 2  # only the two read queries; no update filter was issued
