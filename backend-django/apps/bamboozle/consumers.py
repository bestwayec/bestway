"""Async ASGI WebSocket consumer for Bamboozle Team Arena."""
import json
import logging
from typing import Dict, Any, Set
from django.core.cache import cache
from apps.bamboozle.views import get_cached_room, save_cached_room
from apps.core.lms_services import apply_bamboozle_card_effect

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
                        "text": json.dumps({"type": "STATE_SYNC", "room": room}),
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
                                "room": room,
                                "timestamp": payload.get("timestamp"),
                            }),
                        })

                # TILE / CARD ACTION BROADCAST
                elif msg_type == "CARD_ACTION":
                    card_id = payload.get("card_id")
                    is_correct = bool(payload.get("is_correct", True))
                    team = int(payload.get("team", 1))
                    has_double = bool(payload.get("has_double", False))

                    room = get_cached_room(room_code)
                    if room:
                        target_card = next((c for c in room.get("cards", []) if str(c.get("id")) == str(card_id)), None)
                        if target_card and not target_card.get("is_revealed"):
                            new_t1, new_t2, effect_msg = apply_bamboozle_card_effect(
                                active_team=team,
                                card_type=target_card.get("card_type", "question"),
                                points=target_card.get("points", 10),
                                team1_score=room["team1_score"],
                                team2_score=room["team2_score"],
                                is_correct=is_correct,
                                has_double=has_double,
                            )
                            target_card["is_revealed"] = True
                            target_card["revealed_by_team"] = team
                            target_card["effect_message"] = effect_msg

                            room["team1_score"] = new_t1
                            room["team2_score"] = new_t2
                            room["revealed_cards_count"] = sum(1 for c in room["cards"] if c.get("is_revealed"))
                            room["active_turn"] = 2 if team == 1 else 1

                            if room["revealed_cards_count"] >= room.get("total_cards", len(room["cards"])):
                                room["status"] = "finished"

                            save_cached_room(room)

                            broadcast_msg = json.dumps({"type": "GAME_UPDATE", "room": room})
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
