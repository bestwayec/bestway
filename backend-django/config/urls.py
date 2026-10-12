from django.contrib import admin
from django.urls import include, path

from common.auth.admin_forms import BestwayAdminAuthenticationForm

# Sign in with the existing BESTWAY account (phone number + bcrypt password).
admin.site.login_form = BestwayAdminAuthenticationForm
admin.site.site_header = "BESTWAY Administration"
admin.site.site_title = "BESTWAY admin"
admin.site.index_title = "Operations overview"

urlpatterns = [
    # Django Admin lives on the API origin only (e.g. /admin/ on the backend
    # host). The Next.js /admin bookmark still redirects to the Next.js
    # super-admin dashboard; it is a separate product surface.
    path("admin/", admin.site.urls),
    path("v1/", include("apps.core.urls")),
]
