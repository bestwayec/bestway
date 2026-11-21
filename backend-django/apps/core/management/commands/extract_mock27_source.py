from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.core.mock27.extract_source import ExtractionError, write_private_packages


class Command(BaseCommand):
    help = ('Parse the owner-supplied Listening/Reading PDFs into PRIVATE import packages. '
            'Output must stay outside git: the source material has unverified redistribution rights.')

    def add_arguments(self, parser):
        parser.add_argument('--listening', required=True)
        parser.add_argument('--reading', required=True)
        parser.add_argument('--out', required=True)

    def handle(self, *args, **opts):
        try:
            report = write_private_packages(Path(opts['listening']), Path(opts['reading']), Path(opts['out']))
        except ExtractionError as error:
            raise CommandError(str(error)) from error
        for name, info in report['packages'].items():
            self.stdout.write(f'{name}: {info["questions"]} questions in {info["groups"]} groups -> {opts["out"]}/{info["file"]}')
