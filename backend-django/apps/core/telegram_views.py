import hmac
import os
from rest_framework.decorators import api_view,permission_classes,authentication_classes
from rest_framework.permissions import AllowAny
from common.auth.permissions import Authenticated
from common.api.exceptions import ContractAPIException
from .mock_attempt_views import success
from . import telegram_links as links,telegram_bot as bot


@api_view(['GET'])
@permission_classes([Authenticated])
def status(request):return success(links.status(request.user.id))


@api_view(['POST'])
@permission_classes([Authenticated])
def token(request):return success(links.create_token(request.user))


@api_view(['DELETE'])
@permission_classes([Authenticated])
def unlink(request):return success(links.unlink(request.user))


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def webhook(request):
    expected=os.environ.get('TELEGRAM_WEBHOOK_SECRET','');supplied=request.headers.get('x-telegram-bot-api-secret-token','')
    if not expected or not supplied or not hmac.compare_digest(expected.encode(),supplied.encode()):raise ContractAPIException('FORBIDDEN','Webhook secret mos kelmadi',403)
    bot.handle(request.data)
    return success(dict(ok=True))
