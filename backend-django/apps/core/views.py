from django.conf import settings
from django.utils.timezone import now
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


def success(data: object) -> Response:
    return Response({"success": True, "data": data})


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return success({"status": "ok", "time": now().isoformat().replace("+00:00", "Z"), "buildCommit": settings.BUILD_COMMIT})


@api_view(["GET"])
@permission_classes([AllowAny])
def desktop_version(request):
    return success({
        "version": settings.DESKTOP_LATEST_VERSION,
        "downloadUrl": settings.DESKTOP_DOWNLOAD_URL,
        "prerelease": settings.DESKTOP_PRERELEASE,
        "updateChannel": settings.DESKTOP_UPDATE_CHANNEL,
    })
