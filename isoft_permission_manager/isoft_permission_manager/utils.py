# Copyright (c) 2026, Isoft and contributors
# For license information, please see license.txt
#
# Backend for the Isoft Permission Manager app.
#
# A System Manager defines "delegations" (ISOFT Permission Delegation) that say
# which users a manager may manage and which roles/modules fall in their scope.
# Managers (users with the "ISOFT Permission Manager" role + an enabled
# delegation) then read and edit those users' permissions through the page.
#
# Every UI-facing endpoint is whitelisted and guarded. Mutating endpoints
# re-validate target user + scope server-side - the front-end is never trusted.

import json
import secrets
import string

import frappe
from frappe import _
from frappe.utils import add_days, cint, nowdate, strip_html
from frappe.utils.password import update_password as _update_password

SETTINGS_DOCTYPE = "ISOFT Permission Manager Settings"
DELEGATION_DOCTYPE = "ISOFT Permission Delegation"
MANAGER_ROLE = "ISOFT Permission Manager"

# Roles that must never be granted/revoked or used as a management target through
# this tool. Protects against privilege escalation and self-lockout.
PROTECTED_ROLES = {"System Manager", "Administrator", "All", "Guest"}
# Users that are never management targets.
PROTECTED_USERS = {"Administrator", "Guest"}

# The always-allowed fallback report shipped by this app. Report visibility is
# stored as User Permissions on the Report doctype, where "no permissions" means
# unrestricted - so "no report access" cannot be expressed by an empty set. We
# express it by leaving this harmless report as the only permitted one.
SENTINEL_REPORT = "My User Info"

# The page equivalent of SENTINEL_REPORT, and the reason it is "print" rather
# than something we ship: /app/print/<doctype>/<name> - the document print view -
# is itself a Page, and frappe has no PrintFactory, so that route really does go
# through Page.is_permitted(). Blocking it would kill printing for every doctype
# site-wide, which is governed by each doctype's `print` permission, not by page
# access. So it must always be reachable - which makes it the natural value to
# park in the User Permission slot when a user is restricted to no pages.
SENTINEL_PAGE = "print"


# --------------------------------------------------------------------------- #
# Access control
# --------------------------------------------------------------------------- #
def _is_admin(user=None):
	"""Full access: Administrator or any System Manager."""
	user = user or frappe.session.user
	if user == "Administrator":
		return True
	return "System Manager" in frappe.get_roles(user)


def _get_delegation(user=None):
	"""Return the enabled delegation doc for a manager, or None."""
	user = user or frappe.session.user
	name = frappe.db.get_value(DELEGATION_DOCTYPE, {"manager": user, "enabled": 1})
	if not name:
		return None
	return frappe.get_doc(DELEGATION_DOCTYPE, name)


def _has_access(user=None):
	user = user or frappe.session.user
	if _is_admin(user):
		return True
	return bool(MANAGER_ROLE in frappe.get_roles(user) and _get_delegation(user))


@frappe.whitelist()
def can_access():
	"""Lightweight check used by the navbar icon and page guard."""
	return 1 if _has_access() else 0


def _assert_access():
	if not _has_access():
		frappe.throw(_("You are not permitted to use the Permission Manager."), frappe.PermissionError)


def _settings():
	return frappe.get_single(SETTINGS_DOCTYPE)


# Accent palette, mirrored by ipm.THEMES in the page JS. Kept here too so the
# navbar icon - which loads on every desk page, without the app's stylesheet -
# can be tinted without shipping the whole page bundle everywhere.
THEME_PALETTE = {
	"Red": {"p": "#dc2626", "d": "#991b1b", "a": "#ef4444", "rgb": "220,38,38"},
	"Blue": {"p": "#2563eb", "d": "#1e40af", "a": "#3b82f6", "rgb": "37,99,235"},
	"Green": {"p": "#059669", "d": "#047857", "a": "#10b981", "rgb": "5,150,105"},
	"Purple": {"p": "#7c3aed", "d": "#5b21b6", "a": "#8b5cf6", "rgb": "124,58,237"},
	"Orange": {"p": "#ea580c", "d": "#c2410c", "a": "#f97316", "rgb": "234,88,12"},
	"Slate": {"p": "#475569", "d": "#334155", "a": "#64748b", "rgb": "71,85,105"},
	"Dark": {"p": "#0f172a", "d": "#020617", "a": "#334155", "rgb": "15,23,42"},
}
THEME_COLORS = set(THEME_PALETTE)


@frappe.whitelist()
def get_navbar_info():
	"""One call for the navbar shortcut: may this user open the app, and in which
	accent. Returns access as an explicit flag - never a truthy wrapper object -
	so a mis-read on the client cannot reveal the icon to everyone."""
	if not _has_access():
		return {"can_access": 0}
	theme = _settings().theme_color or "Red"
	return {
		"can_access": 1,
		"palette": THEME_PALETTE.get(theme, THEME_PALETTE["Red"]),
	}


