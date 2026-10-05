#!/usr/bin/env node
// Localisation dictionary tool (docs/I18N.md).
//
//   node tools/i18n.mjs build [--lang ja]      merge i18n/<lang>/*.json (flat { "<zh>": "<translation>" }, files in name
//                                              order, later files win) into public/i18n/<lang>.json, after validating
//                                              placeholders and rich-text tags
//   node tools/i18n.mjs coverage [--lang ja]   list what has no translation yet: every t('…') key found in public/js +
//                                              shared, and every Chinese string of data/*.json (the files data.js
//                                              localises); exits 1 when anything is missing and --strict is given
//        --list <n>                            print the first n missing strings per group (default 15)
//        --json <file>                         write the full missing list (grouped) to a file
//   node tools/i18n.mjs todo --data <name> [--out <file>]
//                                              the untranslated Chinese strings of data/<name>.json as [{ zh, field, n }]
//                                              (a plain desc whose tagged descRaw is listed is left out: it is derived)
//   node tools/i18n.mjs lint [--file <substr>] [--list <n>] [--server] [--strict]
//                                              lines of public/js + shared (+ server) that still have Chinese outside
//                                              comments and t() calls; a line that must stay Chinese (logic key, regex,
//                                              data id) is marked with a trailing `// i18n-ok`
//
// Keys of t() must be static string literals (no `${…}`): dynamic parts are `{name}` placeholders filled by t()'s second
// argument, with the same names in every language.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CJK = /[㐀-鿿]/;

/**
 * Fields of the generated data that are developer notes (English prose quoting Chinese terms, rules research, formulas):
 * no UI reads them (checked against public/js), so `todo` and `coverage` do not ask for a translation.
 */
const DEV_FIELDS = new Set([
  'need', 'effect', 'layerGain', 'howToPlay', 'assumed', 'algorithm', 'members', 'meaning', 'notes', // bonds / factions
  'formula', 'helperOrder', // config
  'implFormula', 'cards', // items / choices
  '_why', // tuning
]);

function parseArgs(argv) {
  const o = { cmd: argv[0], lang: 'ja', strict: false, list: 15, json: null, server: false, file: null };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang') o.lang = argv[++i];
    else if (a === '--server') o.server = true;
    else if (a === '--conflicts') o.conflicts = true;
    else if (a === '--file') o.file = argv[++i];
    else if (a === '--data') o.data = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--strict') o.strict = true;
    else if (a === '--list') o.list = Number(argv[++i]);
    else if (a === '--json') o.json = argv[++i];
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const tags = (s) => [...s.matchAll(/<\/?@?[\w.\-$]*>/g)].map((m) => m[0]).sort().join(' ');

/** A rich-text text without its tags: `<@ba.vup>…</>` / `<$ba.xx>…</>` (the generated data's `desc` is exactly `descRaw` stripped). */
const stripTags = (s) => s.replace(/<\/>|<[@$][^>]*>/g, '');

function readDictFiles(lang) {
  const dir = path.join(ROOT, 'i18n', lang);
  if (!fs.existsSync(dir)) return { files: [], merged: new Map() };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const merged = new Map();
  const overrides = []; // a key defined again by a later file with a different value: { key, from, was, to, value }
  for (const f of files) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const [k, v] of Object.entries(json)) {
      const prev = merged.get(k);
      if (prev && prev.value !== v) overrides.push({ key: k, was: prev.file, wasValue: prev.value, file: f, value: v });
      merged.set(k, { value: v, file: f });
    }
  }
  merged.overrides = overrides;
  // The plain `desc` of every tagged `descRaw` is derived (translate the tagged text only): same words, tags removed.
  // An entry written by hand for the plain text wins.
  for (const [k, { value, file }] of [...merged]) {
    if (typeof value !== 'string' || !/<\/>|<[@$]/.test(k)) continue;
    const pk = stripTags(k);
    if (pk !== k && !merged.has(pk)) merged.set(pk, { value: stripTags(value), file: `${file} (derived)` });
  }
  return { files, merged };
}

