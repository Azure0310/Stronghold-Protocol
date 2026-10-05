// Localisation. The game's source language is Chinese (zh-CN): every user-visible string in the code is its own key,
// `t('升级')`, and a language dictionary (/i18n/<lang>.json: { "<zh text>": "<translation>" }) maps it to the target
// language. A key missing from the dictionary shows the Chinese text, so a half-translated build never shows holes and
// logic that compares Chinese strings (reasons, tags) keeps working — only what is *displayed* goes through t().
//
//   t('升级')                                    → '昇格' (ja) / '升级' (zh)
//   t('已拥有 {copies}/{need}', { copies, need }) → named placeholders, same names in every language
//   localizeJson(json)                           → deep copy of generated game data with every known text replaced
//                                                  (data.js: UI copy only — the simulation keeps its own pristine copy,
//                                                  server/sim parses some Chinese descriptions with regexes)
//
// The language is fixed for the page's lifetime (switching reloads the page): this module loads the dictionary with a
// top-level await, so every module evaluated after it — including module-level constants that call t() — sees it.
// Language: `?lang=ja|zh` (remembered) → localStorage `sp.lang` → the browser's language (ja → ja) → zh.
// Debug: `?i18n=debug` logs each CJK key that has no translation once, and keeps them in `__i18nMissing`.

const LANG_KEY = 'sp.lang';

/** Selectable languages: id → the language's own name (never translated). */
export const LANGS = Object.freeze([
  Object.freeze({ id: 'zh', label: '中文' }),
  Object.freeze({ id: 'ja', label: '日本語' }),
]);
const SUPPORTED = new Set(LANGS.map((l) => l.id));
const CJK = /[㐀-鿿]/;

const hasDom = typeof document !== 'undefined' && typeof location !== 'undefined';

function readPref() {
  try { const v = localStorage.getItem(LANG_KEY); return SUPPORTED.has(v) ? v : null; } catch { return null; }
}

/** Remember a language (no reload). */
export function saveLang(id) {
  if (!SUPPORTED.has(id)) return;
  try { localStorage.setItem(LANG_KEY, id); } catch { /* storage blocked: the choice lasts until reload */ }
}

function detectLang() {
  if (!hasDom) return 'zh'; // Node (tests, tools): the source language
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q && SUPPORTED.has(q)) { saveLang(q); return q; }
  } catch { /* ignore */ }
  const saved = readPref();
  if (saved) return saved;
  try {
    const n = String((navigator.languages && navigator.languages[0]) || navigator.language || '').toLowerCase();
    if (n.startsWith('ja')) return 'ja';
  } catch { /* ignore */ }
  return 'zh';
}

/** Current language id ('zh' | 'ja'); fixed for the page's lifetime. */
export const lang = detectLang();

/** @type {Record<string, string>} */
let dict = Object.create(null);
/** Every translation (the dictionary's values): a text that is one of them has been translated already. */
let translated = new Set();
/** Dictionary keys with `{name}` placeholders, as matchers for text the server composed with numbers already filled in. */
let patterns = [];
const dynamicCache = new Map();
const debug = hasDom && /[?&]i18n=debug\b/.test(location.search);
const missing = new Set();
const KANA = /[぀-ヿ]/;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildPatterns() {
  patterns = [];
  for (const [key, value] of Object.entries(dict)) {
    if (!/\{\w+\}/.test(key)) continue;
    const names = [];
    let src = '';
    let last = 0;
    for (const m of key.matchAll(/\{(\w+)\}/g)) {
      src += escapeRe(key.slice(last, m.index)) + '([\\s\\S]+?)';
      names.push(m[1]);
      last = m.index + m[0].length;
    }
    src += escapeRe(key.slice(last));
    // fixed text first: the pattern with the most literal text is the most specific
    patterns.push({ re: new RegExp(`^${src}$`), names, value, weight: key.replace(/\{\w+\}/g, '').length });
  }
  patterns.sort((a, b) => b.weight - a.weight);
}