@frappe.whitelist()
def set_theme(theme_color):
	"""Persist the accent theme picked from the toolbar (System Managers only)."""
	_assert_admin()
	if theme_color not in THEME_COLORS:
		frappe.throw(_("Unknown theme: {0}").format(theme_color))
	frappe.db.set_single_value(SETTINGS_DOCTYPE, "theme_color", theme_color)
	return {"ok": 1, "theme_color": theme_color}


@frappe.whitelist()
def get_settings():
	s = _settings()
	return {
		"theme_color": s.theme_color or "Red",
		"is_admin": 1 if _is_admin() else 0,
		"can_access": 1 if _has_access() else 0,
		"block_managing_system_managers": cint(s.block_managing_system_managers),
		"user": frappe.session.user,
	}


# --------------------------------------------------------------------------- #
# Scope resolution
# --------------------------------------------------------------------------- #
def _scope():
	"""Resolve what the current user is allowed to do.

	Returns a dict; `users`/`roles`/`modules` are sets, or None meaning "all".
	"""
	if _is_admin():
		return {
			"admin": True,
			"all_users": True, "users": None,
			"all_roles": True, "roles": None,
			"all_modules": True, "modules": None,
			"caps": {
				"roles": 1, "user_permissions": 1, "modules": 1,
				"pages_reports": 1, "reset_password": 1, "enable_disable": 1, "logs": 1,
			},
		}

	d = _get_delegation()
	if not d:
		frappe.throw(_("No active delegation found for your account."), frappe.PermissionError)

	return {
		"admin": False,
		"all_users": bool(d.all_users),
		"users": None if d.all_users else {r.user for r in (d.allowed_users or [])},
		"all_roles": bool(d.all_roles),
		"roles": None if d.all_roles else {r.role for r in (d.allowed_roles or [])},
		"all_modules": bool(d.all_modules),
		"modules": None if d.all_modules else {r.module for r in (d.allowed_modules or [])},
		"caps": {
			"roles": cint(d.can_edit_roles),
			"user_permissions": cint(d.can_edit_user_permissions),
			"modules": cint(d.can_edit_modules),
			"pages_reports": cint(d.can_view_pages_reports),
			"reset_password": cint(d.can_reset_password),
			"enable_disable": cint(d.can_enable_disable),
			"logs": cint(d.can_view_logs),
		},
	}


def _role_in_scope(role, scope):
	if role in PROTECTED_ROLES:
		return False
	if scope["all_roles"]:
		return True
	return role in (scope["roles"] or set())


def _module_in_scope(module, scope):
	if scope["all_modules"]:
		return True
	return module in (scope["modules"] or set())


def _is_system_manager_user(user):
	return "System Manager" in frappe.get_roles(user)


def _real_users():
	"""All non-internal users, enabled or not.

	Disabled users are deliberately included: they must stay selectable, or a
	manager who disables someone could never find them again to switch them back
	on. The front-end marks them instead of hiding them.
	"""
	# `username` is carried so pickers can disambiguate on hover: full_name is NOT
	# unique (several real accounts here share one), so a name-only label renders
	# two different people as identical chips.
	users = frappe.get_all(
		"User",
		fields=["name", "full_name", "username", "user_type", "last_login", "enabled"],
		order_by="full_name asc",
	)
	return [u for u in users if u.name not in PROTECTED_USERS]


def _manageable_users(scope):
	"""List of user dicts the current user may manage."""
	block_sm = (not scope["admin"]) or cint(_settings().block_managing_system_managers)
	out = []
	for u in _real_users():
		if not scope["admin"]:
			if scope["all_users"]:
				pass  # all real users are candidates
			elif u.name not in (scope["users"] or set()):
				continue
		if block_sm and not scope["admin"] and _is_system_manager_user(u.name):
			continue
		out.append(u)
	return out


def _assert_can_manage(user, scope):
	if user in PROTECTED_USERS:
		frappe.throw(_("This user cannot be managed here."), frappe.PermissionError)
	# Non-admins can never manage a System Manager.
	if not scope["admin"] and _is_system_manager_user(user):
		frappe.throw(_("You cannot manage a System Manager."), frappe.PermissionError)
	allowed = {u["name"] for u in _manageable_users(scope)}
	if user not in allowed:
		frappe.throw(_("You are not allowed to manage {0}.").format(user), frappe.PermissionError)


# --------------------------------------------------------------------------- #
# Bootstrap / pickers
# --------------------------------------------------------------------------- #
@frappe.whitelist()
def get_bootstrap():
	"""Everything the front-end needs to render the smart view."""
	_assert_access()
	scope = _scope()

	# Roles in scope (for the role editor); admins get every assignable role.
	all_roles = [
		r.name for r in frappe.get_all("Role", filters={"disabled": 0}, fields=["name"], order_by="name asc")
		if r.name not in PROTECTED_ROLES
	]
	scope_roles = all_roles if scope["all_roles"] else sorted((scope["roles"] or set()) - PROTECTED_ROLES)

	all_modules = [m.name for m in frappe.get_all("Module Def", fields=["name"], order_by="name asc")]
	scope_modules = all_modules if scope["all_modules"] else sorted(scope["modules"] or set())

	return {
		"is_admin": 1 if scope["admin"] else 0,
		"capabilities": scope["caps"],
		"users": _manageable_users(scope),
		"scope_roles": scope_roles,
		"scope_modules": scope_modules,
	}


