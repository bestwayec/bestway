from threading import Event
import signal
from django.core.management.base import BaseCommand
from apps.core.game_scheduler import run


class Command(BaseCommand):
    help = 'Run game startup recovery and monthly reset worker (Asia/Tashkent).'

    def add_arguments(self, parser):
        parser.add_argument('--once', action='store_true', help='Recover stale periods and exit without scheduling.')

    def handle(self, *args, **options):
        stop = Event()
        previous = {}
        for name in ('SIGINT', 'SIGTERM'):
            sig = getattr(signal, name, None)
            if sig is not None:
                previous[sig] = signal.getsignal(sig)
                signal.signal(sig, lambda *_: stop.set())
        try: run(stop, once=options['once'])
        finally:
            for sig, handler in previous.items(): signal.signal(sig, handler)
