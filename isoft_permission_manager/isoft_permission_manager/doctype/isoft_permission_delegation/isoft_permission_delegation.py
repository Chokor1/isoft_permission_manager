# Copyright (c) 2026, Isoft and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class ISOFTPermissionDelegation(Document):
	def validate(self):
		# A manager must never be able to grant the System Manager role through
		# this tool - that would be a privilege-escalation path.
		for row in self.allowed_roles or []:
			if row.role == "System Manager":
				frappe.throw(_("'System Manager' cannot be added to a delegation's allowed roles."))

		# De-duplicate child rows.
		self._dedupe("allowed_users", "user")
		self._dedupe("allowed_roles", "role")
		self._dedupe("allowed_modules", "module")

	def _dedupe(self, table, field):
		seen = set()
		kept = []
		for row in self.get(table) or []:
			val = row.get(field)
			if val and val not in seen:
				seen.add(val)
				kept.append(row)
		self.set(table, kept)