# --------------------------------------------------------------------------- #
# Per-user overview (read)
# --------------------------------------------------------------------------- #
@frappe.whitelist()
def get_user_overview(user):
	_assert_access()
	scope = _scope()
	_assert_can_manage(user, scope)

	ud = frappe.get_doc("User", user)
	user_roles = [r.role for r in ud.roles]
	user_roles_set = set(user_roles)

	# Roles split into "editable in scope" and "other (read-only)".
	roles_in_scope = []
	if scope["all_roles"]:
		# show assignable roles; mark assigned
		for r in frappe.get_all("Role", filters={"disabled": 0}, fields=["name"], order_by="name asc"):
			if r.name in PROTECTED_ROLES:
				continue
			roles_in_scope.append({"role": r.name, "assigned": 1 if r.name in user_roles_set else 0})
	else:
		for role in sorted((scope["roles"] or set()) - PROTECTED_ROLES):
			roles_in_scope.append({"role": role, "assigned": 1 if role in user_roles_set else 0})
	scope_role_names = {r["role"] for r in roles_in_scope}
	other_roles = sorted(user_roles_set - scope_role_names)

	# Module blocks
	blocked = {b.module for b in (ud.block_modules or [])}
	all_modules = [m.name for m in frappe.get_all("Module Def", fields=["name"], order_by="name asc")]
	scope_modules = set(all_modules) if scope["all_modules"] else (scope["modules"] or set())
	modules = [{"module": m, "blocked": 1 if m in blocked else 0} for m in sorted(scope_modules)]
	other_blocked = sorted(blocked - set(scope_modules))

	# User permissions
	ups = frappe.get_all(
		"User Permission",
		filters={"user": user},
		fields=["name", "allow", "for_value", "applicable_for", "apply_to_all_doctypes", "is_default"],
		order_by="allow asc, for_value asc",
	)

	overview = {
		"profile": {
			"name": ud.name,
			"full_name": ud.full_name,
			"enabled": cint(ud.enabled),
			"user_type": ud.user_type,
			"last_login": str(ud.last_login) if ud.last_login else None,
		},
		"capabilities": scope["caps"],
		"roles_in_scope": roles_in_scope,
		"other_roles": other_roles,
		"modules": modules,
		"other_blocked_modules": other_blocked,
		"user_permissions": ups,
		# Viewing page/report access follows the same capability as the lists.
		"report_access": _get_report_access(user, user_roles) if scope["caps"]["pages_reports"] else None,
		"page_access": _get_page_access(user, user_roles) if scope["caps"]["pages_reports"] else None,
	}

	# View-only: doctype access, pages, reports (derived from roles). Pages and
	# reports are withheld entirely without the capability - hiding them only in
	# the front-end would still ship the list in the response.
	overview.update(_access_summary(user_roles, with_pages_reports=bool(scope["caps"]["pages_reports"])))
	return overview


def _access_summary(user_roles, with_pages_reports=True):
	if not user_roles:
		return {"doctype_access": [], "pages": [], "reports": []}

	doctype_access = frappe.db.sql(
		"""
		SELECT parent AS doctype,
			MAX(`read`) AS `read`, MAX(`write`) AS `write`,
			MAX(`create`) AS `create`, MAX(`delete`) AS `delete`,
			MAX(`submit`) AS `submit`, MAX(`cancel`) AS `cancel`, MAX(`amend`) AS `amend`,
			MAX(`print`) AS `print`, MAX(`email`) AS `email`, MAX(`report`) AS `report`,
			MAX(`export`) AS `export`, MAX(`share`) AS `share`
		FROM (
			SELECT parent, `read`, `write`, `create`, `delete`, `submit`, `cancel`, `amend`,
				`print`, `email`, `report`, `export`, `share`
			FROM `tabDocPerm` WHERE role IN %(roles)s AND permlevel = 0
			UNION ALL
			SELECT parent, `read`, `write`, `create`, `delete`, `submit`, `cancel`, `amend`,
				`print`, `email`, `report`, `export`, `share`
			FROM `tabCustom DocPerm` WHERE role IN %(roles)s AND permlevel = 0
		) t
		GROUP BY parent
		HAVING MAX(`read`) = 1
		ORDER BY parent
		""",
		{"roles": tuple(user_roles)},
		as_dict=True,
	)

	if not with_pages_reports:
		return {"doctype_access": doctype_access, "pages": [], "reports": []}

	pages = [
		r.parent for r in frappe.db.sql(
			"""SELECT DISTINCT parent FROM `tabHas Role`
			WHERE parenttype = 'Page' AND role IN %(roles)s ORDER BY parent""",
			{"roles": tuple(user_roles)}, as_dict=True,
		)
	]
	reports = [
		r.parent for r in frappe.db.sql(
			"""SELECT DISTINCT parent FROM `tabHas Role`
			WHERE parenttype = 'Report' AND role IN %(roles)s ORDER BY parent""",
			{"roles": tuple(user_roles)}, as_dict=True,
		)
	]
	return {"doctype_access": doctype_access, "pages": pages, "reports": reports}


