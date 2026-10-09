from datetime import datetime, timezone
from django.test import SimpleTestCase
from common.schema_validation import migration_problems


class MigrationGateTests(SimpleTestCase):
    expected = [{'name': '001', 'checksums': ['correct']}, {'name': '002', 'checksums': ['next']}]
    finished = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def test_completed_exact_release_passes(self):
        self.assertEqual(migration_problems(self.expected, [
            ('001', 'correct', self.finished, None), ('002', 'next', self.finished, None)]), [])

    def test_failed_pending_unknown_and_modified_history_fail_closed(self):
        errors = migration_problems(self.expected, [
            ('001', 'modified', self.finished, None), ('002', 'next', None, None),
            ('003', 'future', self.finished, None)])
        self.assertTrue(any('checksum mismatch' in item for item in errors))
        self.assertTrue(any('Unfinished migration' in item for item in errors))
        self.assertTrue(any('newer/unknown' in item for item in errors))
        self.assertEqual(sum('not successfully applied' in item for item in errors), 2)

    def test_rolled_back_failure_can_be_followed_by_successful_retry(self):
        self.assertEqual(migration_problems(self.expected, [
            ('001', 'correct', None, self.finished), ('001', 'correct', self.finished, None),
            ('002', 'next', self.finished, None)]), [])

    def test_preflight_allows_pending_but_still_rejects_foreign_or_modified_history(self):
        self.assertEqual(migration_problems(self.expected,
            [('001', 'correct', self.finished, None)], allow_pending=True), [])
        errors = migration_problems(self.expected, [
            ('001', 'modified', self.finished, None), ('003', 'unknown', self.finished, None)
        ], allow_pending=True)
        self.assertEqual(len(errors), 2)
        self.assertTrue(any('checksum mismatch' in item for item in errors))
        self.assertTrue(any('newer/unknown' in item for item in errors))
