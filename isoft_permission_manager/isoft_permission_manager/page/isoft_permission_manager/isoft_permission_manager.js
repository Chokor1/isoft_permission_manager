// Isoft Permission Manager - delegated permission management SPA shell.
// Builds a toolbar + tab router and lazy-loads view components. Shared helpers
// (api, esc) and state (bootstrap, is_admin) are exposed on `ipm.app`.

frappe.provide('ipm');
frappe.provide('ipm.views');

ipm.METHOD = 'isoft_permission_manager.isoft_permission_manager.utils.';

ipm.THEMES = {
	Red:    { p: '#dc2626', d: '#991b1b', a: '#ef4444' },
	Blue:   { p: '#2563eb', d: '#1e40af', a: '#3b82f6' },
	Green:  { p: '#059669', d: '#047857', a: '#10b981' },
	Purple: { p: '#7c3aed', d: '#5b21b6', a: '#8b5cf6' },
	Orange: { p: '#ea580c', d: '#c2410c', a: '#f97316' },
	Slate:  { p: '#475569', d: '#334155', a: '#64748b' },
	Dark:   { p: '#0f172a', d: '#020617', a: '#334155' }
};

// admin: only visible to System Managers.
ipm.VIEWS = [
	{ key: 'users',    label: 'Permissions', icon: 'fa-user-shield', file: 'users',    admin: false },
	{ key: 'managers', label: 'Managers',    icon: 'fa-users-cog',   file: 'managers', admin: true }
];

ipm.apply_chrome = function () {
	const route = (frappe.get_route_str && frappe.get_route_str()) || '';
	const standalone = route.indexOf('isoft-permission-manager') !== -1;
	const $chrome = $('header.navbar, .navbar.sticky-top, .navbar.navbar-default.navbar-fixed-top, .navbar-expand-lg, .page-head');
	if (standalone) {
		$chrome.hide();
		$('.layout-main-section-wrapper').css('margin-top', '0');
		$('.page-container').css('padding-top', '0');
	} else {
		$chrome.show();
		$('.layout-main-section-wrapper').css('margin-top', '');
		$('.page-container').css('padding-top', '');
	}
};

frappe.pages['isoft-permission-manager'].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: 'Isoft Permission Manager', single_column: true });
	ipm.app = new ipm.App(wrapper, page);

	ipm.apply_chrome();
	[100, 400, 900].forEach((t) => setTimeout(ipm.apply_chrome, t));
	if (!ipm._chrome_bound) {
		ipm._chrome_bound = true;
		$(window).on('hashchange', ipm.apply_chrome);
	}
};

frappe.pages['isoft-permission-manager'].on_page_show = function () {
	ipm.apply_chrome();
	if (ipm.app && ipm.app.ready) ipm.app.reload();
};

frappe.pages['isoft-permission-manager'].on_page_hide = function () {
	$('header.navbar, .navbar.sticky-top, .navbar.navbar-default.navbar-fixed-top, .navbar-expand-lg, .page-head').show();
	$('.layout-main-section-wrapper').css('margin-top', '');
	$('.page-container').css('padding-top', '');
};