# --------------------------------------------------------------------------- #
# Mutations
# --------------------------------------------------------------------------- #
@frappe.whitelist()
def set_user_roles(user, roles):
	"""Set the user's roles *within the caller's scope*; roles outside the scope
	are left untouched. `roles` is a JSON array of role names to be assigned."""
	_assert_access()
	scope = _scope()
	_assert_can_manage(user, scope)
	if not scope["caps"]["roles"]:
		frappe.throw(_("You are not allowed to edit role assignments."), frappe.PermissionError)

	selected = set(_loads(roles))
	# Keep only valid, in-scope selections.
	selected = {r for r in selected if _role_in_scope(r, scope)}

	ud = frappe.get_doc("User", user)
	current = {r.role for r in ud.roles}
	# Roles the caller may touch:
	if scope["all_roles"]:
		touchable = {r.name for r in frappe.get_all("Role", filters={"disabled": 0}, fields=["name"])} - PROTECTED_ROLES
	else:
		touchable = (scope["roles"] or set()) - PROTECTED_ROLES

	keep = {r for r in current if r not in touchable}  # out-of-scope roles preserved
	final = keep | selected

	ud.set("roles", [])
	for r in sorted(final):
		ud.append("roles", {"role": r})
	ud.save(ignore_permissions=True)
	frappe.msgprint(_("Roles updated for {0}.").format(user), alert=True, indicator="green")
	return {"ok": 1}


@frappe.whitelist()
def set_module_blocks(user, blocked_modules):
	"""Set blocked modules within scope; out-of-scope blocks are preserved.
	`blocked_modules` is a JSON array of modules to BLOCK (within scope)."""
	_assert_access()
	scope = _scope()
	_assert_can_manage(user, scope)
	if not scope["caps"]["modules"]:
		frappe.throw(_("You are not allowed to edit module access."), frappe.PermissionError)

	to_block = {m for m in _loads(blocked_modules) if _module_in_scope(m, scope)}

	ud = frappe.get_doc("User", user)
	current = {b.module for b in (ud.block_modules or [])}
	if scope["all_modules"]:
		touchable = {m.name for m in frappe.get_all("Module Def", fields=["name"])}
	else:
		touchable = scope["modules"] or set()

	keep = {m for m in current if m not in touchable}
	final = keep | to_block

	ud.set("block_modules", [])
	for m in sorted(final):
		ud.append("block_modules", {"module": m})
	ud.save(ignore_permissions=True)
	frappe.msgprint(_("Module access updated for {0}.").format(user), alert=True, indicator="green")
	return {"ok": 1}


@frappe.whitelist()
def add_user_permission(user, allow, for_value, applicable_for=None, apply_to_all_doctypes=1):
	_assert_access()
	scope = _scope()
	_assert_can_manage(user, scope)
	if not scope["caps"]["user_permissions"]:
		frappe.throw(_("You are not allowed to edit user permissions."), frappe.PermissionError)

	apply_all = cint(apply_to_all_doctypes)
	doc = frappe.get_doc({
		"doctype": "User Permission",
		"user": user,
		"allow": allow,
		"for_value": for_value,
		"apply_to_all_doctypes": apply_all,
		"applicable_for": None if apply_all else applicable_for,
	})
	doc.insert(ignore_permissions=True)
	frappe.msgprint(_("User permission added."), alert=True, indicator="green")
	return {"ok": 1, "name": doc.name}


@frappe.whitelist()
def remove_user_permission(name):
	_assert_access()
	scope = _scope()
	up = frappe.db.get_value("User Permission", name, ["user"], as_dict=True)
	if not up:
		return {"ok": 1}
	_assert_can_manage(up.user, scope)
	if not scope["caps"]["user_permissions"]:
		frappe.throw(_("You are not allowed to edit user permissions."), frappe.PermissionError)
	frappe.delete_doc("User Permission", name, ignore_permissions=True)
	frappe.msgprint(_("User permission removed."), alert=True, indicator="green")
	return {"ok": 1}


# --------------------------------------------------------------------------- #
# Page access (per-user allowlist, stored as User Permissions on "Page")
# --------------------------------------------------------------------------- #
def _reachable_pages(user_roles):
	"""Desk pages this user can open today, by role alone.

	Mirrors Page.is_permitted(): a page with no roles attached is open to
	everyone. The sentinel is excluded - it is never a choice.
	"""
	rows = frappe.db.sql(
		"""
		SELECT p.name, p.title
		FROM `tabPage` p
		WHERE p.name != %(sentinel)s AND (
			NOT EXISTS (
				SELECT 1 FROM `tabHas Role` h
				WHERE h.parent = p.name AND h.parenttype = 'Page'
			)
			OR EXISTS (
				SELECT 1 FROM `tabHas Role` h
				WHERE h.parent = p.name AND h.parenttype = 'Page' AND h.role IN %(roles)s
			)
		)
		ORDER BY p.name
		""",
		{"roles": tuple(user_roles) if user_roles else ("__none__",), "sentinel": SENTINEL_PAGE},
		as_dict=True,
	)
	return [{"name": r.name, "title": r.title or r.name} for r in rows]


