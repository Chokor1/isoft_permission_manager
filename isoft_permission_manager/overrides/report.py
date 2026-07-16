# Copyright (c) 2026, Isoft and contributors
# For license information, please see license.txt
#
# Makes per-user report restrictions actually bite.
#
# Frappe gates reports by ROLE only: Report.is_permitted() consults the report's
# Has Role table (or a Custom Role override) and nothing else. A User Permission
# on the Report doctype filters the report LIST view, but does not stop the user
# from running a report they were never granted - the desk simply hides the link.
#
# Every report entry point (query_report run / export_query /
# background_enqueue_run / get_script) resolves its doc via
# frappe.get_doc("Report", ...), so overriding is_permitted() here covers them
# all in one place. Wired up through `override_doctype_class` in hooks.py.

from frappe.core.doctype.report.report import Report

from isoft_permission_manager.isoft_permission_manager.utils import SENTINEL_REPORT
from isoft_permission_manager.overrides.access import is_allowed


class IPMReport(Report):
	def is_permitted(self):
		# Role check first - a restriction never widens access.
		if not super().is_permitted():
			return False
		return is_allowed("Report", self.name, SENTINEL_REPORT)
