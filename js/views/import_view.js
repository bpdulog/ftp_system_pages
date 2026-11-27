import { parseCsvRows, rowsToTable, resolveColumns, importRows, SUPPORTED_FIELDS, sha256Hex, ImportValidationError } from '../importer.js';
import { lockInstrumentFtp, todayIso } from '../engine.js';
import { downloadCsv } from '../exports.js';
import { esc, showToast } from '../ui.js';

let pendingImport = null;

export async function renderImport(host, ctx) {
    const { store, rerender, navigate } = ctx;
    const state = store.state;

    host.innerHTML = `
    <div class="card">
        <div class="heading">
            <div>
                <h2>Import CSV or Excel Instruments</h2>
                <p>All parsing and validation runs locally in your browser via SheetJS. Nothing is uploaded to a server.</p>
            </div>
            <div class="actions">
                <button class="btn" id="btnDlTemplate" type="button"><i class="fas fa-download"></i> Download CSV Template</button>
            </div>
        </div>

        <div class="form-grid" style="margin-top:1rem;">
            <div class="field">
                <label for="impSourceSystem">Source System Name</label>
                <input type="text" id="impSourceSystem" value="${esc(pendingImport?.sourceSystem || 'core-banking')}" placeholder="e.g., core-banking">
                <small>Paired with optional <code>source_id</code> to prevent duplicate imports.</small>
            </div>
            <div class="field">
                <label for="impFile">Select CSV or XLSX File</label>
                <input type="file" id="impFile" accept=".csv,.xlsx,.xls">
            </div>
        </div>

        <div class="dropzone-box" id="impDropzone">
            <div class="dropzone-icon"><i class="fas fa-cloud-upload-alt"></i></div>
            <strong>Drag &amp; drop a CSV or Excel workbook here, or click to browse</strong>
            <p class="small-note">Required columns: name, principal, rate (decimal like 0.055 or 5.5%), term_months (or term_years), instrument_type (loan/deposit).</p>
        </div>
    </div>

    <div id="impPreviewHost"></div>

    <div class="card">
        <h2>Import Batch History (${state.import_batches.length})</h2>
        <div class="table-wrap">
            <table class="compact">
                <thead><tr><th>ID</th><th>File Name</th><th>Source System</th><th>Status</th><th class="num">Rows</th><th class="num">Imported</th><th>Date</th></tr></thead>
                <tbody>
                    ${[...state.import_batches].reverse().map(b => `
                    <tr>
                        <td>#${b.id}</td>
                        <td>${esc(b.file_name)}</td>
                        <td>${esc(b.source_system || '&mdash;')}</td>
                        <td><span class="status-pill status-${b.status === 'imported' ? 'imported' : 'invalid'}">${esc(b.status)}</span></td>
                        <td class="num">${b.total_rows}</td>
                        <td class="num">${b.records_imported}</td>
                        <td>${esc(b.created_at.slice(0, 19).replace('T', ' '))}</td>
                    </tr>`).join('') || '<tr><td colspan="7" class="muted">No imports recorded yet.</td></tr>'}
                </tbody>
            </table>
        </div>
    </div>`;

    document.getElementById('btnDlTemplate')?.addEventListener('click', () => {
        downloadCsv('ftp_import_template.csv',
            ['source_id', 'name', 'instrument_type', 'amortization_type', 'rate_type', 'rate_index', 'reset_frequency_months', 'index_spread_bps', 'principal', 'rate', 'term_months', 'currency', 'cpr_percent', 'start_date'],
            [
                ['LN-101', 'Sample Fixed Commercial Loan', 'loan', 'amortizing', 'fixed', '', '', '', '1500000', '6.75%', '60', 'USD', '1.5', '2026-01-15'],
                ['LN-102', 'Sample Floating Revolver', 'loan', 'bullet', 'floating', 'SOFR', '3', '250', '2000000', '7.55%', '36', 'USD', '0', '2026-01-15'],
                ['CD-201', 'Sample 24M Term Deposit', 'deposit', 'bullet', 'fixed', '', '', '', '750000', '0.0410', '24', 'USD', '0', '2026-01-15'],
            ]);
    });

    const handleFile = async (file) => {
        if (!file) return;
        try {
            const buf = await file.arrayBuffer();
            const digest = await sha256Hex(buf);
            const isCsv = file.name.toLowerCase().endsWith('.csv');
            let sheets = {};
            let sheetNames = [];
            if (isCsv) {
                const text = new TextDecoder().decode(buf);
                sheets['CSV'] = rowsToTable(parseCsvRows(text));
                sheetNames = ['CSV'];
            } else {
                if (!window.XLSX) throw new Error('SheetJS library not loaded.');
                const wb = window.XLSX.read(buf, { type: 'array' });
                sheetNames = wb.SheetNames;
                for (const sName of sheetNames) {
                    const aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[sName], { header: 1, defval: '' });
                    sheets[sName] = rowsToTable(aoa);
                }
            }
            const firstSheet = sheetNames[0];
            let initialMapping = {};
            try { initialMapping = resolveColumns(sheets[firstSheet].columns); } catch { initialMapping = {}; }
            pendingImport = {
                fileName: file.name,
                digest,
                sourceSystem: document.getElementById('impSourceSystem').value.trim() || 'core-banking',
                sheets,
                sheetNames,
                selectedSheet: firstSheet,
                mapping: initialMapping,
            };
            renderPreview();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const renderPreview = () => {
        const previewHost = document.getElementById('impPreviewHost');
        if (!previewHost || !pendingImport) { if (previewHost) previewHost.innerHTML = ''; return; }
        const table = pendingImport.sheets[pendingImport.selectedSheet];
        let validRecords = null;
        let validationErrors = [];
        let mappingErr = null;
        try {
            const res = importRows(table.columns, table.rows, pendingImport.mapping);
            validRecords = res.records;
        } catch (err) {
            if (err instanceof ImportValidationError) validationErrors = err.errors;
            else mappingErr = err.message;
        }

        const dupFile = state.import_batches.some(b => b.status === 'imported' && b.file_sha256 === pendingImport.digest);

        previewHost.innerHTML = `
        <div class="card">
            <div class="heading">
                <div><h2>Preview: ${esc(pendingImport.fileName)} (${table.rows.length} rows)</h2></div>
                ${pendingImport.sheetNames.length > 1 ? `
                <label>Sheet <select id="impSheetSel">${pendingImport.sheetNames.map(s => `<option value="${esc(s)}" ${s === pendingImport.selectedSheet ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>` : ''}
            </div>
            ${dupFile ? `<div class="notice notice-warning">Warning: a file with this exact SHA-256 digest was already imported.</div>` : ''}

            <details open>
                <summary>Column Mapping</summary>
                <div class="form-grid" style="margin-top:.5rem;">
                    ${SUPPORTED_FIELDS.map(f => `
                    <div class="field">
                        <label>${esc(f)}</label>
                        <select class="imp-map-sel" data-field="${esc(f)}">
                            <option value="">-- Not mapped --</option>
                            ${table.columns.map(c => `<option value="${esc(c)}" ${pendingImport.mapping[f] === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                        </select>
                    </div>`).join('')}
                </div>
            </details>

            ${mappingErr ? `<div class="notice notice-error">${esc(mappingErr)}</div>` : ''}
            ${validationErrors.length ? `
            <div class="notice notice-error">
                <strong>${validationErrors.length} validation error(s) found (whole-file validation):</strong>
                <ul style="margin:.4rem 0 0 1.2rem;">
                    ${validationErrors.slice(0, 15).map(e => `<li>Row ${e.row} (${esc(e.field)} = "${esc(e.value)}"): ${esc(e.error)} &mdash; <em>${esc(e.guidance)}</em></li>`).join('')}
                </ul>
                <button class="btn btn-sm" id="btnDlErrCsv" type="button" style="margin-top:.5rem;">Download Error Report CSV</button>
            </div>` : ''}

            ${validRecords ? `
            <div class="notice notice-success">All ${validRecords.length} rows validated successfully and are ready to import.</div>
            <div class="table-wrap">
                <table class="compact">
                    <thead><tr><th>Name</th><th>Type</th><th>Pricing</th><th>Amort.</th><th class="num">Principal</th><th class="num">Rate</th><th class="num">Term</th><th>Currency</th><th>Origination</th></tr></thead>
                    <tbody>
                        ${validRecords.slice(0, 10).map(r => `<tr>
                            <td>${esc(r.name)}</td><td>${esc(r.instrument_type)}</td><td>${r.rate_type === 'floating' ? `${esc(r.rate_index || 'SOFR')} +${esc(r.index_spread_bps ?? 0)} bps (${r.reset_frequency_months || 3}M)` : 'Fixed'}</td><td>${esc(r.amortization_type)}</td>
                            <td class="num">${esc(r.principal)}</td><td class="num">${esc(r.contract_rate)}</td>
                            <td class="num">${r.term_months} mo</td><td>${esc(r.currency)}</td><td>${esc(r.origination_date || todayIso())}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
            <div class="form-actions" style="margin-top:1rem;">
                <button class="btn btn-primary" id="btnConfirmImport" type="button"><i class="fas fa-check"></i> Confirm Import (${validRecords.length} rows)</button>
                <button class="btn" id="btnCancelImport" type="button">Discard Preview</button>
            </div>` : ''}
        </div>`;

        document.getElementById('impSheetSel')?.addEventListener('change', (e) => {
            pendingImport.selectedSheet = e.target.value;
            try { pendingImport.mapping = resolveColumns(pendingImport.sheets[pendingImport.selectedSheet].columns); } catch { pendingImport.mapping = {}; }
            renderPreview();
        });
        previewHost.querySelectorAll('.imp-map-sel').forEach(sel => {
            sel.addEventListener('change', (e) => {
                pendingImport.mapping[e.target.getAttribute('data-field')] = e.target.value;
                renderPreview();
            });
        });
        document.getElementById('btnDlErrCsv')?.addEventListener('click', () => {
            downloadCsv('import_errors.csv', ['Row', 'Field', 'Column', 'Value', 'Error', 'Guidance'],
                validationErrors.map(e => [e.row, e.field, e.column, e.value, e.error, e.guidance]));
        });
        document.getElementById('btnCancelImport')?.addEventListener('click', () => {
            pendingImport = null;
            renderPreview();
        });
        document.getElementById('btnConfirmImport')?.addEventListener('click', async () => {
            try {
                const srcSys = document.getElementById('impSourceSystem').value.trim() || 'core-banking';
                const existingKeys = new Set(
                    state.instruments
                        .filter(i => i.source_system && i.source_id)
                        .map(i => `${i.source_system}\0${i.source_id}`)
                );
                for (const rec of validRecords) {
                    if (rec.source_id && existingKeys.has(`${srcSys}\0${rec.source_id}`)) {
                        throw new Error(`Duplicate source_id '${rec.source_id}' already exists for source system '${srcSys}'.`);
                    }
                    if (rec.source_id) existingKeys.add(`${srcSys}\0${rec.source_id}`);
                }

                const batchId = store.nextId('import_batches');
                const now = new Date().toISOString();
                const hasSofr = state.yield_curves.some(c => c.name === 'SOFR');

                for (const rec of validRecords) {
                    const inst = {
                        id: store.nextId('instruments'),
                        name: rec.name,
                        instrument_type: rec.instrument_type,
                        amortization_type: rec.amortization_type,
                        principal: rec.principal,
                        contract_rate: rec.contract_rate,
                        rate_type: rec.rate_type || 'fixed',
                        rate_index: rec.rate_index || null,
                        reset_frequency_months: rec.reset_frequency_months ?? null,
                        index_spread_bps: rec.index_spread_bps ?? null,
                        term_months: rec.term_months,
                        currency: rec.currency,
                        cpr_percent: rec.cpr_percent,
                        origination_date: rec.origination_date || todayIso(),
                        source_system: srcSys,
                        source_id: rec.source_id || null,
                        import_batch_id: batchId,
                        ftp_spread_override: null,
                        cpr_percent_override: null,
                        locked_yield_curve_id: null,
                        locked_base_rate: null,
                        locked_ftp_spread: null,
                        locked_ftp_rate: null,
                        locked_at: null,
                        bucket_id: null,
                        created_at: now,
                    };
                    if (hasSofr) lockInstrumentFtp(state, inst, 'SOFR');
                    state.instruments.push(inst);
                }

                state.import_batches.push({
                    id: batchId,
                    file_name: pendingImport.fileName,
                    file_sha256: pendingImport.digest,
                    source_system: srcSys,
                    uploaded_by: 'browser-user',
                    status: 'imported',
                    total_rows: validRecords.length,
                    records_imported: validRecords.length,
                    column_mapping: pendingImport.mapping,
                    error_report: null,
                    created_at: now,
                });

                await store.save();
                pendingImport = null;
                showToast(`Imported ${validRecords.length} instruments.`, 'success');
                navigate('/instruments');
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    };

    const fileInput = document.getElementById('impFile');
    const dropzone = document.getElementById('impDropzone');
    fileInput?.addEventListener('change', (e) => handleFile(e.target.files[0]));
    dropzone?.addEventListener('click', () => fileInput?.click());
    dropzone?.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone?.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        handleFile(e.dataTransfer?.files[0]);
    });

    if (pendingImport) renderPreview();
}
