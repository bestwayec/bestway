from django.urls import path

from .views import desktop_version, health

urlpatterns = [path("health", health, name="health"), path("desktop-version", desktop_version, name="desktop-version")]
