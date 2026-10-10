import signal
from threading import Event
from django.core.management.base import BaseCommand
from apps.core.assessment_worker import run

class Command(BaseCommand):
    help='Run the explicit 20-second PostgreSQL assessment worker (no schema migrations).'
    def add_arguments(self,parser):parser.add_argument('--once',action='store_true')
    def handle(self,*args,**options):
        stop=Event();previous={}
        try:
            for sig in (signal.SIGINT,signal.SIGTERM):previous[sig]=signal.signal(sig,lambda *_:stop.set())
            run(stop,options['once'])
        finally:
            for sig,handler in previous.items():signal.signal(sig,handler)
