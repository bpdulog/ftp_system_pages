/**
 * SPA Router & Application Shell for Open ALCO (GitHub Pages Edition).
 */
import { BankStore } from './store.js';
import { initializeDemoBank } from './demo.js';
import { closeModal, destroyAllCharts, esc, showToast, syncChartDefaults } from './ui.js';
import { renderDashboard } from './views/dashboard.js';
import { renderExecutive } from './views/executive.js';
import { renderInstruments, renderInstrumentForm, renderInstrumentDetail } from './views/instruments.js';
import { renderImport } from './views/import_view.js';
import { renderCurve } from './views/curve.js';
import { renderBuckets } from './views/buckets.js';
import { renderGroups } from './views/groups.js';
import { renderAnalytics } from './views/analytics_view.js';
import { renderAlco } from './views/alco_view.js';
import { renderRuns } from './views/runs.js';
import { renderRepricing } from './views/repricing.js';
import { renderStress } from './views/stress.js';
import { renderMethodology } from './views/methodology.js';
import { renderBackup } from './views/backup.js';

const THEME_KEY = 'ftp_pages_theme';
const store = new BankStore(BankStore.getSavedMode());

export function navigate(hashPath) {
    window.location.hash = hashPath.startsWith('#') ? hashPath : `#${hashPath}`;
}

