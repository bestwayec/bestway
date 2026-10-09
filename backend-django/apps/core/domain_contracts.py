"""Shared Nest DTO and pagination boundary for newly ported domains."""
import math
from rest_framework.response import Response
from common.api.exceptions import ContractAPIException
from .mock_attempt_views import wire


def invalid(message):
    raise ContractAPIException('VALIDATION_ERROR', message, 400)


def js_length(value):
    """Match class-validator/validator.js isLength (Unicode code points)."""
    return len(value)


def payload(request, allowed):
    if not isinstance(request.data, dict): invalid('Validatsiya xatosi')
    for key in request.data:
        if key not in allowed: invalid(f'property {key} should not exist')
    return request.data


def pagination(request, filters=()):
    data = dict(request.query_params.items())
    for key in data:
        if key not in {'page', 'limit', *filters}: invalid(f'property {key} should not exist')
    for key, default in [('page', 1), ('limit', 20)]:
        try: value = float(data.get(key, default) or 0)
        except (ValueError, TypeError):
            invalid('limit must not be greater than 100' if key == 'limit' else 'page must not be less than 1')
        if key == 'limit' and value > 100: invalid('limit must not be greater than 100')
        if value < 1: invalid(f'{key} must not be less than 1')
        if not math.isfinite(value) or not value.is_integer(): invalid(f'{key} must be an integer number')
        data[key] = int(value)
    return data


def paginated(items, page, limit, total):
    return Response(dict(success=True, data=wire(items), meta=dict(page=page, limit=limit, total=total)))
