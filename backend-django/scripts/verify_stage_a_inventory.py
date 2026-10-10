"""Compare active reference routes to DRF registration, not semantic parity."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.test')
import django
django.setup()
from apps.core.urls import urlpatterns

def canonical(path):
    return re.sub(r':[^/]+|<[^>]+>', ':param', path.rstrip('/'))

registered = set()
for pattern in urlpatterns:
    if not str(pattern.pattern).startswith('mock/'):
        continue
    path = '/v1/' + str(pattern.pattern)
    for method in pattern.callback.cls.http_method_names:
        if method.upper() in {'GET', 'POST', 'PUT', 'PATCH', 'DELETE'}:
            registered.add((method.upper(), canonical(path)))
reference = subprocess.run(['node', str(Path(__file__).with_name('stage_a_inventory.cjs'))], capture_output=True, text=True, check=True, timeout=30)
data = json.loads(reference.stdout)
missing = []
for row in data['endpoints']:
    exists = (row['method'], canonical(row['path'])) in registered
    print(f'{"REGISTERED" if exists else "MISSING"} {row["method"]} {row["path"]} roles={row["roles"]} status={row["successStatus"]} alternate={row["alternateSuccessStatus"]}')
    if not exists:
        missing.append(row)
print(f'SUMMARY active={data["count"]} registered={data["count"] - len(missing)} missing={len(missing)}; registration does not prove compatibility')
