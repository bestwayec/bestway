"""Consent and request budgets shared by the assessment provider adapters."""
import os
from datetime import UTC, datetime, time, timedelta
from urllib.parse import urlsplit
from uuid import uuid4

from django.db import connection, transaction
from django.utils import timezone

from apps.legacy_schema.models import AuditLog

from .assessment_results import ProviderError

USAGE_ENTITY = 'AssessmentProviderRequest'
COOLDOWN_ENTITY = 'AssessmentProviderCooldown'
FREE_MODEL = 'deepseek/deepseek-v4.1-flash-1017:free'
PAID_MODELS = {'deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash-1017'}


def enabled(name):
    return os.environ.get(name, '').strip().lower() in {'1', 'true', 'yes'}


def is_loopback(url):
    return urlsplit(url).hostname in ('localhost', '127.0.0.1', '::1')


def positive_limit(name, default):
    try:
        return max(0, int(os.environ.get(name, default)))
    except (ValueError, TypeError):
        return 0


@transaction.atomic
def reserve_request(provider, model, *, paid_microusd=0):
    """Reserve a UTC daily request before dispatch, across all worker processes.

    Requests with uncertain outcomes still consume a slot.
    """
    now = timezone.now()
    day_start = datetime.combine(now.astimezone(UTC).date(), time.min, tzinfo=UTC)
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [USAGE_ENTITY])
    cooldown = AuditLog.objects.filter(entity=COOLDOWN_ENTITY, entity_id=provider,
        created_at__gte=now - timedelta(days=1)).order_by('-created_at').first()
    if cooldown and (remaining := cooldown.new_value['untilEpoch'] - now.timestamp()) > 0:
        raise ProviderError('PROVIDER_RATE_LIMITED', transient=True, retry_after=int(remaining) + 1)
    usage = AuditLog.objects.filter(entity=USAGE_ENTITY, created_at__gte=day_start)
    if usage.count() >= positive_limit('ASSESSMENT_DAILY_BUDGET', 50):
        raise ProviderError('ASSESSMENT_DAILY_BUDGET_EXHAUSTED')
    if paid_microusd:
        charges = list(usage.filter(action='assessment.provider.paid').values_list('new_value', flat=True))
        max_amount = positive_limit('ASSESSMENT_PAID_DAILY_BUDGET_MICROUSD', 0)
        if len(charges) >= positive_limit('ASSESSMENT_PAID_DAILY_REQUESTS', 0) or (
            paid_microusd + sum(charge['reservedMicrousd'] for charge in charges) > max_amount
        ):
            raise ProviderError('ASSESSMENT_PAID_BUDGET_EXHAUSTED')
    AuditLog.objects.create(id=str(uuid4()), entity=USAGE_ENTITY, created_at=now,
        action='assessment.provider.paid' if paid_microusd else 'assessment.provider.standard',
        new_value={'provider': provider, 'model': model, 'reservedMicrousd': paid_microusd})


def authorize_remote(url, provider, model, *, paid_microusd=0):
    if is_loopback(url):
        return
    if not enabled('ASSESSMENT_EXTERNAL_AI_ALLOWED'):
        raise ProviderError('ASSESSMENT_EXTERNAL_AI_DISABLED')
    reserve_request(provider, model, paid_microusd=paid_microusd)


def request_remote(transport, url, body, headers, timeout, provider):
    try:
        return transport(url, body, headers, timeout)
    except ProviderError as error:
        if error.code == 'PROVIDER_RATE_LIMITED' and not is_loopback(url):
            now = timezone.now()
            period = min(86400, max(15, error.retry_after))
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [USAGE_ENTITY])
                prior = AuditLog.objects.filter(entity=COOLDOWN_ENTITY, entity_id=provider).order_by('-created_at').first()
                until_epoch = max(now.timestamp() + period, prior.new_value['untilEpoch'] if prior else 0)
                AuditLog.objects.create(id=str(uuid4()), entity=COOLDOWN_ENTITY, entity_id=provider, created_at=now,
                    action='assessment.provider.cooldown', new_value={'untilEpoch': until_epoch})
        raise


def openrouter_route(model, paid):
    providers = [item.strip() for item in os.environ.get('OPENROUTER_ALLOWED_PROVIDERS', '').split(',') if item.strip()]
    if not providers:
        raise ProviderError('PROVIDER_PRIVACY_ROUTE_REQUIRED')
    if not paid:
        if model != FREE_MODEL:
            raise ProviderError('ASSESSMENT_FREE_MODEL_REQUIRED')
        prompt_price = completion_price = 0
    else:
        if not enabled('ASSESSMENT_ALLOW_PAID_FALLBACK') or model not in PAID_MODELS:
            raise ProviderError('ASSESSMENT_PAID_FALLBACK_DISABLED')
        try:
            prompt_price = float(os.environ['OPENROUTER_MAX_PROMPT_PRICE'])
            completion_price = float(os.environ['OPENROUTER_MAX_COMPLETION_PRICE'])
        except (KeyError, ValueError):
            raise ProviderError('ASSESSMENT_PAID_BUDGET_REQUIRED') from None
        if not (0 < prompt_price <= 100 and 0 < completion_price <= 100):
            raise ProviderError('ASSESSMENT_PAID_BUDGET_REQUIRED')
    return dict(only=providers, allow_fallbacks=False, require_parameters=True, data_collection='deny', zdr=True,
        max_price=dict(prompt=prompt_price, completion=completion_price, request=0,
                       image=0, audio=0))
