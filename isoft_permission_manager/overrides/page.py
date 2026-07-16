# Copyright (c) 2026, Isoft and contributors
# For license information, please see license.txt
#
# Makes per-user desk page restrictions actually bite.
#
# Same story as reports: Page.is_permitted() checks roles only, so a User
# Permission on the Page doctype does not stop anyone opening the page. The desk
# resolves pages through frappe.get_doc("Page", ...) in desk_page.get(), so this
# one override covers the route. Wired up via `override_doctype_class`.

from frappe.core.doctype.page.page import Page

from isoft_permission_manager.isoft_permission_manager.utils import SENTINEL_PAGE
from isoft_permission_manager.overrides.access import is_allowed


class IPMPage(Page):
	def is_permitted(self):
		# Role check first - a restriction never widens access.
		if not super().is_permitted():
			return False
		return is_allowed("Page", self.name, SENTINEL_PAGE)
