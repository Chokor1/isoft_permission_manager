// Isoft Permission Manager - delegated permission management SPA shell.
// Builds a toolbar + tab router and lazy-loads view components. Shared helpers
// (api, esc) and state (bootstrap, is_admin) are exposed on `ipm.app`.

frappe.provide('ipm');
frappe.provide('ipm.views');

ipm.METHOD = 'isoft_permission_manager.isoft_permission_manager.utils.';

// `rgb` powers rgba(var(--ipm-primary-rgb), a) tints, so glows/washes follow the
// selected theme instead of being hardcoded red.
ipm.THEMES = {
	Red:    { p: '#dc2626', d: '#991b1b', a: '#ef4444', rgb: '220,38,38' },
	Blue:   { p: '#2563eb', d: '#1e40af', a: '#3b82f6', rgb: '37,99,235' },
	Green:  { p: '#059669', d: '#047857', a: '#10b981', rgb: '5,150,105' },
	Purple: { p: '#7c3aed', d: '#5b21b6', a: '#8b5cf6', rgb: '124,58,237' },
	Orange: { p: '#ea580c', d: '#c2410c', a: '#f97316', rgb: '234,88,12' },
	Slate:  { p: '#475569', d: '#334155', a: '#64748b', rgb: '71,85,105' },
	Dark:   { p: '#0f172a', d: '#020617', a: '#334155', rgb: '15,23,42' }
};

// Shimmering placeholder shown while a view loads - reads as "content is coming"
// rather than a bare spinner.
ipm.skeleton = function (kind) {
	const line = (w, h) => `<div class="ipm-skel" style="width:${w};height:${h || '12px'};"></div>`;
	if (kind === 'detail') {
		return `<div class="ipm-skel-wrap">
			<div class="ipm-skel-row">${line('38px', '38px')}<div style="flex:1;">${line('40%', '14px')}${line('60%')}</div></div>
			${[0, 1, 2].map(() => `<div class="ipm-skel-block">${line('120px', '11px')}
				<div class="ipm-skel-chips">${[0, 1, 2, 3, 4].map(() => line(`${60 + Math.round(Math.random() * 60)}px`, '26px')).join('')}</div>
			</div>`).join('')}
		</div>`;
	}
	return `<div class="ipm-skel-wrap">
		${[0, 1, 2, 3, 4, 5].map(() => `<div class="ipm-skel-row">${line('30px', '30px')}<div style="flex:1;">${line('45%')}${line('70%', '10px')}</div></div>`).join('')}
	</div>`;
};

