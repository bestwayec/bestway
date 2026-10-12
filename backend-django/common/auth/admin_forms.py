"""Admin login form wording for BESTWAY's phone-based accounts.

The password check itself lives in ``common.auth.admin_backend``; this only
tells the administrator which identifier the existing account uses.
"""
from __future__ import annotations

from django import forms
from django.contrib.admin.forms import AdminAuthenticationForm
from django.utils.text import capfirst


class BestwayAdminAuthenticationForm(AdminAuthenticationForm):
    username = forms.CharField(
        label="Phone number",
        max_length=254,
        strip=True,
        help_text="The account's phone number (e-mail address or id also work).",
        widget=forms.TextInput(attrs={"autofocus": True, "autocomplete": "username"}),
    )

    def __init__(self, request=None, *args, **kwargs):
        super().__init__(request, *args, **kwargs)
        # AuthenticationForm overwrites the label from the stock auth.User
        # field; keep ours so the identifier is unambiguous.
        self.fields["username"].label = capfirst("Phone number")
        self.fields["username"].widget.attrs["maxlength"] = 254
