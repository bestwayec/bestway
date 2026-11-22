"""Global pytest configuration for BESTWAY backend test suite.

Ensures URLconf and route decorators are evaluated cleanly before any test
fixtures or mocks (such as transaction.atomic) run.
"""
import config.urls  # noqa: F401