def _get_page_access(user, user_roles):
	allowed = set(
		frappe.get_all("User Permission", filters={"user": user, "allow": "Page"}, pluck="for_value")
	)
	return {
		"restricted": 1 if allowed else 0,
		"allowed": sorted(allowed - {SENTINEL_PAGE}),
		"reachable": _reachable_pages(user_roles),
		"sentinel": SENTINEL_PAGE,
	}


@frappe.whitelist()
def set_page_access(user, restricted, pages):
	"""Restrict a user to `pages`, or lift the restriction entirely.

	restricted=0 -> delete every Page User Permission (back to role-only access).
	restricted=1 -> keep exactly `pages` + the sentinel (the print view, which
	                must never be blocked - see SENTINEL_PAGE).
	"""
	_assert_access()
	scope = _scope()
	_assert_can_manage(user, scope)
	if not scope["caps"]["pages_reports"]:
		frappe.throw(_("You are not allowed to view page access."), frappe.PermissionError)
	if not scope["caps"]["user_permissions"]:
		frappe.throw(_("You are not allowed to edit user permissions."), frappe.PermissionError)
	# The Permission Manager is itself a desk page: restricting your own pages
	# could lock you out of the very tool needed to undo it.
	if cint(restricted) and user == frappe.session.user:
		frappe.throw(_("You cannot restrict your own page access."))

	existing = {
		u.for_value: u.name
		for u in frappe.get_all(
			"User Permission", filters={"user": user, "allow": "Page"}, fields=["name", "for_value"]
		)
	}

	if not cint(restricted):
		for name in existing.values():
			frappe.delete_doc("User Permission", name, ignore_permissions=True)
		frappe.msgprint(_("{0} can now open any page their roles allow.").format(user), alert=True, indicator="green")
		return {"ok": 1, "restricted": 0}

	selected = {p for p in _loads(pages) if frappe.db.exists("Page", p)}
	final = selected | {SENTINEL_PAGE}

	for value in final - set(existing):
		frappe.get_doc({
			"doctype": "User Permission",
			"user": user,
			"allow": "Page",
			"for_value": value,
			"apply_to_all_doctypes": 1,
		}).insert(ignore_permissions=True)

	for value, name in existing.items():
		if value not in final:
			frappe.delete_doc("User Permission", name, ignore_permissions=True)

	frappe.msgprint(
		_("{0} is now restricted to {1} page(s).").format(user, len(selected)),
		alert=True, indicator="green",
	)
	return {"ok": 1, "restricted": 1, "count": len(selected)}


# --------------------------------------------------------------------------- #
# Report access (per-user allowlist, stored as User Permissions on "Report")
# --------------------------------------------------------------------------- #
def _reachable_reports(user_roles):
	"""Reports this user can open today, by role alone.

	Mirrors Report.is_permitted(): a report with no roles attached is open to
	everyone, so those must be listed too - they are the ones a manager would
	otherwise have no way to take away.
	"""
	rows = frappe.db.sql(
		"""
		SELECT r.name
		FROM `tabReport` r
		WHERE r.disabled = 0 AND r.name != %(sentinel)s AND (
			NOT EXISTS (
				SELECT 1 FROM `tabHas Role` h
				WHERE h.parent = r.name AND h.parenttype = 'Report'
			)
			OR EXISTS (
				SELECT 1 FROM `tabHas Role` h
				WHERE h.parent = r.name AND h.parenttype = 'Report' AND h.role IN %(roles)s
			)
		)
		ORDER BY r.name
		""",
		# A user with no roles still reaches the role-less reports.
		{"roles": tuple(user_roles) if user_roles else ("__none__",), "sentinel": SENTINEL_REPORT},
		as_dict=True,
	)
	return [r.name for r in rows]


def _get_report_access(user, user_roles):
	allowed = set(
		frappe.get_all("User Permission", filters={"user": user, "allow": "Report"}, pluck="for_value")
	)
	return {
		# No User Permission rows at all == unrestricted. That is frappe's rule,
		# not ours, and it is why the sentinel report exists.
		"restricted": 1 if allowed else 0,
		"allowed": sorted(allowed - {SENTINEL_REPORT}),
		"reachable": _reachable_reports(user_roles),
		"sentinel": SENTINEL_REPORT,
	}


