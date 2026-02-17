// ── Hash-based SPA Router ─────────────────────────────────

const routes = {};
let currentCleanup = null;

export function registerRoute(path, handler) {
    routes[path] = handler;
}

export function navigate(path) {
    window.location.hash = path;
}

export function getCurrentRoute() {
    return window.location.hash.slice(1) || '/';
}

function handleRoute() {
    const path = getCurrentRoute();
    const app = document.getElementById('app');

    // Run cleanup for previous page
    if (currentCleanup && typeof currentCleanup === 'function') {
        currentCleanup();
        currentCleanup = null;
    }

    // Find matching route
    const handler = routes[path] || routes['/'];
    if (handler) {
        const result = handler(app);
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
