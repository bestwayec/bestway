from datetime import datetime, timezone as utc_timezone
from threading import Event
from types import SimpleNamespace
from unittest.mock import patch
from django.test import SimpleTestCase
from rest_framework.test import APIClient
from apps.core import game, points, game_scheduler
from common.api.exceptions import ContractAPIException


class GamePointsTests(SimpleTestCase):
    def setUp(self):
        self.client=APIClient()

    def test_mutation_roles_and_roster_privacy(self):
        for role in ('student','parent','teacher','receptionist'):
            self.client.force_authenticate(SimpleNamespace(id='user',role=role,is_authenticated=True))
            if role!='teacher':
                self.assertEqual(self.client.post('/v1/points/student/adjust',{},format='json').status_code,403)
            for path in ('/v1/game/roster','/v1/game/roster/export'):
                with self.subTest(role=role,path=path):self.assertEqual(self.client.get(path).status_code,403)

    def test_only_students_can_read_personal_game_status(self):
        for role in ('teacher','parent','admin','super_admin'):
            self.client.force_authenticate(SimpleNamespace(id='user',role=role,is_authenticated=True))
            self.assertEqual(self.client.get('/v1/game/status').status_code,403)

    def test_public_leaderboard_does_not_require_authentication(self):
        with patch.object(points,'leaderboard',return_value=[]) as listing:
            self.assertEqual(self.client.get('/v1/points/leaderboard').status_code,200)
            listing.assert_called_once_with({})

    def test_adjust_validation_and_coercion_before_database_access(self):
        self.client.force_authenticate(SimpleNamespace(id='admin',role='admin',is_authenticated=True))
        for body,message in [(dict(change=0,reason='zero'),"O'zgarish 0 bo'lishi mumkin emas"),
                             (dict(change=1.5,reason='fraction'),'change must be an integer number'),
                             (dict(change=1,reason='xx'),"Sabab kamida 3 belgidan iborat bo'lsin"),
                             (dict(change=1,reason='valid',currentPoints=100),'property currentPoints should not exist')]:
            with self.subTest(body=body),patch.object(points,'adjust') as write:
                result=self.client.post('/v1/points/student/adjust',body,format='json')
                self.assertEqual(result.status_code,400)
                self.assertEqual(result.data['error']['message'],message)
                write.assert_not_called()
        with patch.object(points,'adjust',return_value=dict(current=12)) as write:
            self.assertEqual(self.client.post('/v1/points/student/adjust',dict(change='0x02',reason='hex'),format='json').status_code,201)
            self.assertEqual(write.call_args.args[2]['change'],2)

    def test_query_whitelist_and_numeric_bounds(self):
        self.client.force_authenticate(SimpleNamespace(id='admin',role='admin',is_authenticated=True))
        for url in ('/v1/game/roster?year=2101','/v1/game/roster?month=0','/v1/points/leaderboard?limit=101','/v1/points/leaderboard?unknown=1'):
            with self.subTest(url=url):self.assertEqual(self.client.get(url).status_code,400)

    def test_teacher_foreign_group_denied_before_any_points_write(self):
        student=SimpleNamespace(group_id='group',group=SimpleNamespace(teacher_id='other'))
        with patch.object(points.StudentProfile.objects,'filter') as query:
            query.return_value.select_related.return_value.first.return_value=student
            with self.assertRaises(ContractAPIException) as raised:
                points.adjust(SimpleNamespace(id='teacher',role='teacher'),'student',dict(change=1,reason='valid'))
            self.assertEqual(raised.exception.contract_code,'FORBIDDEN')

    def test_teacher_limit_denied_before_any_points_write(self):
        student=SimpleNamespace(group_id='group',group=SimpleNamespace(teacher_id='teacher'))
        with patch.object(points.StudentProfile.objects,'filter') as query,patch.object(game,'setting',return_value=20):
            query.return_value.select_related.return_value.first.return_value=student
            with self.assertRaises(ContractAPIException) as raised:
                points.adjust(SimpleNamespace(id='teacher',role='teacher'),'student',dict(change=21,reason='valid'))
            self.assertEqual(raised.exception.contract_code,'POINT_LIMIT_EXCEEDED')

    def test_foreign_student_points_history_is_denied(self):
        with self.assertRaises(ContractAPIException):
            points.assert_can_view(SimpleNamespace(id='self',role='student'),'foreign')

    def test_stale_game_status_is_projection_without_reset(self):
        student=SimpleNamespace(points_period='2000-01',current_points=500,game_qualified=True,qualified_at='old')
        with patch.object(game.StudentProfile.objects,'filter') as query,patch.object(game,'setting',side_effect=lambda k:100 if k=='initialPoints' else 150):
            query.return_value.first.return_value=student
            result=game.status('student')
            self.assertEqual((result['points'],result['qualified'],result['remaining'],result['qualifiedAt']),(100,False,50,None))
            query.return_value.update.assert_not_called()

    def test_period_uses_tashkent_local_calendar_at_year_boundary(self):
        self.assertEqual(game.period_key(datetime(2026,12,31,19,tzinfo=utc_timezone.utc)),'2027-01')

    def test_qualification_under_threshold_performs_no_write(self):
        with patch.object(game,'setting',return_value=150),patch.object(game.StudentProfile.objects,'filter') as query:
            self.assertFalse(game.check_and_qualify(None,'student',149,'Student'))
            query.assert_not_called()

    def test_already_qualified_emits_no_duplicate_notifications(self):
        with patch.object(game,'setting',return_value=150),patch.object(game.StudentProfile.objects,'filter') as query,patch.object(game,'notify_many') as notify:
            query.return_value.update.return_value=0
            self.assertFalse(game.check_and_qualify(None,'student',200,'Student'))
            notify.assert_not_called()

    def test_startup_failure_is_best_effort_but_monthly_failure_is_visible(self):
        with patch.object(game,'rollover_stale',side_effect=RuntimeError('fixture')):
            with self.assertLogs(game.__name__,level='WARNING'):self.assertIsNone(game.startup_recovery())
            with self.assertRaises(RuntimeError):game.monthly_reset()


class GameSchedulerTests(SimpleTestCase):
    def test_schedule_timezone_and_year_transition(self):
        due=game_scheduler.next_due(datetime(2026,12,31,19,tzinfo=utc_timezone.utc))
        self.assertEqual(due.astimezone(utc_timezone.utc),datetime(2026,12,31,19,5,tzinfo=utc_timezone.utc))
        later=game_scheduler.next_due(due)
        self.assertEqual((later.year,later.month,later.day,later.hour,later.minute),(2027,2,1,0,5))

    def test_once_recovers_and_never_waits_or_runs_monthly_callback(self):
        stop=Event()
        with patch.object(game,'startup_recovery') as startup,patch.object(game,'monthly_reset') as monthly:
            game_scheduler.run(stop,once=True)
            startup.assert_called_once();monthly.assert_not_called()

    def test_scheduled_tick_executes_once_and_stops_cleanly(self):
        start=datetime(2026,10,31,19,tzinfo=utc_timezone.utc)
        due=game_scheduler.next_due(start)
        class Stop:
            stopped=False
            def is_set(self):return self.stopped
            def wait(self,_):self.stopped=True
        ticks=iter([start,due,due])
        with patch.object(game,'startup_recovery') as startup,patch.object(game,'monthly_reset') as monthly:
            game_scheduler.run(Stop(),now=lambda:next(ticks))
            startup.assert_called_once();monthly.assert_called_once()
