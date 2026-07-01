// Isoft Permission Manager - "Managers" view (System Manager only).
// Configure ISOFT Permission Delegation records: who may manage permissions and
// the exact scope (users / roles / modules) they are allowed to touch.
frappe.provide('ipm.views');

ipm.views.managers = function (ctx) {
	const esc = ctx.esc;
	const st = ctx.state.managers = ctx.state.managers || { pickers: null };

	ctx.$content.html('<div class="ipm-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');

	const ensurePickers = () => st.pickers
		? Promise.resolve(st.pickers)
		: ctx.api('get_pickers').then((p) => (st.pickers = p || { roles: [], modules: [], users: [] }));

	const renderList = () => {
		ctx.$content.html('<div class="ipm-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');
		ctx.api('list_delegations').then((rows) => {
			rows = rows || [];
			const scopeText = (all, count, label) => all ? `All ${label}` : `${count} ${label}`;
			const body = rows.map((d) => `
				<tr>
					<td><b>${esc(d.manager_name)}</b><br><span style="font-size:11px;color:var(--ipm-muted);">${esc(d.manager)}</span>
						${d.has_role ? '' : '<br><span class="ipm-no" style="font-size:11px;"><i class="fa fa-exclamation-triangle"></i> missing role</span>'}</td>
					<td>${d.enabled ? '<span class="ipm-ok">Enabled</span>' : '<span class="ipm-no">Disabled</span>'}</td>
					<td>${esc(scopeText(d.all_users, d.users_count, 'users'))}</td>
					<td>${esc(scopeText(d.all_roles, d.roles_count, 'roles'))}</td>
					<td>${esc(scopeText(d.all_modules, d.modules_count, 'modules'))}</td>
					<td class="ipm-num">
						<button class="ipm-btn ipm-btn-sm ipm-edit-del" data-name="${esc(d.name)}"><i class="fa fa-pencil"></i></button>
						<button class="ipm-btn ipm-btn-sm ipm-del-del" data-name="${esc(d.name)}"><i class="fa fa-trash"></i></button>
					</td>
				</tr>`).join('');

			ctx.$content.html(`
				<div class="ipm-card">
					<div class="ipm-card-title"><i class="fa fa-users-cog"></i> Delegations
						<span class="ipm-pill">${rows.length}</span>
						<button class="ipm-btn ipm-btn-primary ipm-btn-sm" id="ipm-new-del" style="margin-left:10px;"><i class="fa fa-plus"></i> New delegation</button>
					</div>
					${rows.length ? `<table class="ipm-table"><thead><tr>
						<th>Manager</th><th>Status</th><th>Users</th><th>Roles</th><th>Modules</th><th></th>
					</tr></thead><tbody>${body}</tbody></table>`
					: '<div class="ipm-empty"><i class="fa fa-users-cog"></i>No delegations yet. Create one to let a user manage permissions.</div>'}
				</div>
			`);

			ctx.$content.find('#ipm-new-del').on('click', () => openEditor(null));
			ctx.$content.find('.ipm-edit-del').on('click', function () { openEditor($(this).data('name')); });
			ctx.$content.find('.ipm-del-del').on('click', function () {
				const name = $(this).data('name');
				frappe.confirm(__('Delete delegation for {0}?', [name]), () => {
					ctx.api('delete_delegation', { name }).then(renderList);
				});
			});
		}).catch(() => ctx.$content.html('<div class="ipm-empty">Could not load delegations.</div>'));
	};

	const openEditor = (name) => {
		Promise.all([ensurePickers(), name ? ctx.api('get_delegation', { name }) : Promise.resolve(null)])
			.then(([pickers, d]) => renderEditor(pickers, d));
	};

	const chipGroup = (id, items, selected, label) => {
		const sel = new Set(selected || []);
		return { id, items, sel, label };
	};

	const renderEditor = (pickers, d) => {
		d = d || {};
		const model = {
			manager: d.manager || '',
			enabled: d.enabled != null ? d.enabled : 1,
			description: d.description || '',
			can_edit_roles: d.can_edit_roles != null ? d.can_edit_roles : 1,
			can_edit_user_permissions: d.can_edit_user_permissions != null ? d.can_edit_user_permissions : 1,
			can_edit_modules: d.can_edit_modules != null ? d.can_edit_modules : 1,
			can_view_pages_reports: d.can_view_pages_reports != null ? d.can_view_pages_reports : 1,
			all_users: d.all_users || 0, all_roles: d.all_roles || 0, all_modules: d.all_modules || 0
		};
		const groups = {
			users: chipGroup('users', (pickers.users || []).map((u) => ({ value: u.name, label: u.full_name || u.name })), d.allowed_users, 'users'),
			roles: chipGroup('roles', (pickers.roles || []).map((r) => ({ value: r, label: r })), d.allowed_roles, 'roles'),
			modules: chipGroup('modules', (pickers.modules || []).map((m) => ({ value: m, label: m })), d.allowed_modules, 'modules')
		};
		const isNew = !d.name;
		const userOptions = (pickers.users || []).map((u) =>
			`<option value="${esc(u.name)}" ${model.manager === u.name ? 'selected' : ''}>${esc(u.full_name || u.name)} (${esc(u.name)})</option>`).join('');

		const checkRow = (key, label) => `
			<label class="ipm-chip ${model[key] ? 'on' : ''}" data-flag="${key}" style="margin:0 6px 6px 0;">
				<i class="fa ${model[key] ? 'fa-check-square-o' : 'fa-square-o'}"></i>${label}</label>`;

		ctx.$content.html(`
			<div class="ipm-card" style="max-width:980px;">
				<div class="ipm-card-title"><i class="fa fa-user-shield"></i> ${isNew ? 'New delegation' : esc(model.manager)}
					<button class="ipm-btn ipm-btn-sm" id="ipm-back" style="margin-left:auto;"><i class="fa fa-arrow-left"></i> Back</button>
				</div>

				<div class="ipm-section">
					<h4><i class="fa fa-user"></i> Manager</h4>
					${isNew
						? `<select class="form-control ipm-input" id="ipm-manager" style="width:100%;max-width:460px;"><option value="">Select a user…</option>${userOptions}</select>`
						: `<div><b>${esc(model.manager)}</b></div>`}
					<div style="margin-top:12px;" class="ipm-chips">
						${checkRow('enabled', 'Enabled')}
					</div>
				</div>

				<div class="ipm-section">
					<h4><i class="fa fa-sliders"></i> Capabilities</h4>
					<div class="ipm-chips">
						${checkRow('can_edit_roles', 'Edit role assignments')}
						${checkRow('can_edit_user_permissions', 'Edit user permissions')}
						${checkRow('can_edit_modules', 'Edit module access')}
						${checkRow('can_view_pages_reports', 'View pages / reports')}
					</div>
				</div>

				${groupBlock('users', 'fa-users', 'Manageable users', 'all_users', model.all_users)}
				${groupBlock('roles', 'fa-id-badge', 'Allowed roles', 'all_roles', model.all_roles)}
				${groupBlock('modules', 'fa-th-large', 'Allowed modules', 'all_modules', model.all_modules)}

				<div class="ipm-actions">
					<button class="ipm-btn ipm-btn-primary" id="ipm-save-del"><i class="fa fa-save"></i> Save delegation</button>
					<button class="ipm-btn" id="ipm-cancel-del">Cancel</button>
				</div>
			</div>
		`);

		function groupBlock(key, icon, label, flag, allOn) {
			return `
				<div class="ipm-section" data-group="${key}">
					<h4><i class="fa ${icon}"></i> ${label}
						<label class="ipm-chip ${allOn ? 'on' : ''}" data-flag="${flag}" style="margin-left:auto;">
							<i class="fa ${allOn ? 'fa-check-square-o' : 'fa-square-o'}"></i>All</label>
					</h4>
					<div class="ipm-group-body" ${allOn ? 'style="display:none;"' : ''}>
						<input type="text" class="form-control ipm-input ipm-group-filter" data-group="${key}" placeholder="Filter ${label.toLowerCase()}…" style="width:100%;max-width:460px;margin-bottom:10px;">
						<div class="ipm-chips ipm-group-chips" data-group="${key}"></div>
					</div>
				</div>`;
		}

		const renderChips = (key) => {
			const g = groups[key];
			const term = (ctx.$content.find(`.ipm-group-filter[data-group="${key}"]`).val() || '').toLowerCase().trim();
			const items = g.items.filter((it) => !term || it.label.toLowerCase().includes(term) || it.value.toLowerCase().includes(term));
			ctx.$content.find(`.ipm-group-chips[data-group="${key}"]`).html(items.map((it) => `
				<span class="ipm-chip ${g.sel.has(it.value) ? 'on' : ''}" data-val="${esc(it.value)}">
					<i class="fa ${g.sel.has(it.value) ? 'fa-check' : 'fa-plus'}"></i>${esc(it.label)}</span>`).join('') ||
				'<span style="color:var(--ipm-muted);font-size:12px;">No matches.</span>');
		};
		['users', 'roles', 'modules'].forEach(renderChips);

		// chip toggles
		ctx.$content.on('click', '.ipm-group-chips .ipm-chip', function () {
			const key = $(this).closest('.ipm-group-chips').data('group');
			const val = $(this).data('val');
			const g = groups[key];
			if (g.sel.has(val)) g.sel.delete(val); else g.sel.add(val);
			renderChips(key);
		});
		ctx.$content.find('.ipm-group-filter').on('input', function () { renderChips($(this).data('group')); });

		// flag toggles (enabled, capabilities, all_*)
		ctx.$content.find('[data-flag]').on('click', function () {
			const flag = $(this).data('flag');
			model[flag] = model[flag] ? 0 : 1;
			$(this).toggleClass('on', !!model[flag]);
			$(this).find('i').attr('class', `fa ${model[flag] ? 'fa-check-square-o' : 'fa-square-o'}`);
			if (flag === 'all_users' || flag === 'all_roles' || flag === 'all_modules') {
				const key = flag.replace('all_', '');
				ctx.$content.find(`.ipm-section[data-group="${key}"] .ipm-group-body`).toggle(!model[flag]);
			}
		});

		if (isNew) ctx.$content.find('#ipm-manager').on('change', function () { model.manager = $(this).val(); });
		ctx.$content.find('#ipm-back, #ipm-cancel-del').on('click', renderList);
		ctx.$content.find('#ipm-save-del').on('click', function () {
			if (!model.manager) { frappe.msgprint(__('Please select a manager.')); return; }
			const payload = Object.assign({}, model, {
				allowed_users: Array.from(groups.users.sel),
				allowed_roles: Array.from(groups.roles.sel),
				allowed_modules: Array.from(groups.modules.sel),
				grant_role: 1
			});
			const $b = $(this).prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Saving…');
			ctx.api('save_delegation', { payload: JSON.stringify(payload) })
				.then(() => { frappe.show_alert({ message: __('Delegation saved'), indicator: 'green' }); renderList(); })
				.catch(() => $b.prop('disabled', false).html('<i class="fa fa-save"></i> Save delegation'));
		});
	};

	renderList();
};
