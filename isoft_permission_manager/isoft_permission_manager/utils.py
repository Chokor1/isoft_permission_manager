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

import frappe
from frappe import _
from frappe.utils import cint

SETTINGS_DOCTYPE = "ISOFT Permission Manager Settings"
DELEGATION_DOCTYPE = "ISOFT Permission Delegation"
MANAGER_ROLE = "ISOFT Permission Manager"

# Roles that must never be granted/revoked or used as a management target through
# this tool. Protects against privilege escalation and self-lockout.
PROTECTED_ROLES = {"System Manager", "Administrator", "All", "Guest"}
# Users that are never management targets.
PROTECTED_USERS = {"Administrator", "Guest"}


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
			"caps": {"roles": 1, "user_permissions": 1, "modules": 1, "pages_reports": 1},
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
	"""All enabled, non-internal users."""
	users = frappe.get_all(
		"User",
		filters={"enabled": 1},
		fields=["name", "full_name", "user_type", "last_login"],
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
	}

	# View-only: doctype access, pages, reports (derived from roles).
	overview.update(_access_summary(user_roles))
	return overview


def _access_summary(user_roles):
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