@frappe.whitelist()
def set_report_access(user, restricted, reports):
	"""Restrict a user to `reports`, or lift the restriction entirely.

	restricted=0 -> delete every Report User Permission (back to role-only access).
	restricted=1 -> keep exactly `reports` + the sentinel. An empty selection
	                therefore means "no reports", which an empty User Permission
	                set could never express.
	"""
	_assert_access()
	scope = _scope()
	_assert_can_manage(user, scope)
	if not scope["caps"]["pages_reports"]:
		frappe.throw(_("You are not allowed to view report access."), frappe.PermissionError)
	if not scope["caps"]["user_permissions"]:
		frappe.throw(_("You are not allowed to edit user permissions."), frappe.PermissionError)

	existing = {
		u.for_value: u.name
		for u in frappe.get_all(
			"User Permission", filters={"user": user, "allow": "Report"}, fields=["name", "for_value"]
		)
	}

	if not cint(restricted):
		for name in existing.values():
			frappe.delete_doc("User Permission", name, ignore_permissions=True)
		frappe.msgprint(_("{0} can now open any report their roles allow.").format(user), alert=True, indicator="green")
		return {"ok": 1, "restricted": 0}

	selected = {r for r in _loads(reports) if frappe.db.exists("Report", r)}
	final = selected | {SENTINEL_REPORT}

	for value in final - set(existing):
		frappe.get_doc({
			"doctype": "User Permission",
			"user": user,
			"allow": "Report",
			"for_value": value,
			"apply_to_all_doctypes": 1,
		}).insert(ignore_permissions=True)

	for value, name in existing.items():
		if value not in final:
			frappe.delete_doc("User Permission", name, ignore_permissions=True)

	frappe.msgprint(
		_("{0} is now restricted to {1} report(s).").format(user, len(selected)),
		alert=True, indicator="green",
	)
	return {"ok": 1, "restricted": 1, "count": len(selected)}


# --------------------------------------------------------------------------- #
# User logs (read-only audit timeline)
# --------------------------------------------------------------------------- #
# Four separate frappe logs, merged into one timeline. Note the ownership column
# differs: Activity/Access/Route History carry an explicit `user`, while Version
# only records `owner` - getting that wrong would silently show the wrong
# person's history.
LOG_KINDS = ("logins", "changes", "exports", "pages")
LOG_PERIODS = {"1d": 1, "7d": 7, "30d": 30, "90d": 90, "all": None}
LOG_MAX = 200


def _log_from_date(period):
	days = LOG_PERIODS.get(period, 30)
	if days is None:
		return None
	return add_days(nowdate(), -days)


def _clean(text):
	"""Activity Log subjects contain markup - flatten it for display."""
	return strip_html(text or "").strip()


@frappe.whitelist()
def get_user_logs(user, kinds=None, period="30d", search=None, limit=100):
	"""A merged, read-only activity timeline for one managed user."""
	_assert_access()
	scope = _scope()
	_assert_can_manage(user, scope)
	if not scope["caps"]["logs"]:
		frappe.throw(_("You are not allowed to view user logs."), frappe.PermissionError)

	# `kinds` omitted means "all"; an explicit empty list means "none". Falling
	# back on falsiness would turn "show me nothing" into "show me everything".
	requested = None if kinds in (None, "") else _loads(kinds)
	wanted = set(LOG_KINDS) if requested is None else (set(requested) & set(LOG_KINDS))
	if not wanted:
		return {"rows": [], "truncated": 0}

	frm = _log_from_date(period)
	limit = min(cint(limit) or 100, LOG_MAX)
	term = (search or "").strip()
	# Per-source cap: fetch enough of each to fill `limit` after merging.
	each = limit

	def date_filter(field="creation"):
		return {field: [">=", frm]} if frm else {}

	rows = []

	if "logins" in wanted:
		f = {"user": user}
		f.update(date_filter())
		for r in frappe.get_all(
			"Activity Log", filters=f, order_by="creation desc", limit=each,
			fields=["creation", "operation", "status", "subject", "reference_doctype", "reference_name"],
		):
			op = r.operation or _("Activity")
			rows.append({
				"when": str(r.creation),
				"kind": "logins",
				"title": op,
				"detail": _clean(r.subject) or " ".join(filter(None, [r.reference_doctype, r.reference_name])),
				"status": r.status or "",
				# Failed logins are the reason anyone opens this section.
				"level": "danger" if (r.status or "").lower() == "failed" else "",
			})

	if "changes" in wanted:
		f = {"owner": user}  # Version has no `user` column
		f.update(date_filter())
		for r in frappe.get_all(
			"Version", filters=f, order_by="creation desc", limit=each,
			fields=["creation", "ref_doctype", "docname"],
		):
			rows.append({
				"when": str(r.creation), "kind": "changes",
				"title": _("Modified {0}").format(r.ref_doctype),
				"detail": r.docname, "status": "", "level": "",
			})

	if "exports" in wanted:
		f = {"user": user}
		f.update(date_filter())
		for r in frappe.get_all(
			"Access Log", filters=f, order_by="creation desc", limit=each,
			fields=["creation", "export_from", "reference_document", "file_type", "method", "report_name"],
		):
			what = r.report_name or r.export_from or r.reference_document or ""
			rows.append({
				"when": str(r.creation), "kind": "exports",
				"title": r.method or _("Access"),
				"detail": " ".join(filter(None, [what, f"({r.file_type})" if r.file_type else ""])).strip(),
				"status": "",
				# Data leaving the system is worth flagging.
				"level": "warn" if (r.method or "") in ("Export", "PDF") else "",
			})

	if "pages" in wanted:
		f = {"user": user}
		f.update(date_filter())
		for r in frappe.get_all(
			"Route History", filters=f, order_by="creation desc", limit=each,
			fields=["creation", "route"],
		):
			rows.append({
				"when": str(r.creation), "kind": "pages",
				"title": _("Visited"), "detail": r.route, "status": "", "level": "",
			})

	if term:
		low = term.lower()
		rows = [r for r in rows if low in (r["title"] or "").lower()
				or low in (r["detail"] or "").lower() or low in (r["status"] or "").lower()]

	rows.sort(key=lambda r: r["when"], reverse=True)
	return {"rows": rows[:limit], "truncated": 1 if len(rows) > limit else 0}


