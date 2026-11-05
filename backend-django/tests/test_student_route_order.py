"""Literal /students/<name> routes must not be swallowed by the delete-student catch-all."""
import pytest
from django.urls import resolve


@pytest.mark.parametrize("prefix", ["/v1/", "/api/v1/", "/v1/v1/"])
@pytest.mark.parametrize("slash", ["", "/"])
@pytest.mark.parametrize("name", ["study-plan", "mistake-vault"])
def test_student_literal_routes_are_get_views(prefix, slash, name):
    cls = resolve(f"{prefix}students/{name}{slash}").func.cls
    assert hasattr(cls, "get"), f"{name} must be served by its GET view, not the delete-student route"
    assert not hasattr(cls, "delete")


def test_student_id_still_resolves_to_delete_view():
    cls = resolve("/v1/students/some-student-id").func.cls
    assert hasattr(cls, "delete")
