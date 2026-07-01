from . import __version__ as app_version

app_name = "isoft_permission_manager"
app_title = "Isoft Permission Manager"
app_publisher = "Isoft"
app_description = "Delegated permission management for Frappe/ERPNext"
app_icon = "fa fa-lock"
app_color = "red"
app_email = "abbasschokor225@gmail.com"
app_license = "MIT"

# Navbar shortcut icon to the Permission Manager (shown only to allowed users).
app_include_js = "/assets/isoft_permission_manager/js/ipm_icon.js"

# Fixtures
# --------
# Ship the dedicated role so it exists on fresh installs.
fixtures = [
	{
		"doctype": "Role",
		"filters": [["role_name", "=", "ISOFT Permission Manager"]],
	},
]
