// ── Hash-based SPA Router ─────────────────────────────────

const routes = {};
let currentCleanup = null;

const NAV_ITEMS = [
    { path: '/', label: 'Agents' },
    { path: '/demo', label: 'Call Tester' },
];

export function registerRoute(path, handler) {
    routes[path] = handler;
}

export function navigate(path) {
    window.location.hash = path;
}

export function getCurrentRoute() {
    return window.location.hash.slice(1) || '/';
}

function renderNav(activePath) {
    return `<nav class="dashboard-nav">
        <div class="nav-inner">
            <span class="nav-brand">Voice AI</span>
            <div class="nav-links">
                ${NAV_ITEMS.map(item =>
                    `<a href="#${item.path}" class="nav-link${activePath === item.path ? ' active' : ''}">${item.label}</a>`
                ).join('')}
            </div>
        </div>
    </nav>`;
}

function handleRoute() {
    const path = getCurrentRoute();
    const app = document.getElementById('app');

    // Run cleanup for previous page
    if (currentCleanup && typeof currentCleanup === 'function') {
        currentCleanup();
        currentCleanup = null;
    }

    // Render nav + page container
    app.innerHTML = renderNav(path) + '<div id="page"></div>';
    const page = document.getElementById('page');

    // Find matching route
    const handler = routes[path] || routes['/'];
    if (handler) {
        const result = handler(page);
        // Handler can return a cleanup function
        if (typeof result === 'function') {
            currentCleanup = result;
        }
    }
}

export function initRouter() {
    window.addEventListener('hashchange', handleRoute);
    // Initial route
    handleRoute();
}
