// Isoft Permission Manager - "Permissions" smart view.
// Left: filter/select a manageable user. Right: view & edit their roles,
// module access and user permissions (within the caller's scope), plus a
// read-only summary of doctype / page / report access derived from roles.
frappe.provide('ipm.views');

ipm.views.users = function (ctx) {
	const esc = ctx.esc;
	const boot = ctx.bootstrap || {};
	const caps = boot.capabilities || {};
	// enabled_only defaults off: the list is the only route back to someone who
	// was just disabled, so nothing is hidden unless the manager asks for it.
	const st = ctx.state.users = ctx.state.users || { selected: null, search: '', enabled_only: false };

	const disabledCount = (boot.users || []).filter((u) => !u.enabled).length;
	// The badge sits next to the words "Enabled only", so it has to be the number
	// of enabled users - i.e. what you get by ticking it. How many get hidden
	// belongs in the tooltip, not the badge.
	const enabledCount = (boot.users || []).length - disabledCount;

	ctx.$content.html(`
		<div class="ipm-layout">
			<div class="ipm-card">
				<div class="ipm-card-title"><i class="fa fa-users"></i> Users
					<span class="ipm-pill" id="ipm-user-count">${(boot.users || []).length}</span>
				</div>
				<input type="text" class="form-control ipm-input ipm-search" id="ipm-user-search" placeholder="Filter users…" value="${esc(st.search)}" style="width:100%;margin-bottom:8px;">
				${disabledCount ? `
				<div class="ipm-chips" style="margin-bottom:10px;">
					<span class="ipm-chip ipm-chip-sm ${st.enabled_only ? 'on' : ''}" id="ipm-enabled-only"
						title="${__('Hides {0} disabled account(s)', [disabledCount])}">
						<i class="fa ${st.enabled_only ? 'fa-check-square-o' : 'fa-square-o'}"></i>${__('Enabled only')}
						<span class="ipm-chip-count">${enabledCount}</span>
					</span>
				</div>` : ''}
				<div class="ipm-userlist" id="ipm-userlist"></div>
			</div>
			<div class="ipm-card" id="ipm-detail">
				<div class="ipm-empty"><i class="fa fa-id-card-o"></i>Select a user to view and manage their permissions.</div>
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
		const users = (boot.users || []).filter((u) => {
			if (term && !(u.full_name || '').toLowerCase().includes(term)
				&& !(u.name || '').toLowerCase().includes(term)) return false;
			// Never hide the user being looked at, even when filtered out - they
			// are usually the person who was just disabled, and hiding the row
			// mid-edit is how you lose track of them.
			if (st.enabled_only && !u.enabled && u.name !== st.selected) return false;
			return true;
		});
		ctx.$content.find('#ipm-user-count').text(users.length);
		const $list = ctx.$content.find('#ipm-userlist');
		if (!users.length) {
			$list.html(`<div class="ipm-empty" style="padding:24px">${st.enabled_only && disabledCount
				? __('No enabled users match.') : __('No users.')}</div>`);
			return;
		}
		// Disabled users stay listed (dimmed + badged) unless filtered out - hiding
		// them by default would strand anyone just switched off, with no way back.
		$list.html(users.map((u) => `
			<div class="ipm-user ${st.selected === u.name ? 'active' : ''} ${u.enabled ? '' : 'ipm-user-off'}" data-user="${esc(u.name)}">
				<div class="ipm-avatar">${esc(initials(u.full_name, u.name))}</div>
				<div class="ipm-user-meta">
					<span class="ipm-user-name">${esc(u.full_name || u.name)}</span>
					<span class="ipm-user-email">${esc(u.name)}</span>
				</div>
				${u.enabled ? '' : `<span class="ipm-off-badge">${__('Disabled')}</span>`}
			</div>`).join(''));
	};

	ctx.$content.find('#ipm-user-search').on('input', function () { st.search = $(this).val(); renderUserList(); });
	ctx.$content.find('#ipm-enabled-only').on('click', function () {
		st.enabled_only = !st.enabled_only;
		$(this).toggleClass('on', st.enabled_only)
			.find('i').attr('class', `fa ${st.enabled_only ? 'fa-check-square-o' : 'fa-square-o'}`);
		renderUserList();
	});
	ctx.$content.on('click', '.ipm-user', function () {
		st.selected = $(this).data('user');
		renderUserList();
		loadDetail(st.selected);
	});

	// ---- detail ----
	const loadDetail = (user) => {
		const $d = ctx.$content.find('#ipm-detail');
		$d.html(ipm.skeleton('detail'));
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
		const canResetPwd = !!caps.reset_password && p.name !== frappe.session.user;
		// Disabling yourself is refused server-side, so don't offer it either.
		const canToggle = !!caps.enable_disable && p.name !== frappe.session.user;
		const logsVisible = !!caps.logs;
		const pagesReportsVisible = !!caps.pages_reports;
		// Report access is stored as User Permissions, so editing it needs that cap.
		const reportsEditable = pagesReportsVisible && !!caps.user_permissions;

		const $d = ctx.$content.find('#ipm-detail');
		$d.html(`
			<div class="ipm-card-title" style="margin-bottom:14px;">
				<div class="ipm-avatar" style="width:38px;height:38px;font-size:14px;">${esc(initials(p.full_name, p.name))}</div>
				<div style="display:flex;flex-direction:column;line-height:1.25;">
					<span style="font-size:15px;">${esc(p.full_name || p.name)}</span>
					<span style="font-size:12px;color:var(--ipm-muted);">${esc(p.name)} · ${esc(p.user_type || '')} · ${p.enabled ? `<span class="ipm-ok">${__('Enabled')}</span>` : `<span class="ipm-no">${__('Disabled')}</span>`}</span>
				</div>
				<div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
					${canToggle ? `
						<button class="ipm-switch ${p.enabled ? 'on' : ''}" id="ipm-toggle-enabled"
							title="${p.enabled ? __('Disable this account') : __('Enable this account')}"
							aria-label="${__('Account enabled')}" role="switch" aria-checked="${p.enabled ? 'true' : 'false'}">
							<span class="ipm-switch-knob"></span>
						</button>` : ''}
					${logsVisible ? `<button class="ipm-btn ipm-btn-sm" id="ipm-open-logs" title="${__('Open the activity log filtered on this user')}"><i class="fa fa-history"></i> ${__('Activity log')}</button>` : ''}
					${canResetPwd ? `<button class="ipm-btn ipm-btn-sm" id="ipm-reset-pwd" title="${__('Reset this user\'s password')}"><i class="fa fa-key"></i> ${__('Reset password')}</button>` : ''}
				</div>
			</div>

			<div class="ipm-section" id="ipm-sec-roles">
				${sectionHead('fa-id-badge', 'Roles', (ov.roles_in_scope || []).length, rolesEditable ? 'click to toggle' : 'view only')}
				<div class="ipm-chips" id="ipm-roles"></div>
				${rolesEditable ? `<div class="ipm-actions"><button class="ipm-btn ipm-btn-primary" id="ipm-save-roles" disabled>Save roles</button><span class="ipm-dirty-note" id="ipm-roles-dirty" style="display:none;">Unsaved changes</span></div>` : ''}
			</div>

			<div class="ipm-section" id="ipm-sec-modules">
				${sectionHead('fa-th-large', 'Module access', (ov.modules || []).length, modsEditable ? 'click to toggle' : 'view only')}
				<div class="ipm-chips" id="ipm-modules"></div>
				${modsEditable ? `<div class="ipm-actions"><button class="ipm-btn ipm-btn-primary" id="ipm-save-modules" disabled>Save module access</button><span class="ipm-dirty-note" id="ipm-modules-dirty" style="display:none;">Unsaved changes</span></div>` : ''}
			</div>

			<div class="ipm-section" id="ipm-sec-up">
				${sectionHead('fa-filter', 'User Permissions', (ov.user_permissions || []).length, upEditable ? '' : 'view only')}
				<div id="ipm-up-table"></div>
				${upEditable ? `<div class="ipm-actions"><button class="ipm-btn ipm-btn-sm" id="ipm-add-up"><i class="fa fa-plus"></i> Add user permission</button></div>` : ''}
			</div>

			${pagesReportsVisible ? `
			<div class="ipm-section" id="ipm-sec-pages">
				${sectionHead('fa-window-maximize', 'Page access', null, reportsEditable ? '' : 'view only')}
				<div id="ipm-page-access"></div>
			</div>

			<div class="ipm-section" id="ipm-sec-reports">
				${sectionHead('fa-file-text-o', 'Report access', null, reportsEditable ? '' : 'view only')}
				<div id="ipm-report-access"></div>
			</div>` : ''}

			<div class="ipm-section">
				${sectionHead('fa-database', 'DocType access', (ov.doctype_access || []).length, 'view only · via roles')}
				<input type="text" class="form-control ipm-input" id="ipm-dt-filter" placeholder="Filter doctypes…" style="width:100%;margin-bottom:8px;">
				<div class="ipm-dt-scroll">
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

		// Module chips read exactly like the role chips above: highlighted + check
		// = the user HAS access. Only the rendering is inverted - blockState still
		// means "is blocked", because that is what set_module_blocks saves.
		const renderModChips = () => {
			ctx.$content.find('#ipm-modules').html((ov.modules || []).map((m) => {
				const allowed = !blockState[m.module];
				return `
				<span class="ipm-chip ${allowed ? 'on' : ''}" data-module="${esc(m.module)}" ${modsEditable ? '' : 'style="cursor:default;"'}
					title="${allowed ? __('Has access - click to block') : __('Blocked - click to allow')}">
					<i class="fa ${allowed ? 'fa-check' : 'fa-plus'}"></i>${esc(m.module)}</span>`;
			}).join('') ||
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

		// ---- page / report access ----
		// Frappe treats "no User Permissions" as unrestricted, so an empty
		// selection is ambiguous on its own. The mode toggle makes the intent
		// explicit: All = delete the permissions; Only selected = keep the chosen
		// ones (plus the always-allowed sentinel).
		//
		// One implementation drives both sections - they differ only in wording,
		// endpoint and how an item is labelled.
		const accessSection = (cfg) => {
			const data = cfg.data;
			if (!pagesReportsVisible || !data) return;
			const editable = cfg.editable;
			const state = { restricted: !!data.restricted, sel: new Set(data.allowed || []) };
			let dirtyFlag = false;
			const items = (data.reachable || []).map((r) =>
				(typeof r === 'string' ? { value: r, label: r } : { value: r.name, label: r.title || r.name }));

			const renderChips = () => {
				const term = (ctx.$content.find(`#${cfg.id}-filter`).val() || '').toLowerCase().trim();
				const shown = items.filter((it) => !term ||
					it.label.toLowerCase().includes(term) || it.value.toLowerCase().includes(term));
				ctx.$content.find(`#${cfg.id}-chips`).html(shown.map((it) => `
					<span class="ipm-chip ${state.sel.has(it.value) ? 'on' : ''}" data-val="${esc(it.value)}" ${editable ? '' : 'style="cursor:default;"'}>
						<i class="fa ${state.sel.has(it.value) ? 'fa-check' : 'fa-plus'}"></i>${esc(it.label)}</span>`).join('') ||
					`<span style="color:var(--ipm-muted);font-size:12px;">${__('No matches.')}</span>`);
			};

			const render = () => {
				const $c = ctx.$content.find(`#${cfg.id}`);
				const modeChip = (on, label, val, icon) => `
					<span class="ipm-chip ${on ? 'on' : ''}" data-mode="${val}" ${editable ? '' : 'style="cursor:default;"'}>
						<i class="fa ${icon}"></i>${label}</span>`;
				$c.html(`
					<div class="ipm-chips" style="margin-bottom:10px;">
						${modeChip(!state.restricted, cfg.allLabel, '0', 'fa-unlock')}
						${modeChip(state.restricted, __('Only selected'), '1', 'fa-lock')}
					</div>
					<div id="${cfg.id}-detail"></div>
				`);

				const $d = $c.find(`#${cfg.id}-detail`);
				if (!state.restricted) {
					$d.html(`<div style="color:var(--ipm-muted);font-size:12px;">
						${cfg.freeNote} ${items.length ? `(${items.length})` : ''}
					</div>`);
				} else {
					$d.html(`
						<input type="text" class="form-control ipm-input" id="${cfg.id}-filter" placeholder="${cfg.filterPlaceholder}" style="width:100%;max-width:460px;margin-bottom:10px;">
						<div class="ipm-chips" id="${cfg.id}-chips" style="max-height:260px;overflow:auto;"></div>
						<div class="ipm-dialog-note" style="margin-top:10px;">
							<i class="fa fa-info-circle" style="margin-top:2px;"></i>
							<span>${state.sel.size ? cfg.someNote(state.sel.size) : cfg.noneNote}
								${cfg.sentinelNote}</span>
						</div>`);
					renderChips();
				}

				if (editable) {
					$c.append(`<div class="ipm-actions">
						<button class="ipm-btn ipm-btn-primary" id="${cfg.id}-save" ${dirtyFlag ? '' : 'disabled'}>${cfg.saveLabel}</button>
						${dirtyFlag ? `<span class="ipm-dirty-note">${__('Unsaved changes')}</span>` : ''}
					</div>`);
				}
			};

			render();
			if (!editable) return;

			const $sec = ctx.$content.find(`#${cfg.sectionId}`);
			$sec.on('click', `#${cfg.id} > .ipm-chips [data-mode]`, function () {
				const next = String($(this).data('mode')) === '1';
				if (next === state.restricted) return;
				state.restricted = next;
				dirtyFlag = true;
				render();
			});
			$sec.on('click', `#${cfg.id}-chips .ipm-chip`, function () {
				const v = $(this).data('val');
				if (state.sel.has(v)) state.sel.delete(v); else state.sel.add(v);
				dirtyFlag = true;
				render();
			});
			$sec.on('input', `#${cfg.id}-filter`, renderChips);
			$sec.on('click', `#${cfg.id}-save`, function () {
				$(this).prop('disabled', true).text(__('Saving…'));
				ctx.api(cfg.method, Object.assign(
					{ user, restricted: state.restricted ? 1 : 0 },
					{ [cfg.payloadKey]: JSON.stringify(Array.from(state.sel)) }
				)).then(() => loadDetail(user))
					.catch(() => { dirtyFlag = true; render(); });
			});
		};

		accessSection({
			id: 'ipm-page-access', sectionId: 'ipm-sec-pages',
			data: ov.page_access, editable: reportsEditable,
			method: 'set_page_access', payloadKey: 'pages',
			allLabel: __('All pages'),
			saveLabel: __('Save page access'),
			filterPlaceholder: __('Filter pages…'),
			freeNote: __('No restriction: this user can open any page their roles allow.'),
			someNote: (n) => __('This user will only be able to open the {0} selected page(s).', [n]),
			noneNote: __('Nothing selected: this user will have no desk page access.'),
			// Blocking the print view would break document printing everywhere, so
			// it is never taken away - see SENTINEL_PAGE in utils.py.
			sentinelNote: __('Document printing is never blocked.')
		});

		accessSection({
			id: 'ipm-report-access', sectionId: 'ipm-sec-reports',
			data: ov.report_access, editable: reportsEditable,
			method: 'set_report_access', payloadKey: 'reports',
			allLabel: __('All reports'),
			saveLabel: __('Save report access'),
			filterPlaceholder: __('Filter reports…'),
			freeNote: __('No restriction: this user can open any report their roles allow.'),
			someNote: (n) => __('This user will only be able to open the {0} selected report(s).', [n]),
			noneNote: __('Nothing selected: this user will have no report access.'),
			sentinelNote: __('They always keep "My User Info", which shows their own account details.')
		});

		if (canResetPwd) {
			ctx.$content.find('#ipm-reset-pwd').on('click', () => confirmReset(p));
		}

		// Hand this user over to the Activity log tab, preselected. Filters already
		// chosen there survive, so switching users mid-investigation keeps them.
		if (logsVisible) {
			ctx.$content.find('#ipm-open-logs').on('click', () => {
				ctx.state.logs = Object.assign(ctx.state.logs || {}, { user: p.name });
				ctx.app.set_view('logs');
			});
		}

		if (canToggle) {
			ctx.$content.find('#ipm-toggle-enabled').on('click', function () {
				const turningOff = !!p.enabled;
				const $sw = $(this);
				const apply = () => {
					$sw.toggleClass('on', !turningOff).prop('disabled', true);
					ctx.api('set_user_enabled', { user, enabled: turningOff ? 0 : 1 })
						.then(() => ctx.app.reload())   // refresh the list so the badge follows
						.catch(() => { $sw.toggleClass('on', turningOff).prop('disabled', false); });
				};
				// Enabling is harmless; disabling kicks them out, so confirm that way only.
				if (!turningOff) return apply();
				frappe.confirm(
					__('Disable {0}? They will be signed out and unable to log in.', [esc(p.full_name || p.name)]),
					apply
				);
			});
		}
	};

	// ---- password reset ----
	// Step 1: confirm, since this immediately invalidates the current password.
	const confirmReset = (p) => {
		const who = `${esc(p.full_name || p.name)} (${esc(p.name)})`;
		const d = new frappe.ui.Dialog({
			title: __('Reset password'),
			fields: [{
				fieldtype: 'HTML', fieldname: 'warn', options: `
					<div class="ipm-dialog-body">
						<p>${__('Generate a new random password for')} <b>${who}</b>?</p>
						<ul>
							<li>${__('Their current password stops working immediately.')}</li>
							<li>${__('They are signed out of all sessions.')}</li>
							<li>${__('They must choose a new password when they next sign in.')}</li>
							<li>${__('The generated password is shown only once.')}</li>
						</ul>
					</div>`
			}],
			primary_action_label: __('Generate password'),
			primary_action: () => {
				d.get_primary_btn().prop('disabled', true).html(`<i class="fa fa-spinner fa-spin"></i> ${__('Resetting…')}`);
				ctx.api('reset_user_password', { user: p.name })
					.then((r) => { d.hide(); showPassword(p, r || {}); })
					.catch(() => d.hide());
			}
		});
		d.$wrapper.addClass('ipm-dialog');
		d.show();
	};

	// Step 2: show it once, with a copy button.
	const showPassword = (p, r) => {
		const d = new frappe.ui.Dialog({
			title: __('New password'),
			fields: [{
				fieldtype: 'HTML', fieldname: 'pwd', options: `
					<div class="ipm-dialog-body">
						<p style="margin-bottom:12px;">${__('Share this password with')} <b>${esc(p.full_name || p.name)}</b>.
							${__('It will not be shown again.')}</p>
						<div class="ipm-pwd-box">
							<code class="ipm-pwd" id="ipm-pwd-value">${esc(r.password || '')}</code>
							<button class="ipm-btn ipm-btn-sm ipm-pwd-copy" id="ipm-pwd-copy" title="${__('Copy to clipboard')}">
								<i class="fa fa-copy"></i></button>
						</div>
						${r.forced_change
							? `<div class="ipm-dialog-note"><i class="fa fa-info-circle" style="margin-top:2px;"></i>
								<span>${__('They will be asked to set their own password when they sign in with this one.')}</span></div>`
							: `<div class="ipm-dialog-note ipm-warn"><i class="fa fa-exclamation-triangle" style="margin-top:2px;"></i>
								<span>${__('"Force User to Reset Password" is off in System Settings, so they will not be prompted to change it. Ask a System Manager to enable it.')}</span></div>`}
					</div>`
			}],
			primary_action_label: __('Done'),
			primary_action: () => d.hide()
		});
		d.$wrapper.addClass('ipm-dialog');
		d.show();

		d.$wrapper.find('#ipm-pwd-copy').on('click', function () {
			frappe.utils.copy_to_clipboard(r.password || '');
			const $b = $(this).html('<i class="fa fa-check"></i>').addClass('ipm-copied');
			setTimeout(() => $b.html('<i class="fa fa-copy"></i>').removeClass('ipm-copied'), 1600);
		});
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
