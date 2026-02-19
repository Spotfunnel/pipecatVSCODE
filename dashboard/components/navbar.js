// ── Top Navigation Bar ───────────────────────────────────────
import { navigate, getCurrentRoute } from '../lib/router.js';

export function renderNavbar() {
    const el = document.createElement('nav');
    el.className = 'top-navbar';

    const currentPath = getCurrentRoute();

    el.innerHTML = `
        <div class="navbar-inner">
            <div class="navbar-brand">Voice AI</div>
            <div class="navbar-tabs">
                <button class="navbar-tab ${currentPath === '/' || currentPath === '/onboarding' ? 'active' : ''}" data-path="/">Agents</button>
                <button class="navbar-tab ${currentPath === '/demo' ? 'active' : ''}" data-path="/demo">Demo</button>
            </div>
        </div>
    `;

    requestAnimationFrame(() => {
        el.querySelectorAll('.navbar-tab').forEach(tab => {
            tab.addEventListener('click', () => navigate(tab.dataset.path));
        });
    });

    return el;
}