function build(o) {
  const { files, merged } = readDictFiles(o.lang);
  const errors = []; const warnings = [];
  const out = {};
  for (const [k, { value, file }] of merged) {
    if (typeof value !== 'string') { errors.push(`${file}: value of ${JSON.stringify(k)} is not a string`); continue; }
    if (placeholders(k) !== placeholders(value)) errors.push(`${file}: placeholders differ: ${JSON.stringify(k)} → ${JSON.stringify(value)}`);
    if (tags(k) !== tags(value)) errors.push(`${file}: rich-text tags differ: ${JSON.stringify(k)} → ${JSON.stringify(value)}`);
    if (value === '') { warnings.push(`${file}: empty translation for ${JSON.stringify(k)} (skipped)`); continue; }
    out[k] = value;
  }
  for (const w of warnings.slice(0, 20)) console.warn('warn:', w);
  const ov = merged.overrides || [];
  if (ov.length) {
    console.warn(`warn: ${ov.length} key(s) defined in two files with different translations (the later file wins; --conflicts lists them)`);
    if (o.conflicts) for (const c of ov) console.warn(`  ${JSON.stringify(c.key).slice(0, 80)}\n    ${c.was}: ${JSON.stringify(c.wasValue)}\n    ${c.file}: ${JSON.stringify(c.value)}  <- used`);
  }
  if (errors.length) {
    for (const e of errors.slice(0, 50)) console.error('error:', e);
    console.error(`${errors.length} error(s); public/i18n/${o.lang}.json not written`);
    return 1;
  }
  const dest = path.join(ROOT, 'public', 'i18n', `${o.lang}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out));
  console.log(`built ${path.relative(ROOT, dest)}: ${Object.keys(out).length} entries from ${files.length} file(s), ${(fs.statSync(dest).size / 1024).toFixed(0)} KB`);
  return 0;
}

// ---- coverage ------------------------------------------------------------------------------------------------------

function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(vendor|assets|node_modules|dev)$/.test(e.name)) walk(p, files); }
    else if (/\.(js|mjs)$/.test(e.name)) files.push(p);
  }
  return files;
}

/**
 * Keys that need a translation: the static argument of every `t('…')` call in public/js, and every Chinese string literal
 * of shared/ (that code also runs in Node, so it holds plain Chinese texts the client translates when it shows them:
 * `t(ERR_TEXT[code])`). Also the locations of `t()` calls with a dynamic key (not allowed).
 */
function codeKeys() {
  const keys = new Map(); const dynamic = [];
  const call = /(?<![\w.$])t\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
  const literal = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  const evalLit = (lit) => (lit[0] === '`' ? lit.slice(1, -1) : (0, eval)(lit));
  for (const f of walk(path.join(ROOT, 'public/js'))) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (rel === 'public/js/i18n.js') continue;
    const src = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = call.exec(src))) {
      const lit = m[1];
      const line = src.slice(0, m.index).split('\n').length;
      if (lit[0] === '`' && lit.includes('${')) { dynamic.push(`${rel}:${line}`); continue; }
      let key;
      try { key = evalLit(lit); } catch { dynamic.push(`${rel}:${line}`); continue; }
      if (!keys.has(key)) keys.set(key, `${rel}:${line}`);
    }
  }
  for (const f of walk(path.join(ROOT, 'shared'))) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const code = stripComments(fs.readFileSync(f, 'utf8'));
    let m;
    while ((m = literal.exec(code))) {
      const text = m[1] ?? m[2] ?? m[3];
      if (!text || !CJK.test(text) || (m[3] !== undefined && text.includes('${'))) continue;
      let key;
      try { key = evalLit(m[0]); } catch { continue; }
      if (!keys.has(key)) keys.set(key, `${rel}:${code.slice(0, m.index).split('\n').length}`);
    }
  }
  return { keys, dynamic };
}

/** Every distinct Chinese string value of the data files data.js localises. */
function dataStrings() {
  const out = new Map(); // string → "file.field"
  const dir = path.join(ROOT, 'data');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !/^(assets|local-assets)\.json$/.test(x))) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    (function visit(v, field) {
      if (DEV_FIELDS.has(field)) return;
      if (typeof v === 'string') { if (CJK.test(v) && !out.has(v)) out.set(v, `${f}:${field}`); }
      else if (Array.isArray(v)) v.forEach((x) => visit(x, field));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, k);
    })(json, '');
  }
  return out;
}

function coverage(o) {
  const { merged } = readDictFiles(o.lang);
  const has = (k) => merged.has(k);
  const { keys, dynamic } = codeKeys();
  const data = dataStrings();
  const missCode = [...keys].filter(([k]) => !has(k));
  const missData = [...data].filter(([k]) => !has(k));
  const byField = {};
  for (const [, where] of missData) byField[where] = (byField[where] || 0) + 1;
  console.log(`code  : ${keys.size} t() keys, ${keys.size - missCode.length} translated, ${missCode.length} missing${dynamic.length ? `, ${dynamic.length} dynamic key(s) (not allowed)` : ''}`);
  console.log(`data  : ${data.size} strings, ${data.size - missData.length} translated, ${missData.length} missing`);
  console.log(`dict  : ${merged.size} entries, ${[...merged.keys()].filter((k) => !keys.has(k) && !data.has(k)).length} not referenced by code or data (server / dynamic uses are fine)`);
  for (const d of dynamic.slice(0, 20)) console.log(`  dynamic t() key at ${d}`);
  for (const [k, where] of missCode.slice(0, o.list)) console.log(`  code: ${where}  ${JSON.stringify(k).slice(0, 100)}`);
  for (const [k, where] of missData.slice(0, o.list)) console.log(`  data: ${where}  ${JSON.stringify(k).slice(0, 100)}`);
  if (o.json) {
    fs.writeFileSync(o.json, JSON.stringify({ code: Object.fromEntries(missCode), data: Object.fromEntries(missData), dynamic }, null, 1));
    console.log(`wrote ${o.json}`);
  }
  return o.strict && (missCode.length || missData.length || dynamic.length) ? 1 : 0;
}

