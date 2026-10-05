#!/usr/bin/env node
// tools/i18n-official.mjs — Japanese texts of the official game data → i18n/ja/00-official.json.
//
// What it does: data/chess.json (operator / subclass / skill / talent / trait / module texts), data/enemies.json (name,
// description, abilities) and data/tokens.json (summons) hold the Chinese texts of the official client data
// (zh_CN, Kengxxiao/ArknightsGameData). Most of them exist in the Japanese client data (ja_JP,
// Kengxxiao/ArknightsGameData_Yostar) too. The two tables share ids and structure, so the Japanese text of a Chinese
// text is found by id. Every official text is a TEMPLATE ("攻击力<@ba.vup>+{atk:0%}</>") filled with a blackboard
// (the numbers: data's `bb`), so for each text of the data this script
//   1. finds the Chinese template(s) that, expanded with the record's own blackboard, give EXACTLY the data's Chinese
//      text (a text no template reproduces is never translated: it was written / rewritten for the mode — those are
//      left to hand translation and counted in the report);
//   2. expands the Japanese template of the same slot with the same blackboard (the numbers of the Chinese data win);
//   3. checks that the placeholders / rich-text tags of the pair agree (the checks of `tools/i18n.mjs build`), that no
//      stray tag / `{key}` is left in the Japanese text, and that the Japanese slot has the same structure (unlock
//      condition, talent index, blackboard keys) as the Chinese one. A pair that fails a check is NOT written to the
//      dictionary; its Japanese text goes to the draft list of the report (a starting point for the hand translation).
// The output is { "<zh descRaw>": "<ja descRaw>" } (the plain `desc` is derived by `tools/i18n.mjs build`) plus the names:
// operators, subclasses, modules, skills, talents, traits, enemies, summons, and (category `other`) the `name` of the other
// data files (bands.json, bosses.json…) when it is exactly an official operator / enemy name.
//
// Usage:
//   node tools/i18n-official.mjs [--offline] [--refresh] [--keep-identical] [--check]
//        [--out <file>] [--report <file>] [--explain <n>] [--quiet]
//     --offline         never download (fail when a table is missing from the cache)
//     --refresh         download every table again
//     --keep-identical  also write entries whose official Japanese text equals the Chinese one ("火力支援"; the
//                       dictionary rule says not to create those, so by default they are only counted in the report)
//     --check           compute and report, do not write the dictionary
//     --out             dictionary (default i18n/ja/00-official.json)
//     --report          full report: statistics, excluded texts, drafts, conflicts (default .cache/i18n-official-report.json)
//     --explain <n>     print n samples per exclusion reason
//
// Needed tables (downloaded into the cache when missing; public data, ~100 MB in all):
//   Chinese  → .cache/gamedata/      (the build-data.mjs cache; raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/)
//   Japanese → .cache/gamedata-ja/   (raw.githubusercontent.com/Kengxxiao/ArknightsGameData_Yostar/main/ja_JP/gamedata/)
//     excel/character_table.json  excel/skill_table.json  excel/uniequip_table.json  excel/battle_equip_table.json
//     excel/enemy_handbook_table.json  levels/enemydata/enemy_database.json
// The Japanese client data stops in 2025-11: newer operators / enemies / modules have no Japanese text and are left out.
// Regenerate: `node tools/i18n-official.mjs && node tools/i18n.mjs build`. It never touches data/*.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CJK = /[㐀-鿿]/;
const BASE = {
  zh: 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/',
  ja: 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData_Yostar/main/ja_JP/gamedata/',
};
const CACHE = { zh: path.join(ROOT, '.cache', 'gamedata'), ja: path.join(ROOT, '.cache', 'gamedata-ja') };
const TABLES = {
  char: 'excel/character_table.json', skill: 'excel/skill_table.json', uniequip: 'excel/uniequip_table.json',
  battleEquip: 'excel/battle_equip_table.json', handbook: 'excel/enemy_handbook_table.json', enemyDb: 'levels/enemydata/enemy_database.json',
};

function parseArgs(argv) {
  const o = { offline: false, refresh: false, keepIdentical: false, check: false, quiet: false, explain: 0,
    out: path.join(ROOT, 'i18n', 'ja', '00-official.json'), report: path.join(ROOT, '.cache', 'i18n-official-report.json') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offline') o.offline = true;
    else if (a === '--refresh') o.refresh = true;
    else if (a === '--keep-identical') o.keepIdentical = true;
    else if (a === '--check') o.check = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '--report') o.report = path.resolve(argv[++i]);
    else if (a === '--explain') o.explain = Number(argv[++i]);
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}
const OPTS = parseArgs(process.argv.slice(2));
const log = (...a) => { if (!OPTS.quiet) console.log(...a); };

// ---- tables ----------------------------------------------------------------------------------------------------------

