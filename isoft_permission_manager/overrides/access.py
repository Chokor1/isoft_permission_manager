# Copyright (c) 2026, Isoft and contributors
# For license information, please see license.txt
#
# The shared per-user allowlist rule behind the Report and Page overrides.
#
# Frappe gates both Reports and Pages by ROLE only - their is_permitted() reads
# the Has Role table (or a Custom Role override) and nothing else. A User
# Permission on those doctypes filters LIST views but never blocks opening the
# thing, so the restriction has to be enforced here.
#
# Kept in one place on purpose: this is a security check, and two drifting copies
# of it is exactly the bug nobody notices.

import frappe
from frappe.permissions import get_user_permissions


def is_allowed(allow_doctype, name, sentinel, user=None):
	"""True if `user` may open `name` under the per-user allowlist.

	Mirrors frappe's own User Permission semantics: no permissions for
	`allow_doctype` at all means unrestricted. As soon as one exists, the user is
	limited to exactly those values.

	`sentinel` is always permitted. It is what occupies the User Permission slot
	when a user is restricted to nothing - the empty set cannot express that,
	because frappe reads "no permissions" as "no restriction".
	"""
	user = user or frappe.session.user
	if user == "Administrator":
		return True

	allowed = {d.get("doc") for d in (get_user_permissions(user) or {}).get(allow_doctype, [])}
	if not allowed:
		return True  # unrestricted - the permissive default

	if name == sentinel:
		return True

	return name in allowed
