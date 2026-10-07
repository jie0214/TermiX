import { t, getLocale } from '../../i18n/index.ts';
import { aiConnectionStore } from './AIConnectionStore.ts';
import { analysisSessionCache, analysisTargetKey } from './AnalysisSessionCache.ts';
import { AIConnectionAPI } from './AIConnectionAPI.ts';
import { createPodAnalysisStore } from './PodAnalysisStore.ts';
import type { AnalysisTarget } from './types.ts';
import './ai.css';
import { renderAIReport } from './AIReport.ts';

export function escapeAIText(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
const e = escapeAIText;

function updateHTML(root: HTMLElement, html: string) {
  const active = root.contains(document.activeElement) ? document.activeElement?.id : '';
  const openDetails = [...root.querySelectorAll<HTMLDetailsElement>('details[id]')].filter(d => d.open).map(d => d.id);
  const scrollTop = root.querySelector('.ai-analysis-scroll')?.scrollTop || 0;
  root.innerHTML = html;
  const scroll = root.querySelector('.ai-analysis-scroll');
  if (scroll) scroll.scrollTop = scrollTop;
  for (const id of openDetails) root.querySelector<HTMLDetailsElement>('#' + CSS.escape(id))?.setAttribute('open', '');
  if (active) root.querySelector<HTMLElement>('#' + CSS.escape(active))?.focus({ preventScroll: true });
}

class AIConnectionsPanel extends HTMLElement {
  private unsubscribe?: () => void;
  connectedCallback() {
    this.unsubscribe?.();
    this.unsubscribe = aiConnectionStore.subscribe(() => this.render());
    this.render();
    void aiConnectionStore.getState().refresh();
  }
  disconnectedCallback() { this.unsubscribe?.(); }
  refresh() { return aiConnectionStore.getState().refresh(); }
  private render() {
    const state = aiConnectionStore.getState();
    updateHTML(this, `<div class="ai-connection-heading"><h3>AI Connection</h3><button id="ai-connection-refresh" class="no-drag ui-button ui-button--secondary" ${state.loading ? 'disabled' : ''}>${state.loading ? t('ai.detecting') : t('ai.refresh')}</button></div>
      ${state.error ? `<p class="ai-error" role="alert">${e(state.error)}</p>` : ''}
      <div class="ai-connection-list">${state.connections.map(c => `<article class="ai-connection-row">
        <div class="ai-connection-identity"><strong>${e(c.name)}</strong><span>${e(c.path)}</span></div>
        <div class="ai-connection-actions"><span class="${c.connected && c.installed ? 'ai-connected' : ''}" role="status">${state.pending[c.id] ? t('ai.busy') : !c.installed ? t('ai.notInstalled') : state.status[c.id] || (c.connected ? t('ai.connected') : t('ai.disconnected'))}</span>
          <button id="ai-test-${e(c.id)}" data-ai-test="${e(c.id)}" class="no-drag ui-button ui-button--secondary" ${!c.connected || !c.installed || state.pending[c.id] ? 'disabled' : ''}>${t('ai.test')}</button>
          <button id="ai-toggle-${e(c.id)}" data-ai-toggle="${e(c.id)}" class="no-drag ui-button ${c.connected ? 'ui-button--secondary' : 'ui-button--primary'}" ${state.pending[c.id] ? 'disabled' : ''}>${c.connected ? t('ai.disconnect') : t('ai.connect')}</button>
        </div>${state.errors[c.id] ? `<p class="ai-error" role="alert">${e(state.errors[c.id])}</p>` : ''}
      </article>`).join('')}${!state.connections.length && !state.loading && !state.error ? `<p class="ai-empty">${t('ai.none')}</p>` : ''}</div>`);
    this.querySelector('#ai-connection-refresh')?.addEventListener('click', () => void state.refresh());
    this.querySelectorAll<HTMLButtonElement>('[data-ai-toggle]').forEach(button => button.addEventListener('click', () => void state.toggle(button.dataset.aiToggle!)));
    this.querySelectorAll<HTMLButtonElement>('[data-ai-test]').forEach(button => button.addEventListener('click', () => void state.test(button.dataset.aiTest!)));
  }
}

class PodAIAnalysisPanel extends HTMLElement {
  static observedAttributes = ['data-target'];
  private store = createPodAnalysisStore(AIConnectionAPI, analysisSessionCache);
  private unsubscribeCache?: () => void;
  private draft = '';
  private unsubscribe?: () => void;
  private unsubscribeConnections?: () => void;
  connectedCallback() {
    this.unsubscribe?.();
    this.unsubscribeConnections?.();
    this.unsubscribeCache?.();
    this.unsubscribeCache = analysisSessionCache.subscribe((state, previous) => {
      if (state.epoch !== previous.epoch) this.draft = '';
      this.store.getState().syncCache();
    });
    this.unsubscribe = this.store.subscribe(() => this.render());
    this.unsubscribeConnections = aiConnectionStore.subscribe(state => this.store.getState().setConnections(state.connections));
    this.readTarget();
    this.store.getState().setConnections(aiConnectionStore.getState().connections);
    this.render();
    void aiConnectionStore.getState().refresh();
  }
  disconnectedCallback() {
    this.unsubscribe?.();
    this.unsubscribeConnections?.();
    this.unsubscribeCache?.();
    this.store.getState().setTarget(null);
  }
  attributeChangedCallback() { if (this.isConnected) this.readTarget(); }
  private readTarget() {
    try {
      const target: AnalysisTarget = JSON.parse(this.getAttribute('data-target') || 'null');
      if (analysisTargetKey(target) !== analysisTargetKey(this.store.getState().target)) this.draft = '';
      this.store.getState().setTarget(target);
    } catch { this.store.getState().setTarget(null); }
  }
  private render() {
    const s = this.store.getState();
    const isEvent = Boolean(s.target && 'eventName' in s.target);
    const containers = s.target && 'containers' in s.target ? s.target.containers : [];
    const agentName = (id: string) => s.connections.find(c => c.id === id)?.name || id;
    const ready = Boolean(s.target && s.modelId && !s.modelsLoading && !s.loading);
    const disabled = s.loading ? 'disabled' : '';
    updateHTML(this, `<section class="ai-analysis"><div class="ai-analysis-scroll">
      <div class="ai-analysis-selectors">
        <label for="pod-ai-agent">${t('ai.agent')}<select id="pod-ai-agent" ${disabled} ${!s.connections.length ? 'disabled' : ''}>${s.connections.length ? s.connections.map(c => `<option value="${e(c.id)}" ${c.id === s.agentId ? 'selected' : ''}>${e(c.name)}</option>`).join('') : `<option>${t('ai.notConnected')}</option>`}</select></label>
        <label for="pod-ai-model">${t('ai.model')}<select id="pod-ai-model" ${disabled} ${!s.models.length || s.modelsLoading ? 'disabled' : ''}>${s.modelsLoading ? `<option>${t('ai.loading')}</option>` : s.models.length ? s.models.map(m => `<option value="${e(m.id)}" ${m.id === s.modelId ? 'selected' : ''}>${e(m.name || m.id)}</option>`).join('') : `<option>${t('ai.noModels')}</option>`}</select></label>
      </div>
      <div class="ai-analysis-links"><button id="pod-ai-settings" class="no-drag ui-button ui-button--quiet">AI Connection</button><button id="pod-ai-model-refresh" class="no-drag ui-button ui-button--quiet" ${!s.agentId || s.modelsLoading || s.loading ? 'disabled' : ''}>${t('ai.refreshModels')}</button></div>
      ${s.modelsError ? `<p class="ai-error" role="alert">${e(s.modelsError)}</p>` : ''}
      <details id="pod-ai-scope" class="ai-analysis-scope"><summary>${t('ai.scope')}</summary>
        ${isEvent ? `<p>${t('ai.eventScope')}</p>` : `
        <div class="ai-analysis-checks"><label><input type="checkbox" checked disabled> ${t('ai.podSpec')}</label><label><input id="pod-ai-events" type="checkbox" ${s.includeEvents ? 'checked' : ''} ${disabled}> Events</label><label><input id="pod-ai-logs" type="checkbox" ${s.includeLogs ? 'checked' : ''} ${disabled}> ${t('ai.recentLogs')}</label></div>
        ${s.includeLogs ? `<label for="pod-ai-container">${t('ai.container')}<select id="pod-ai-container" ${disabled}>${containers.map(name => `<option value="${e(name)}" ${name === s.container ? 'selected' : ''}>${e(name)}</option>`).join('')}</select></label>` : ''}
        <p>${t('ai.dataNotice')}</p>`}

      </details>
      <div class="ai-analysis-run"><span role="status">${s.loading ? (s.pendingQuestion ? t('ai.answering') : t('ai.analyzing')) : t('ai.readonly')}</span>${s.loading ? `<button id="pod-ai-cancel" class="no-drag ui-button ui-button--secondary">${t('ai.cancel')}</button>` : `<button id="pod-ai-run" class="no-drag ui-button ui-button--primary" ${ready ? '' : 'disabled'}>${s.result ? t('ai.reanalyze') : t('ai.analyze')}</button>`}</div>
      ${s.error && !s.result ? `<p class="ai-error" role="alert">${e(s.error)}</p>` : ''}
      ${s.result ? `<section class="ai-analysis-result"><div class="ai-analysis-result-meta"><strong>${t('ai.complete')}</strong><span>${e(agentName(s.result.agentId))} / ${e(s.result.modelId)}</span><time>${e(new Date(s.result.snapshot.capturedAt).toLocaleString(getLocale()))}</time></div><div class="ai-analysis-report">${renderAIReport(s.result.text)}</div>
        ${s.result.snapshot.warnings.map(w => `<p class="ai-error">${e(w)}</p>`).join('')}
        <h4>${t('ai.evidence')}</h4>${s.result.snapshot.evidence.map((item, index) => `<details id="pod-ai-evidence-${index}" class="ai-analysis-evidence"><summary>${e(item.title)}${item.truncated ? t('ai.truncated') : ''}</summary><pre>${e(item.content)}</pre></details>`).join('')}
      </section>` : !s.loading && !s.error ? `<div class="ai-empty">${s.connections.length ? (isEvent ? t('ai.startEvent') : t('ai.startPod')) : t('ai.noAgent')}</div>` : ''}
      ${s.turns.length || s.pendingQuestion ? `<section class="ai-conversation" aria-label="${t('ai.conversation')}">${s.turns.map((turn, index) => `
        <article class="ai-conversation-turn"><p class="ai-conversation-question">${e(turn.question)}</p>
          <div class="ai-analysis-result-meta"><span>${e(agentName(turn.response.agentId))} / ${e(turn.response.modelId)}</span><time>${e(new Date(turn.response.snapshot.capturedAt).toLocaleString(getLocale()))}</time></div>
          <div class="ai-analysis-report">${renderAIReport(turn.response.text)}</div>
          ${turn.response.snapshot.warnings.map(w => `<p class="ai-error">${e(w)}</p>`).join('')}
          <details id="ai-turn-evidence-${index}" class="ai-analysis-evidence"><summary>${t('ai.responseEvidence')}</summary>${turn.response.snapshot.evidence.map(item => `<h4>${e(item.title)}${item.truncated ? t('ai.truncated') : ''}</h4><pre>${e(item.content)}</pre>`).join('')}</details>
        </article>`).join('')}${s.pendingQuestion ? `<p class="ai-conversation-question">${e(s.pendingQuestion)}</p><p class="ai-conversation-pending" role="status">${t('ai.answering')}</p>` : ''}</section>` : ''}
      </div>
      <form class="ai-followup-composer" aria-label="${t('ai.followup')}">
        <label for="ai-followup-input" class="ai-followup-label">${t('ai.followup')}</label>
        <textarea id="ai-followup-input" class="no-drag" rows="2" maxlength="4000" placeholder="${s.result ? t('ai.question') : t('ai.afterAnalysis')}" ${!s.result || s.loading ? 'disabled' : ''}>${e(this.draft)}</textarea>
        ${s.error && s.result ? `<p class="ai-error" role="alert">${e(s.error)}</p>` : ''}
        <div class="ai-followup-actions"><span>${t('ai.keys')}</span>${s.pendingQuestion ? `<button type="button" id="ai-followup-cancel" class="no-drag ui-button ui-button--secondary">${t('ai.stop')}</button>` : `<button type="submit" id="ai-followup-send" class="no-drag ui-button ui-button--primary" ${!ready || !s.result || !this.draft.trim() ? 'disabled' : ''}>${t('ai.send')}</button>`}</div>
      </form>
    </section>`);
    this.querySelector('#ai-followup-cancel')?.addEventListener('click', () => s.cancel());
    const composer = this.querySelector<HTMLFormElement>('.ai-followup-composer');
    const input = this.querySelector<HTMLTextAreaElement>('#ai-followup-input');
    input?.addEventListener('input', () => {
      this.draft = input.value;
      const send = this.querySelector<HTMLButtonElement>('#ai-followup-send');
      if (send) send.disabled = !ready || !s.result || !this.draft.trim();
    });
    input?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); composer?.requestSubmit(); }
    });
    composer?.addEventListener('submit', async event => {
      event.preventDefault();
      const target = analysisTargetKey(s.target);
      const request = s.followUp(this.draft);
      const scrollBottom = () => { const scroll = this.querySelector('.ai-analysis-scroll'); if (scroll) scroll.scrollTop = scroll.scrollHeight; };
      scrollBottom();
      const success = await request;
      if (success && target === analysisTargetKey(this.store.getState().target)) {
        this.draft = '';
        this.render();
        scrollBottom();
        this.querySelector<HTMLTextAreaElement>('#ai-followup-input')?.focus({ preventScroll: true });
      }
    });
    this.querySelector<HTMLSelectElement>('#pod-ai-agent')?.addEventListener('change', event => void s.selectAgent((event.target as HTMLSelectElement).value));
    this.querySelector<HTMLSelectElement>('#pod-ai-model')?.addEventListener('change', event => s.selectModel((event.target as HTMLSelectElement).value));
    this.querySelector('#pod-ai-model-refresh')?.addEventListener('click', () => void s.selectAgent(s.agentId));
    this.querySelector('#pod-ai-settings')?.addEventListener('click', () => this.dispatchEvent(new CustomEvent('open-ai-settings', { bubbles: true, composed: true })));
    this.querySelector('#pod-ai-run')?.addEventListener('click', () => void s.analyze());
    this.querySelector('#pod-ai-cancel')?.addEventListener('click', () => s.cancel());
    this.querySelector<HTMLInputElement>('#pod-ai-events')?.addEventListener('change', event => s.setOptions({ includeEvents: (event.target as HTMLInputElement).checked }));
    this.querySelector<HTMLInputElement>('#pod-ai-logs')?.addEventListener('change', event => s.setOptions({ includeLogs: (event.target as HTMLInputElement).checked }));
    this.querySelector<HTMLSelectElement>('#pod-ai-container')?.addEventListener('change', event => s.setOptions({ container: (event.target as HTMLSelectElement).value }));
  }
}

if (!customElements.get('termix-ai-connections')) customElements.define('termix-ai-connections', AIConnectionsPanel);
if (!customElements.get('termix-pod-analysis')) customElements.define('termix-pod-analysis', PodAIAnalysisPanel);
