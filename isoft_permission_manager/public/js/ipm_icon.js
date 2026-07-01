// Isoft Permission Manager navbar icon - shortcut to the Permission Manager.
// Shown only to users who may access it (System Managers / delegated managers).
(function () {
	'use strict';

	function initIcon() {
		if (document.getElementById('ipm-navbar')) return;
		frappe.call({
			method: 'isoft_permission_manager.isoft_permission_manager.utils.can_access',
			callback: function (r) {
				if (!r || !r.message) return;
				if (document.getElementById('ipm-navbar')) return;

				const icon = `
					<li class='nav-item dropdown ipm-nav-item' title="Isoft Permission Manager" aria-label="Permission Manager">
						<a href="/app/isoft-permission-manager" class="ipm-nav-button" id="ipm-navbar" target="_blank" rel="noopener"
							onclick="window.open('/app/isoft-permission-manager', '_blank'); return false;">
							<i class="fa fa-lock"></i>
						</a>
					</li>`;
				const $list = $('header.navbar > .container > .navbar-collapse > ul');
				if ($list.length) $list.prepend(icon);

				if (!document.getElementById('ipm-icon-styles')) {
					$('head').append(`
						<style id="ipm-icon-styles">
							.ipm-nav-item { margin-right: 8px; display: flex; align-items: center; }
							.ipm-nav-button {
								display: flex; align-items: center; justify-content: center;
								width: 40px; height: 40px; border-radius: 50%; cursor: pointer;
								background: linear-gradient(135deg, #f87171 0%, #b91c1c 55%, #7f1d1d 100%);
								color: #fff; text-decoration: none;
								box-shadow: 0 2px 8px rgba(153,27,27,0.45), inset 0 0 0 1px rgba(255,255,255,0.12);
								transition: all 0.25s ease; position: relative; overflow: hidden;
							}
							.ipm-nav-button:hover {
								background: linear-gradient(135deg, #ef4444 0%, #991b1b 60%, #7f1d1d 100%);
								color: #fff; text-decoration: none;
								transform: translateY(-2px) scale(1.05);
								box-shadow: 0 4px 16px rgba(153,27,27,0.55), inset 0 0 0 1px rgba(255,255,255,0.2);
							}
							.ipm-nav-button:active { transform: translateY(0) scale(0.98); }
							.ipm-nav-button i { color: #fff; font-size: 18px; line-height: 1; text-shadow: 0 1px 2px rgba(0,0,0,0.25); }
							.ipm-nav-button::before {
								content: ''; position: absolute; top: 0; left: -100%;
								width: 100%; height: 100%;
								background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
								transition: left 0.5s;
							}
							.ipm-nav-button:hover::before { left: 100%; }
							@media (max-width: 768px) { .ipm-nav-button { width: 36px; height: 36px; } .ipm-nav-button i { font-size: 16px; } }
						</style>`);
				}
			}
		});
	}

	if (typeof frappe !== 'undefined' && frappe.user) {
		$(document).ready(initIcon);
	} else {
		$(document).on('frappe:ready', initIcon);
	}
})();
