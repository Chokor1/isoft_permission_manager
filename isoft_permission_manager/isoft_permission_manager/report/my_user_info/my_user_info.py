# Copyright (c) 2026, Isoft and contributors
# For license information, please see license.txt
#
# "My User Info" - the fallback report every user can always open.
#
# Report visibility is driven by User Permissions on the Report doctype, where
# "no permissions at all" means *unrestricted*. So there is no way to express
# "this user may see no reports" - the empty set is the permissive case. This
# report exists to occupy that slot: restricting a user to only this report is
# how the Permission Manager says "no report access", while still leaving them
# something harmless and self-explanatory to land on.
#
# It only ever reports on the logged-in user, so it is safe for everyone.

import frappe
from frappe import _

from isoft_permission_manager.isoft_permission_manager.utils import SENTINEL_REPORT


def execute(filters=None):
	return get_columns(), get_data()


def get_columns():
	return [
		{"label": _("Info"), "fieldname": "label", "fieldtype": "Data", "width": 200},
		{"label": _("Value"), "fieldname": "value", "fieldtype": "Data", "width": 420},
	]


def get_data():
	user = frappe.session.user
	u = frappe.get_doc("User", user)

	roles = sorted({r.role for r in u.roles})

	# Mirrors the rule enforced in IPMReport.is_permitted().
	allowed_reports = frappe.get_all(
		"User Permission",
		filters={"user": user, "allow": "Report"},
		pluck="for_value",
	)
	if not allowed_reports:
		access = _("All reports your roles allow")
	else:
		others = sorted(r for r in allowed_reports if r != SENTINEL_REPORT)
		access = _("Only: {0}").format(", ".join(others)) if others else _("No reports")

	rows = [
		{"label": _("Full Name"), "value": u.full_name},
		{"label": _("User ID"), "value": u.name},
		{"label": _("User Type"), "value": u.user_type},
		{"label": _("Enabled"), "value": _("Yes") if u.enabled else _("No")},
		{"label": _("Last Login"), "value": str(u.last_login) if u.last_login else _("Never")},
		{"label": _("Roles"), "value": ", ".join(roles) if roles else _("None")},
		{"label": _("Report Access"), "value": access},
	]
	return rows
