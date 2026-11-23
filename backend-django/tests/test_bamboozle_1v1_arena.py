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

    def _room(self, code, cards):
        from apps.bamboozle.views import _issue_token
        room = {
            "room_code": code, "deck_id": "deck-1", "deck_title": "Conditionals", "category": "Grammar",
            "host_id": "h1", "host_name": "Player 1", "guest_id": "g1", "guest_name": "Player 2",
            "mode": "1v1", "status": "active", "active_turn": 1, "team1_score": 0, "team2_score": 0,
            "team1_name": "Player 1", "team2_name": "Player 2", "cards": cards,
            "total_cards": len(cards), "revealed_cards_count": 0, "logs": [],
        }
        t1, t2 = _issue_token(room, 1), _issue_token(room, 2)
        save_cached_room(room)
        return t1, t2

    def _play(self, code, token, **body):
        headers = {"HTTP_X_BAMBOOZLE_PLAYER": token} if token else {}
        return self.client.post(f"/v1/bamboozle/rooms/{code}/play", data=json.dumps(body),
                                content_type="application/json", **headers)

    QUESTION = {"id": "card-q1", "order_index": 1, "card_type": "question", "points": 15,
                "question_text": "If it rains, we ... stay home.", "options": ["will", "would"],
                "correct_answer": "will", "is_revealed": False}
    SWAP = {"id": "card-swap", "order_index": 2, "card_type": "swap", "points": 0,
            "question_text": "Swap Points!", "is_revealed": False}

    def test_play_action_and_turn_progression(self):
        """The server judges the answer, scores it and passes the turn."""
        t1, t2 = self._room("TURN88", [dict(self.QUESTION), dict(self.SWAP)])
        play_resp = self._play("TURN88", t1, card_id="card-q1", answer="WILL")
        self.assertEqual(play_resp.status_code, 200)
        data = play_resp.json()["data"]
        self.assertEqual((data["team1_score"], data["team2_score"]), (15, 0))
        self.assertEqual(data["active_turn"], 2)
        self.assertEqual(data["revealed_cards_count"], 1)
        self.assertEqual(data["status"], "active")
        self.assertTrue(data["last_play"]["isCorrect"])

        swap_resp = self._play("TURN88", t2, card_id="card-swap")
        self.assertEqual(swap_resp.status_code, 200)
        swap_data = swap_resp.json()["data"]
        self.assertEqual((swap_data["team1_score"], swap_data["team2_score"]), (0, 15))
        self.assertEqual(swap_data["status"], "finished")
        self.assertEqual(swap_data["revealed_cards_count"], 2)

    def test_client_cannot_claim_a_correct_answer_or_another_team(self):
        t1, t2 = self._room("CHEAT1", [dict(self.QUESTION), dict(self.SWAP)])
        # No token: not a player, whatever the body claims.
        self.assertEqual(self._play("CHEAT1", None, card_id="card-q1", is_correct=True, team=1, answer="will").status_code, 403)
        # Team 2 cannot play on team 1's turn, even claiming team=1.
        resp = self._play("CHEAT1", t2, card_id="card-q1", answer="will", team=1)
        self.assertEqual((resp.status_code, resp.json()["error"]["code"]), (409, "NOT_YOUR_TURN"))
        # A wrong answer scores nothing even with is_correct/has_double claimed.
        resp = self._play("CHEAT1", t1, card_id="card-q1", answer="would", is_correct=True, has_double=True)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["team1_score"], 0)
        self.assertFalse(resp.json()["data"]["last_play"]["isCorrect"])
        # A question needs one of its own options.
        t1b, _ = self._room("CHEAT2", [dict(self.QUESTION)])
        self.assertEqual(self._play("CHEAT2", t1b, card_id="card-q1").json()["error"]["code"], "ANSWER_REQUIRED")
        self.assertEqual(self._play("CHEAT2", t1b, card_id="card-q1", answer="maybe").json()["error"]["code"], "INVALID_ANSWER")

    def test_room_state_hides_tokens_and_unopened_answers(self):
        t1, _ = self._room("HIDE77", [dict(self.QUESTION), dict(self.SWAP, id="s2")])
        data = self.client.get("/v1/bamboozle/rooms/HIDE77").json()["data"]
        self.assertNotIn("_tokens", data)
        self.assertNotIn("correct_answer", data["cards"][0])
        self.assertNotIn(t1, json.dumps(data))
        self._play("HIDE77", t1, card_id="card-q1", answer="would")
        opened = self.client.get("/v1/bamboozle/rooms/HIDE77").json()["data"]["cards"][0]
        self.assertEqual(opened["correct_answer"], "will")  # shown once the card is opened

    def test_double_bonus_is_kept_by_the_server(self):
        double = {"id": "d1", "order_index": 1, "card_type": "double", "points": 0, "question_text": "2x", "is_revealed": False}
        swap = dict(self.SWAP, id="s1")
        t1, t2 = self._room("DBL555", [double, swap, dict(self.QUESTION)])
        self._play("DBL555", t1, card_id="d1")
        self._play("DBL555", t2, card_id="s1")
        data = self._play("DBL555", t1, card_id="card-q1", answer="will").json()["data"]
        self.assertEqual(data["team1_score"], 30)  # 15 x 2
        self.assertFalse(data["double_pending"]["1"])

    def test_join_gives_one_seat_and_a_token(self):
        from apps.bamboozle.views import _issue_token
        room = {"room_code": "SEAT22", "status": "waiting", "host_id": "h", "guest_id": None,
                "team1_name": "H", "team2_name": "?", "cards": [], "logs": []}
        _issue_token(room, 1)
        save_cached_room(room)
        first = self.client.post("/v1/bamboozle/rooms/SEAT22/join", data=json.dumps({"guest_name": "Madina"}),
                                 content_type="application/json").json()["data"]
        self.assertEqual(first["my_team"], 2)
        self.assertTrue(first["player_token"])
        again = self.client.post("/v1/bamboozle/rooms/SEAT22/join", data="{}", content_type="application/json",
                                 HTTP_X_BAMBOOZLE_PLAYER=first["player_token"]).json()["data"]
        self.assertEqual(again["my_team"], 2)
        self.assertNotIn("player_token", again)
        third = self.client.post("/v1/bamboozle/rooms/SEAT22/join", data=json.dumps({"guest_name": "X"}),
                                 content_type="application/json")
        self.assertEqual((third.status_code, third.json()["error"]["code"]), (409, "ROOM_FULL"))
