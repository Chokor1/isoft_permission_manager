// Isoft Permission Manager - "Permissions" smart view.
// Left: filter/select a manageable user. Right: view & edit their roles,
// module access and user permissions (within the caller's scope), plus a
// read-only summary of doctype / page / report access derived from roles.
frappe.provide('ipm.views');

ipm.views.users = function (ctx) {
	const esc = ctx.esc;
	const boot = ctx.bootstrap || {};
	const caps = boot.capabilities || {};
	const st = ctx.state.users = ctx.state.users || { selected: null, search: '' };

	ctx.$content.html(`
		<div class="ipm-layout">
			<div class="ipm-card">
				<div class="ipm-card-title"><i class="fa fa-users"></i> Users
					<span class="ipm-pill">${(boot.users || []).length}</span>
				</div>
				<input type="text" class="form-control ipm-input ipm-search" id="ipm-user-search" placeholder="Filter users…" value="${esc(st.search)}" style="width:100%;margin-bottom:10px;">
				<div class="ipm-userlist" id="ipm-userlist"></div>
			</div>
			<div class="ipm-card" id="ipm-detail">
				<div class="ipm-empty"><i class="fa fa-user-shield"></i>Select a user to view and manage their permissions.</div>
			</div>
		</div>
	`);

	const initials = (name, email) => {
		const s = (name || email || '?').trim();
		const parts = s.split(/\s+/);
		return ((parts[0] || '')[0] || '' + (parts[1] ? parts[1][0] : '')).toUpperCase() || s[0].toUpperCase();
	};

	const renderUserList = () => {
		const term = (st.search || '').toLowerCase().trim();
		const users = (boot.users || []).filter((u) => !term ||
			(u.full_name || '').toLowerCase().includes(term) || (u.name || '').toLowerCase().includes(term));
		const $list = ctx.$content.find('#ipm-userlist');
		if (!users.length) { $list.html('<div class="ipm-empty" style="padding:24px">No users.</div>'); return; }
		$list.html(users.map((u) => `
			<div class="ipm-user ${st.selected === u.name ? 'active' : ''}" data-user="${esc(u.name)}">
				<div class="ipm-avatar">${esc(initials(u.full_name, u.name))}</div>
				<div class="ipm-user-meta">
					<span class="ipm-user-name">${esc(u.full_name || u.name)}</span>
					<span class="ipm-user-email">${esc(u.name)}</span>
				</div>
			</div>`).join(''));
	};

	ctx.$content.find('#ipm-user-search').on('input', function () { st.search = $(this).val(); renderUserList(); });
	ctx.$content.on('click', '.ipm-user', function () {
		st.selected = $(this).data('user');
		renderUserList();
		loadDetail(st.selected);
	});

	// ---- detail ----
	const loadDetail = (user) => {
		const $d = ctx.$content.find('#ipm-detail');
		$d.html('<div class="ipm-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');
		ctx.api('get_user_overview', { user }).then((ov) => renderDetail(user, ov))
			.catch(() => $d.html('<div class="ipm-empty">Could not load this user.</div>'));
	};

	const sectionHead = (icon, title, count, note) => `
		<h4><i class="fa ${icon}"></i> ${title}${count != null ? ` <span class="ipm-count">${count}</span>` : ''}
			${note ? `<span class="ipm-readonly-note">${note}</span>` : ''}</h4>`;

	const renderDetail = (user, ov) => {
		const p = ov.profile || {};
		const dirty = { roles: false, modules: false };
		const rolesState = {}; (ov.roles_in_scope || []).forEach((r) => rolesState[r.role] = !!r.assigned);
		const blockState = {}; (ov.modules || []).forEach((m) => blockState[m.module] = !!m.blocked);

		const rolesEditable = !!caps.roles;
		const modsEditable = !!caps.modules;
		const upEditable = !!caps.user_permissions;

		const $d = ctx.$content.find('#ipm-detail');
		$d.html(`
			<div class="ipm-card-title" style="margin-bottom:14px;">
				<div class="ipm-avatar" style="width:38px;height:38px;font-size:14px;">${esc(initials(p.full_name, p.name))}</div>
				<div style="display:flex;flex-direction:column;line-height:1.25;">
					<span style="font-size:15px;">${esc(p.full_name || p.name)}</span>
					<span style="font-size:12px;color:var(--ipm-muted);">${esc(p.name)} · ${esc(p.user_type || '')} · ${p.enabled ? 'Enabled' : '<span class="ipm-no">Disabled</span>'}</span>
				</div>
			</div>

			<div class="ipm-section" id="ipm-sec-roles">
				${sectionHead('fa-id-badge', 'Roles', (ov.roles_in_scope || []).length, rolesEditable ? 'click to toggle' : 'view only')}
				<div class="ipm-chips" id="ipm-roles"></div>
				${rolesEditable ? `<div class="ipm-actions"><button class="ipm-btn ipm-btn-primary" id="ipm-save-roles" disabled>Save roles</button><span class="ipm-dirty-note" id="ipm-roles-dirty" style="display:none;">Unsaved changes</span></div>` : ''}
			</div>

			<div class="ipm-section" id="ipm-sec-modules">
				${sectionHead('fa-th-large', 'Module access', (ov.modules || []).length, modsEditable ? 'highlighted = blocked' : 'view only')}
				<div class="ipm-chips" id="ipm-modules"></div>
				${modsEditable ? `<div class="ipm-actions"><button class="ipm-btn ipm-btn-primary" id="ipm-save-modules" disabled>Save module access</button><span class="ipm-dirty-note" id="ipm-modules-dirty" style="display:none;">Unsaved changes</span></div>` : ''}
			</div>

			<div class="ipm-section" id="ipm-sec-up">
				${sectionHead('fa-filter', 'User Permissions', (ov.user_permissions || []).length, upEditable ? '' : 'view only')}
				<div id="ipm-up-table"></div>
				${upEditable ? `<div class="ipm-actions"><button class="ipm-btn ipm-btn-sm" id="ipm-add-up"><i class="fa fa-plus"></i> Add user permission</button></div>` : ''}
			</div>

			<div class="ipm-grid2">
				<div class="ipm-section">
					${sectionHead('fa-window-maximize', 'Pages', (ov.pages || []).length, 'via roles')}
					<div>${(ov.pages || []).length ? ov.pages.map((x) => `<span class="ipm-tag">${esc(x)}</span>`).join('') : '<span style="color:var(--ipm-muted);font-size:12px;">None</span>'}</div>
				</div>
				<div class="ipm-section">
					${sectionHead('fa-file-text-o', 'Reports', (ov.reports || []).length, 'via roles')}
					<div>${(ov.reports || []).length ? ov.reports.map((x) => `<span class="ipm-tag">${esc(x)}</span>`).join('') : '<span style="color:var(--ipm-muted);font-size:12px;">None</span>'}</div>
				</div>
			</div>

			<div class="ipm-section">
				${sectionHead('fa-database', 'DocType access', (ov.doctype_access || []).length, 'view only · via roles')}
				<input type="text" class="form-control ipm-input" id="ipm-dt-filter" placeholder="Filter doctypes…" style="width:100%;margin-bottom:8px;">
				<div style="max-height:340px;overflow:auto;">
					<table class="ipm-table ipm-dt-table"><thead><tr>
						<th>DocType</th>
						<th class="ipm-num">Read</th><th class="ipm-num">Write</th><th class="ipm-num">Create</th><th class="ipm-num">Delete</th>
						<th class="ipm-num">Submit</th><th class="ipm-num">Cancel</th><th class="ipm-num">Amend</th>
						<th class="ipm-num">Print</th><th class="ipm-num">Email</th><th class="ipm-num">Report</th>
						<th class="ipm-num">Export</th><th class="ipm-num">Share</th>
					</tr></thead><tbody id="ipm-dt-body"></tbody></table>
				</div>
			</div>
		`);

		// roles chips
		const renderRoleChips = () => {
			ctx.$content.find('#ipm-roles').html((ov.roles_in_scope || []).map((r) => `
				<span class="ipm-chip ${rolesState[r.role] ? 'on' : ''}" data-role="${esc(r.role)}" ${rolesEditable ? '' : 'style="cursor:default;"'}>
					<i class="fa ${rolesState[r.role] ? 'fa-check' : 'fa-plus'}"></i>${esc(r.role)}</span>`).join('') ||
				'<span style="color:var(--ipm-muted);font-size:12px;">No roles in your scope.</span>');
		};
		renderRoleChips();
		if (rolesEditable) {
			ctx.$content.find('#ipm-roles').on('click', '.ipm-chip', function () {
				const role = $(this).data('role');
				rolesState[role] = !rolesState[role];
				renderRoleChips();
				dirty.roles = true;
				ctx.$content.find('#ipm-save-roles').prop('disabled', false);
				ctx.$content.find('#ipm-roles-dirty').show();
			});
			ctx.$content.find('#ipm-save-roles').on('click', function () {
				const roles = Object.keys(rolesState).filter((r) => rolesState[r]);
				$(this).prop('disabled', true).text('Saving…');
				ctx.api('set_user_roles', { user, roles: JSON.stringify(roles) })
					.then(() => loadDetail(user))
					.catch(() => { $(this).prop('disabled', false).text('Save roles'); });
			});
		}

		// module chips (highlighted = blocked)
		const renderModChips = () => {
			ctx.$content.find('#ipm-modules').html((ov.modules || []).map((m) => `
				<span class="ipm-chip ${blockState[m.module] ? 'on' : ''}" data-module="${esc(m.module)}" ${modsEditable ? '' : 'style="cursor:default;"'}>
					<i class="fa ${blockState[m.module] ? 'fa-ban' : 'fa-check'}"></i>${esc(m.module)}</span>`).join('') ||
				'<span style="color:var(--ipm-muted);font-size:12px;">No modules in your scope.</span>');
		};
		renderModChips();
		if (modsEditable) {
			ctx.$content.find('#ipm-modules').on('click', '.ipm-chip', function () {
				const m = $(this).data('module');
				blockState[m] = !blockState[m];
				renderModChips();
				dirty.modules = true;
				ctx.$content.find('#ipm-save-modules').prop('disabled', false);
				ctx.$content.find('#ipm-modules-dirty').show();
			});
			ctx.$content.find('#ipm-save-modules').on('click', function () {
				const blocked = Object.keys(blockState).filter((m) => blockState[m]);
				$(this).prop('disabled', true).text('Saving…');
				ctx.api('set_module_blocks', { user, blocked_modules: JSON.stringify(blocked) })
					.then(() => loadDetail(user))
					.catch(() => { $(this).prop('disabled', false).text('Save module access'); });
			});
		}

		// user permissions table
		const renderUP = () => {
			const rows = ov.user_permissions || [];
			const $t = ctx.$content.find('#ipm-up-table');
			if (!rows.length) { $t.html('<div style="color:var(--ipm-muted);font-size:12px;">No user permissions.</div>'); return; }
			$t.html(`<table class="ipm-table"><thead><tr>
					<th>Allow (DocType)</th><th>For Value</th><th>Applies To</th>${upEditable ? '<th></th>' : ''}
				</tr></thead><tbody>${rows.map((u) => `
					<tr>
						<td>${esc(u.allow)}</td>
						<td>${esc(u.for_value)}</td>
						<td>${u.apply_to_all_doctypes ? 'All DocTypes' : esc(u.applicable_for || '—')}</td>
						${upEditable ? `<td class="ipm-num"><button class="ipm-btn ipm-btn-sm ipm-del-up" data-name="${esc(u.name)}" title="Remove"><i class="fa fa-trash"></i></button></td>` : ''}
					</tr>`).join('')}</tbody></table>`);
		};
		renderUP();
		if (upEditable) {
			ctx.$content.find('#ipm-up-table').on('click', '.ipm-del-up', function () {
				const name = $(this).data('name');
				frappe.confirm(__('Remove this user permission?'), () => {
					ctx.api('remove_user_permission', { name }).then(() => loadDetail(user));
				});
			});
			ctx.$content.find('#ipm-add-up').on('click', () => addUserPermission(user, () => loadDetail(user)));
		}

		// doctype access table + filter
		const renderDT = () => {
			const term = (ctx.$content.find('#ipm-dt-filter').val() || '').toLowerCase().trim();
			const rows = (ov.doctype_access || []).filter((r) => !term || r.doctype.toLowerCase().includes(term));
			const mark = (v) => v ? '<span class="ipm-ok"><i class="fa fa-check"></i></span>' : '<span style="color:var(--ipm-muted)">·</span>';
			ctx.$content.find('#ipm-dt-body').html(rows.map((r) => `
				<tr><td>${esc(r.doctype)}</td>
					<td class="ipm-num">${mark(r.read)}</td><td class="ipm-num">${mark(r.write)}</td>
					<td class="ipm-num">${mark(r.create)}</td><td class="ipm-num">${mark(r.delete)}</td>
					<td class="ipm-num">${mark(r.submit)}</td><td class="ipm-num">${mark(r.cancel)}</td><td class="ipm-num">${mark(r.amend)}</td>
					<td class="ipm-num">${mark(r.print)}</td><td class="ipm-num">${mark(r.email)}</td><td class="ipm-num">${mark(r.report)}</td>
					<td class="ipm-num">${mark(r.export)}</td><td class="ipm-num">${mark(r.share)}</td></tr>`).join('') ||
				'<tr><td colspan="13" style="color:var(--ipm-muted);text-align:center;padding:16px;">No matches.</td></tr>');
		};
		renderDT();
		ctx.$content.find('#ipm-dt-filter').on('input', renderDT);
	};

	const addUserPermission = (user, after) => {
		const d = new frappe.ui.Dialog({
			title: __('Add User Permission'),
			fields: [
				{ fieldname: 'allow', fieldtype: 'Link', options: 'DocType', label: __('Allow (DocType)'), reqd: 1 },
				{ fieldname: 'for_value', fieldtype: 'Dynamic Link', options: 'allow', label: __('For Value'), reqd: 1 },
				{ fieldname: 'apply_to_all_doctypes', fieldtype: 'Check', label: __('Apply to all DocTypes'), default: 1 },
				{ fieldname: 'applicable_for', fieldtype: 'Link', options: 'DocType', label: __('Applicable For (DocType)'), depends_on: 'eval:!doc.apply_to_all_doctypes' }
			],
			primary_action_label: __('Add'),
			primary_action: (v) => {
				ctx.api('add_user_permission', {
					user, allow: v.allow, for_value: v.for_value,
					apply_to_all_doctypes: v.apply_to_all_doctypes ? 1 : 0,
					applicable_for: v.applicable_for || null
				}).then(() => { d.hide(); after && after(); });
			}
		});
		d.show();
	};

	renderUserList();
	if (st.selected) loadDetail(st.selected);
};
