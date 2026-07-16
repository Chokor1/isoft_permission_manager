from . import __version__ as app_version

app_name = "isoft_permission_manager"
app_title = "Isoft Permission Manager"
app_publisher = "Isoft"
app_description = "Delegated permission management for Frappe/ERPNext"
app_icon = "fa fa-shield"
app_color = "red"
app_email = "abbasschokor225@gmail.com"
app_license = "MIT"

# Navbar shortcut icon to the Permission Manager (shown only to allowed users).
# ?v= is a cache buster: browsers keep this file (served without Cache-Control)
# and the desk is an SPA, so a stale copy survives normal reloads. Bump the
# number whenever ipm_icon.js changes.
app_include_js = "/assets/isoft_permission_manager/js/ipm_icon.js?v=2"

# Enforce the per-user report allowlist. Frappe checks roles only, so without
# this a User Permission on Report merely hides the report from list views while
# leaving it runnable. See overrides/report.py.
override_doctype_class = {
	"Report": "isoft_permission_manager.overrides.report.IPMReport",
	"Page": "isoft_permission_manager.overrides.page.IPMPage",
}

# Fixtures
# --------
# Ship the dedicated role so it exists on fresh installs.
fixtures = [
	{
		"doctype": "Role",
		"filters": [["role_name", "=", "ISOFT Permission Manager"]],
	},
]
