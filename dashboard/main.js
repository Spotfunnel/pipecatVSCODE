// ── Voice AI Agent Dashboard — Entry Point ────────────────

import { registerRoute, initRouter, navigate } from './lib/router.js';
import { renderOnboarding } from './pages/onboarding.js';
import { renderOverview } from './pages/overview.js';
import { renderDemo } from './pages/demo.js';
import { renderMeetDemo } from './pages/meet-demo.js';

// Register routes
registerRoute('/', (container) => {
    renderOverview(container);
});

registerRoute('/onboarding', (container) => {
    renderOnboarding(container);
});

registerRoute('/demo', (container) => {
    renderDemo(container);
});

registerRoute('/meet', (container) => {
    renderMeetDemo(container);
});

// Initialize
initRouter();

// If no hash, default to overview
if (!window.location.hash) {
    navigate('/');
}