ipm.App = class App {
	constructor(wrapper, page) {
		this.wrapper = wrapper;
		this.page = page;
		this.ready = false;
		$(wrapper).find('.page-body').addClass('full-width');
		this.state = { settings: {}, bootstrap: {}, is_admin: 0, active_view: 'users' };
		this.inject_styles();
		this.build_shell();
		this.boot();
	}

	api(method, args) {
		return new Promise((resolve, reject) => {
			frappe.call({
				method: ipm.METHOD + method,
				args: args || {},
				callback: (r) => resolve(r.message),
				error: (e) => reject(e)
			});
		});
	}

	esc(s) { return frappe.utils.escape_html(s == null ? '' : String(s)); }

	$content() { return this.page.main.find('#ipm-content'); }

	boot() {
		this.api('get_settings').then((s) => {
			this.state.settings = s || {};
			this.state.is_admin = s && s.is_admin ? 1 : 0;
			this.apply_theme((s && s.theme_color) || 'Red');
			if (!s || !s.can_access) { this.show_lock(); return; }
			return this.api('get_bootstrap').then((b) => {
				this.state.bootstrap = b || {};
				this.build_tabs();
				this.ready = true;
				this.set_view(this.state.active_view);
			});
		}).catch(() => this.show_lock('Unable to load the Permission Manager.'));
	}

	apply_theme(name) {
		const t = ipm.THEMES[name] || ipm.THEMES.Red;
		const root = this.page.main.find('.ipm-root')[0];
		if (root) {
			root.style.setProperty('--ipm-primary', t.p);
			root.style.setProperty('--ipm-primary-dark', t.d);
			root.style.setProperty('--ipm-accent', t.a);
		}
	}

	build_shell() {
		this.page.main.html(`
			<div class="ipm-root">
				<div class="ipm-bar">
					<div class="ipm-brand">
						<span class="ipm-brand-logo"><i class="fa fa-lock"></i></span>
						<span class="ipm-brand-meta">
							<span class="ipm-brand-name">Permission Manager</span>
							<span class="ipm-brand-tag">Delegated Access Control</span>
						</span>
					</div>
					<div class="ipm-tabs"></div>
					<div class="ipm-filters">
						<button class="btn btn-default ipm-refresh ipm-fs" id="ipm-fs" title="Fullscreen"><i class="fa fa-arrows-alt"></i></button>
						<button class="btn btn-default ipm-refresh" id="ipm-refresh" title="Refresh"><i class="fa fa-refresh"></i></button>
					</div>
				</div>
				<div id="ipm-content"><div class="ipm-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div></div>
				<div class="ipm-lock" id="ipm-lock" style="display:none;">
					<div class="ipm-lock-box">
						<i class="fa fa-lock"></i>
						<h3>Access restricted</h3>
						<p id="ipm-lock-msg">You don't have permission to use the Permission Manager. Ask a System Manager to grant you a delegation.</p>
					</div>
				</div>
			</div>
		`);
		const me = this;
		this.page.main.find('#ipm-refresh').on('click', () => me.reload());
		this.page.main.find('#ipm-fs').on('click', () => me.toggle_fullscreen());
		$(document).off('fullscreenchange.ipm webkitfullscreenchange.ipm')
			.on('fullscreenchange.ipm webkitfullscreenchange.ipm', () => me.on_fs_change());
	}

	toggle_fullscreen() {
		const el = document.documentElement;
		const isFs = document.fullscreenElement || document.webkitFullscreenElement;
		if (!isFs) {
			const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
			if (req) req.call(el);
		} else {
			const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
			if (exit) exit.call(document);
		}
	}

	on_fs_change() {
		const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
		this.page.main.find('.ipm-root').toggleClass('ipm-maximized', active);
		this.page.main.find('#ipm-fs i').toggleClass('fa-arrows-alt', !active).toggleClass('fa-compress', active);
		setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
	}

	build_tabs() {
		const views = ipm.VIEWS.filter((v) => !v.admin || this.state.is_admin);
		const tabs = views.map((v) => `
			<button class="ipm-tab" data-view="${v.key}"><i class="fa ${v.icon}"></i> ${v.label}</button>`).join('');
		this.page.main.find('.ipm-tabs').html(tabs);
		const me = this;
		this.page.main.find('.ipm-tab').on('click', function () { me.set_view($(this).data('view')); });
	}

	show_lock(msg) {
		this.page.main.find('#ipm-content').hide();
		this.page.main.find('.ipm-tabs, .ipm-filters').css('visibility', 'hidden');
		if (msg) this.page.main.find('#ipm-lock-msg').text(msg);
		this.page.main.find('#ipm-lock').show();
	}

	set_view(key) {
		const views = ipm.VIEWS.filter((v) => !v.admin || this.state.is_admin);
		const view = views.find((v) => v.key === key) || views[0];
		if (!view) return;
		this.state.active_view = view.key;
		this.page.main.find('.ipm-tab').removeClass('active');
		this.page.main.find(`.ipm-tab[data-view="${view.key}"]`).addClass('active');

		const $c = this.$content();
		$c.html('<div class="ipm-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');
		const url = `/assets/isoft_permission_manager/js/components/${view.file}.js`;
		frappe.require(url, () => {
			const fn = ipm.views[view.key];
			if (typeof fn !== 'function') { $c.html('<div class="ipm-empty">View not available.</div>'); return; }
			try { fn(this.ctx()); }
			catch (e) { console.error('IPM view error', e); $c.html('<div class="ipm-empty">Something went wrong rendering this view.</div>'); }
		});
	}

	reload() {
		if (!this.ready) return;
		this.api('get_bootstrap').then((b) => { this.state.bootstrap = b || {}; this.set_view(this.state.active_view); });
	}

	ctx() {
		return {
			app: this,
			state: this.state,
			$content: this.$content(),
			api: this.api.bind(this),
			esc: this.esc.bind(this),
			is_admin: this.state.is_admin,
			bootstrap: this.state.bootstrap
		};
	}

	inject_styles() {
		if (document.getElementById('isoft-pm-styles')) return;
		const css = `
		<style id="isoft-pm-styles">
		.ipm-root {
			--ipm-primary: #dc2626; --ipm-primary-dark: #991b1b; --ipm-accent: #ef4444;
			--ipm-bg: #f6f8fb; --ipm-card: #ffffff; --ipm-border: #e6eaf0; --ipm-text: #1f2937; --ipm-muted: #6b7280;
			color: var(--ipm-text); padding-bottom: 40px;
		}
		.ipm-bar {
			display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
			position: sticky; top: 0; z-index: 30; margin-top: 10px;
			background: rgba(255,255,255,0.9); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
			border: 1px solid var(--ipm-border); border-radius: 14px; padding: 9px 14px; margin-bottom: 18px;
			box-shadow: 0 6px 22px rgba(17,24,39,0.07);
		}
		.ipm-brand { display: flex; align-items: center; gap: 10px; padding-right: 14px; border-right: 1px solid var(--ipm-border); }
		.ipm-brand-logo {
			width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
			color: #fff; font-size: 16px; background: linear-gradient(135deg, var(--ipm-primary), var(--ipm-accent));
			box-shadow: 0 4px 11px rgba(220,38,38,0.4);
		}
		.ipm-brand-meta { display: flex; flex-direction: column; line-height: 1.15; }
		.ipm-brand-name { font-weight: 800; font-size: 14px; color: var(--ipm-text); white-space: nowrap; }
		.ipm-brand-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: var(--ipm-muted); }
		.ipm-tabs { display: flex; gap: 6px; flex-wrap: wrap; flex: 1 1 auto; }
		.ipm-filters { display: flex; align-items: center; gap: 8px; }
		.ipm-tab {
			border: 1px solid var(--ipm-border); background: var(--ipm-card); color: var(--ipm-muted);
			border-radius: 9px; padding: 7px 14px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all .15s ease;
		}
		.ipm-tab i { margin-right: 6px; }
		.ipm-tab:hover { color: var(--ipm-primary); border-color: var(--ipm-accent); transform: translateY(-1px); }
		.ipm-tab.active { background: var(--ipm-primary); color: #fff; border-color: var(--ipm-primary); box-shadow: 0 6px 16px rgba(220,38,38,0.3); }
		.ipm-refresh { border: 1px solid var(--ipm-border) !important; border-radius: 9px !important; height: 34px; }

		/* Fullscreen / maximized mode */
		.ipm-root.ipm-maximized { position: fixed; inset: 0; z-index: 1050; overflow: auto; background: var(--ipm-bg); padding: 14px 22px; }
		.ipm-root.ipm-maximized .ipm-bar { top: 0; }

		.ipm-card { background: var(--ipm-card); border: 1px solid var(--ipm-border); border-radius: 14px; padding: 18px; box-shadow: 0 4px 14px rgba(17,24,39,0.04); margin-bottom: 18px; }
		.ipm-card-title { font-size: 15px; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
		.ipm-card-title .ipm-pill { margin-left: auto; font-size: 11px; font-weight: 600; color: var(--ipm-muted); background: var(--ipm-bg); padding: 3px 9px; border-radius: 20px; }

		.ipm-input { width: auto; min-width: 120px; border: 1px solid var(--ipm-border) !important; border-radius: 9px !important; height: 34px; background: var(--ipm-card); color: var(--ipm-text); }
		.ipm-search { min-width: 220px !important; }

		.ipm-layout { display: grid; grid-template-columns: 300px 1fr; gap: 16px; align-items: start; }
		@media (max-width: 820px) { .ipm-layout { grid-template-columns: 1fr; } }
		.ipm-userlist { max-height: 70vh; overflow: auto; }
		.ipm-user { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 10px; cursor: pointer; border: 1px solid transparent; }
		.ipm-user:hover { background: var(--ipm-bg); }
		.ipm-user.active { background: rgba(220,38,38,0.10); border-color: var(--ipm-accent); }
		.ipm-avatar { width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, var(--ipm-primary), var(--ipm-accent)); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; flex: 0 0 auto; }
		.ipm-user-meta { display: flex; flex-direction: column; line-height: 1.2; overflow: hidden; }
		.ipm-user-name { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.ipm-user-email { font-size: 11px; color: var(--ipm-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

		.ipm-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.ipm-table th { text-align: left; color: var(--ipm-muted); font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: .5px; padding: 9px 10px; border-bottom: 2px solid var(--ipm-border); }
		.ipm-table td { padding: 9px 10px; border-bottom: 1px solid var(--ipm-border); }
		.ipm-table tbody tr:hover { background: var(--ipm-bg); }
		.ipm-num { text-align: right; }

		.ipm-chips { display: flex; flex-wrap: wrap; gap: 8px; }
		.ipm-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; border: 1px solid var(--ipm-border); border-radius: 20px; padding: 5px 12px; cursor: pointer; transition: all .15s ease; background: var(--ipm-card); user-select: none; }
		.ipm-chip:hover { border-color: var(--ipm-accent); }
		.ipm-chip.on { background: var(--ipm-primary); color: #fff; border-color: var(--ipm-primary); }
		.ipm-chip .fa { font-size: 11px; opacity: .8; }

		.ipm-section { margin-bottom: 18px; }
		.ipm-section h4 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--ipm-muted); margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
		.ipm-section h4 .ipm-count { background: var(--ipm-bg); border-radius: 20px; padding: 1px 9px; font-size: 11px; }
		.ipm-readonly-note { font-size: 11px; color: var(--ipm-muted); font-weight: 500; margin-left: auto; text-transform: none; letter-spacing: 0; }

		.ipm-btn { border: 1px solid var(--ipm-border); background: var(--ipm-card); color: var(--ipm-text); border-radius: 9px; padding: 7px 14px; font-weight: 600; font-size: 13px; cursor: pointer; }
		.ipm-btn-primary { background: var(--ipm-primary); color: #fff; border-color: var(--ipm-primary); }
		.ipm-btn-primary:hover { background: var(--ipm-primary-dark); }
		.ipm-btn[disabled] { opacity: .5; cursor: not-allowed; }
		.ipm-btn-sm { padding: 4px 9px; font-size: 12px; border-radius: 7px; }
		.ipm-actions { display: flex; gap: 8px; align-items: center; margin-top: 14px; }
		.ipm-dirty-note { color: var(--ipm-primary); font-size: 12px; font-weight: 600; }

		.ipm-tag { display: inline-block; font-size: 11px; padding: 1px 8px; border-radius: 20px; background: var(--ipm-bg); color: var(--ipm-muted); margin: 2px; }
		.ipm-ok { color: #166534; } .ipm-no { color: #b91c1c; }
		.ipm-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } @media (max-width:680px){ .ipm-grid2 { grid-template-columns: 1fr; } }

		.ipm-loading, .ipm-empty { text-align: center; color: var(--ipm-muted); padding: 50px 20px; font-size: 14px; }
		.ipm-empty i { font-size: 30px; display: block; margin-bottom: 10px; opacity: .5; }
		.ipm-lock { display: flex; align-items: center; justify-content: center; padding: 80px 20px; }
		.ipm-lock-box { text-align: center; max-width: 440px; }
		.ipm-lock-box i { font-size: 44px; color: var(--ipm-muted); margin-bottom: 14px; }
		.ipm-lock-box p { color: var(--ipm-muted); }

		/* Dark mode: follow Frappe's [data-theme="dark"] on <html> */
		[data-theme="dark"] .ipm-root {
			--ipm-bg: #1a1d23; --ipm-card: #21242c; --ipm-border: #32373f; --ipm-text: #e6e8ec; --ipm-muted: #9aa1ac;
		}
		[data-theme="dark"] .ipm-bar { background: rgba(33,36,44,0.9); box-shadow: 0 6px 22px rgba(0,0,0,0.45); }
		[data-theme="dark"] .ipm-card { box-shadow: 0 4px 14px rgba(0,0,0,0.30); }
		[data-theme="dark"] .ipm-user.active { background: rgba(239,68,68,0.18); }
		[data-theme="dark"] .ipm-ok { color: #4ade80; } [data-theme="dark"] .ipm-no { color: #f87171; }
		</style>`;
		$('head').append(css);
	}
};