# --------------------------------------------------------------------------- #
# Enable / disable an account
# --------------------------------------------------------------------------- #
@frappe.whitelist()
def set_user_enabled(user, enabled):
	"""Switch a managed user's account on or off.

	Saves the User doc rather than writing the field directly, so frappe's own
	check_enable_disable() still runs: it refuses to disable the last System
	Manager, clears the user's sessions, and toggles their notifications.
	"""
	_assert_access()
	scope = _scope()
	_assert_can_manage(user, scope)
	if not scope["caps"]["enable_disable"]:
		frappe.throw(_("You are not allowed to enable or disable users."), frappe.PermissionError)

	enabled = cint(enabled)
	# Locking yourself out is not recoverable from this page.
	if not enabled and user == frappe.session.user:
		frappe.throw(_("You cannot disable your own account."))

	ud = frappe.get_doc("User", user)
	if cint(ud.enabled) == enabled:
		return {"ok": 1, "enabled": enabled}

	ud.enabled = enabled
	ud.save(ignore_permissions=True)

	ud.add_comment(
		"Comment",
		_("Account {0} by {1} via Permission Manager.").format(
			_("enabled") if enabled else _("disabled"), frappe.session.user
		),
	)
	frappe.msgprint(
		_("{0} has been {1}.").format(user, _("enabled") if enabled else _("disabled")),
		alert=True, indicator="green" if enabled else "orange",
	)
	return {"ok": 1, "enabled": enabled}


# --------------------------------------------------------------------------- #
# Password reset
# --------------------------------------------------------------------------- #
# Characters that survive being read aloud or copied by hand: no 0/O, 1/l/I.
_PWD_LOWER = "abcdefghijkmnopqrstuvwxyz"
_PWD_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_PWD_DIGITS = "23456789"
_PWD_SYMBOLS = "!@#$%&*?"

# Sentinel date that makes frappe.auth force the /update-password flow at the
# next login (see LoginManager.force_user_to_reset_password).
_PASSWORD_EXPIRED_DATE = "1970-01-01"


def _generate_password(length=14):
	"""A random password with at least one character from each class."""
	pools = [_PWD_LOWER, _PWD_UPPER, _PWD_DIGITS, _PWD_SYMBOLS]
	chars = [secrets.choice(p) for p in pools]
	everything = "".join(pools)
	chars += [secrets.choice(everything) for _ in range(length - len(chars))]
	secrets.SystemRandom().shuffle(chars)
	return "".join(chars)


@frappe.whitelist()
def reset_user_password(user):
	"""Set a random password for a managed user and force them to change it at
	their next login. Returns the generated password once - it is never stored
	in readable form, so it cannot be retrieved again."""
	_assert_access()
	scope = _scope()
	_assert_can_manage(user, scope)
	if not scope["caps"]["reset_password"]:
		frappe.throw(_("You are not allowed to reset passwords."), frappe.PermissionError)
	if user == frappe.session.user:
		frappe.throw(_("Use My Settings to change your own password."))

	password = _generate_password()
	# Bypasses User.password_strength_test: the generated password is strong by
	# construction, and the user picks their own at the next login anyway.
	_update_password(user=user, pwd=password, logout_all_sessions=True)

	frappe.db.set_value(
		"User",
		user,
		{"last_password_reset_date": _PASSWORD_EXPIRED_DATE, "reset_password_key": ""},
		update_modified=False,
	)

	# An account locked by failed attempts stays locked otherwise.
	from frappe.utils.password import delete_login_failed_cache

	delete_login_failed_cache(user)

	frappe.get_doc("User", user).add_comment(
		"Comment", _("Password reset by {0} via Permission Manager.").format(frappe.session.user)
	)

	# Without a non-zero policy, frappe never expires the password and the forced
	# change at next login silently does not happen.
	forced = cint(frappe.db.get_single_value("System Settings", "force_user_to_reset_password")) > 0

	return {"ok": 1, "user": user, "password": password, "forced_change": 1 if forced else 0}


