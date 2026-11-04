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
    root = Path(os.environ.get("STORAGE_DIR", settings.MEDIA_ROOT)).resolve()
    # Public assets and candidate submissions must never share a download policy.
    # Resolve before checking so encoded traversal and symlink aliases cannot expose
    # either legacy recordings or newly separated private uploads.
    clean = path.replace("\\", "/")
    if clean.startswith("/") or ".." in Path(clean).parts:
        raise Http404("Media file not found")
    private_roots = [path.resolve() for path in (root / "private", root / "speaking_submissions",
                     root / "media" / "private", root / "media" / "speaking_submissions")]
    variants = [clean]
    if clean.startswith("media/"):
        variants.append(clean[len("media/"):])
    for relative in variants:
        for candidate_root in [root / "media", root]:
            candidate = (candidate_root / relative).resolve()
            if not candidate.is_relative_to(root):
                continue
            if any(candidate.is_relative_to(private) for private in private_roots):
                continue
            if candidate.is_file():
                return serve(request, str(candidate.relative_to(root)), document_root=str(root))
    raise Http404("Media file not found")


def sitemap_view(request):
    xml = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://bestwayec.uz/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
    <xhtml:link rel="alternate" hreflang="uz" href="https://bestwayec.uz/"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://bestwayec.uz/en"/>
  </url>
  <url>
    <loc>https://bestwayec.uz/mock</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
    <xhtml:link rel="alternate" hreflang="uz" href="https://bestwayec.uz/mock"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://bestwayec.uz/en/mock"/>
  </url>
  <url>
    <loc>https://bestwayec.uz/desktop</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
    <xhtml:link rel="alternate" hreflang="uz" href="https://bestwayec.uz/desktop"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://bestwayec.uz/en/desktop"/>
  </url>
</urlset>"""
    from django.http import HttpResponse
    return HttpResponse(xml, content_type="application/xml")


def robots_view(request):
    text = """User-agent: *
Allow: /
Allow: /mock
Allow: /desktop
Allow: /en/
Disallow: /api/
Disallow: /admin/
Disallow: /teacher/
Disallow: /dashboard/

Sitemap: https://bestwayec.uz/sitemap.xml
"""
    from django.http import HttpResponse
    return HttpResponse(text, content_type="text/plain")


urlpatterns = [
    # Django Admin lives on the API origin only (e.g. /admin/ on the backend
    # host). The Next.js /admin bookmark still redirects to the Next.js
    # super-admin dashboard; it is a separate product surface.
    path("admin/", admin.site.urls),
    path("sitemap.xml", sitemap_view),
    path("robots.txt", robots_view),
    path("v1/", include("apps.core.urls")),
    path("api/v1/", include("apps.core.urls")),
    re_path(r"^media/(?P<path>.*)$", serve_media),
]


