"""Teachers see full contact details only for students in their own groups."""
from django.test import SimpleTestCase

from apps.core.user_admin import mask_email, mask_phone


class ContactMaskingTests(SimpleTestCase):
    def test_phone_keeps_only_country_code_and_last_four_digits(self):
        self.assertEqual(mask_phone("+998901234567"), "+998 ** *** 45 67")
        self.assertEqual(mask_phone("998901234567"), "+998 ** *** 45 67")
        self.assertNotIn("90123", mask_phone("+998901234567"))
        self.assertEqual(mask_phone("12"), "***")
        self.assertIsNone(mask_phone(None))

    def test_email_keeps_first_letter_and_domain(self):
        self.assertEqual(mask_email("student10@local.test"), "s***@local.test")
        self.assertEqual(mask_email("broken"), "***")
