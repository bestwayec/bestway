"""Read-only checks for the Prisma-owned compatibility database."""
import json
import hashlib
from pathlib import Path


def expected_migrations():
    return json.loads((Path(__file__).resolve().parents[1] / 'config' /
                       'prisma_migrations.json').read_text(encoding='utf-8'))['migrations']


def migration_problems(expected, applied, allow_pending=False):
    problems = []
    expected_by_name = {item['name']: item for item in expected}
    complete = set()
    for name, checksum, finished, rolled_back in applied:
        if rolled_back is not None:
            continue
        if finished is None:
            problems.append(f'Unfinished migration: {name}')
            continue
        if name not in expected_by_name:
            problems.append(f'Database migration is newer/unknown to this release: {name}')
            continue
        if checksum not in expected_by_name[name]['checksums']:
            problems.append(f'Migration checksum mismatch: {name}')
            continue
        complete.add(name)
    if not allow_pending:
        for name in sorted(set(expected_by_name) - complete):
            problems.append(f'Migration not successfully applied: {name}')
    return problems


def verify_manifest(source):
    expected = {item['name']: item for item in expected_migrations()}
    files = {path.parent.name: path for path in Path(source).glob('*/migration.sql')}
    errors = []
    if set(expected) != set(files):
        errors.append('Prisma migration manifest names differ from source migrations')
    for name in sorted(set(expected) & set(files)):
        checksum = hashlib.sha256(files[name].read_bytes().replace(b'\r\n', b'\n')).hexdigest()
        if checksum not in expected[name]['checksums']:
            errors.append(f'Prisma migration manifest checksum differs: {name}')
    return errors


if __name__ == '__main__':
    import sys
    issues = verify_manifest(sys.argv[1])
    if issues:
        raise SystemExit('\n'.join(issues))
    print('Prisma migration manifest matches source')
