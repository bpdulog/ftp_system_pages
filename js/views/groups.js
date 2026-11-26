import { esc, showToast } from '../ui.js';

const DIMENSIONS = ['legal_entity', 'business_line', 'branch', 'product'];

export async function renderGroups(host, ctx) {
    const { store, rerender } = ctx;
    const state = store.state;
    const memberCounts = new Map();
    for (const m of state.group_memberships) {
        memberCounts.set(m.group_id, (memberCounts.get(m.group_id) || 0) + 1);
    }

    host.innerHTML = `
    <div class="card">
        <h2>Create Reporting Group</h2>
        <p class="definition">Groups organize profitability by legal entity, business line, branch, or product without altering FTP pricing.</p>
        <form id="groupForm" class="filters">
            <label>Dimension
                <select id="gDim">${DIMENSIONS.map(d => `<option value="${d}">${esc(d.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}</option>`).join('')}</select>
            </label>
            <label>Group Name<input type="text" id="gName" required placeholder="e.g., Commercial Real Estate"></label>
            <label>Parent Group (optional)
                <select id="gParent">
                    <option value="">Root (No Parent)</option>
                    ${state.reporting_groups.map(g => `<option value="${g.id}">[${esc(g.dimension)}] ${esc(g.name)}</option>`).join('')}
                </select>
            </label>
            <button class="btn btn-primary" type="submit"><i class="fas fa-plus"></i> Add Group</button>
        </form>
    </div>

    <div class="card">
        <h2>Configured Reporting Groups (${state.reporting_groups.length})</h2>
        <div class="table-wrap">
            <table>
                <thead><tr><th>Dimension</th><th>Name</th><th>Parent</th><th class="num">Assigned Instruments</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                    ${state.reporting_groups.map(g => {
                        const parent = g.parent_id ? state.reporting_groups.find(p => p.id === g.parent_id) : null;
                        return `<tr>
                            <td>${esc(g.dimension.replace(/_/g, ' '))}</td>
                            <td><strong>${esc(g.name)}</strong></td>
                            <td>${parent ? esc(parent.name) : '<span class="muted">Root</span>'}</td>
                            <td class="num">${memberCounts.get(g.id) || 0}</td>
                            <td><span class="status-pill ${g.active !== false ? 'status-imported' : ''}">${g.active !== false ? 'Active' : 'Archived'}</span></td>
                            <td><button class="btn btn-sm btn-toggle-grp" data-id="${g.id}" type="button">${g.active !== false ? 'Archive' : 'Activate'}</button></td>
                        </tr>`;
                    }).join('') || '<tr><td colspan="6" class="muted">No reporting groups yet.</td></tr>'}
                </tbody>
            </table>
        </div>
    </div>`;

    document.getElementById('groupForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const dim = document.getElementById('gDim').value;
            const name = document.getElementById('gName').value.trim();
            const parentRaw = document.getElementById('gParent').value;
            const parentId = parentRaw ? Number(parentRaw) : null;
            if (!name) throw new Error('Group name is required.');
            if (parentId) {
                const p = state.reporting_groups.find(x => x.id === parentId);
                if (p && p.dimension !== dim) throw new Error('Parent group must belong to the same dimension.');
            }
            const dup = state.reporting_groups.some(g => g.dimension === dim && g.parent_id === parentId && g.name.toLowerCase() === name.toLowerCase());
            if (dup) throw new Error(`Group '${name}' already exists at this level.`);
            state.reporting_groups.push({
                id: store.nextId('reporting_groups'),
                name,
                dimension: dim,
                description: null,
                parent_id: parentId,
                active: true,
                created_at: new Date().toISOString(),
            });
            await store.save();
            showToast(`Reporting group "${name}" created.`, 'success');
            await rerender();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    host.querySelectorAll('.btn-toggle-grp').forEach(btn => {
        btn.addEventListener('click', async () => {
            const g = state.reporting_groups.find(x => x.id === Number(btn.getAttribute('data-id')));
            if (!g) return;
            g.active = g.active === false;
            await store.save();
            await rerender();
        });
    });
}
