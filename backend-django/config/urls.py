import os
from pathlib import Path

from django.conf import settings
from django.contrib import admin
from django.http import Http404
from django.urls import include, path, re_path
from django.views.static import serve

from common.auth.admin_forms import BestwayAdminAuthenticationForm

# Sign in with the existing BESTWAY account (phone number + bcrypt password).
admin.site.login_form = BestwayAdminAuthenticationForm
admin.site.site_header = "BESTWAY Administration"
admin.site.site_title = "BESTWAY admin"
admin.site.index_title = "Operations overview"


def serve_media(request, path):
    root = Path(os.environ.get("STORAGE_DIR", getattr(settings, "MEDIA_ROOT", "/app/storage")))
    clean_path = path.lstrip("/")
    for candidate_root in [root / "media", root]:
        candidate_file = candidate_root / clean_path
        if candidate_file.is_file():
            return serve(request, clean_path, document_root=str(candidate_root))
    if clean_path.startswith("media/"):
        stripped = clean_path[len("media/"):]
        for candidate_root in [root / "media", root]:
            candidate_file = candidate_root / stripped
            if candidate_file.is_file():
                return serve(request, stripped, document_root=str(candidate_root))
    raise Http404("Media file not found")


urlpatterns = [
    # Django Admin lives on the API origin only (e.g. /admin/ on the backend
    # host). The Next.js /admin bookmark still redirects to the Next.js
    # super-admin dashboard; it is a separate product surface.
    path("admin/", admin.site.urls),
    path("v1/", include("apps.core.urls")),
    path("api/v1/", include("apps.core.urls")),
    re_path(r"^media/(?P<path>.*)$", serve_media),
]

