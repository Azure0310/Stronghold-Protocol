// Localisation (docs/I18N.md): public/js/i18n.js — t(), `{name}` placeholders, contexts, the pattern matching of text the
// server composed, localizeJson; and the dictionary pipeline (tools/i18n.mjs build / coverage) that feeds /i18n/ja.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const I18N_URL = pathToFileURL(join(ROOT, 'public/js/i18n.js')).href;

// ---- source language (Node has no DOM: the page language is Chinese and nothing is fetched) ----------------------------

const zh = await import(`${I18N_URL}?zh`);

test('source language: t() returns the Chinese text, params fill {name}, localizeJson is the identity', () => {
  assert.equal(zh.lang, 'zh');
  assert.equal(zh.t('升级'), '升级');
  assert.equal(zh.t('已拥有 {copies}/{need}', { copies: 2, need: 3 }), '已拥有 2/3');
  assert.equal(zh.t('已拥有 {copies}/{need}', { copies: 2 }), '已拥有 2/{need}', 'a missing param is left as written');
  assert.equal(zh.t('关闭', null, 'toggle'), '关闭', 'a context changes nothing in the source language');
  const data = { name: '阿米娅', list: ['升级'] };
  assert.equal(zh.localizeJson(data), data);
  assert.equal(zh.hasTranslation('anything'), true);
});

// ---- a Japanese page: the globals i18n.js reads, then a fresh module instance -------------------------------------------

const DICT = {
  '升级': 'レベルアップ',
  '已拥有 {copies}/{need}': '{copies}/{need} 所持',
  '{who}购买了{item}': '{who}が{item}を購入した',
  '关闭': '閉じる',
  'toggle::关闭': 'OFF',
  '阿米娅': 'アーミヤ',
  '华法琳': 'ワルファリン',
  '作战结束': '作戦終了',
  '{n}名博士': '{n}名のドクター',
  '{n}名博士在场': '{n}名のドクターが場にいる',
};
const saved = {};
for (const k of ['location', 'document', 'localStorage', 'fetch']) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
Object.defineProperty(globalThis, 'location', { value: { search: '?lang=ja', href: 'http://localhost/?lang=ja', pathname: '/', hash: '' }, configurable: true, writable: true });
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {} }, configurable: true, writable: true });
const doc = { documentElement: {}, head: { appendChild() {} }, title: '', querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}) };
Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
Object.defineProperty(globalThis, 'fetch', { value: async () => ({ ok: true, json: async () => DICT }), configurable: true, writable: true });
const ja = await import(`${I18N_URL}?ja`);
for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }

test('Japanese page: language, <html lang>, the dictionary is loaded before anything else runs', () => {
  assert.equal(ja.lang, 'ja');
  assert.equal(doc.documentElement.lang, 'ja');
  assert.equal(ja.t('升级'), 'レベルアップ');
  assert.equal(ja.t('没有翻译的文字'), '没有翻译的文字', 'a text without a translation shows the Chinese text');
  assert.equal(ja.hasTranslation('升级'), true);
  assert.equal(ja.hasTranslation('没有翻译的文字'), false);
});

test('placeholders keep their names in every language and can be reordered by the translation', () => {
  assert.equal(ja.t('已拥有 {copies}/{need}', { copies: 1, need: 3 }), '1/3 所持');
  assert.equal(ja.t('{who}购买了{item}', { who: 'Foo', item: 'Bar' }), 'FooがBarを購入した');
});

test('a context picks the special sense, the plain entry is the fallback', () => {
  assert.equal(ja.t('关闭'), '閉じる');
  assert.equal(ja.t('关闭', null, 'toggle'), 'OFF');
  assert.equal(ja.t('关闭', null, 'unknown-context'), '閉じる');
  assert.equal(ja.t('升级', null, 'toggle'), 'レベルアップ');
});

test('text the server composed (numbers already filled in) is matched against the {name} keys', () => {
  assert.equal(ja.t('已拥有 2/3'), '2/3 所持');
  assert.equal(ja.t('Foo购买了Bar'), 'FooがBarを購入した');
  assert.equal(ja.t('3名博士'), '3名のドクター');
  assert.equal(ja.t('3名博士在场'), '3名のドクターが場にいる', 'the most specific pattern wins');
  assert.equal(ja.t('阿米娅购买了华法琳'), 'アーミヤがワルファリンを購入した', 'a name the dictionary knows is translated inside the sentence');
  assert.equal(ja.t('阿米娅购买了华法琳、阿米娅'), 'アーミヤがワルファリン、アーミヤを購入した', 'also each name of a 、 list');
});

test('t() is idempotent: a translated text passes through unchanged', () => {
  assert.equal(ja.t(ja.t('升级')), 'レベルアップ');
  assert.equal(ja.t(ja.t('作战结束')), '作戦終了');
});

test('localizeJson: deep copy with every known text replaced, object keys untouched, unknown text kept', () => {
  const src = { chess_a: { name: '阿米娅', skills: [{ name: '升级', desc: '没有翻译的文字', n: 3 }], ok: true, nil: null } };
  const out = ja.localizeJson(src);
  assert.deepEqual(out, { chess_a: { name: 'アーミヤ', skills: [{ name: 'レベルアップ', desc: '没有翻译的文字', n: 3 }], ok: true, nil: null } });
  assert.equal(src.chess_a.name, '阿米娅', 'the source (the simulation reads its own copy anyway) is not mutated');
});

// ---- the dictionary pipeline ------------------------------------------------------------------------------------------

function tool(...args) {
  return execFileSync(process.execPath, [join(ROOT, 'tools/i18n.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('tools/i18n.mjs build: i18n/ja/*.json validate (placeholders, rich-text tags) and make public/i18n/ja.json', () => {
  assert.doesNotThrow(() => tool('build'));
  const dict = JSON.parse(readFileSync(join(ROOT, 'public/i18n/ja.json'), 'utf8'));
  const entries = Object.entries(dict);
  assert.ok(entries.length > 1000, 'a real dictionary');
  for (const [k, v] of entries) assert.equal(typeof v, 'string', `value of ${k}`);
  assert.equal(dict['toggle::关闭'], 'OFF');
  assert.equal(dict['卫戍协议'], '堅守協定');
  assert.equal(dict['盟约'], '盟約');
});

test('every t() key of the client has a Japanese translation', () => {
  const out = tool('coverage', '--list', '0');
  const m = /code\s*:\s*(\d+) t\(\) keys, (\d+) translated, (\d+) missing/.exec(out);
  assert.ok(m, 'coverage reports the code keys');
  assert.equal(Number(m[3]), 0, `${m[3]} t() key(s) without a translation — run: node tools/i18n.mjs coverage`);
  assert.ok(!/dynamic t\(\) key/.test(out), 't() keys must be static string literals');
});
