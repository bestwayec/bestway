"""SettingsService/SettingsController and the best-effort AuditService port."""
import logging
import math
from uuid import uuid4
from django.db import transaction, connection
from django.db.models import Value, JSONField
from django.utils import timezone
from apps.legacy_schema.models import Setting, AuditLog
from .mock_scoring import parse_band_table, LISTENING, ACADEMIC, GENERAL

DEFAULTS = dict(teacherPointLimit=20, initialPoints=100, monthlyFee=0, gameThreshold=150)
BAND_KEYS = dict(listening='ieltsBandListening', readingAcademic='ieltsBandReadingAcademic', readingGeneral='ieltsBandReadingGeneral')
BAND_DEFAULTS = dict(listening=LISTENING, readingAcademic=ACADEMIC, readingGeneral=GENERAL)
_number_cache = {}


def cache_key(key):
    return (connection.settings_dict['NAME'], str(connection.settings_dict.get('OPTIONS')), key)


def audit(actor, action, entity='setting', entity_id=None, old=None, new=None):
    # Match reference best-effort audit. The savepoint prevents a failed log from
    # poisoning the surrounding domain transaction; exam audit remains unchanged.
    try:
        with transaction.atomic():
            AuditLog.objects.create(id=str(uuid4()), user_id=actor.id if actor else None,
                action=action, entity=entity, entity_id=entity_id, old_value=old,
                new_value=new, created_at=timezone.now())
    except Exception:
        logging.getLogger(__name__).warning('Audit write failed', exc_info=True)


def get_json(key, fallback=None):
    row = Setting.objects.filter(key=key).first()
    return row.value if row is not None and row.value is not None else fallback


def set_value(key, value):
    # JSON null is a valid Prisma Json value; SQL NULL violates this table.
    stored = Value(None, output_field=JSONField()) if value is None else value
    Setting.objects.update_or_create(key=key, defaults={'value': stored})
    if key in DEFAULTS:
        token = cache_key(key)
        transaction.on_commit(lambda: _number_cache.__setitem__(token, value))


def numeric_settings():
    result = {}
    for key, default in DEFAULTS.items():
        token = cache_key(key)
        if token in _number_cache:
            result[key] = _number_cache[token]
            continue
        row = Setting.objects.filter(key=key).first()
        raw = row.value if row else default
        # JavaScript Number(null/boolean/empty string) contracts.
        try: number = float(raw or 0) if not isinstance(raw, (dict, list)) else float('nan')
        except (ValueError, TypeError): number = float('nan')
        result[key] = int(number) if math.isfinite(number) and number.is_integer() else number if math.isfinite(number) else None
        _number_cache[token] = result[key]
    return result


def band_tables():
    result = {}
    for key, stored in BAND_KEYS.items():
        try: result[key] = parse_band_table(get_json(stored, BAND_DEFAULTS[key]))
        except (ValueError, TypeError): result[key] = BAND_DEFAULTS[key]
    return result


def customized():
    present = set(Setting.objects.filter(key__in=BAND_KEYS.values()).values_list('key', flat=True))
    return {key: stored in present for key, stored in BAND_KEYS.items()}


@transaction.atomic
def update_numbers(actor, values):
    old = numeric_settings()
    for key, value in values.items(): set_value(key, value)
    fresh = numeric_settings()
    fresh.update(values)
    audit(actor, 'settings.update', old=old, new=fresh)
    return fresh


@transaction.atomic
def update_policy(actor, value):
    old = dict(accessPolicy=get_json('examProgramAccessPolicy', 'SELF_SELECT'))
    set_value('examProgramAccessPolicy', value)
    fresh = dict(accessPolicy=get_json('examProgramAccessPolicy', 'SELF_SELECT'))
    audit(actor, 'settings.exam-program-policy.update', old=old, new=fresh)
    return fresh


@transaction.atomic
def update_bands(actor, values=None):
    old = band_tables()
    if values is None:
        Setting.objects.filter(key__in=BAND_KEYS.values()).delete()
    else:
        # Validate every provided table before any write, as Nest's apply array.
        parsed = {key: parse_band_table(value) for key, value in values.items()}
        for key, value in parsed.items(): set_value(BAND_KEYS[key], value)
    fresh = band_tables()
    audit(actor, 'settings.ielts-bands.reset' if values is None else 'settings.ielts-bands.update', old=old, new=fresh)
    return fresh
