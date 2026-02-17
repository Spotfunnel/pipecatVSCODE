// ── Stepper Component ─────────────────────────────────────

const STEPS = [
    { number: 1, label: 'Name' },
    { number: 2, label: 'Prompt' },
    { number: 3, label: 'Webhooks' },
    { number: 4, label: 'Phone' },
];

export function renderStepper(currentStep) {
    const el = document.createElement('div');
    el.className = 'stepper';

    STEPS.forEach((step, i) => {
        // Step
        const stepEl = document.createElement('div');
        stepEl.className = 'stepper-step';
        if (i + 1 === currentStep) stepEl.classList.add('active');
        if (i + 1 < currentStep) stepEl.classList.add('completed');

        const numberEl = document.createElement('div');
        numberEl.className = 'stepper-number';
        numberEl.textContent = i + 1 < currentStep ? '✓' : step.number;

        const labelEl = document.createElement('span');
        labelEl.className = 'stepper-label';
        labelEl.textContent = step.label;

        stepEl.appendChild(numberEl);
        stepEl.appendChild(labelEl);
        el.appendChild(stepEl);

        // Connector (except after last step)
        if (i < STEPS.length - 1) {
            const connector = document.createElement('div');
            connector.className = 'stepper-connector';
            if (i + 1 < currentStep) connector.classList.add('filled');
            el.appendChild(connector);
        }
    });

    return el;
}
