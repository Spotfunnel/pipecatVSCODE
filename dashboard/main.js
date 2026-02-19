// ── Voice AI Agent Dashboard — Entry Point ────────────────

import { registerRoute, initRouter, navigate } from './lib/router.js';
import { renderOnboarding } from './pages/onboarding.js';
import { renderOverview } from './pages/overview.js';
import { renderDemo } from './pages/demo.js';
import { renderNavbar } from './components/navbar.js';

// Mount persistent navbar
const navbarMount = document.getElementById('navbar-mount');
function updateNavbar() {
    if (navbarMount) {
        navbarMount.innerHTML = '';
        navbarMount.appendChild(renderNavbar());
    }
}
updateNavbar();

// Re-render navbar on route change to update active tab
window.addEventListener('hashchange', updateNavbar);

// Register routes
registerRoute('/', (container) => {
    renderOverview(container);
});

registerRoute('/onboarding', (container) => {
    renderOnboarding(container);
});

registerRoute('/demo', (container) => {
    return renderDemo(container);
});

// Initialize
initRouter();

// If no hash, default to overview
if (!window.location.hash) {
    navigate('/');
}
