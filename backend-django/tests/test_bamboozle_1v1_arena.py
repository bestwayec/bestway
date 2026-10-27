"""Tests for Bamboozle 1v1 Arena and viral link generation."""
import json
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from django.test.client import Client

from apps.bamboozle.views import generate_room_code, get_cached_room, save_cached_room


class Bamboozle1v1ArenaTests(SimpleTestCase):
    def setUp(self):
        self.client = Client()

    def test_generate_room_code_format(self):
        """Room code should be 6 characters alphanumeric uppercase without ambiguous chars."""
        code = generate_room_code()
        self.assertEqual(len(code), 6)
        self.assertTrue(code.isalnum())
        self.assertEqual(code, code.upper())
        for ambiguous in ("0", "O", "1", "I"):
            self.assertNotIn(ambiguous, code)

    @patch("apps.bamboozle.views.get_quiz_deck_detail")
    def test_create_room_generates_share_and_telegram_urls(self, mock_deck):
        """Creating a room sets up initial state with shareable link and cards."""
        mock_deck.return_value = {
            "id": "deck-grammar-1",
            "title": "Nouns and Articles Quiz",
            "category": "Grammar",
            "cards": [
                {
                    "id": "card-1",
                    "question_text": "What is the plural of child?",
                    "card_type": "question",
                    "points": 10,
                    "options": ["childs", "children", "childes"],
                    "correct_answer": "children",
                },
                {
                    "id": "card-2",
                    "question_text": "Surprise Swap Card!",
                    "card_type": "swap",
                    "points": 0,
                    "options": [],
                    "correct_answer": "",
                },
            ],
        }

        resp = self.client.post(
            "/v1/bamboozle/rooms/create",
            data=json.dumps({"deck_id": "deck-grammar-1", "host_name": "Jasur"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()["data"]

        self.assertEqual(data["deck_title"], "Nouns and Articles Quiz")
        self.assertEqual(data["host_name"], "Jasur")
        self.assertEqual(data["status"], "waiting")
        self.assertEqual(data["active_turn"], 1)
        self.assertEqual(data["team1_score"], 0)
        self.assertEqual(data["team2_score"], 0)
        self.assertEqual(len(data["cards"]), 2)

        # Check shareable links
        self.assertIn(f"?room={data['room_code']}&deck=deck-grammar-1", data["share_url"])
        self.assertIn("t.me/share/url", data["telegram_share_url"])

    def test_get_room_and_join_flow(self):
        """Test retrieving room and joining as a guest."""
        room_code = "TEST99"
        initial_room = {
            "room_code": room_code,
            "deck_id": "deck-123",
            "deck_title": "Verb Tenses",
            "category": "Grammar",
            "host_id": "host-1",
            "host_name": "Jasur",
            "guest_id": None,
            "guest_name": None,
            "mode": "1v1",
            "status": "waiting",
            "active_turn": 1,
            "team1_score": 0,
            "team2_score": 0,
            "team1_name": "Jasur",
            "team2_name": "Do'st (Kutilmoqda)",
            "cards": [
                {
                    "id": "c1",
                    "order_index": 1,
                    "card_type": "question",
                    "points": 10,
                    "question_text": "Sample Q",
                    "is_revealed": False,
                }
            ],
            "total_cards": 1,
            "revealed_cards_count": 0,
            "logs": [],
        }
        save_cached_room(initial_room)

        # 1. GET room
        resp = self.client.get(f"/v1/bamboozle/rooms/{room_code}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["deck_title"], "Verb Tenses")

        # 2. Join as guest
        join_resp = self.client.post(
            f"/v1/bamboozle/rooms/{room_code}/join",
            data=json.dumps({"guest_name": "Madina"}),
            content_type="application/json",
        )
        self.assertEqual(join_resp.status_code, 200)
        joined_data = join_resp.json()["data"]
        self.assertEqual(joined_data["status"], "active")
        self.assertEqual(joined_data["guest_name"], "Madina")
        self.assertEqual(joined_data["team2_name"], "Madina")

    def test_play_action_and_turn_progression(self):
        """Test playing a turn, updating scores, and toggling active turn."""
        room_code = "TURN88"
        initial_room = {
            "room_code": room_code,
            "deck_id": "deck-1",
            "deck_title": "Conditionals",
            "category": "Grammar",
            "host_id": "h1",
            "host_name": "Player 1",
            "guest_id": "g1",
            "guest_name": "Player 2",
            "mode": "1v1",
            "status": "active",
            "active_turn": 1,
            "team1_score": 0,
            "team2_score": 0,
            "team1_name": "Player 1",
            "team2_name": "Player 2",
            "cards": [
                {
                    "id": "card-q1",
                    "order_index": 1,
                    "card_type": "question",
                    "points": 15,
                    "question_text": "If it rains, we ... stay home.",
                    "is_revealed": False,
                },
                {
                    "id": "card-swap",
                    "order_index": 2,
                    "card_type": "swap",
                    "points": 0,
                    "question_text": "Swap Points!",
                    "is_revealed": False,
                },
            ],
            "total_cards": 2,
            "revealed_cards_count": 0,
            "logs": [],
        }
        save_cached_room(initial_room)

        # Player 1 answers card 1 correctly (+15)
        play_resp = self.client.post(
            f"/v1/bamboozle/rooms/{room_code}/play",
            data=json.dumps({"card_id": "card-q1", "is_correct": True, "team": 1}),
            content_type="application/json",
        )
        self.assertEqual(play_resp.status_code, 200)
        data = play_resp.json()["data"]
        self.assertEqual(data["team1_score"], 15)
        self.assertEqual(data["team2_score"], 0)
        self.assertEqual(data["active_turn"], 2)  # Turn switched to Player 2
        self.assertEqual(data["revealed_cards_count"], 1)
        self.assertEqual(data["status"], "active")

        # Player 2 picks the Swap card
        swap_resp = self.client.post(
            f"/v1/bamboozle/rooms/{room_code}/play",
            data=json.dumps({"card_id": "card-swap", "team": 2}),
            content_type="application/json",
        )
        self.assertEqual(swap_resp.status_code, 200)
        swap_data = swap_resp.json()["data"]
        # Scores swapped: Team 1 has 0, Team 2 has 15
        self.assertEqual(swap_data["team1_score"], 0)
        self.assertEqual(swap_data["team2_score"], 15)
        # All 2 cards revealed -> finished
        self.assertEqual(swap_data["status"], "finished")
        self.assertEqual(swap_data["revealed_cards_count"], 2)