async function ensureFile(lang, rel) {
  const abs = path.join(CACHE[lang], rel);
  if (!OPTS.refresh && fs.existsSync(abs)) return abs;
  if (OPTS.offline) { if (fs.existsSync(abs)) return abs; throw new Error(`missing ${lang} table ${rel} (offline)`); }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const url = BASE[lang] + rel;
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      log(`  download ${lang} ${rel}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const text = await res.text();
      JSON.parse(text); // never cache a truncated file
      const tmp = `${abs}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, abs);
      return abs;
    } catch (e) { lastErr = e; if (attempt < 4) await new Promise((r) => setTimeout(r, 500 * attempt)); }
  }
  throw new Error(`cannot obtain ${lang} ${rel}: ${lastErr && lastErr.message}`);
}

async function loadTables(lang) {
  const t = {};
  for (const [k, rel] of Object.entries(TABLES)) t[k] = JSON.parse(fs.readFileSync(await ensureFile(lang, rel), 'utf8'));
  t.db = new Map();
  for (const e of t.enemyDb.enemies || []) t.db.set(e.Key, e.Value);
  return t;
}

// ---- template engine (the placeholder rules of tools/build-data.mjs, kept identical so the check is meaningful) ---------

const unesc = (s) => (typeof s === 'string' ? s.replace(/\\n/g, '\n') : s);

function cleanNum(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v;
  if (Number.isInteger(v) || Math.abs(v) >= 1e6) return v;
  return Math.round(v * 1e6) / 1e6;
}

function formatValue(v, fmt) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  if (!fmt) return String(cleanNum(v));
  const pct = fmt.endsWith('%');
  const core = pct ? fmt.slice(0, -1) : fmt;
  const decimals = core.includes('.') ? core.split('.')[1].length : 0;
  const x = pct ? v * 100 : v;
  const rounded = Math.sign(x) * Math.round(Math.abs(x) * 10 ** decimals + 1e-9) / 10 ** decimals;
  return rounded.toFixed(decimals) + (pct ? '%' : '');
}

