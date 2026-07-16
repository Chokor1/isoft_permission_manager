// Isoft Permission Manager navbar icon - shortcut to the Permission Manager.
// Shown only to users who may access it (System Managers / delegated managers).
//
// This file loads on every desk page via app_include_js, where the app's own
// stylesheet is not present - so it carries its own styles and takes the accent
// colours from the server rather than reading --ipm-* variables that only exist
// once the Permission Manager page itself has been opened.
(function () {
	'use strict';

	const FALLBACK = { p: '#dc2626', d: '#991b1b', a: '#ef4444' };

	function paint(palette) {
		const t = palette || FALLBACK;
		const el = document.documentElement;
		el.style.setProperty('--ipm-nav-a', t.a);
		el.style.setProperty('--ipm-nav-p', t.p);
		el.style.setProperty('--ipm-nav-d', t.d);
	}

	function injectStyles() {
		if (document.getElementById('ipm-icon-styles')) return;
		$('head').append(`
			<style id="ipm-icon-styles">
				.ipm-nav-item { margin-right: 8px; display: flex; align-items: center; }
				.ipm-nav-button {
					display: flex; align-items: center; justify-content: center;
					width: 40px; height: 40px; border-radius: 12px; cursor: pointer;
					background: linear-gradient(135deg, var(--ipm-nav-a, #ef4444) 0%, var(--ipm-nav-p, #dc2626) 55%, var(--ipm-nav-d, #991b1b) 100%);
					color: #fff; text-decoration: none;
					box-shadow: 0 3px 10px rgba(0,0,0,.22), inset 0 0 0 1px rgba(255,255,255,.14);
					transition: transform .22s cubic-bezier(.34,1.56,.64,1), box-shadow .22s cubic-bezier(.4,0,.2,1);
					position: relative; overflow: hidden;
				}
				.ipm-nav-button:hover {
					color: #fff; text-decoration: none;
					transform: translateY(-2px) scale(1.06);
					box-shadow: 0 6px 18px rgba(0,0,0,.30), inset 0 0 0 1px rgba(255,255,255,.24);
				}
				.ipm-nav-button:active { transform: translateY(0) scale(.96); }
				.ipm-nav-button i { color: #fff; font-size: 17px; line-height: 1; text-shadow: 0 1px 2px rgba(0,0,0,.25); }
				/* Sheen sweep, matching the app's own brand mark. */
				.ipm-nav-button::before {
					content: ''; position: absolute; top: 0; left: -100%; width: 100%; height: 100%;
					background: linear-gradient(90deg, transparent, rgba(255,255,255,.32), transparent);
					transition: left .55s cubic-bezier(.4,0,.2,1);
				}
				.ipm-nav-button:hover::before { left: 100%; }
				@media (max-width: 768px) { .ipm-nav-button { width: 36px; height: 36px; border-radius: 10px; } .ipm-nav-button i { font-size: 15px; } }
				@media (prefers-reduced-motion: reduce) {
					.ipm-nav-button, .ipm-nav-button::before { transition: none !important; }
					.ipm-nav-button:hover { transform: none !important; }
				}
			</style>`);
	}

	function initIcon() {
		if (document.getElementById('ipm-navbar')) return;
		frappe.call({
			method: 'isoft_permission_manager.isoft_permission_manager.utils.get_navbar_info',
			callback: function (r) {
				const info = r && r.message;
				if (!info || !info.can_access) return;
				if (document.getElementById('ipm-navbar')) return;

				injectStyles();
				paint(info.palette);

				const icon = `
					<li class='nav-item dropdown ipm-nav-item' title="Isoft Permission Manager" aria-label="Permission Manager">
						<a href="/app/isoft-permission-manager" class="ipm-nav-button" id="ipm-navbar" target="_blank" rel="noopener"
							onclick="window.open('/app/isoft-permission-manager', '_blank'); return false;">
							<i class="fa fa-shield"></i>
						</a>
					</li>`;
				const $list = $('header.navbar > .container > .navbar-collapse > ul');
				if ($list.length) $list.prepend(icon);
			}
		});
	}

	if (typeof frappe !== 'undefined' && frappe.user) {
		$(document).ready(initIcon);
	} else {
		$(document).on('frappe:ready', initIcon);
	}
})();