async function loadDict(id) {
  if (id === 'zh' || !hasDom || typeof fetch !== 'function') return;
  try {
    const res = await fetch(`/i18n/${id}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json && typeof json === 'object') {
      dict = Object.assign(Object.create(null), json);
      translated = new Set(Object.values(dict));
      buildPatterns();
    }
  } catch (err) {
    console.warn(`[i18n] /i18n/${id}.json unavailable (${err && err.message ? err.message : err}); showing the source language`);
  }
}

function noteMissing(key) {
  // a string with kana, or one that is a translation itself (kanji-only: 作戦終了), is already Japanese (translated once:
  // t() is idempotent) — only Chinese counts as missing
  if (!debug || missing.has(key) || !CJK.test(key) || KANA.test(key) || translated.has(key)) return;
  missing.add(key);
  globalThis.__i18nMissing = [...missing];
  console.warn('[i18n] no translation:', key);
}

/**
 * What a `{name}` placeholder captured in a server text: a name (operator, item, enemy …) the dictionary knows is
 * translated as well, also each name of a `、` list; numbers and unknown text stay as they are.
 */
function translateCaptured(v) {
  if (dict[v] !== undefined) return dict[v];
  if (v.includes('、')) return v.split('、').map((x) => (dict[x] !== undefined ? dict[x] : x)).join('、');
  return v;
}

/** A text the server composed (numbers already filled in) against the dictionary's `{name}` keys; null when none fits. */
function matchPattern(text) {
  if (dynamicCache.has(text)) return dynamicCache.get(text);
  let out = null;
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (!m) continue;
    const params = {};
    p.names.forEach((n, i) => { params[n] = translateCaptured(m[i + 1]); });
    out = p.value.replace(/\{(\w+)\}/g, (all, k) => (Object.hasOwn(params, k) ? params[k] : all));
    break;
  }
  if (dynamicCache.size > 2000) dynamicCache.clear();
  dynamicCache.set(text, out);
  return out;
}

/**
 * Translate a Chinese source string. `params` fills `{name}` placeholders (same in every language); a placeholder with
 * no matching param is left as written. Without params, a text that is not a dictionary key is also tried against the
 * `{name}` keys — that is how text composed on the server ("已拥有 2/3") is translated: `t(msg.text)`. Idempotent: an
 * already translated text passes through unchanged.
 *
 * The same Chinese text can mean different things (关闭 = close / switched off, 冻结 = shop lock / the freeze status):
 * `ctx` names the sense, and the dictionary entry is `"<ctx>::<text>"` (`t('关闭', null, 'toggle')` →
 * `"toggle::关闭": "OFF"`). It is tried first; the plain entry is the fallback, so only the *special* sense needs a ctx.
 * @param {string} key
 * @param {Record<string, any>|null} [params]
 * @param {string} [ctx]
 * @returns {string}
 */
export function t(key, params, ctx) {
  let s = key;
  if (lang !== 'zh' && typeof key === 'string') {
    const hit = (ctx ? dict[`${ctx}::${key}`] : undefined) ?? dict[key];
    if (hit !== undefined) s = hit;
    else if (!params && CJK.test(key) && !KANA.test(key)) {
      const dyn = matchPattern(key);
      if (dyn != null) s = dyn; else noteMissing(key);
    }
  }
  if (params && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(params, k) && params[k] != null ? String(params[k]) : m));
  return s;
}

/** True when `key` has a translation (always true for the source language). */
export const hasTranslation = (key) => lang === 'zh' || dict[key] !== undefined;

/**
 * Deep copy of a JSON value with every string that has a translation replaced. Strings without one are kept (Chinese).
 * Object keys are never touched (ids). Not applied for the source language (returns the value itself).
 * @template T @param {T} value @returns {T}
 */
export function localizeJson(value) {
  if (lang === 'zh') return value;
  const walk = (v) => {
    if (typeof v === 'string') { const hit = dict[v]; return hit !== undefined ? hit : v; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = walk(x); return o; }
    return v;
  };
  return walk(value);
}

/**
 * Switch language: remembered, then the page reloads (strings captured at module level are fixed per page).
 * @param {string} id
 */
export function switchLang(id) {
  if (!SUPPORTED.has(id) || id === lang) return;
  saveLang(id);
  if (hasDom) {
    try {
      const url = new URL(location.href);
      url.searchParams.delete('lang');
      location.replace(url.pathname + (url.search || '') + url.hash);
    } catch { location.reload(); }
  }
}

/** `<html lang>`, the title and the static texts of index.html; a Japanese page also gets a Japanese web font. */
function applyDocument() {
  const root = document.documentElement;
  root.lang = lang === 'ja' ? 'ja' : 'zh-CN';
  if (lang === 'zh') return;
  document.title = t('卫戍协议：盟约 · STRONGHOLD PROTOCOL');
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute('content', t('卫戍协议：盟约 · 网页联机复刻（非官方同人作品）'));
  const appTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appTitle) appTitle.setAttribute('content', t('卫戍协议'));
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.getAttribute('data-i18n'));
  if (lang === 'ja') {
    // not render-blocking, like the page's other web fonts (LAN / offline play must still start); theme.css falls back
    // to the system Japanese fonts
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.media = 'print';
    link.onload = () => { link.media = 'all'; };
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap';
    document.head.appendChild(link);
  }
}

await loadDict(lang);
if (hasDom) applyDocument();
