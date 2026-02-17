// ── Onboarding Wizard Page ─────────────────────────────────

import { renderStepper } from '../components/stepper.js';
import { renderVoiceTest } from '../components/voice-test.js';
import { renderWebhookBuilder } from '../components/webhook-builder.js';
import { createAgent } from '../lib/storage.js';
import { navigate } from '../lib/router.js';

const VOICE_OPTIONS = [
  { value: 'coral', label: 'Coral', desc: 'Warm & friendly' },
  { value: 'alloy', label: 'Alloy', desc: 'Neutral & versatile' },
  { value: 'ash', label: 'Ash', desc: 'Crisp & direct' },
  { value: 'ballad', label: 'Ballad', desc: 'Smooth & melodic' },
  { value: 'echo', label: 'Echo', desc: 'Deep & resonant' },
  { value: 'sage', label: 'Sage', desc: 'Calm & wise' },
  { value: 'shimmer', label: 'Shimmer', desc: 'Bright & energetic' },
  { value: 'verse', label: 'Verse', desc: 'Poetic & expressive' },
];

const PROMPT_TEMPLATES = [
  {
    id: 'sales',
    title: '🛒 Sales Agent',
    desc: 'Handle inbound sales calls',
    prompt: `You are a friendly and professional sales assistant for a home services business.\n\n## Persona\nYou are warm, confident, and knowledgeable about the company's services. You speak naturally and avoid sounding robotic.\n\n## Task Objectives\n- Qualify leads by understanding their needs\n- Explain relevant services and pricing\n- Book appointments when the caller is ready\n- Collect contact information for follow-up\n\n## Rules\n- Never make up pricing — if unsure, offer to have someone call back\n- Always confirm the caller's name and number\n- Keep responses concise (2-3 sentences max)\n- If asked something outside your scope, politely redirect\n\n## Tools\n- book_appointment: Schedule a service appointment\n- send_info: Send product/service info via SMS`,
  },
  {
    id: 'support',
    title: '🎧 Support Agent',
    desc: 'Customer support & troubleshooting',
    prompt: `You are a patient and empathetic customer support agent.\n\n## Persona\nYou are understanding, solution-oriented, and professional. You acknowledge frustrations before jumping to solutions.\n\n## Task Objectives\n- Understand the customer's issue clearly\n- Provide step-by-step troubleshooting guidance\n- Escalate complex issues to human agents\n- Follow up on unresolved tickets\n\n## Rules\n- Always empathize first, solve second\n- Never argue with the customer\n- Keep responses clear and jargon-free\n- If you can't resolve it, escalate gracefully\n\n## Tools\n- create_ticket: Create a support ticket\n- lookup_order: Look up order status`,
  },
  {
    id: 'receptionist',
    title: '📞 Receptionist',
    desc: 'Answer calls & route enquiries',
    prompt: `You are a professional receptionist for a busy office.\n\n## Persona\nYou are polite, efficient, and organized. You speak clearly and get to the point quickly.\n\n## Task Objectives\n- Greet callers warmly\n- Understand the purpose of their call\n- Route calls to the appropriate department\n- Take messages when staff aren't available\n\n## Rules\n- Always ask for the caller's name\n- Keep hold times to a minimum\n- Never share internal information\n- Be concise — callers appreciate efficiency\n\n## Tools\n- transfer_call: Route to a specific department\n- take_message: Record a message for staff`,
  },
  {
    id: 'blank',
    title: '📝 Blank',
    desc: 'Start from scratch',
    prompt: '',
  },
];