# --------------------------------------------------------------------------- #
# Delegation management (System Manager / admin only)
# --------------------------------------------------------------------------- #
def _assert_admin():
	if not _is_admin():
		frappe.throw(_("Only System Managers can configure delegations."), frappe.PermissionError)


@frappe.whitelist()
def list_delegations():
	_assert_admin()
	out = []
	for name in frappe.get_all(DELEGATION_DOCTYPE, pluck="name", order_by="modified desc"):
		d = frappe.get_doc(DELEGATION_DOCTYPE, name)
		out.append({
			"name": d.name,
			"manager": d.manager,
			"manager_name": frappe.db.get_value("User", d.manager, "full_name") or d.manager,
			"enabled": cint(d.enabled),
			"all_users": cint(d.all_users),
			"users_count": len(d.allowed_users or []),
			"all_roles": cint(d.all_roles),
			"roles_count": len(d.allowed_roles or []),
			"all_modules": cint(d.all_modules),
			"modules_count": len(d.allowed_modules or []),
			"has_role": 1 if MANAGER_ROLE in frappe.get_roles(d.manager) else 0,
		})
	return out


@frappe.whitelist()
def get_delegation(name):
	_assert_admin()
	d = frappe.get_doc(DELEGATION_DOCTYPE, name)
	return {
		"name": d.name,
		"manager": d.manager,
		"enabled": cint(d.enabled),
		"description": d.description,
		"can_edit_roles": cint(d.can_edit_roles),
		"can_edit_user_permissions": cint(d.can_edit_user_permissions),
		"can_edit_modules": cint(d.can_edit_modules),
		"can_view_pages_reports": cint(d.can_view_pages_reports),
		"can_reset_password": cint(d.can_reset_password),
		"can_enable_disable": cint(d.can_enable_disable),
		"can_view_logs": cint(d.can_view_logs),
		"all_users": cint(d.all_users),
		"all_roles": cint(d.all_roles),
		"all_modules": cint(d.all_modules),
		"allowed_users": [r.user for r in (d.allowed_users or [])],
		"allowed_roles": [r.role for r in (d.allowed_roles or [])],
		"allowed_modules": [r.module for r in (d.allowed_modules or [])],
	}


@frappe.whitelist()
def save_delegation(payload):
	_assert_admin()
	data = _loads(payload)
	manager = data.get("manager")
	if not manager:
		frappe.throw(_("Manager is required."))

	existing = frappe.db.get_value(DELEGATION_DOCTYPE, {"manager": manager})
	d = frappe.get_doc(DELEGATION_DOCTYPE, existing) if existing else frappe.new_doc(DELEGATION_DOCTYPE)
	d.manager = manager
	d.enabled = cint(data.get("enabled", 1))
	d.description = data.get("description")
	d.can_edit_roles = cint(data.get("can_edit_roles", 1))
	d.can_edit_user_permissions = cint(data.get("can_edit_user_permissions", 1))
	d.can_edit_modules = cint(data.get("can_edit_modules", 1))
	d.can_view_pages_reports = cint(data.get("can_view_pages_reports", 1))
	d.can_reset_password = cint(data.get("can_reset_password", 0))
	d.can_enable_disable = cint(data.get("can_enable_disable", 0))
	d.can_view_logs = cint(data.get("can_view_logs", 0))
	d.all_users = cint(data.get("all_users", 0))
	d.all_roles = cint(data.get("all_roles", 0))
	d.all_modules = cint(data.get("all_modules", 0))

	d.set("allowed_users", [])
	for u in data.get("allowed_users") or []:
		d.append("allowed_users", {"user": u})
	d.set("allowed_roles", [])
	for r in data.get("allowed_roles") or []:
		if r not in PROTECTED_ROLES:
			d.append("allowed_roles", {"role": r})
	d.set("allowed_modules", [])
	for m in data.get("allowed_modules") or []:
		d.append("allowed_modules", {"module": m})

	d.save(ignore_permissions=True)

	# Convenience: ensure the manager actually has the role so they can open the app.
	if cint(data.get("grant_role", 1)) and MANAGER_ROLE not in frappe.get_roles(manager):
		mu = frappe.get_doc("User", manager)
		mu.append("roles", {"role": MANAGER_ROLE})
		mu.save(ignore_permissions=True)

	return {"ok": 1, "name": d.name}


@frappe.whitelist()
def delete_delegation(name):
	_assert_admin()
	frappe.delete_doc(DELEGATION_DOCTYPE, name, ignore_permissions=True)
	return {"ok": 1}


@frappe.whitelist()
def get_pickers():
	"""Lists for the delegation editor (admin only)."""
	_assert_admin()
	roles = [
		r.name for r in frappe.get_all("Role", filters={"disabled": 0}, fields=["name"], order_by="name asc")
		if r.name not in PROTECTED_ROLES
	]
	modules = [m.name for m in frappe.get_all("Module Def", fields=["name"], order_by="name asc")]
	users = _real_users()
	return {"roles": roles, "modules": modules, "users": users}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _loads(value):
	if isinstance(value, (list, dict)):
		return value
	if value in (None, ""):
		return []
	return json.loads(value)
