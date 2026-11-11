"""A published or unpublished exam must show up in the student catalogue at once."""
from types import SimpleNamespace
from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class CatalogueCacheTests(SimpleTestCase):
    def test_a_content_change_bypasses_the_cached_list(self):
        cache.clear()
        client = APIClient()
        client.force_authenticate(SimpleNamespace(id="stu-1", role="student", is_authenticated=True))
        with patch("apps.core.views.catalogue_version", side_effect=["v1", "v1", "v2"]), \
             patch("apps.core.mock_catalog.list_exams", side_effect=[[{"id": "old"}], [{"id": "old"}, {"id": "new"}]]) as listing:
            first = client.get("/v1/mock/exams").data["data"]
            cached = client.get("/v1/mock/exams").data["data"]
            fresh = client.get("/v1/mock/exams").data["data"]
        self.assertEqual(first, cached)
        self.assertEqual(listing.call_count, 2)
        self.assertEqual([e["id"] for e in fresh], ["old", "new"])
