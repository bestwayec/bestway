from django.core.management.base import BaseCommand

from apps.core import mock_deadline


class Command(BaseCommand):
    help = 'Hand in every in-progress exam attempt whose server deadline has passed (one bounded catch-up pass).'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=mock_deadline.BATCH)

    def handle(self, *args, **options):
        total = 0
        while True:
            done = mock_deadline.sweep(limit=options['limit'])
            total += done
            if done < options['limit']:
                break
        self.stdout.write(f'auto-submitted={total}')
