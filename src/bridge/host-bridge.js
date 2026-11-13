import { Emitter } from '../core/emitter.js';
import { normalizeEvent } from '../director/director.js';

/**
 * HostBridge — ponte de eventos com o backend nativo (Go + WebView2).
 *
 * Recebe por dois caminhos (o backend escolhe o que já usa):
 *   1) window.chrome.webview  → mensagens de PostWebMessageAsJson/AsString
 *   2) window.__umx.receive(json) → para backends que usam Eval/Dispatch
 *
 * Envelope: { channel: "umx", type, id, seq, ts, status, payload }.
 * O backend emite EVENTOS DE ESTADO (nunca frames de decoração).
 * simulate() existe só para o Motion Lab e marca o evento como simulado.
 */
export class HostBridge extends Emitter {
  constructor({ webview = globalThis.chrome?.webview ?? null, channel = 'umx', globalName = '__umx', target = globalThis } = {}) {
    super();
    this.webview = webview;
    this.channel = channel;
    this.globalName = globalName;
    this.target = target;
    this._onMessage = (e) => this.receive(e?.data);
    if (webview?.addEventListener) webview.addEventListener('message', this._onMessage);
    if (target && globalName) {
      target[globalName] = Object.assign(target[globalName] ?? {}, { receive: (msg) => this.receive(msg) });
    }
  }

  get connected() { return !!this.webview; }

  receive(message) {
    let data = message;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { return false; }
    }
    if (!data || typeof data !== 'object') return false;
    if (data.channel != null && data.channel !== this.channel) return false;
    const event = normalizeEvent({ ...data, simulated: false });
    if (!event) return false;
    this.emit('event', event);
    return true;
  }

  /** Envia um comando ao backend (ex.: pedido de salvar clipe). */
  send(type, payload = {}, { id } = {}) {
    if (!this.webview?.postMessage) return false;
    this.webview.postMessage({ channel: this.channel, type, id, payload });
    return true;
  }

  /** Evento simulado (Motion Lab): sempre marcado como simulated=true. */
  simulate(raw) {
    const event = normalizeEvent({ ...raw, simulated: true });
    if (event) this.emit('event', event);
    return event;
  }

  destroy() {
    if (this.webview?.removeEventListener) this.webview.removeEventListener('message', this._onMessage);
    if (this.target?.[this.globalName]) delete this.target[this.globalName].receive;
    this.removeAllListeners();
  }
}
