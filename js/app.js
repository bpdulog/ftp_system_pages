/**
 * SPA Router & Application Shell for FTP System (GitHub Pages Edition).
 */
import { BankStore } from './store.js';
import { initializeDemoBank } from './demo.js';
import { closeModal, destroyAllCharts, esc, showToast } from './ui.js';
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

const store = new BankStore(BankStore.getSavedMode());

export function navigate(hashPath) {
    window.location.hash = hashPath.startsWith('#') ? hashPath : `#${hashPath}`;
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
    document.title = `${title} — FTP System`;

    document.querySelectorAll('.nav-link[data-route]').forEach(el => {
        const base = el.getAttribute('data-route');
        const active = path === base || (base !== '/dashboard' && path.startsWith(base + '/') && path !== '/instruments/new');
        el.classList.toggle('active', active);
    });

    const isDemo = store.mode === 'demo';
    const badgeHost = document.getElementById('sidebarDemoBadge');
    const switchHost = document.getElementById('sidebarDemoSwitch');
    const bannerHost = document.getElementById('demoBannerHost');
    const statusText = document.getElementById('storageStatusText');

    if (badgeHost) {
        badgeHost.innerHTML = isDemo ? '<span class="demo-badge">SAMPLE BANK</span>' : '';
    }
    if (statusText) {
        statusText.textContent = isDemo ? 'Demo DB (Browser)' : 'Live DB (Browser)';
    }
    if (switchHost) {
        switchHost.innerHTML = isDemo
            ? `<button class="nav-link" id="btnSwitchLiveSide" type="button"><i class="fas fa-arrow-left"></i><span>Return to My Bank</span></button>`
            : `<button class="nav-link" id="btnSwitchDemoSide" type="button"><i class="fas fa-university"></i><span>Load Example Bank</span></button>`;
        document.getElementById('btnSwitchDemoSide')?.addEventListener('click', switchToDemo);
        document.getElementById('btnSwitchLiveSide')?.addEventListener('click', switchToLive);
    }
    if (bannerHost) {
        bannerHost.innerHTML = isDemo
            ? `<div class="demo-banner">
                <span><strong>Sample bank mode.</strong> These 13 fictional instruments and illustrative calculations live in an isolated browser demo store, separate from your bank.</span>
                <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
                    <button class="btn btn-sm" id="btnResetDemo" type="button"><i class="fas fa-rotate-left"></i> Reset sample</button>
                    <button class="btn btn-sm btn-primary" id="btnSwitchLiveBanner" type="button">Return to my bank</button>
                </div>
               </div>`
            : '';
        document.getElementById('btnSwitchLiveBanner')?.addEventListener('click', switchToLive);
        document.getElementById('btnResetDemo')?.addEventListener('click', async () => {
            await store.reset(true);
            await initializeDemoBank(store);
            showToast('Sample bank reset to initial fixtures.', 'success');
            await renderCurrentRoute();
        });
    }
}

export async function switchToDemo() {
    BankStore.setSavedMode('demo');
    await store.load('demo');
    await initializeDemoBank(store);
    showToast('Loaded Example Bank (isolated browser demo).', 'success');
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
            title = 'Yield Curve';
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
            title = 'Methodology & Guide';
            updateChrome('/methodology', title);
            await renderMethodology(host, ctx);
        } else if (path === '/backup') {
            title = 'Browser Backup & Storage';
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
    document.getElementById('menuToggle')?.addEventListener('click', () => {
        document.getElementById('sidebar')?.classList.toggle('active');
    });
    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('menuToggle');
        if (window.innerWidth <= 900 && sidebar?.classList.contains('active') && !sidebar.contains(e.target) && !toggle?.contains(e.target)) {
            sidebar.classList.remove('active');
        }
    });
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 900) document.getElementById('sidebar')?.classList.remove('active');
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
