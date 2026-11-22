import logging
import signal
from threading import Event

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from apps.core import telegram_notify


class Command(BaseCommand):
    help = 'Deliver durable Telegram notifications (outbox) and run the deadline / review / closed-test sweeps.'

    def add_arguments(self, parser):
        parser.add_argument('--once', action='store_true', help='Run one sweep + delivery pass and exit.')
        parser.add_argument('--interval', type=float, default=5.0)

    def handle(self, *args, **options):
        stop = Event()
        for name in ('SIGINT', 'SIGTERM'):
            sig = getattr(signal, name, None)
            if sig is not None:
                signal.signal(sig, lambda *_: stop.set())
        while not stop.is_set():
            close_old_connections()
            try:
                result = telegram_notify.tick()
                if options['once']:
                    self.stdout.write(str(result))
            except Exception:  # noqa: BLE001
                logging.getLogger(__name__).exception('telegram outbox tick failed')
            if options['once']:
                return
            stop.wait(options['interval'])
