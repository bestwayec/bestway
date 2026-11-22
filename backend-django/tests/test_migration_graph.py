"""The `core` migration graph must have exactly one leaf.

PR #209 (Mock 27 gate, 0018_mock_exam_gate_and_listening_audio) and PR #210 (Telegram Bot 2.0, 0018..0025) both
started from 0017; 0026_merge_mock27_and_telegram_bot2 joins them. Two leaves make `manage.py migrate` refuse to run
("Conflicting migrations detected"), which would block every deployment.
"""
from django.db.migrations.loader import MigrationLoader
from django.test import SimpleTestCase


class CoreMigrationGraph(SimpleTestCase):
    def setUp(self):
        self.loader = MigrationLoader(None, ignore_no_migrations=True)

    def test_no_conflicting_leaves(self):
        self.assertEqual(self.loader.detect_conflicts(), {})
        self.assertEqual(self.loader.graph.leaf_nodes('core'), [('core', '0026_merge_mock27_and_telegram_bot2')])

    def test_merge_node_joins_both_branches(self):
        parents = set(self.loader.graph.node_map[('core', '0026_merge_mock27_and_telegram_bot2')].parents)
        self.assertEqual({p.key for p in parents},
                         {('core', '0018_mock_exam_gate_and_listening_audio'), ('core', '0025_telegram_outbox')})
        migration = self.loader.disk_migrations[('core', '0026_merge_mock27_and_telegram_bot2')]
        self.assertEqual(migration.operations, [])        # joins only: no schema or data change

    def test_both_branches_start_from_production_0017(self):
        for name in ('0018_mock_exam_gate_and_listening_audio', '0018_telegram_update_receipts'):
            self.assertIn(('core', '0017_vocabulary_flashcard_receipts'), self.loader.disk_migrations[('core', name)].dependencies)