export function renderOnboarding(container) {
  let currentStep = 1;
  const totalSteps = 4;

  // Agent state
  const agentData = {
    name: '',
    description: '',
    systemPrompt: '',
    selectedVoice: 'coral',
    webhooks: [],
    phoneConfig: {
      phoneNumber: '',
      voice: 'coral',
      vadThreshold: 0.55,
      stopSecs: 0.7,
    },
  };

  function render() {
    container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'page-header';
    header.innerHTML = `
      <h1>Create Agent</h1>
      <p>Set up your voice AI agent in a few steps</p>
    `;
    container.appendChild(header);

    // Stepper
    container.appendChild(renderStepper(currentStep));

    // Step Content
    const content = document.createElement('div');
    content.className = 'glass-card';

    const stepContent = document.createElement('div');
    stepContent.className = 'step-content';

    switch (currentStep) {
      case 1: renderStep1(stepContent); break;
      case 2: renderStep2(stepContent); break;
      case 3: renderStep3(stepContent); break;
      case 4: renderStep4(stepContent); break;
    }

    content.appendChild(stepContent);

    // Wrap everything in page container
    const page = document.createElement('div');
    page.className = 'page-container';
    page.appendChild(header);
    page.appendChild(renderStepper(currentStep));
    page.appendChild(content);

    container.innerHTML = '';
    container.appendChild(page);
  }

  // ── Step 1: Name ─────────────────────────────────────
  function renderStep1(el) {
    el.innerHTML = `
      <h2 class="step-title">Name Your Agent</h2>
      <p class="step-subtitle">Give your agent a name and description so you can identify it later.</p>

      <div class="form-group">
        <label class="form-label" for="agentName">Agent Name *</label>
        <input class="form-input" type="text" id="agentName" placeholder="e.g., Sales Assistant" value="${agentData.name}" autofocus />
      </div>

      <div class="form-group">
        <label class="form-label" for="agentDesc">Description</label>
        <input class="form-input" type="text" id="agentDesc" placeholder="e.g., Handles inbound sales calls for plumbing services" value="${agentData.description}" />
        <p class="form-hint">Optional — helps you remember what this agent does</p>
      </div>

      <div class="step-actions">
        <div></div>
        <button class="btn btn-primary" id="nextBtn">Continue →</button>
      </div>
    `;

    requestAnimationFrame(() => {
      const nameInput = el.querySelector('#agentName');
      const descInput = el.querySelector('#agentDesc');
      const nextBtn = el.querySelector('#nextBtn');

      nameInput?.addEventListener('input', (e) => { agentData.name = e.target.value; });
      descInput?.addEventListener('input', (e) => { agentData.description = e.target.value; });

      nextBtn?.addEventListener('click', () => {
        if (!agentData.name.trim()) {
          nameInput.style.borderColor = 'var(--accent-rose)';
          nameInput.focus();
          return;
        }
        currentStep = 2;
        render();
      });
    });
  }

  // ── Step 2: System Prompt + Voice Test ───────────────
  function renderStep2(el) {
    el.innerHTML = `
      <h2 class="step-title">System Prompt</h2>
      <p class="step-subtitle">Define your agent's personality, objectives, and rules. Use a template or start blank.</p>

      <div class="form-group">
        <label class="form-label">Quick Templates</label>
        <div class="template-grid" id="templateGrid"></div>
      </div>

      <div class="prompt-section">
        <div class="prompt-section-header">✍️ Prompt Editor</div>
        <textarea class="form-textarea" id="systemPrompt" rows="14" placeholder="Describe who your agent is, what it should do, and any rules it should follow...">${agentData.systemPrompt}</textarea>
      </div>

      <div class="prompt-section mt-lg">
        <div class="prompt-section-header">🎤 Voice Selector</div>
        <p class="voice-selector-hint">Pick a voice, then test it with the mic below</p>
        <div class="voice-grid" id="voiceGrid"></div>
      </div>

      <div class="prompt-section mt-lg">
        <div class="prompt-section-header">🔊 Voice Test</div>
        <div id="voiceTestMount"></div>
      </div>

      <div class="step-actions">
        <button class="btn btn-ghost" id="backBtn">← Back</button>
        <button class="btn btn-primary" id="nextBtn">Continue →</button>
      </div>
    `;

    requestAnimationFrame(() => {
      // Templates
      const grid = el.querySelector('#templateGrid');
      PROMPT_TEMPLATES.forEach(tmpl => {
        const card = document.createElement('div');
        card.className = 'template-card';
        card.innerHTML = `
          <div class="template-card-title">${tmpl.title}</div>
          <div class="template-card-desc">${tmpl.desc}</div>
        `;
        card.addEventListener('click', () => {
          agentData.systemPrompt = tmpl.prompt;
          const textarea = el.querySelector('#systemPrompt');
          if (textarea) textarea.value = tmpl.prompt;
          grid.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
        });
        grid.appendChild(card);
      });

      // Prompt textarea
      const textarea = el.querySelector('#systemPrompt');
      textarea?.addEventListener('input', (e) => { agentData.systemPrompt = e.target.value; });

      // Voice selector grid
      const voiceGrid = el.querySelector('#voiceGrid');
      VOICE_OPTIONS.forEach(v => {
        const card = document.createElement('div');
        card.className = 'voice-card' + (agentData.selectedVoice === v.value ? ' selected' : '');
        card.dataset.voice = v.value;
        card.innerHTML = `
          <div class="voice-card-icon">🎙️</div>
          <div class="voice-card-name">${v.label}</div>
          <div class="voice-card-desc">${v.desc}</div>
        `;
        card.addEventListener('click', () => {
          agentData.selectedVoice = v.value;
          agentData.phoneConfig.voice = v.value;
          voiceGrid.querySelectorAll('.voice-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
        });
        voiceGrid.appendChild(card);
      });

      // Voice test
      const mount = el.querySelector('#voiceTestMount');
      if (mount) mount.appendChild(renderVoiceTest(() => agentData.systemPrompt, () => agentData.selectedVoice));

      // Navigation
      el.querySelector('#backBtn')?.addEventListener('click', () => { currentStep = 1; render(); });
      el.querySelector('#nextBtn')?.addEventListener('click', () => { currentStep = 3; render(); });
    });
  }

  // ── Step 3: Webhooks ────────────────────────────────
  function renderStep3(el) {
    el.innerHTML = `
      <h2 class="step-title">Webhooks</h2>
      <p class="step-subtitle">Connect your agent to n8n workflows, CRMs, or any external service via webhooks.</p>
      <div id="webhookMount"></div>
      <div class="step-actions">
        <button class="btn btn-ghost" id="backBtn">← Back</button>
        <button class="btn btn-primary" id="nextBtn">Continue →</button>
      </div>
    `;

    requestAnimationFrame(() => {
      const mount = el.querySelector('#webhookMount');
      if (mount) {
        const builder = renderWebhookBuilder(agentData.webhooks, (updated) => {
          agentData.webhooks = updated;
        });
        mount.appendChild(builder);
      }

      el.querySelector('#backBtn')?.addEventListener('click', () => { currentStep = 2; render(); });
      el.querySelector('#nextBtn')?.addEventListener('click', () => { currentStep = 4; render(); });
    });
  }

  // ── Step 4: Phone Configuration ─────────────────────
  function renderStep4(el) {
    el.innerHTML = `
      <h2 class="step-title">Phone Configuration</h2>
      <p class="step-subtitle">Configure the phone number, voice, and responsiveness for your agent.</p>

      <div class="form-group">
        <label class="form-label" for="phoneNumber">Phone Number</label>
        <input class="form-input" type="tel" id="phoneNumber" placeholder="+61..." value="${agentData.phoneConfig.phoneNumber}" />
        <p class="form-hint">Telnyx phone number assigned to this agent</p>
      </div>

      <div class="form-group">
        <label class="form-label" for="voiceSelect">Voice</label>
        <select class="form-select" id="voiceSelect">
          ${VOICE_OPTIONS.map(v =>
      `<option value="${v.value}" ${agentData.phoneConfig.voice === v.value ? 'selected' : ''}>${v.label} — ${v.desc}</option>`
    ).join('')}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">VAD Sensitivity</label>
        <div class="range-row">
          <span style="font-size:var(--font-xs);color:var(--text-tertiary);">Less sensitive</span>
          <input class="range-slider" type="range" id="vadSlider" min="0.4" max="0.7" step="0.05" value="${agentData.phoneConfig.vadThreshold}" />
          <span style="font-size:var(--font-xs);color:var(--text-tertiary);">More sensitive</span>
        </div>
        <p class="form-hint">Threshold: <span class="range-value" id="vadValue">${agentData.phoneConfig.vadThreshold}</span> — Controls when the bot detects speech vs. background noise</p>
      </div>

      <div class="form-group">
        <label class="form-label">Response Latency</label>
        <div class="range-row">
          <span style="font-size:var(--font-xs);color:var(--text-tertiary);">Faster</span>
          <input class="range-slider" type="range" id="latencySlider" min="0.3" max="1.5" step="0.1" value="${agentData.phoneConfig.stopSecs}" />
          <span style="font-size:var(--font-xs);color:var(--text-tertiary);">Slower</span>
        </div>
        <p class="form-hint">Silence wait: <span class="range-value" id="latencyValue">${agentData.phoneConfig.stopSecs}s</span> — How long to wait after you stop speaking before responding</p>
      </div>

      <div class="step-actions">
        <button class="btn btn-ghost" id="backBtn">← Back</button>
        <button class="btn btn-primary btn-lg" id="createBtn">🚀 Create Agent</button>
      </div>
    `;

    requestAnimationFrame(() => {
      const phoneInput = el.querySelector('#phoneNumber');
      const voiceSelect = el.querySelector('#voiceSelect');
      const vadSlider = el.querySelector('#vadSlider');
      const vadValue = el.querySelector('#vadValue');
      const latencySlider = el.querySelector('#latencySlider');
      const latencyValue = el.querySelector('#latencyValue');

      phoneInput?.addEventListener('input', (e) => { agentData.phoneConfig.phoneNumber = e.target.value; });
      voiceSelect?.addEventListener('change', (e) => { agentData.phoneConfig.voice = e.target.value; });

      vadSlider?.addEventListener('input', (e) => {
        agentData.phoneConfig.vadThreshold = parseFloat(e.target.value);
        if (vadValue) vadValue.textContent = e.target.value;
      });

      latencySlider?.addEventListener('input', (e) => {
        agentData.phoneConfig.stopSecs = parseFloat(e.target.value);
        if (latencyValue) latencyValue.textContent = e.target.value + 's';
      });

      el.querySelector('#backBtn')?.addEventListener('click', () => { currentStep = 3; render(); });
      el.querySelector('#createBtn')?.addEventListener('click', () => {
        const agent = createAgent(agentData);
        // Brief success animation
        const btn = el.querySelector('#createBtn');
        if (btn) {
          btn.textContent = '✓ Agent Created!';
          btn.disabled = true;
        }
        setTimeout(() => navigate('/'), 800);
      });
    });
  }

  render();
}