// admin: only visible to System Managers.
// cap:   only visible when the caller's delegation grants that capability.
ipm.VIEWS = [
	{ key: 'users',    label: 'Permissions',  icon: 'fa-id-card-o', file: 'users',    admin: false },
	{ key: 'logs',     label: 'Activity log', icon: 'fa-history',   file: 'logs',     admin: false, cap: 'logs' },
	{ key: 'managers', label: 'Managers',     icon: 'fa-users',     file: 'managers', admin: true }
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
			if (this.state.is_admin) this.page.main.find('#ipm-theme-picker').show();
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
		// Set on <html> so dialogs (mounted on <body>) inherit the theme too.
		const el = document.documentElement;
		el.style.setProperty('--ipm-primary', t.p);
		el.style.setProperty('--ipm-primary-dark', t.d);
		el.style.setProperty('--ipm-accent', t.a);
		el.style.setProperty('--ipm-primary-rgb', t.rgb);
		this.state.theme = name;
		this.page.main.find('.ipm-swatch').removeClass('on')
			.filter(`[data-theme-name="${name}"]`).addClass('on');
	}

	build_shell() {
		this.page.main.html(`
			<div class="ipm-root">
				<div class="ipm-bar">
					<div class="ipm-brand">
						<span class="ipm-brand-logo"><i class="fa fa-shield"></i></span>
						<span class="ipm-brand-meta">
							<span class="ipm-brand-name">Permission Manager</span>
							<span class="ipm-brand-tag">Delegated Access Control</span>
						</span>
					</div>
					<div class="ipm-tabs"></div>
					<div class="ipm-filters">
						<div class="ipm-theme-picker" id="ipm-theme-picker" style="display:none;">
							<button class="ipm-icon-btn" id="ipm-theme-toggle" title="Theme"><i class="fa fa-paint-brush"></i></button>
							<div class="ipm-swatches" id="ipm-swatches"></div>
						</div>
						<button class="ipm-icon-btn" id="ipm-fs" title="Fullscreen"><i class="fa fa-arrows-alt"></i></button>
						<button class="ipm-icon-btn" id="ipm-refresh" title="Refresh"><i class="fa fa-refresh"></i></button>
					</div>
				</div>
				<div id="ipm-content">${ipm.skeleton()}</div>
				<div class="ipm-lock" id="ipm-lock" style="display:none;">
					<div class="ipm-lock-box">
						<div class="ipm-lock-icon"><i class="fa fa-lock"></i></div>
						<h3>Access restricted</h3>
						<p id="ipm-lock-msg">You don't have permission to use the Permission Manager. Ask a System Manager to grant you a delegation.</p>
					</div>
				</div>
			</div>
		`);
		const me = this;
		this.page.main.find('#ipm-refresh').on('click', function () {
			$(this).addClass('ipm-spin-once');
			setTimeout(() => $(this).removeClass('ipm-spin-once'), 600);
			me.reload();
		});
		this.page.main.find('#ipm-fs').on('click', () => me.toggle_fullscreen());
		this.build_theme_picker();
		$(document).off('fullscreenchange.ipm webkitfullscreenchange.ipm')
			.on('fullscreenchange.ipm webkitfullscreenchange.ipm', () => me.on_fs_change());
	}

	// Live theme switcher (System Managers only) - applies instantly, then persists.
	build_theme_picker() {
		const me = this;
		const $picker = this.page.main.find('#ipm-theme-picker');
		this.page.main.find('#ipm-swatches').html(Object.keys(ipm.THEMES).map((name) => {
			const t = ipm.THEMES[name];
			return `<button class="ipm-swatch" data-theme-name="${name}" title="${name}"
				style="background:linear-gradient(135deg, ${t.p}, ${t.a});"></button>`;
		}).join(''));

		this.page.main.find('#ipm-theme-toggle').on('click', (e) => {
			e.stopPropagation();
			$picker.toggleClass('open');
		});
		$(document).off('click.ipmtheme').on('click.ipmtheme', () => $picker.removeClass('open'));
		this.page.main.find('#ipm-swatches').on('click', '.ipm-swatch', function (e) {
			e.stopPropagation();
			const name = $(this).data('theme-name');
			me.apply_theme(name);           // instant feedback
			$picker.removeClass('open');
			me.api('set_theme', { theme_color: name })
				.then(() => frappe.show_alert({ message: __('Theme saved'), indicator: 'green' }))
				.catch(() => frappe.show_alert({ message: __('Could not save theme'), indicator: 'red' }));
		});
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

	// Single source of truth for which tabs exist - build_tabs and set_view must
	// never disagree, or a hidden view stays reachable by falling through.
	visible_views() {
		const caps = (this.state.bootstrap || {}).capabilities || {};
		return ipm.VIEWS.filter((v) => (!v.admin || this.state.is_admin) && (!v.cap || !!caps[v.cap]));
	}

	build_tabs() {
		const views = this.visible_views();
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
		const views = this.visible_views();
		const view = views.find((v) => v.key === key) || views[0];
		if (!view) return;
		this.state.active_view = view.key;
		this.page.main.find('.ipm-tab').removeClass('active');
		this.page.main.find(`.ipm-tab[data-view="${view.key}"]`).addClass('active');

		const $c = this.$content();
		$c.html(ipm.skeleton('list'));
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
		/* =========================================================
		   Isoft Permission Manager - design tokens
		   Defined on :root, not .ipm-root: frappe mounts dialogs on
		   <body>, so a modal is never inside .ipm-root and would not
		   see these otherwise.
		   --ipm-primary-rgb drives every tint/glow, so themes stay
		   coherent instead of hardcoding one accent.
		   ========================================================= */
		:root {
			--ipm-primary: #dc2626; --ipm-primary-dark: #991b1b; --ipm-accent: #ef4444;
			--ipm-primary-rgb: 220,38,38;

			--ipm-bg: #f4f6fa; --ipm-card: #ffffff; --ipm-raised: #fbfcfe;
			--ipm-border: #e6eaf0; --ipm-border-strong: #d3dae5;
			--ipm-text: #111827; --ipm-muted: #6b7280; --ipm-faint: #9ca3af;

			--ipm-r-sm: 8px; --ipm-r-md: 11px; --ipm-r-lg: 16px; --ipm-r-xl: 20px;
			--ipm-sh-sm: 0 1px 2px rgba(17,24,39,.06);
			--ipm-sh-md: 0 4px 16px rgba(17,24,39,.06), 0 1px 3px rgba(17,24,39,.04);
			--ipm-sh-lg: 0 12px 34px rgba(17,24,39,.10), 0 2px 8px rgba(17,24,39,.05);
			--ipm-glow: 0 6px 18px rgba(var(--ipm-primary-rgb), .32);

			/* One easing for everything - a single motion "voice". */
			--ipm-ease: cubic-bezier(.4, 0, .2, 1);
			--ipm-spring: cubic-bezier(.34, 1.56, .64, 1);
			--ipm-fast: .14s; --ipm-med: .24s;
		}
		[data-theme="dark"] {
			--ipm-bg: #14171d; --ipm-card: #1c2027; --ipm-raised: #22262f;
			--ipm-border: #2e343e; --ipm-border-strong: #3d444f;
			--ipm-text: #e8eaee; --ipm-muted: #99a1ad; --ipm-faint: #6f7885;
			--ipm-sh-sm: 0 1px 2px rgba(0,0,0,.3);
			--ipm-sh-md: 0 4px 16px rgba(0,0,0,.34);
			--ipm-sh-lg: 0 12px 34px rgba(0,0,0,.46);
		}

		/* ---------------- motion ---------------- */
		@keyframes ipm-fade-up { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform:none; } }
		@keyframes ipm-fade-in { from { opacity:0; } to { opacity:1; } }
		@keyframes ipm-pop { 0%{transform:scale(.86)} 60%{transform:scale(1.06)} 100%{transform:scale(1)} }
		@keyframes ipm-shimmer { 0%{background-position:-500px 0} 100%{background-position:500px 0} }
		@keyframes ipm-spin { to { transform: rotate(360deg); } }
		@keyframes ipm-ring { 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }

		.ipm-root { color: var(--ipm-text); padding-bottom: 48px; animation: ipm-fade-in var(--ipm-med) var(--ipm-ease); }
		.ipm-root *, .ipm-root *:before, .ipm-root *:after { box-sizing: border-box; }

		/* Stagger children in as a view mounts. */
		#ipm-content > * { animation: ipm-fade-up .32s var(--ipm-ease) both; }
		.ipm-section { animation: ipm-fade-up .34s var(--ipm-ease) both; }
		.ipm-section:nth-child(1){animation-delay:.02s} .ipm-section:nth-child(2){animation-delay:.06s}
		.ipm-section:nth-child(3){animation-delay:.10s} .ipm-section:nth-child(4){animation-delay:.14s}
		.ipm-section:nth-child(5){animation-delay:.18s} .ipm-section:nth-child(6){animation-delay:.22s}

		/* ---------------- top bar ---------------- */
		.ipm-bar {
			display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
			position: sticky; top: 0; z-index: 30; margin: 10px 0 20px;
			background: rgba(255,255,255,.78);
			-webkit-backdrop-filter: saturate(180%) blur(14px); backdrop-filter: saturate(180%) blur(14px);
			border: 1px solid var(--ipm-border); border-radius: var(--ipm-r-lg);
			padding: 10px 14px; box-shadow: var(--ipm-sh-md);
			transition: box-shadow var(--ipm-med) var(--ipm-ease);
		}
		[data-theme="dark"] .ipm-bar { background: rgba(28,32,39,.82); }
		.ipm-brand { display: flex; align-items: center; gap: 11px; padding-right: 14px; border-right: 1px solid var(--ipm-border); }
		.ipm-brand-logo {
			width: 36px; height: 36px; border-radius: var(--ipm-r-md); display: grid; place-items: center;
			color: #fff; font-size: 15px; background: linear-gradient(135deg, var(--ipm-primary), var(--ipm-accent));
			box-shadow: var(--ipm-glow); position: relative; overflow: hidden;
			transition: transform var(--ipm-med) var(--ipm-spring), box-shadow var(--ipm-med) var(--ipm-ease);
		}
		.ipm-brand-logo:hover { transform: rotate(-6deg) scale(1.06); }
		/* Sheen sweep across the logo. */
		.ipm-brand-logo:after {
			content:""; position:absolute; inset:0; background: linear-gradient(120deg, transparent 30%, rgba(255,255,255,.45) 50%, transparent 70%);
			transform: translateX(-120%); transition: transform .7s var(--ipm-ease);
		}
		.ipm-brand-logo:hover:after { transform: translateX(120%); }
		.ipm-brand-meta { display: flex; flex-direction: column; line-height: 1.2; }
		.ipm-brand-name { font-weight: 750; font-size: 14px; letter-spacing: -.2px; color: var(--ipm-text); white-space: nowrap; }
		.ipm-brand-tag { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .7px; color: var(--ipm-faint); }

		.ipm-tabs { display: flex; gap: 6px; flex-wrap: wrap; flex: 1 1 auto; }
		.ipm-tab {
			position: relative; border: 1px solid transparent; background: transparent; color: var(--ipm-muted);
			border-radius: var(--ipm-r-md); padding: 8px 15px; font-weight: 600; font-size: 13px; cursor: pointer;
			transition: color var(--ipm-fast) var(--ipm-ease), background var(--ipm-fast) var(--ipm-ease),
				transform var(--ipm-fast) var(--ipm-ease), box-shadow var(--ipm-med) var(--ipm-ease);
		}
		.ipm-tab i { margin-right: 6px; opacity: .85; }
		.ipm-tab:hover { color: var(--ipm-text); background: var(--ipm-bg); }
		.ipm-tab:active { transform: scale(.97); }
		.ipm-tab.active {
			background: linear-gradient(135deg, var(--ipm-primary), var(--ipm-accent));
			color: #fff; box-shadow: var(--ipm-glow);
		}
		.ipm-tab.active i { opacity: 1; }

		.ipm-filters { display: flex; align-items: center; gap: 8px; }
		.ipm-icon-btn {
			width: 34px; height: 34px; display: grid; place-items: center; cursor: pointer;
			border: 1px solid var(--ipm-border); background: var(--ipm-card); color: var(--ipm-muted);
			border-radius: var(--ipm-r-md); font-size: 13px;
			transition: all var(--ipm-fast) var(--ipm-ease);
		}
		.ipm-icon-btn:hover { color: var(--ipm-primary); border-color: var(--ipm-primary); transform: translateY(-1px); box-shadow: var(--ipm-sh-sm); }
		.ipm-icon-btn:active { transform: translateY(0) scale(.95); }
		.ipm-spin-once i { animation: ipm-spin .6s var(--ipm-ease); }

		/* ---------------- theme picker ---------------- */
		.ipm-theme-picker { position: relative; }
		.ipm-swatches {
			position: absolute; right: 0; top: calc(100% + 8px); z-index: 40;
			display: flex; gap: 6px; padding: 8px; border-radius: var(--ipm-r-md);
			background: var(--ipm-card); border: 1px solid var(--ipm-border); box-shadow: var(--ipm-sh-lg);
			opacity: 0; visibility: hidden; transform: translateY(-6px) scale(.96); transform-origin: top right;
			transition: all var(--ipm-med) var(--ipm-spring);
		}
		.ipm-theme-picker.open .ipm-swatches { opacity: 1; visibility: visible; transform: none; }
		.ipm-swatch {
			width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0;
			transition: transform var(--ipm-fast) var(--ipm-spring), border-color var(--ipm-fast) var(--ipm-ease);
		}
		.ipm-swatch:hover { transform: scale(1.18); }
		.ipm-swatch.on { border-color: var(--ipm-text); transform: scale(1.1); }

		/* ---------------- fullscreen ---------------- */
		.ipm-root.ipm-maximized { position: fixed; inset: 0; z-index: 1050; overflow: auto; background: var(--ipm-bg); padding: 14px 22px; }
		.ipm-root.ipm-maximized .ipm-bar { top: 0; }

		/* ---------------- cards ---------------- */
		.ipm-card {
			background: var(--ipm-card); border: 1px solid var(--ipm-border); border-radius: var(--ipm-r-lg);
			padding: 20px; box-shadow: var(--ipm-sh-md); margin-bottom: 18px;
			transition: box-shadow var(--ipm-med) var(--ipm-ease), border-color var(--ipm-med) var(--ipm-ease);
		}
		.ipm-card:hover { box-shadow: var(--ipm-sh-lg); }
		.ipm-card-title { font-size: 15px; font-weight: 700; letter-spacing: -.2px; margin-bottom: 14px; display: flex; align-items: center; gap: 9px; }
		.ipm-card-title > i { color: var(--ipm-primary); }
		.ipm-card-title .ipm-pill {
			margin-left: auto; font-size: 11px; font-weight: 700; color: var(--ipm-primary);
			background: rgba(var(--ipm-primary-rgb), .10); padding: 3px 10px; border-radius: 999px;
		}

		.ipm-input {
			width: auto; min-width: 120px; border: 1px solid var(--ipm-border) !important;
			border-radius: var(--ipm-r-md) !important; height: 36px; background: var(--ipm-raised); color: var(--ipm-text);
			transition: border-color var(--ipm-fast) var(--ipm-ease), box-shadow var(--ipm-fast) var(--ipm-ease), background var(--ipm-fast) var(--ipm-ease);
		}
		.ipm-input:focus {
			border-color: var(--ipm-primary) !important; background: var(--ipm-card);
			box-shadow: 0 0 0 3px rgba(var(--ipm-primary-rgb), .14) !important; outline: none;
		}
		.ipm-search { min-width: 220px !important; }

		/* ---------------- layout ---------------- */
		.ipm-layout { display: grid; grid-template-columns: 310px 1fr; gap: 18px; align-items: start; }
		@media (max-width: 860px) { .ipm-layout { grid-template-columns: 1fr; } }
		.ipm-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
		@media (max-width: 680px) { .ipm-grid2 { grid-template-columns: 1fr; } }

		/* ---------------- user list ---------------- */
		.ipm-userlist { max-height: 68vh; overflow: auto; margin: 0 -6px; padding: 0 6px; }
		.ipm-userlist::-webkit-scrollbar, .ipm-dt-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
		.ipm-userlist::-webkit-scrollbar-thumb, .ipm-dt-scroll::-webkit-scrollbar-thumb { background: var(--ipm-border-strong); border-radius: 99px; }
		.ipm-userlist::-webkit-scrollbar-track, .ipm-dt-scroll::-webkit-scrollbar-track { background: transparent; }
		.ipm-user {
			position: relative; display: flex; align-items: center; gap: 11px; padding: 10px 12px;
			border-radius: var(--ipm-r-md); cursor: pointer; border: 1px solid transparent; margin-bottom: 3px;
			transition: background var(--ipm-fast) var(--ipm-ease), transform var(--ipm-fast) var(--ipm-ease), border-color var(--ipm-fast) var(--ipm-ease);
		}
		/* Accent bar grows from the left edge on select. */
		.ipm-user:before {
			content: ""; position: absolute; left: 0; top: 50%; width: 3px; height: 0; border-radius: 0 3px 3px 0;
			background: var(--ipm-primary); transform: translateY(-50%);
			transition: height var(--ipm-med) var(--ipm-spring);
		}
		.ipm-user:hover { background: var(--ipm-bg); transform: translateX(2px); }
		.ipm-user.active { background: rgba(var(--ipm-primary-rgb), .09); border-color: rgba(var(--ipm-primary-rgb), .22); }
		.ipm-user.active:before { height: 62%; }
		.ipm-avatar {
			width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, var(--ipm-primary), var(--ipm-accent));
			color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 12px; flex: 0 0 auto;
			box-shadow: 0 3px 9px rgba(var(--ipm-primary-rgb), .28);
		}
		.ipm-user-meta { display: flex; flex-direction: column; line-height: 1.25; overflow: hidden; }
		.ipm-user-name { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.ipm-user-email { font-size: 11px; color: var(--ipm-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

		/* Disabled accounts stay in the list, visibly muted. */
		.ipm-user-off .ipm-avatar { filter: grayscale(1); opacity: .6; box-shadow: none; }
		.ipm-user-off .ipm-user-name, .ipm-user-off .ipm-user-email { opacity: .6; }
		.ipm-off-badge {
			margin-left: auto; flex: 0 0 auto; font-size: 9px; font-weight: 800; text-transform: uppercase;
			letter-spacing: .5px; color: #b45309; background: rgba(245,158,11,.15);
			border: 1px solid rgba(245,158,11,.30); border-radius: 999px; padding: 2px 7px;
		}
		[data-theme="dark"] .ipm-off-badge { color: #fbbf24; }

		/* ---------------- activity log ---------------- */
		.ipm-log-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
		.ipm-log-list { max-height: 420px; overflow: auto; border: 1px solid var(--ipm-border); border-radius: var(--ipm-r-md); }
		.ipm-log-row {
			display: grid; grid-template-columns: 96px minmax(120px, 1fr) minmax(0, 1.6fr) auto;
			gap: 10px; align-items: center; padding: 9px 12px; font-size: 12.5px;
			border-bottom: 1px solid var(--ipm-border); border-left: 2px solid transparent;
			transition: background var(--ipm-fast) var(--ipm-ease);
		}
		.ipm-log-row:last-child { border-bottom: none; }
		.ipm-log-row:hover { background: rgba(var(--ipm-primary-rgb), .04); }
		.ipm-log-kind {
			font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .4px;
			text-align: center; padding: 3px 6px; border-radius: 999px;
			background: var(--ipm-bg); color: var(--ipm-muted); border: 1px solid var(--ipm-border);
			white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
		}
		.ipm-log-title { font-weight: 600; color: var(--ipm-text); }
		.ipm-log-status { font-size: 10px; font-weight: 700; color: var(--ipm-muted); text-transform: uppercase; }
		.ipm-log-detail { color: var(--ipm-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.ipm-log-when { color: var(--ipm-faint); font-size: 11px; white-space: nowrap; }
		/* Failed logins and data leaving the system get flagged. */
		.ipm-log-danger { border-left-color: #dc2626; background: rgba(220,38,38,.05); }
		.ipm-log-danger .ipm-log-title { color: #dc2626; }
		.ipm-log-warn { border-left-color: #f59e0b; background: rgba(245,158,11,.05); }
		[data-theme="dark"] .ipm-log-danger .ipm-log-title { color: #f87171; }
		@media (max-width: 720px) {
			.ipm-log-row { grid-template-columns: 1fr auto; }
			.ipm-log-kind, .ipm-log-detail { grid-column: 1 / -1; text-align: left; }
		}

		/* ---------------- switch ---------------- */
		.ipm-switch {
			position: relative; width: 42px; height: 24px; flex: 0 0 auto; padding: 0; cursor: pointer;
			border: none; border-radius: 999px; background: var(--ipm-border-strong);
			transition: background var(--ipm-med) var(--ipm-ease), box-shadow var(--ipm-med) var(--ipm-ease);
		}
		.ipm-switch:hover:not([disabled]) { box-shadow: 0 0 0 3px rgba(var(--ipm-primary-rgb), .12); }
		.ipm-switch.on { background: linear-gradient(135deg, var(--ipm-primary), var(--ipm-accent)); }
		.ipm-switch[disabled] { opacity: .55; cursor: wait; }
		.ipm-switch-knob {
			position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%;
			background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.28);
			transition: transform var(--ipm-med) var(--ipm-spring);
		}
		.ipm-switch.on .ipm-switch-knob { transform: translateX(18px); }

		/* ---------------- tables ---------------- */
		.ipm-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.ipm-table th {
			text-align: left; color: var(--ipm-faint); font-weight: 700; text-transform: uppercase;
			font-size: 10px; letter-spacing: .6px; padding: 10px; border-bottom: 1px solid var(--ipm-border);
			background: var(--ipm-card);
		}
		/* Sticky only where there is a scroll container to stick to - on a plain
		   page-scrolled table the header would float loose under the toolbar. */
		.ipm-dt-scroll .ipm-table th { position: sticky; top: 0; z-index: 1; }
		.ipm-table td { padding: 10px; border-bottom: 1px solid var(--ipm-border); }
		.ipm-table tbody tr { transition: background var(--ipm-fast) var(--ipm-ease); }
		.ipm-table tbody tr:hover { background: rgba(var(--ipm-primary-rgb), .04); }
		.ipm-table tbody tr:last-child td { border-bottom: none; }
		.ipm-num { text-align: right; }
		.ipm-dt-scroll { max-height: 340px; overflow: auto; border: 1px solid var(--ipm-border); border-radius: var(--ipm-r-md); }

		/* ---------------- chips ---------------- */
		.ipm-chips { display: flex; flex-wrap: wrap; gap: 7px; }
		.ipm-chip {
			display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 500;
			border: 1px solid var(--ipm-border); border-radius: 999px; padding: 6px 13px; cursor: pointer;
			background: var(--ipm-raised); color: var(--ipm-text); user-select: none;
			transition: all var(--ipm-fast) var(--ipm-ease);
		}
		.ipm-chip:hover { border-color: var(--ipm-primary); color: var(--ipm-primary); transform: translateY(-1px); }
		.ipm-chip:active { transform: scale(.95); }
		.ipm-chip.on {
			background: linear-gradient(135deg, var(--ipm-primary), var(--ipm-accent));
			color: #fff; border-color: transparent; box-shadow: 0 3px 10px rgba(var(--ipm-primary-rgb), .30);
		}
		.ipm-chip.on:hover { color: #fff; }
		.ipm-chip .fa { font-size: 10px; opacity: .9; }
		.ipm-chip.on .fa { animation: ipm-pop .26s var(--ipm-spring); }
		.ipm-chip-sm { font-size: 11.5px; padding: 4px 10px; }
		/* Disabled accounts in a picker: muted, but still selectable. Once picked,
		   full contrast - a selection you cannot read is worse than no marker. */
		.ipm-chip-off { opacity: .62; border-style: dashed; }
		.ipm-chip-off:hover, .ipm-chip-off.on { opacity: 1; }
		.ipm-chip-off.on { border-style: solid; }
		.ipm-chip-tag {
			font-size: 8.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .4px;
			line-height: 1; padding: 2px 5px; border-radius: 999px;
			background: rgba(245,158,11,.16); color: #b45309; border: 1px solid rgba(245,158,11,.32);
		}
		.ipm-chip.on .ipm-chip-tag { background: rgba(255,255,255,.24); color: #fff; border-color: transparent; }
		[data-theme="dark"] .ipm-chip-off .ipm-chip-tag { color: #fbbf24; }
		.ipm-chip-count {
			font-size: 9.5px; font-weight: 800; line-height: 1; padding: 2px 5px; border-radius: 999px;
			background: rgba(var(--ipm-primary-rgb), .12); color: var(--ipm-primary);
		}
		.ipm-chip.on .ipm-chip-count { background: rgba(255,255,255,.24); color: #fff; }

		/* ---------------- sections ---------------- */
		.ipm-section { margin-bottom: 22px; }
		.ipm-section h4 {
			font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .7px;
			color: var(--ipm-faint); margin: 0 0 11px; display: flex; align-items: center; gap: 8px;
		}
		.ipm-section h4 > i { color: var(--ipm-primary); opacity: .8; font-size: 12px; }
		.ipm-section h4 .ipm-count { background: var(--ipm-bg); color: var(--ipm-muted); border-radius: 999px; padding: 2px 9px; font-size: 10px; }
		.ipm-readonly-note { font-size: 10.5px; color: var(--ipm-faint); font-weight: 600; margin-left: auto; text-transform: none; letter-spacing: 0; }

		/* ---------------- buttons ---------------- */
		.ipm-btn {
			border: 1px solid var(--ipm-border); background: var(--ipm-card); color: var(--ipm-text);
			border-radius: var(--ipm-r-md); padding: 8px 15px; font-weight: 600; font-size: 13px; cursor: pointer;
			transition: all var(--ipm-fast) var(--ipm-ease);
		}
		.ipm-btn:hover:not([disabled]) { border-color: var(--ipm-border-strong); transform: translateY(-1px); box-shadow: var(--ipm-sh-sm); }
		.ipm-btn:active:not([disabled]) { transform: translateY(0) scale(.98); }
		.ipm-btn-primary {
			background: linear-gradient(135deg, var(--ipm-primary), var(--ipm-accent));
			color: #fff; border-color: transparent; box-shadow: var(--ipm-glow);
		}
		.ipm-btn-primary:hover:not([disabled]) { filter: brightness(1.06); box-shadow: 0 8px 22px rgba(var(--ipm-primary-rgb), .40); }
		.ipm-btn[disabled] { opacity: .45; cursor: not-allowed; box-shadow: none; }
		.ipm-btn-sm { padding: 5px 10px; font-size: 12px; border-radius: var(--ipm-r-sm); }
		.ipm-actions { display: flex; gap: 9px; align-items: center; margin-top: 14px; }
		.ipm-dirty-note { color: var(--ipm-primary); font-size: 12px; font-weight: 600; animation: ipm-fade-in var(--ipm-med) var(--ipm-ease); }

		/* ---------------- misc ---------------- */
		.ipm-tag {
			display: inline-block; font-size: 11px; padding: 3px 9px; border-radius: 999px;
			background: var(--ipm-bg); color: var(--ipm-muted); margin: 2px; border: 1px solid var(--ipm-border);
			transition: all var(--ipm-fast) var(--ipm-ease);
		}
		.ipm-tag:hover { border-color: var(--ipm-primary); color: var(--ipm-primary); }
		.ipm-ok { color: #16a34a; } .ipm-no { color: #dc2626; }
		[data-theme="dark"] .ipm-ok { color: #4ade80; } [data-theme="dark"] .ipm-no { color: #f87171; }

		.ipm-loading, .ipm-empty { text-align: center; color: var(--ipm-muted); padding: 52px 20px; font-size: 14px; }
		.ipm-empty i { font-size: 28px; display: block; margin-bottom: 12px; opacity: .4; }
		.ipm-empty { animation: ipm-fade-in var(--ipm-med) var(--ipm-ease); }

		/* ---------------- skeletons ---------------- */
		.ipm-skel-wrap { padding: 6px 0; }
		.ipm-skel-row { display: flex; align-items: center; gap: 11px; padding: 10px 12px; }
		.ipm-skel-row .ipm-skel:first-child { border-radius: 50%; flex: 0 0 auto; }
		.ipm-skel-block { padding: 12px; }
		.ipm-skel-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
		.ipm-skel-chips .ipm-skel { border-radius: 999px; }
		.ipm-skel {
			border-radius: 6px; margin: 4px 0;
			background: linear-gradient(90deg, var(--ipm-border) 25%, var(--ipm-bg) 50%, var(--ipm-border) 75%);
			background-size: 500px 100%; animation: ipm-shimmer 1.3s linear infinite;
		}

		/* ---------------- lock screen ---------------- */
		.ipm-lock { display: flex; align-items: center; justify-content: center; padding: 80px 20px; animation: ipm-fade-up .4s var(--ipm-ease); }
		.ipm-lock-box { text-align: center; max-width: 440px; }
		.ipm-lock-icon {
			width: 68px; height: 68px; margin: 0 auto 18px; border-radius: 20px; display: grid; place-items: center;
			background: linear-gradient(135deg, var(--ipm-primary), var(--ipm-accent)); color: #fff; font-size: 26px;
			box-shadow: var(--ipm-glow);
		}
		.ipm-lock-box h3 { font-weight: 750; letter-spacing: -.3px; }
		.ipm-lock-box p { color: var(--ipm-muted); font-size: 13.5px; }

		/* ---------------- themed dialogs (mounted on <body>) ---------------- */
		.ipm-dialog .modal-content { border-radius: var(--ipm-r-lg); border: 1px solid var(--ipm-border); overflow: hidden; box-shadow: var(--ipm-sh-lg); }
		.ipm-dialog .modal-header { background: var(--ipm-raised); border-bottom: 1px solid var(--ipm-border); }
		.ipm-dialog .modal-title { font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 9px; }
		.ipm-dialog .modal-title:before {
			content: "\\f084"; font-family: FontAwesome; font-size: 12px; color: #fff;
			width: 26px; height: 26px; border-radius: var(--ipm-r-sm); display: inline-flex; align-items: center; justify-content: center;
			background: linear-gradient(135deg, var(--ipm-primary), var(--ipm-accent)); box-shadow: var(--ipm-glow);
		}
		.ipm-dialog .modal-footer { background: var(--ipm-raised); border-top: 1px solid var(--ipm-border); }
		/* Keep .btn-primary - frappe's get_primary_btn() selects on it. */
		.ipm-dialog .btn-primary {
			background: linear-gradient(135deg, var(--ipm-primary), var(--ipm-accent));
			border-color: transparent; color: #fff; font-weight: 600; box-shadow: var(--ipm-glow);
			transition: all var(--ipm-fast) var(--ipm-ease);
		}
		.ipm-dialog .btn-primary:hover:not([disabled]) { filter: brightness(1.06); }
		.ipm-dialog .btn-primary[disabled] { opacity: .6; }
		.ipm-dialog-body { font-size: 13px; line-height: 1.65; color: var(--ipm-text); }
		.ipm-dialog-body ul { padding-left: 18px; margin: 0; color: var(--ipm-muted); }
		.ipm-dialog-note { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; margin-top: 12px; color: var(--ipm-muted); }
		.ipm-dialog-note.ipm-warn { color: #b45309; background: rgba(245,158,11,.10); border: 1px solid rgba(245,158,11,.35); border-radius: var(--ipm-r-md); padding: 10px 12px; }
		[data-theme="dark"] .ipm-dialog-note.ipm-warn { color: #fbbf24; }

		/* ---------------- one-time password reveal ---------------- */
		.ipm-pwd-box {
			display: flex; align-items: center; gap: 10px; background: var(--ipm-bg);
			border: 1px solid var(--ipm-border); border-left: 3px solid var(--ipm-primary);
			border-radius: var(--ipm-r-md); padding: 13px 14px; animation: ipm-fade-up .3s var(--ipm-ease);
		}
		.ipm-pwd {
			flex: 1 1 auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
			font-size: 17px; font-weight: 700; letter-spacing: 1.5px; color: var(--ipm-text);
			background: none; padding: 0; word-break: break-all; user-select: all;
		}
		.ipm-pwd-copy {
			flex: 0 0 auto; background: linear-gradient(135deg, var(--ipm-primary), var(--ipm-accent)) !important;
			color: #fff !important; border-color: transparent !important;
		}
		.ipm-pwd-copy:hover { filter: brightness(1.06); }
		.ipm-pwd-copy.ipm-copied { background: #16a34a !important; }
		.ipm-pwd-copy.ipm-copied .fa { animation: ipm-pop .3s var(--ipm-spring); }

		/* Respect users who ask the OS for less motion. */
		@media (prefers-reduced-motion: reduce) {
			.ipm-root *, .ipm-root *:before, .ipm-root *:after,
			.ipm-dialog *, .ipm-skel {
				animation-duration: .001ms !important; animation-iteration-count: 1 !important;
				transition-duration: .001ms !important; scroll-behavior: auto !important;
			}
			.ipm-user:hover, .ipm-chip:hover, .ipm-btn:hover:not([disabled]), .ipm-icon-btn:hover { transform: none !important; }
		}
		</style>`;
		$('head').append(css);
	}
};