function applyTheme(theme) {
    const t = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
    const btn = document.getElementById('themeToggleBtn');
    if (btn) {
        btn.innerHTML = t === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        btn.title = t === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
    syncChartDefaults();
}

function getSavedTheme() {
    try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
}

function parseRoute() {
    const raw = (window.location.hash || '#/dashboard').slice(1);
    const [pathPart, queryPart] = raw.split('?');
    const path = pathPart || '/dashboard';
    const params = new URLSearchParams(queryPart || '');
    return { path, params };
}

function updateChrome(path, title) {
    document.getElementById('pageTitle').textContent = title;
    document.title = `${title} — Open ALCO`;

    document.querySelectorAll('.nav-link[data-route]').forEach(el => {
        const base = el.getAttribute('data-route');
        const active = path === base || (base !== '/dashboard' && path.startsWith(base + '/') && path !== '/instruments/new');
        el.classList.toggle('active', active);
    });

    const isDemo = store.mode === 'demo';
    const badgeHost = document.getElementById('sidebarDemoBadge');
    const bannerHost = document.getElementById('demoBannerHost');
    const statusText = document.getElementById('storageStatusText');
    const topModePill = document.getElementById('topModePill');

    if (badgeHost) {
        badgeHost.innerHTML = isDemo ? '<span class="demo-badge"><i class="fas fa-flask"></i> SAMPLE BANK</span>' : '';
    }
    if (statusText) {
        statusText.textContent = isDemo ? 'Demo Store · IndexedDB' : 'Live Store · IndexedDB';
    }
    if (topModePill) {
        topModePill.innerHTML = isDemo
            ? `<button class="mode-pill is-demo" id="btnTopModeSwitch" type="button" title="Return to your Live Bank"><i class="fas fa-flask"></i> Sample Bank &middot; Exit</button>`
            : `<button class="mode-pill" id="btnTopModeSwitch" type="button" title="Load 13-instrument Sample Bank"><i class="fas fa-university"></i> Load Sample Bank</button>`;
        document.getElementById('btnTopModeSwitch')?.addEventListener('click', isDemo ? switchToLive : switchToDemo);
    }
    if (bannerHost) {
        bannerHost.innerHTML = isDemo
            ? `<div class="demo-banner">
                <span><strong>Sample Bank mode.</strong> Exploring 13 fictional commercial loans &amp; term deposits in an isolated browser workspace.</span>
                <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
                    <button class="btn btn-sm" id="btnResetDemo" type="button"><i class="fas fa-rotate-left"></i> Reset sample</button>
                    <button class="btn btn-sm btn-primary" id="btnSwitchLiveBanner" type="button">Return to Live Bank</button>
                </div>
               </div>`
            : '';
        document.getElementById('btnSwitchLiveBanner')?.addEventListener('click', switchToLive);
        document.getElementById('btnResetDemo')?.addEventListener('click', async () => {
            await store.reset(true);
            await initializeDemoBank(store);
            showToast('Sample Bank reset to initial fixtures.', 'success');
            await renderCurrentRoute();
        });
    }
}

export async function switchToDemo() {
    BankStore.setSavedMode('demo');
    await store.load('demo');
    await initializeDemoBank(store);
    showToast('Loaded Sample Bank (isolated browser demo).', 'success');
    await renderCurrentRoute();
}

export async function switchToLive() {
    BankStore.setSavedMode('live');
    await store.load('live');
    showToast('Switched back to your Live Bank.', 'info');
    await renderCurrentRoute();
}

async function renderCurrentRoute() {
    const { path, params } = parseRoute();
    const host = document.getElementById('viewHost');
    destroyAllCharts();

    // Restart subtle fade animation on view change
    host.classList.remove('view-enter');
    void host.offsetWidth;
    host.classList.add('view-enter');

    const ctx = { store, params, navigate, rerender: renderCurrentRoute, switchToDemo, switchToLive };
    let title = 'Dashboard';

    try {
        if (path === '/' || path === '/dashboard') {
            title = 'Dashboard';
            updateChrome('/dashboard', title);
            await renderDashboard(host, ctx);
        } else if (path === '/executive') {
            title = 'Executive Summary';
            updateChrome('/executive', title);
            await renderExecutive(host, ctx);
        } else if (path === '/instruments') {
            title = 'Instruments';
            updateChrome('/instruments', title);
            await renderInstruments(host, ctx);
        } else if (path === '/instruments/new') {
            title = 'Add Instrument';
            updateChrome('/instruments/new', title);
            await renderInstrumentForm(host, ctx);
        } else if (/^\/instruments\/\d+$/.test(path)) {
            const id = Number(path.split('/')[2]);
            title = 'Instrument Detail';
            updateChrome('/instruments', title);
            await renderInstrumentDetail(host, ctx, id);
        } else if (path === '/import') {
            title = 'Import Data';
            updateChrome('/import', title);
            await renderImport(host, ctx);
        } else if (path === '/curve') {
            title = 'Yield Curves';
            updateChrome('/curve', title);
            await renderCurve(host, ctx);
        } else if (path === '/buckets') {
            title = 'Pricing Buckets';
            updateChrome('/buckets', title);
            await renderBuckets(host, ctx);
        } else if (path === '/groups') {
            title = 'Reporting Groups';
            updateChrome('/groups', title);
            await renderGroups(host, ctx);
        } else if (path === '/analytics') {
            title = 'FTP Analytics';
            updateChrome('/analytics', title);
            await renderAnalytics(host, ctx);
        } else if (path === '/alco') {
            title = 'ALCO Reports';
            updateChrome('/alco', title);
            await renderAlco(host, ctx);
        } else if (path === '/runs') {
            title = 'Calculation Runs';
            updateChrome('/runs', title);
            await renderRuns(host, ctx);
        } else if (path === '/repricing-gap') {
            title = 'Repricing Gap & Margin Trends';
            updateChrome('/repricing-gap', title);
            await renderRepricing(host, ctx);
        } else if (path === '/stress-test') {
            title = 'Stress Testing';
            updateChrome('/stress-test', title);
            await renderStress(host, ctx);
        } else if (path === '/methodology') {
            title = 'Methodology & Sandbox';
            updateChrome('/methodology', title);
            await renderMethodology(host, ctx);
        } else if (path === '/backup') {
            title = 'Backup & Storage';
            updateChrome('/backup', title);
            await renderBackup(host, ctx);
        } else {
            title = 'Not Found';
            updateChrome('', title);
            host.innerHTML = `<div class="card empty-state"><h2>Page not found</h2><p>Unknown route: <code>${esc(path)}</code></p><a class="btn btn-primary" href="#/dashboard">Go to Dashboard</a></div>`;
        }
    } catch (err) {
        console.error(err);
        host.innerHTML = `<div class="card"><div class="notice notice-error"><strong>Error rendering view:</strong> ${esc(err.message || err)}</div></div>`;
    }
}

async function boot() {
    applyTheme(getSavedTheme());

    document.getElementById('themeToggleBtn')?.addEventListener('click', async () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        await renderCurrentRoute();
    });

    document.getElementById('menuToggle')?.addEventListener('click', () => {
        document.getElementById('sidebar')?.classList.toggle('active');
    });
    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('menuToggle');
        if (window.innerWidth <= 960 && sidebar?.classList.contains('active') && !sidebar.contains(e.target) && !toggle?.contains(e.target)) {
            sidebar.classList.remove('active');
        }
    });
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 960) document.getElementById('sidebar')?.classList.remove('active');
        });
    });
    document.getElementById('modalCloseBtn')?.addEventListener('click', closeModal);
    document.getElementById('appModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'appModal') closeModal();
    });

    await store.load(BankStore.getSavedMode());
    if (store.mode === 'demo') {
        await initializeDemoBank(store);
    }

    window.addEventListener('hashchange', renderCurrentRoute);
    if (!window.location.hash) window.location.hash = '#/dashboard';
    else await renderCurrentRoute();
}

boot();