/** Fill {key}, {-key}, {key:0%} (case-insensitive) → { text, unresolved: ['{x}'…] }; the template's `\n` become newlines. */
function expand(template, bb, bbStr = {}) {
  const lower = new Map(Object.entries(bb || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const lowerStr = new Map(Object.entries(bbStr || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const unresolved = [];
  const text = unesc(template).replace(/\{(-?)([^{}:]+)(?::([^{}]+))?\}/g, (m, neg, key, fmt) => {
    const k = key.trim().toLowerCase();
    if (lowerStr.has(k) && (!lower.has(k) || !fmt)) return lowerStr.get(k);
    if (lower.has(k)) return formatValue(neg ? -lower.get(k) : lower.get(k), fmt);
    unresolved.push(m);
    return m;
  });
  return { text, unresolved };
}

// The checks of `tools/i18n.mjs build` (same regexes).
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const tags = (s) => [...s.matchAll(/<\/?@?[\w.\-$]*>/g)].map((m) => m[0]).sort().join(' ');
/** `<…>` pieces that are neither the game's rich-text tags (<@ba.x>, <$ba.x>, </>) nor a name label (`<替身>`, `<バリケード>`). */
const strayTags = (s) => [...s.matchAll(/<[^<>]*>/g)].map((m) => m[0]).filter((x) => !(x === '</>' || /^<[@$][\w.]+>$/.test(x) || /[^\x00-\x7f]/.test(x)));
/** The numbers of a text (tags removed). */
const numbersOf = (s) => [...s.replace(/<[^<>]*>/g, '').matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
/** Every number of `zh` also occurs (as often) in `ja`. */
function numbersCovered(zh, ja) {
  const left = numbersOf(ja);
  for (const n of numbersOf(zh)) { const i = left.indexOf(n); if (i < 0) return false; left.splice(i, 1); }
  return true;
}
/** The plain text of a rich text, as `tools/i18n.mjs` derives `desc` from `descRaw`. */
const stripTags = (s) => s.replace(/<\/>|<[@$][^>]*>/g, '');

// ---- slots: the templates of one operator / skill / enemy, the same path in the Chinese and the Japanese table ----------

const keysOf = (bbList) => (Array.isArray(bbList) ? bbList.map((b) => b.key).sort().join(',') : '');

/**
 * Every text slot of a character (character_table entry + the modules of `equipCharIds`), path → slot. Kinds: charName,
 * trait (character description / trait candidates / module trait override), moduleTrait (module additional text),
 * talentName, talentDesc. `sig` = the slot's structure (unlock condition, part kind…), `bbKeys` = its blackboard keys,
 * `idx` = talent index. Null when the character is not in the table.
 */
function charSlots(T, charId, equipCharIds) {
  const C = T.char[charId];
  if (!C) return null;
  const slots = new Map();
  slots.set('name', { kind: 'charName', tpl: C.name, sig: '', bbKeys: '' });
  if (C.description) slots.set('desc', { kind: 'trait', tpl: C.description, sig: '', bbKeys: '' });
  (C.trait?.candidates || []).forEach((c, i) => {
    if (c.overrideDescripton) slots.set(`trait${i}`, { kind: 'trait', tpl: c.overrideDescripton, sig: JSON.stringify([c.unlockCondition, c.requiredPotentialRank]), bbKeys: keysOf(c.blackboard) });
  });
  (C.talents || []).forEach((tal, ti) => (tal.candidates || []).forEach((c, ci) => {
    const sig = JSON.stringify([c.unlockCondition, c.requiredPotentialRank, !!c.isHideTalent]);
    if (c.name) slots.set(`talent${ti}.${ci}.name`, { kind: 'talentName', tpl: c.name, sig, bbKeys: '', idx: ti });
    if (c.description) slots.set(`talent${ti}.${ci}.desc`, { kind: 'talentDesc', tpl: c.description, sig, bbKeys: keysOf(c.blackboard), idx: ti });
  }));
  for (const cid of equipCharIds) {
    for (const eq of T.uniequip.charEquip?.[cid] || []) {
      for (const ph of T.battleEquip[eq]?.phases || []) {
        (ph.parts || []).forEach((pt, qi) => {
          const base = `equip:${eq}.L${ph.equipLevel}.p${qi}`;
          const psig = `${pt.target}|${!!pt.isToken}`;
          (pt.overrideTraitDataBundle?.candidates || []).forEach((c, ci) => {
            const sig = JSON.stringify([psig, c.unlockCondition, c.requiredPotentialRank]);
            if (c.overrideDescripton) slots.set(`${base}.trait${ci}.o`, { kind: 'trait', tpl: c.overrideDescripton, sig, bbKeys: keysOf(c.blackboard) });
            if (c.additionalDescription) slots.set(`${base}.trait${ci}.a`, { kind: 'moduleTrait', tpl: c.additionalDescription, sig, bbKeys: keysOf(c.blackboard) });
          });
          (pt.addOrOverrideTalentDataBundle?.candidates || []).forEach((c, ci) => {
            const sig = JSON.stringify([psig, c.unlockCondition, c.requiredPotentialRank, c.talentIndex, !!c.isHideTalent]);
            const idx = c.talentIndex;
            if (c.name) slots.set(`${base}.talent${ci}.name`, { kind: 'talentName', tpl: c.name, sig, bbKeys: '', idx });
            if (c.upgradeDescription) slots.set(`${base}.talent${ci}.up`, { kind: 'talentDesc', tpl: c.upgradeDescription, sig, bbKeys: keysOf(c.blackboard), idx });
            if (c.description) slots.set(`${base}.talent${ci}.desc`, { kind: 'talentDesc', tpl: c.description, sig, bbKeys: keysOf(c.blackboard), idx });
          });
        });
      }
    }
  }
  return slots;
}

/** Slots of one skill (all levels): `L<level>.name` / `L<level>.desc`. Null when the skill is not in the table. */
function skillSlots(T, skillId) {
  const levels = T.skill[skillId]?.levels;
  if (!levels) return null;
  const slots = new Map();
  levels.forEach((lv, i) => {
    const sig = JSON.stringify([lv.skillType, lv.durationType, lv.spData?.spType]);
    if (lv.name) slots.set(`L${i + 1}.name`, { kind: 'skillName', tpl: lv.name, sig, bbKeys: '' });
    if (lv.description) slots.set(`L${i + 1}.desc`, { kind: 'skillDesc', tpl: lv.description, sig, bbKeys: keysOf(lv.blackboard) });
  });
  return slots;
}

/** Slots of one enemy: name / description of every database level (`db<level>.name`), the handbook's name and abilities. */
function enemySlots(T, key) {
  const lvs = T.db.get(key); const hb = T.handbook.enemyData?.[key];
  if (!lvs && !hb) return null;
  const slots = new Map();
  for (const lv of lvs || []) {
    const d = lv.enemyData || {};
    if (typeof d.name?.m_value === 'string' && d.name.m_value) slots.set(`db${lv.level}.name`, { kind: 'enemyName', tpl: d.name.m_value, sig: '', bbKeys: '' });
    if (typeof d.description?.m_value === 'string' && d.description.m_value) slots.set(`db${lv.level}.desc`, { kind: 'enemyDesc', tpl: d.description.m_value, sig: '', bbKeys: '' });
  }
  if (hb) {
    if (hb.name) slots.set('hb.name', { kind: 'enemyName', tpl: hb.name, sig: '', bbKeys: '' });
    const n = (hb.abilityList || []).length;
    (hb.abilityList || []).forEach((a, i) => { if (a.text) slots.set(`hb.ability${i}`, { kind: 'enemyAbility', tpl: a.text, sig: String(n), bbKeys: '' }); });
  }
  return slots;
}

// ---- resolving one text --------------------------------------------------------------------------------------------------

const REASONS = {
  noZhSlot: 'no Chinese official template of that kind exists for the record (the text is not in the official tables)',
  zhMismatch: 'no Chinese official template reproduces the text with the record\'s blackboard (the text was rewritten / supplemented)',
  noJaChar: 'the Japanese client data has no such operator / enemy / skill (newer than 2025-11)',
  noJaModule: 'the Japanese client data has no such module (newer than 2025-11)',
  noJaSlot: 'the operator exists in the Japanese data but not that talent / module level / candidate',
  sigDiff: 'the Japanese slot has a different structure (unlock condition / talent index / part / number of abilities)',
  bbKeysDiff: 'the Japanese slot has other blackboard keys (the skill / talent was reworked)',
  jaUnresolved: 'the Japanese template needs a blackboard key the record does not have',
  tagDiff: 'the rich-text tags of the official Japanese text differ from the Chinese (the Japanese drops / adds <$ba.xx> keywords or <@ba.rem> notes)',
  strayTag: 'the official Japanese text keeps a stray tag / {key}',
  numDiff: 'a number of the Chinese text is missing from the official Japanese text (stale wording, or the Japanese writes it in words)',
  ambiguous: 'several Chinese slots reproduce the text, with different official Japanese texts',
  empty: 'the Japanese text is empty',
};

/**
 * Resolve one Chinese text of the data against the official slots.
 * @param {Map|null} zs Chinese slots  @param {Map|null} js Japanese slots (null: the Japanese data lacks the whole entry)
 * @param {{kinds:string[], text:string, fill?:{bb?:object,bbStr?:object}, idx?:number, only?:string[], pref?:string[]}} spec
 *   idx = talent index the slot must have; only = path prefixes the slot must start with; pref = path prefixes in order
 *   of preference (the slots of the most preferred prefix win when several slots reproduce the text)
 * @returns {{zh:boolean, ok:true, ja:string, path:string}|{zh:boolean, ok:false, reason:string, detail?:string, draft?:string}}
 */
function resolveText(zs, js, spec) {
  const { kinds, text, fill = {}, idx, only, pref } = spec;
  const bb = fill.bb || {}; const bbStr = fill.bbStr || {};
  const isName = (s) => s.kind.endsWith('Name');
  let anySlot = false;
  let hits = [];
  for (const [p, s] of zs || []) {
    if (!kinds.includes(s.kind)) continue;
    if (only && !only.some((x) => p.startsWith(x))) continue;
    if (s.idx !== undefined && idx !== undefined && s.idx !== idx) continue;
    anySlot = true;
    const z = isName(s) ? { text: s.tpl, unresolved: [] } : expand(s.tpl, bb, bbStr);
    if (z.text === text) hits.push({ p, s, z, rank: 0 });
  }
  if (!hits.length) return { zh: false, ok: false, reason: anySlot ? 'zhMismatch' : 'noZhSlot' };
  if (pref) {
    for (const h of hits) { const i = pref.findIndex((x) => h.p.startsWith(x)); h.rank = i < 0 ? pref.length : i; }
    const best = Math.min(...hits.map((h) => h.rank));
    hits = hits.filter((h) => h.rank === best);
  }
  if (!js) return { zh: true, ok: false, reason: 'noJaChar' };
  let firstFail = null;
  const fail = (reason, detail, draft) => { firstFail ||= { reason, detail, draft }; };
  const outs = new Map(); // ja text → path
  for (const { p, s, z } of hits) {
    const j = js.get(p);
    if (!j) {
      const eq = /^equip:[^.]+\./.exec(p);
      fail(eq && ![...js.keys()].some((k) => k.startsWith(eq[0])) ? 'noJaModule' : 'noJaSlot', p);
      continue;
    }
    if (j.sig !== s.sig) { fail('sigDiff', `${p}: ${s.sig} ≠ ${j.sig}`); continue; }
    const e = isName(s) ? { text: j.tpl, unresolved: [] } : expand(j.tpl, bb, bbStr);
    if (!e.text.trim()) { fail('empty', p); continue; }
    if (j.bbKeys !== s.bbKeys) { fail('bbKeysDiff', `${p}: ${s.bbKeys} ≠ ${j.bbKeys}`, e.text); continue; }
    if (e.unresolved.length > z.unresolved.length) { fail('jaUnresolved', `${p}: ${e.unresolved.join(' ')}`, e.text); continue; }
    if (strayTags(e.text).length || (/[{}]/.test(e.text) && placeholders(e.text) !== placeholders(text))) { fail('strayTag', `${p}: ${strayTags(e.text).join(' ') || 'braces'}`, e.text); continue; }
    if (tags(e.text) !== tags(text) || placeholders(e.text) !== placeholders(text)) { fail('tagDiff', `${p}: ${tags(text)} | ${tags(e.text)}`, e.text); continue; }
    if (!isName(s) && !numbersCovered(text, e.text)) { fail('numDiff', `${p}: ${numbersOf(text).join(',')} | ${numbersOf(e.text).join(',')}`, e.text); continue; }
    if (!outs.has(e.text)) outs.set(e.text, p);
  }
  if (!outs.size) return { zh: true, ok: false, ...firstFail };
  if (outs.size > 1) return { zh: true, ok: false, reason: 'ambiguous', detail: [...outs.keys()].map((x) => JSON.stringify(x).slice(0, 80)).join(' | '), draft: [...outs.keys()][0] };
  const [[ja, p]] = outs;
  return { zh: true, ok: true, ja, path: p };
}

// ---- main --------------------------------------------------------------------------------------------------------------

const readData = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', `${name}.json`), 'utf8'));
const CATS = ['name', 'module', 'skill', 'trait', 'talent', 'token', 'enemy', 'other'];
const CAT_LABEL = { name: 'operator / subclass names', module: 'module names', skill: 'skills (name, text)', trait: 'traits (text, module text)', talent: 'talents (name, text)', token: 'summons (tokens.json)', enemy: 'enemies (name, text, abilities)', other: 'operator / enemy names in other data' };

async function main() {
  log('loading official tables…');
  const Z = await loadTables('zh');
  const J = await loadTables('ja');
  const chess = readData('chess'); const enemies = readData('enemies'); const tokens = readData('tokens');

  // bookkeeping: category → zh text → { ok, fail: Map(reason → n), kind }; occurrence counters; ja votes per zh text
  const cats = Object.fromEntries(CATS.map((c) => [c, new Map()]));
  const occ = Object.fromEntries(CATS.map((c) => [c, { total: 0, zh: 0, ok: 0 }]));
  const votes = new Map(); // zh → { cat, ja: Map(ja → n) }
  const samples = {}; const drafts = new Map(); const handled = new Set();
  const note = (cat, zh, res, where) => {
    if (typeof zh !== 'string' || !CJK.test(zh)) return;
    handled.add(zh);
    const o = occ[cat]; o.total++; if (res.zh) o.zh++; if (res.ok) o.ok++;
    const e = cats[cat].get(zh) || { ok: 0, zh: 0, fail: new Map() };
    cats[cat].set(zh, e);
    if (res.zh) e.zh++;
    if (res.ok) {
      e.ok++;
      const v = votes.get(zh) || { cat, ja: new Map() };
      v.ja.set(res.ja, (v.ja.get(res.ja) || 0) + 1);
      votes.set(zh, v);
    } else {
      e.fail.set(res.reason, (e.fail.get(res.reason) || 0) + 1);
      const arr = (samples[res.reason] ||= []);
      if (arr.length < 600) arr.push({ cat, where, zh: zh.slice(0, 200), detail: res.detail || '' });
      if (res.draft && !drafts.has(zh)) drafts.set(zh, { ja: res.draft, reason: res.reason, where });
    }
  };

  const cache = { zh: new Map(), ja: new Map() };
  const pool = (lang, key, build) => {
    const c = cache[lang];
    if (!c.has(key)) c.set(key, build(lang === 'zh' ? Z : J));
    return c.get(key);
  };
  const charPool = (lang, charId, equipChars = []) => pool(lang, `c:${charId}|${equipChars.join(',')}`, (T) => charSlots(T, charId, equipChars));
  const skillPool = (lang, id) => pool(lang, `s:${id}`, (T) => skillSlots(T, id));
  const enemyPool = (lang, key) => pool(lang, `e:${key}`, (T) => enemySlots(T, key));

  /** A text with templates in a character's slots (+ the modules of `equipChars`). */
  const charText = (cat, text, kinds, charId, equipChars, extra, where) => {
    if (!text) return;
    note(cat, text, resolveText(charPool('zh', charId, equipChars), charPool('ja', charId, equipChars), { kinds, text, ...extra }), where);
  };
  /** A skill record (chess / token skill): name + description; the record's level first, any other level as a fallback. */
  const skillText = (cat, s, where) => {
    if (!s || !s.skillId) return;
    const zs = skillPool('zh', s.skillId); const js = skillPool('ja', s.skillId);
    const fill = { bb: { duration: s.duration, ...s.bb }, bbStr: s.bbStr };
    for (const [kinds, text] of [[['skillName'], s.name], [['skillDesc'], s.descRaw]]) {
      if (!text) continue;
      let res = resolveText(zs, js, { kinds, text, fill, only: [`L${s.level}.`] });
      if (res.reason === 'zhMismatch' || res.reason === 'noZhSlot') {
        const any = resolveText(zs, js, { kinds, text, fill, pref: [`L${s.level}.`] });
        if (any.zh) res = any;
      }
      note(cat, text, res, `${where} ${s.skillId}`);
    }
  };
  const modPrefix = (mod) => (mod && mod.id ? [`equip:${mod.id}.L${mod.level}.`, `equip:${mod.id}.`] : []);

  // ---- chess.json -------------------------------------------------------------------------------------------------------
  for (const rec of Object.values(chess)) {
    if (!rec.charId || !rec.name) continue; // 甄选干员 (the DIY slot) has no operator
    const cid = rec.charId; const where = rec.chessId;
    const mp = rec.module?.active ? modPrefix(rec.module) : null; // a golden chess with its module: module texts first
    note('name', rec.name, resolveText(charPool('zh', cid), charPool('ja', cid), { kinds: ['charName'], text: rec.name }), where);
    const traitOcc = (tr, w, spec, modSpec) => {
      if (!tr) return;
      charText('trait', tr.descRaw, ['trait'], cid, [cid], { fill: tr, ...spec }, w);
      charText('trait', tr.moduleDescRaw, ['moduleTrait'], cid, [cid], { fill: tr, ...modSpec }, `${w}.moduleText`);
    };
    const talentOcc = (list, w, spec) => (list || []).forEach((t) => {
      charText('talent', t.name, ['talentName'], cid, [cid], { idx: t.index, ...spec }, w);
      charText('talent', t.descRaw, ['talentDesc'], cid, [cid], { idx: t.index, fill: t, ...spec }, w);
    });
    for (const s of [rec.skill, ...(rec.skills || [])]) skillText('skill', s, where);
    const charOnly = ['trait', 'desc'];
    traitOcc(rec.trait, `${where}.trait`, mp ? { pref: [...mp, ...charOnly] } : { only: charOnly }, { only: mp || ['equip:'], pref: mp || undefined });
    traitOcc(rec.traitBase, `${where}.traitBase`, { only: charOnly }, { only: ['equip:'] });
    talentOcc(rec.talents, `${where}.talents`, mp ? { pref: [...mp, 'talent'] } : { only: ['talent'] });
    talentOcc(rec.talentsBase, `${where}.talentsBase`, { only: ['talent'] });
    for (const m of rec.modules || []) {
      const p = modPrefix({ id: m.uniEquipId, level: m.level });
      traitOcc(m.traitOverride, `${where}.module ${m.uniEquipId}`, { pref: [...p, ...charOnly], only: [...p.slice(1), ...charOnly] }, { only: p.slice(1), pref: p });
      talentOcc(m.talentChanges, `${where}.module ${m.uniEquipId}`, { only: p.slice(1), pref: p });
    }
  }
  // names that are plain id → name tables: subclasses, modules
  const subProfs = new Map();
  for (const rec of Object.values(chess)) if (rec.subProfessionId && rec.subProfessionName) subProfs.set(rec.subProfessionId, rec.subProfessionName);
  for (const [id, zh] of subProfs) {
    const z = Z.uniequip.subProfDict?.[id]?.subProfessionName; const j = J.uniequip.subProfDict?.[id]?.subProfessionName;
    note('name', zh, z !== zh ? { zh: false, ok: false, reason: 'zhMismatch' } : j ? { zh: true, ok: true, ja: j } : { zh: true, ok: false, reason: 'noJaChar' }, `subProf ${id}`);
  }
  const moduleName = (zh, id, where) => {
    if (!zh || !id) return;
    const z = Z.uniequip.equipDict?.[id]?.uniEquipName; const j = J.uniequip.equipDict?.[id]?.uniEquipName;
    note('module', zh, z !== zh ? { zh: false, ok: false, reason: 'zhMismatch' } : j ? { zh: true, ok: true, ja: j } : { zh: true, ok: false, reason: 'noJaModule' }, `${where} ${id}`);
  };
  for (const rec of Object.values(chess)) {
    if (rec.module) moduleName(rec.module.name, rec.module.id, rec.chessId);
    for (const m of rec.modules || []) moduleName(m.name, m.uniEquipId, rec.chessId);
  }

  // ---- tokens.json (a summon's own character entry + the isToken module parts of its owners) ----------------------------------
  for (const tok of Object.values(tokens)) {
    const tid = tok.tokenId; const where = `token ${tid}`;
    if (tok.kind === 'bondSummon') {
      // the 炎佑 summon is an enemy template: its name is the enemy's; its description (desc) is written by the mode
      note('token', tok.name, resolveText(enemyPool('zh', tid), enemyPool('ja', tid), { kinds: ['enemyName'], text: tok.name }), where);
      continue;
    }
    const ownerChars = [...new Set((tok.owners || []).map((o) => chess[o]?.charId).filter(Boolean))];
    const cat = 'token';
    const T = (text, kinds, extra, w) => charText(cat, text, kinds, tid, ownerChars, extra, w);
    T(tok.name, ['charName'], {}, where);
    const traitOcc = (tr, w, mp, mid) => {
      if (!tr) return;
      const spec = mid === 'none' ? { only: ['trait', 'desc'] } : mp?.length ? { pref: [...mp, 'trait', 'desc'] } : {};
      T(tr.descRaw, ['trait'], { fill: tr, ...spec }, w);
      T(tr.moduleDescRaw, ['moduleTrait'], { fill: tr, only: ['equip:'], pref: mp }, `${w}.moduleText`);
    };
    const talentOcc = (list, w, mp, mid) => (list || []).forEach((t) => {
      const spec = mid === 'none' ? { only: ['talent'] } : mp?.length ? { pref: [...mp, 'talent'] } : {};
      T(t.name, ['talentName'], { idx: t.index, ...spec }, w);
      T(t.descRaw, ['talentDesc'], { idx: t.index, fill: t, ...spec }, w);
    });
    const firstOwner = chess[tok.owners?.[0]];
    const firstPref = firstOwner?.module?.active ? modPrefix(firstOwner.module) : [];
    T(tok.descRaw, ['trait'], { fill: tok.trait || tok.variants?.[tok.owners?.[0]]?.trait || {}, ...(firstPref.length ? { pref: [...firstPref, 'trait', 'desc'] } : {}) }, `${where}.desc`);
    traitOcc(tok.trait, `${where}.trait`, firstPref);
    if (tok.kind === 'mapChar') skillText(cat, tok.skill, where);
    talentOcc(tok.talents, `${where}.talents`, firstPref);
    for (const [owner, v] of Object.entries(tok.variants || {})) {
      const w = `${where}@${owner}`; const oc = chess[owner];
      const mp = oc?.module?.active ? modPrefix(oc.module) : [];
      traitOcc(v.trait, `${w}.trait`, mp);
      skillText(cat, v.skill, w);
      talentOcc(v.talents, `${w}.talents`, mp);
      for (const b of Object.values(v.bySkill || {})) skillText(cat, b.skill, `${w}.bySkill`);
      for (const [mid, b] of Object.entries(v.byModule || {})) {
        const bp = mid === 'none' ? [] : [`equip:${mid}.L${oc?.module?.level ?? 1}.`, `equip:${mid}.`];
        traitOcc(b.trait, `${w}.byModule ${mid}`, bp, mid); talentOcc(b.talents, `${w}.byModule ${mid}`, bp, mid);
      }
    }
  }

  // ---- enemies.json ----------------------------------------------------------------------------------------------------------
  for (const e of Object.values(enemies)) {
    const zs = enemyPool('zh', e.key); const js = enemyPool('ja', e.key);
    const where = `enemy ${e.key}`;
    const dbFirst = [`db${e.level}.`, 'db0.', 'db', 'hb.']; // the database level the data used, then the base level, then the handbook
    if (e.name) note('enemy', e.name, resolveText(zs, js, { kinds: ['enemyName'], text: e.name, pref: dbFirst }), where);
    if (e.descRaw) note('enemy', e.descRaw, resolveText(zs, js, { kinds: ['enemyDesc'], text: e.descRaw, only: ['db'], pref: dbFirst }), where);
    (e.abilities || []).forEach((a, i) => {
      if (a.textRaw) note('enemy', a.textRaw, resolveText(zs, js, { kinds: ['enemyAbility'], text: a.textRaw, only: [`hb.ability${i}`] }), `${where}.abilities[${i}]`);
    });
  }

  // ---- names in the other data files (bands.json "阿米娅", bosses.json "假想敌：胄"…): a `name` that is exactly an official ----
  // operator name or an official enemy name (one kind only) gets the Japanese name of the same id
  {
    const index = (entries) => { const m = new Map(); for (const [id, name] of entries) { if (name && CJK.test(name)) (m.get(name) || m.set(name, []).get(name)).push(id); } return m; };
    const zhChar = index(Object.entries(Z.char).filter(([id]) => /^char_/.test(id)).map(([id, c]) => [id, c.name]));
    const zhEnemy = index(Object.entries(Z.handbook.enemyData || {}).map(([id, e]) => [id, e.name]));
    const dataDir = path.join(ROOT, 'data');
    const seen = new Map(); // name → "file:field"
    for (const file of fs.readdirSync(dataDir).filter((x) => x.endsWith('.json') && !/^(assets|local-assets|chess|enemies|tokens)\.json$/.test(x))) {
      (function visit(v, field) {
        if (typeof v === 'string') { if (field === 'name' && CJK.test(v) && !handled.has(v) && !seen.has(v)) seen.set(v, `${file}:${field}`); }
        else if (Array.isArray(v)) v.forEach((x) => visit(x, field));
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, k);
      })(JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')), '');
    }
    for (const [name, where] of seen) {
      const c = zhChar.get(name); const e = zhEnemy.get(name);
      if ((c && e) || (!c && !e)) continue; // not an official name, or one that is both an operator and an enemy
      const jaNames = c ? c.map((id) => J.char[id]?.name) : e.map((id) => J.handbook.enemyData?.[id]?.name);
      const have = jaNames.filter(Boolean);
      if (!have.length) { note('other', name, { zh: true, ok: false, reason: 'noJaChar' }, where); continue; }
      for (const ja of have) note('other', name, { zh: true, ok: true, ja }, where);
    }
  }

  // ---- the dictionary ---------------------------------------------------------------------------------------------------------
  const dict = {}; const conflicts = []; const identical = [];
  const rank = (cat) => CATS.indexOf(cat);
  for (const [zh, v] of [...votes].sort((a, b) => rank(a[1].cat) - rank(b[1].cat))) {
    const list = [...v.ja].sort((a, b) => b[1] - a[1]);
    if (list.length > 1) conflicts.push({ zh, variants: list.map(([ja, n]) => ({ ja, n })) });
    const ja = list[0][0]; // the most frequent official wording (every variant reproduces the same Chinese text)
    if (ja === zh && !OPTS.keepIdentical) { identical.push(zh); continue; }
    dict[zh] = ja;
  }

  // ---- texts of the three files no category handled (hand-written by the mode) -------------------------------------------------------
  const derived = new Set([...handled].map(stripTags));
  const unhandled = new Map();
  for (const [file, json] of [['chess', chess], ['enemies', enemies], ['tokens', tokens]]) {
    (function visit(v, field) {
      if (typeof v === 'string') {
        if (!CJK.test(v) || handled.has(v) || derived.has(v)) return;
        const k = `${file}:${field}`; const m = unhandled.get(k) || new Map(); unhandled.set(k, m); m.set(v, (m.get(v) || 0) + 1);
      } else if (Array.isArray(v)) v.forEach((x) => visit(x, field));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, k);
    })(json, '');
  }

  // ---- collisions with the other dictionary files (later files win, so a clash may hide an official wording) ----------------------------
  const clashes = [];
  const dir = path.dirname(OPTS.out);
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.json') && path.join(dir, x) !== OPTS.out).sort() : []) {
    const other = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const [k, v] of Object.entries(other)) if (Object.hasOwn(dict, k) && dict[k] !== v) clashes.push({ file: f, zh: k, official: dict[k], other: v });
  }

  // ---- report ---------------------------------------------------------------------------------------------------------------------
  const rows = {};
  for (const cat of CATS) {
    const r = { targets: cats[cat].size, zhMatched: 0, ok: 0, excluded: 0, byReason: {}, occurrences: occ[cat] };
    for (const e of cats[cat].values()) {
      if (e.zh) r.zhMatched++;
      if (e.ok) r.ok++;
      else { r.excluded++; const top = [...e.fail].sort((a, b) => b[1] - a[1])[0][0]; r.byReason[top] = (r.byReason[top] || 0) + 1; }
    }
    rows[cat] = r;
  }
  log('\ncategory                         distinct zh texts: targets  zh-match  ja-ok  excluded | occurrences: total  zh-match');
  for (const cat of CATS) {
    const r = rows[cat]; const o = r.occurrences;
    log(`${CAT_LABEL[cat].padEnd(40)} ${String(r.targets).padStart(7)} ${String(r.zhMatched).padStart(9)} ${String(r.ok).padStart(6)} ${String(r.excluded).padStart(9)} | ${String(o.total).padStart(17)} ${String(o.zh).padStart(9)}   ${Object.entries(r.byReason).map(([k, n]) => `${k}:${n}`).join(' ')}`);
  }
  log(`\ndictionary: ${Object.keys(dict).length} entries; ${identical.length} left out (official Japanese equals the Chinese text); ${conflicts.length} text(s) with several official wordings; ${clashes.length} clash(es) with other dictionary files; ${drafts.size} draft(s) of excluded texts`);
  const unh = [...unhandled].map(([k, m]) => `${k}: ${m.size}`);
  log(`texts no category handled: ${unh.length ? unh.join(', ') : 'none'}`);
  if (OPTS.explain > 0) {
    for (const [reason, arr] of Object.entries(samples)) {
      log(`\n== ${reason}: ${REASONS[reason]} (${arr.length}${arr.length >= 600 ? '+' : ''} occurrences)`);
      for (const s of arr.slice(0, OPTS.explain)) log(`  [${s.cat}] ${s.where}: ${JSON.stringify(s.zh).slice(0, 110)}${s.detail ? `\n      ${s.detail}` : ''}`);
    }
  }

  const excluded = {};
  for (const cat of CATS) excluded[cat] = [...cats[cat]].filter(([, e]) => !e.ok).map(([zh, e]) => ({ zh, reasons: Object.fromEntries(e.fail) }));
  fs.mkdirSync(path.dirname(OPTS.report), { recursive: true });
  fs.writeFileSync(OPTS.report, JSON.stringify({
    rows, reasons: REASONS, conflicts, clashes, identical, excluded, drafts: Object.fromEntries(drafts),
    unhandled: Object.fromEntries([...unhandled].map(([k, m]) => [k, [...m.keys()]])), samples,
  }, null, 1));
  log(`report: ${path.relative(ROOT, OPTS.report)}`);

  if (!OPTS.check) {
    fs.mkdirSync(path.dirname(OPTS.out), { recursive: true });
    fs.writeFileSync(OPTS.out, `${JSON.stringify(dict, null, 1)}\n`);
    log(`wrote ${path.relative(ROOT, OPTS.out)} (${Object.keys(dict).length} entries)`);
  }
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