// ---- todo: what one data file still needs ----------------------------------------------------------------------------

/**
 * Untranslated Chinese strings of one data file (`--data effects` → data/effects.json) as [{ zh, field, n }], in file
 * order. A plain `desc` whose tagged `descRaw` sibling is in the list is left out (it is derived when the tagged text is
 * translated), as is anything the dictionary already has. `--out file` writes the JSON instead of printing it.
 */
function todo(o) {
  if (!o.data) throw new Error('todo needs --data <name> (e.g. --data effects)');
  const { merged } = readDictFiles(o.lang);
  const file = path.join(ROOT, 'data', `${o.data}.json`);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const seen = new Map(); // zh → { field, n }
  (function visit(v, field) {
    if (DEV_FIELDS.has(field)) return;
    if (typeof v === 'string') {
      if (!CJK.test(v)) return;
      const e = seen.get(v);
      if (e) e.n++; else seen.set(v, { zh: v, field, n: 1 });
    } else if (Array.isArray(v)) v.forEach((x) => visit(x, field));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, k);
  })(json, '');
  const derivable = new Set();
  for (const k of seen.keys()) if (/<\/>|<[@$]/.test(k)) derivable.add(stripTags(k));
  const list = [...seen.values()].filter((e) => !merged.has(e.zh) && !derivable.has(e.zh));
  const chars = list.reduce((a, e) => a + e.zh.length, 0);
  if (o.out) {
    fs.writeFileSync(o.out, JSON.stringify(list, null, 1));
    console.log(`${list.length} string(s), ${chars} chars → ${o.out}`);
  } else console.log(JSON.stringify(list, null, 1));
  console.error(`data/${o.data}.json: ${seen.size} distinct Chinese strings, ${list.length} still to translate (${chars} chars)`);
  return 0;
}

// ---- lint: Chinese left in the code outside comments and t() calls ---------------------------------------------------

/** Source with comments blanked (line numbers kept) — string / template contents are respected, so '//' in a URL stays. */
function stripComments(src) {
  let out = ''; let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i]; const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; } i += 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c; out += c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') out += src[i++]; out += src[i++]; }
      out += q; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

/**
 * Every line of public/js (with --server also server/) that still has Chinese outside comments and t(…) calls.
 * A line that is meant to stay Chinese (a logic key compared with ===, a regex, a data id) carries `// i18n-ok`.
 * shared/ is not linted: its Chinese texts are keys by themselves (see codeKeys).
 */
function lint(o) {
  const areas = o.server ? ['public/js', 'server'] : ['public/js'];
  const callRe = /(?<![\w.$])t\(\s*(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
  let total = 0; const perFile = [];
  for (const area of areas) {
    for (const f of walk(path.join(ROOT, area))) {
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      if (rel === 'public/js/i18n.js') continue;
      const raw = fs.readFileSync(f, 'utf8').split('\n');
      const code = stripComments(raw.join('\n')).replace(callRe, (m) => m.replace(/[^\n]/g, ' ')).split('\n');
      const hits = [];
      code.forEach((line, i) => { if (CJK.test(line) && !/i18n-ok/.test(raw[i])) hits.push(`${rel}:${i + 1}: ${raw[i].trim().slice(0, 140)}`); });
      if (hits.length) { perFile.push([rel, hits]); total += hits.length; }
    }
  }
  const only = o.file;
  for (const [rel, hits] of perFile) {
    if (only && !rel.includes(only)) continue;
    console.log(`${rel}: ${hits.length}`);
    if (o.list > 0 || only) for (const h of hits.slice(0, only ? 500 : o.list)) console.log(`  ${h}`);
  }
  console.log(`${total} line(s) with Chinese outside comments and t() in ${perFile.length} file(s)`);
  return o.strict && total ? 1 : 0;
}

let code = 0;
try {
  const o = parseArgs(process.argv.slice(2));
  if (o.cmd === 'build') code = build(o);
  else if (o.cmd === 'coverage') code = coverage(o);
  else if (o.cmd === 'lint') code = lint(o);
  else if (o.cmd === 'todo') code = todo(o);
  else { console.error('usage: node tools/i18n.mjs build|coverage|lint|todo [--lang ja] [--strict] [--list n] [--json file] [--server] [--file substr] [--data name] [--out file]'); code = 2; }
} catch (e) { console.error(e.message); code = 2; }
process.exit(code);
