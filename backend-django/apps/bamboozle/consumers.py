"""Async ASGI WebSocket consumer for Bamboozle Team Arena."""
import json
import logging
from typing import Dict, Any, Set
from django.core.cache import cache
from apps.bamboozle.views import PlayRejected, apply_play, get_cached_room, public_room, save_cached_room

logger = logging.getLogger(__name__)

# In-memory registry of active WebSocket send channels per room
_ROOM_CHANNELS: Dict[str, Set[Any]] = {}


async def bamboozle_websocket_consumer(scope, receive, send):
    """Native ASGI WebSocket handler with zero external dependencies."""
    path = scope.get("path", "")
    parts = [p for p in path.split("/") if p]
    room_code = parts[-1].upper() if parts else ""

    if not room_code:
        await send({"type": "websocket.close", "code": 4000})
        return

    room_group = f"room_{room_code}"
    if room_group not in _ROOM_CHANNELS:
        _ROOM_CHANNELS[room_group] = set()

    channel_queue = send
    _ROOM_CHANNELS[room_group].add(channel_queue)

    try:
        while True:
            event = await receive()
            event_type = event.get("type")

            if event_type == "websocket.connect":
                await send({"type": "websocket.accept"})
                room = get_cached_room(room_code)
                if room:
                    await send({
                        "type": "websocket.send",
                        "text": json.dumps({"type": "STATE_SYNC", "room": public_room(room)}),
                    })

            elif event_type == "websocket.receive":
                text_data = event.get("text", "")
                if not text_data:
                    continue
                try:
                    payload = json.loads(text_data)
                except Exception:
                    continue

                msg_type = payload.get("type")

                # RECONNECTION / FORCE-SYNC TRIGGER
                if msg_type in ("SYNC_STATE", "FORCE_SYNC"):
                    room = get_cached_room(room_code)
                    if room:
                        await send({
                            "type": "websocket.send",
                            "text": json.dumps({
                                "type": "STATE_SYNC",
                                "room": public_room(room),
                                "timestamp": payload.get("timestamp"),
                            }),
                        })

                # TILE / CARD ACTION BROADCAST
                elif msg_type == "CARD_ACTION":
                    # Same server-side rules as the HTTP play endpoint: the player token picks
                    # the team, the server judges the answer; `is_correct`/`team` are ignored.
                    room = get_cached_room(room_code)
                    if not room:
                        continue
                    try:
                        apply_play(room, payload.get("player_token"), payload.get("card_id"), payload.get("answer"))
                    except PlayRejected as rejected:
                        await send({"type": "websocket.send",
                                    "text": json.dumps({"type": "ERROR", "code": rejected.code, "error": rejected.message})})
                        continue
                    save_cached_room(room)
                    broadcast_msg = json.dumps({"type": "GAME_UPDATE", "room": public_room(room)})
                    dead_channels = set()
                    for peer_send in list(_ROOM_CHANNELS[room_group]):
                        try:
                            await peer_send({"type": "websocket.send", "text": broadcast_msg})
                        except Exception:
                            dead_channels.add(peer_send)
                    _ROOM_CHANNELS[room_group] -= dead_channels

            elif event_type == "websocket.disconnect":
                break

    finally:
        _ROOM_CHANNELS[room_group].discard(channel_queue)
        if not _ROOM_CHANNELS[room_group]:
            _ROOM_CHANNELS.pop(room_group, None)
