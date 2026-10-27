"""Bamboozle URLs."""
from django.urls import path

from .views import create_room_view, get_room_view, join_room_view, play_room_action_view

urlpatterns = [
    path("rooms/create", create_room_view, name="bamboozle-room-create"),
    path("rooms/<str:room_code>", get_room_view, name="bamboozle-room-get"),
    path("rooms/<str:room_code>/join", join_room_view, name="bamboozle-room-join"),
    path("rooms/<str:room_code>/play", play_room_action_view, name="bamboozle-room-play"),
]
