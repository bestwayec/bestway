from django.core.management.base import BaseCommand,CommandError
from apps.core.assessment_local_stt import warmup
from apps.core.assessment_results import ProviderError


class Command(BaseCommand):
    help='Load the local CPU English STT model; --download explicitly prepares its public model cache.'
    def add_arguments(self,parser):parser.add_argument('--download',action='store_true')
    def handle(self,*args,**options):
        try:value=warmup(allow_download=options['download'])
        except ProviderError as error:raise CommandError(error.code) from None
        self.stdout.write(self.style.SUCCESS(f"Local STT ready: {value['model']} (CPU int8); no audio sent externally."))
