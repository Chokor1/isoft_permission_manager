// Isoft Permission Manager - "Activity log" view.
// A read-only audit timeline for one managed user, merged server-side from four
// frappe logs (Activity Log, Version, Access Log, Route History).
//
// Filters are applied server-side: those tables run to tens of thousands of rows,
// so the page never pulls them down to filter locally.
//
// The Permissions view links here with a user preselected (ctx.state.logs.user),
// so the two views share state rather than duplicating the picker.
frappe.provide('ipm.views');

ipm.LOG_KINDS = [
	{ key: 'logins',  label: __('Logins'),          icon: 'fa-sign-in' },
	{ key: 'changes', label: __('Changes'),         icon: 'fa-pencil' },
	{ key: 'exports', label: __('Prints / exports'), icon: 'fa-download' },
	{ key: 'pages',   label: __('Pages visited'),   icon: 'fa-compass' }
];
ipm.LOG_PERIODS = [
	{ key: '1d', label: __('24h') }, { key: '7d', label: __('7 days') },
	{ key: '30d', label: __('30 days') }, { key: '90d', label: __('90 days') },
	{ key: 'all', label: __('All time') }
];

ipm.views.logs = function (ctx) {
	const esc = ctx.esc;
	const boot = ctx.bootstrap || {};
	const caps = boot.capabilities || {};

	if (!caps.logs) {
		ctx.$content.html(`<div class="ipm-card"><div class="ipm-empty">
			<i class="fa fa-history"></i>${__('You are not permitted to view user logs.')}</div></div>`);
		return;
	}

	// Merge defaults under whatever the Permissions view handed over (usually a
	// preselected user), so a deep-link keeps its filters.
	const st = ctx.state.logs = Object.assign(
		{ user: null, kinds: ipm.LOG_KINDS.map((k) => k.key), period: '30d', search: '' },
		ctx.state.logs || {}
	);

	const users = boot.users || [];
	// A user picked earlier may since have fallen out of scope.
	if (st.user && !users.some((u) => u.name === st.user)) st.user = null;

	const kindLabel = (k) => (ipm.LOG_KINDS.find((x) => x.key === k) || {}).label || k;
	const pretty = (s) => {
		try { return frappe.datetime.comment_when(s); } catch (e) { return s; }
	};

	ctx.$content.html(`
		<div class="ipm-card">
			<div class="ipm-card-title"><i class="fa fa-history"></i> ${__('Activity log')}
				<span class="ipm-readonly-note" style="margin-left:auto;">${__('read only')}</span>
			</div>

			<div class="ipm-section">
				<h4><i class="fa fa-user"></i> ${__('User')}</h4>
				<select class="form-control ipm-input" id="ipm-log-user" style="width:100%;max-width:460px;">
					<option value="">${__('Select a user…')}</option>
					${users.map((u) => `<option value="${esc(u.name)}" ${st.user === u.name ? 'selected' : ''}>
						${esc(u.full_name || u.name)} (${esc(u.name)})${u.enabled ? '' : ' — ' + __('disabled')}</option>`).join('')}
				</select>
			</div>

			<div class="ipm-section" id="ipm-log-body"></div>
		</div>
	`);

	const renderBody = () => {
		const $b = ctx.$content.find('#ipm-log-body');
		if (!st.user) {
			$b.html(`<div class="ipm-empty"><i class="fa fa-user-o"></i>${__('Pick a user to see their activity.')}</div>`);
			return;
		}
		$b.html(`
			<div class="ipm-log-filters">
				<div class="ipm-chips">
					${ipm.LOG_KINDS.map((k) => `
						<span class="ipm-chip ipm-chip-sm ${st.kinds.includes(k.key) ? 'on' : ''}" data-log-kind="${k.key}">
							<i class="fa ${k.icon}"></i>${k.label}</span>`).join('')}
				</div>
				<div class="ipm-chips" style="margin-left:auto;">
					${ipm.LOG_PERIODS.map((p) => `
						<span class="ipm-chip ipm-chip-sm ${st.period === p.key ? 'on' : ''}" data-log-period="${p.key}">${p.label}</span>`).join('')}
				</div>
			</div>
			<input type="text" class="form-control ipm-input" id="ipm-log-search" placeholder="${__('Search this user\'s activity…')}"
				value="${esc(st.search)}" style="width:100%;max-width:460px;margin:10px 0;">
			<div id="ipm-log-rows"></div>`);
		fetch();
	};

	const fetch = () => {
		const $rows = ctx.$content.find('#ipm-log-rows');
		if (!st.kinds.length) {
			$rows.html(`<div class="ipm-empty" style="padding:26px;">${__('Pick at least one activity type.')}</div>`);
			return;
		}
		$rows.html(`<div class="ipm-loading" style="padding:26px;"><i class="fa fa-spinner fa-spin"></i> ${__('Loading activity…')}</div>`);
		ctx.api('get_user_logs', {
			user: st.user, kinds: JSON.stringify(st.kinds), period: st.period, search: st.search, limit: 100
		}).then((r) => {
			const rows = (r && r.rows) || [];
			if (!rows.length) {
				$rows.html(`<div class="ipm-empty" style="padding:26px;"><i class="fa fa-history"></i>${__('No activity for these filters.')}</div>`);
				return;
			}
			$rows.html(`
				<div class="ipm-log-list">
					${rows.map((x) => `
						<div class="ipm-log-row ${x.level ? 'ipm-log-' + x.level : ''}">
							<span class="ipm-log-kind">${esc(kindLabel(x.kind))}</span>
							<span class="ipm-log-title">${esc(x.title)}${x.status ? ` <span class="ipm-log-status">${esc(x.status)}</span>` : ''}</span>
							<span class="ipm-log-detail" title="${esc(x.detail || '')}">${esc(x.detail || '')}</span>
							<span class="ipm-log-when" title="${esc(x.when)}">${esc(pretty(x.when))}</span>
						</div>`).join('')}
				</div>
				<div style="color:var(--ipm-muted);font-size:11.5px;margin-top:8px;">
					${rows.length} ${__('entries')}${r.truncated ? ` · ${__('showing the most recent 100 - narrow the filters to see more')}` : ''}
				</div>`);
		}).catch(() => $rows.html(`<div class="ipm-empty" style="padding:26px;">${__('Could not load activity.')}</div>`));
	};

	ctx.$content.find('#ipm-log-user').on('change', function () {
		st.user = $(this).val() || null;
		renderBody();
	});
	ctx.$content.on('click', '[data-log-kind]', function () {
		const k = $(this).data('log-kind');
		st.kinds = st.kinds.includes(k) ? st.kinds.filter((x) => x !== k) : st.kinds.concat([k]);
		$(this).toggleClass('on', st.kinds.includes(k));
		fetch();
	});
	ctx.$content.on('click', '[data-log-period]', function () {
		st.period = $(this).data('log-period');
		ctx.$content.find('[data-log-period]').removeClass('on');
		$(this).addClass('on');
		fetch();
	});
	let t = null;
	ctx.$content.on('input', '#ipm-log-search', function () {
		st.search = $(this).val();
		clearTimeout(t);
		t = setTimeout(fetch, 300);   // debounced: each keystroke queries four tables
	});

	renderBody();
};
