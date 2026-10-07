from django.urls import path

from .views import (desktop_authorize_view, desktop_exchange_view, desktop_version,
                    health, link_child_view, login_view, logout_view, me_view,
                    refresh_view, register_view, user_detail_view, users_view)

urlpatterns = [
    path("health", health), path("desktop-version", desktop_version),
    path("auth/register", register_view), path("auth/login", login_view),
    path("auth/refresh", refresh_view), path("auth/logout", logout_view),
    path("auth/me", me_view), path("auth/link-child", link_child_view),
    path("auth/desktop/authorize", desktop_authorize_view),
    path("auth/desktop/exchange", desktop_exchange_view),
    path("users", users_view), path("users/<str:user_id>", user_detail_view),
]
