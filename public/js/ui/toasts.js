// Global toast notifications (top-centre stack).
//
// Imperative API usable from anywhere: `toast(text, kind)`, `toastError(err)`; render <ToastHost/>
// once near the app root. Identical messages shown within a short window are merged (with a ×N
// counter) instead of stacking, and the stack is capped so an error storm cannot flood the screen.

import { h } from '../../vendor/preact.module.js';
import { useEffect, useReducer } from '../../vendor/hooks.module.js';
import htm from '../../vendor/htm.module.js';
import { ERR_TEXT } from '../../../shared/constants.js';
import { t, hasTranslation } from '../i18n.js';

const CJK_RE = /[㐀-鿿]/; // i18n-ok
const KANA_RE = /[぀-ヿ]/; // i18n-ok
/** A run of ideographs (with Latin letters / digits / · inside): a name in text composed by the server. */
const NAME_RUN = /[A-Za-z0-9·]*[㐀-鿿][㐀-鿿A-Za-z0-9·]*/g; // i18n-ok

/**
 * Translate a text the server composed (Chinese, names and numbers already filled in: m.toast, m.ticker, errors).
 * t() matches the sentence against the dictionary's `{name}` keys, but a placeholder is filled with what it captured —
 * the Chinese name of an operator, a summon or an AI teammate stays Chinese inside the Japanese sentence. So the
 * ideograph runs that came from the original text and are dictionary keys themselves are translated one by one
 * (names in a list are separated by 、 and so are runs of their own). Texts that are not Chinese pass through unchanged.
 * @param {any} text
 * @returns {string}
 */
export function tServer(text) {
  const src = String(text ?? '');
  const out = t(src);
  if (out === src || !CJK_RE.test(src) || KANA_RE.test(src)) return out;
  return out.replace(NAME_RUN, (run) => (src.includes(run) && hasTranslation(run) ? t(run) : run));
}

// no shared static vnodes (see components.js hFresh: htm's static cache would retain unmounted DOM)
function hFresh(type, props, ...children) {
  if (this && typeof this === 'object') this[0] = 3;
  return h(type, props, ...children);
}
const html = htm.bind(hFresh);

export const TOAST_KINDS = ['info', 'success', 'warn', 'error'];
const MAX_TOASTS = 4;
const DEFAULT_MS = { info: 2600, success: 2400, warn: 3200, error: 3600 };
const MERGE_WINDOW_MS = 2500;

let seq = 0;
/** @type {{id:number, text:string, kind:string, count:number, at:number, ttl:number, leaving:boolean}[]} */
let toasts = [];
const listeners = new Set();
const timers = new Map();

const emit = () => { for (const fn of [...listeners]) { try { fn(toasts); } catch (err) { console.error(err); } } };

function schedule(item) {
  clearTimeout(timers.get(item.id));
  timers.set(item.id, setTimeout(() => dismissToast(item.id), item.ttl));
}

/**
 * Show a toast.
 * @param {string} text message (plain text)
 * @param {'info'|'success'|'warn'|'error'} [kind]
 * @param {{ ttl?: number }} [opts]
 * @returns {number} toast id
 */
export function toast(text, kind = 'info', opts = {}) {
  const k = TOAST_KINDS.includes(kind) ? kind : 'info';
  const src = String(text ?? '').slice(0, 200).trim();
  if (!src) return -1;
  // The one door every message passes: texts the server composed (m.toast: Chinese, numbers already filled in) and
  // errors are translated here; an already translated text passes through t() unchanged.
  const msg = tServer(src).slice(0, 200);
  const now = Date.now();
  const ttl = Number.isFinite(opts.ttl) && opts.ttl > 0 ? opts.ttl : DEFAULT_MS[k];
  const same = toasts.find((x) => !x.leaving && x.text === msg && x.kind === k && now - x.at < MERGE_WINDOW_MS + x.ttl);
  if (same) {
    toasts = toasts.map((x) => (x === same ? { ...x, count: x.count + 1, at: now, ttl } : x));
    schedule(toasts.find((x) => x.id === same.id));
    emit();
    return same.id;
  }
  const item = { id: ++seq, text: msg, kind: k, count: 1, at: now, ttl, leaving: false };
  toasts = [...toasts, item];
  // Cap the stack: drop the oldest immediately.
  while (toasts.length > MAX_TOASTS) {
    const old = toasts[0];
    clearTimeout(timers.get(old.id));
    timers.delete(old.id);
    toasts = toasts.slice(1);
  }
  schedule(item);
  emit();
  return item.id;
}

/**
 * Dismiss a toast (plays the exit animation, then removes it).
 * @param {number} id
 */
export function dismissToast(id) {
  const item = toasts.find((x) => x.id === id);
  if (!item) return;
  clearTimeout(timers.get(id));
  if (item.leaving) return;
  toasts = toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x));
  emit();
  timers.set(id, setTimeout(() => {
    timers.delete(id);
    toasts = toasts.filter((x) => x.id !== id);
    emit();
  }, 200));
}

/**
 * Text for an error-ish value: NetError / {code,msg} / Error / string.
 * @param {any} err
 * @returns {string}
 */
export function describeError(err) {
  // ERR_TEXT (shared/, Chinese), NetError.message (net.js CLIENT_ERR_TEXT, Chinese: connBanner compares it) and a
  // server `msg` are all source-language texts: translated for display here (t() leaves unknown texts as they are)
  if (!err) return t('发生未知错误');
  if (typeof err === 'string') return t(ERR_TEXT[err] || err);
  if (err.code && ERR_TEXT[err.code]) return t(ERR_TEXT[err.code]);
  if (typeof err.message === 'string' && err.message) return t(err.message);
  if (typeof err.msg === 'string' && err.msg) return t(err.msg);
  return t('发生未知错误');
}

/**
 * Show an error toast for a failed request / error push.
 * @param {any} err
 * @returns {number}
 */
export function toastError(err) {
  return toast(describeError(err), 'error');
}

const ICONS = {
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z',
  success: 'M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z',
  warn: 'M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z',
  error: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm5 13.6L15.6 17 12 13.4 8.4 17 7 15.6 10.6 12 7 8.4 8.4 7 12 10.6 15.6 7 17 8.4 13.4 12 17 15.6Z',
};

/** Renders the toast stack. Mount once. */
export function ToastHost() {
  const [, force] = useReducer((c) => c + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => listeners.delete(force);
  }, []);
  return html`
    <div class="toast-host" role="status" aria-live="polite">
      ${toasts.map((x) => html`
        <div key=${x.id} class=${`toast toast--${x.kind}${x.leaving ? ' is-leaving' : ''}`}
             onClick=${() => dismissToast(x.id)}>
          <svg class="toast__icon" viewBox="0 0 24 24" aria-hidden="true"><path d=${ICONS[x.kind]} /></svg>
          <span class="toast__text">${x.text}</span>
          ${x.count > 1 ? html`<span class="toast__count">×${x.count}</span>` : null}
        </div>`)}
    </div>`;
}
