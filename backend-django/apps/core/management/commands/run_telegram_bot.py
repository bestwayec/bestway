from threading import Event
import signal
from django.core.management.base import BaseCommand
from apps.core.telegram_bot import run


class Command(BaseCommand):
    help='Run configured Telegram polling or initialize webhook lifecycle.'
    def add_arguments(self,parser):parser.add_argument('--once',action='store_true')
    def handle(self,*args,**options):
        stop=Event();previous={}
        for name in ('SIGINT','SIGTERM'):
            sig=getattr(signal,name,None)
            if sig is not None:previous[sig]=signal.getsignal(sig);signal.signal(sig,lambda *_:stop.set())
        try:run(stop,once=options['once'])
        finally:
            for sig,handler in previous.items():signal.signal(sig,handler)
