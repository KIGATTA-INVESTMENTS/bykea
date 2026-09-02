#!/usr/bin/env node
/**
 * Concatenate supabase/*.sql into ONE file, in dependency order, for pasting into
 * the SQL editor of a fresh Supabase project.
 *
 * WHY
 * The 70 migration files carry no numbering and were applied by hand over time.
 * Standing up a throwaway project for local testing (docs/push-local-testing.md,
 * Part 2) means running all of them, in an order where every table exists before
 * anything references it. Doing that by eye 70 times is how you lose an afternoon.
 *
 * HOW THE ORDER IS DECIDED
 * A file that CREATES table X must run before any file that:
 *   - references public.X in a foreign key,
 *   - alters public.X,
 *   - creates a policy, trigger or index on public.X,
 *   - inserts into / updates public.X.
 * Then a topological sort, alphabetical among equals so the output is stable.
 *
 * WHAT THIS DOES NOT DO
 * It does not execute anything, so the order is derived, not proven. If a file
 * turns out to depend on something this heuristic missed, Postgres says
 * "relation ... does not exist" naming the table, and the manifest at the top of
 * the bundle tells you which file that was. Fix the order here, not by hand.
 *
 * seed_test_driver.sql is data, not schema, and is appended LAST as a clearly
 * marked optional block.
 *
 * USAGE
 *   node scripts/build-migration-bundle.js
 *   → supabase/bundle/all-in-order.sql
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'supabase');
const OUT_DIR = path.join(SRC, 'bundle');
const OUT = path.join(OUT_DIR, 'all-in-order.sql');
const SEED = 'seed_test_driver.sql';

const files = fs
  .readdirSync(SRC)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

/** table name -> file that creates it */
const creator = new Map();
/** file -> Set<table> it depends on */
const deps = new Map();

const TABLE = '(?:public\\.)?([a-z_][a-z0-9_]*)';
const reCreate = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${TABLE}`, 'gi');
const reUses = [
  new RegExp(`references\\s+${TABLE}`, 'gi'),
  new RegExp(`alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?${TABLE}`, 'gi'),
  new RegExp(`\\bon\\s+${TABLE}\\s+(?:for|using|to|with|as|\\()`, 'gi'), // policy/index/trigger "on public.x for ..."
  new RegExp(`create\\s+(?:unique\\s+)?index\\s+(?:if\\s+not\\s+exists\\s+)?\\S+\\s+on\\s+${TABLE}`, 'gi'),
  new RegExp(`insert\\s+into\\s+${TABLE}`, 'gi'),
  new RegExp(`update\\s+${TABLE}\\s+set`, 'gi'),
  new RegExp(`delete\\s+from\\s+${TABLE}`, 'gi'),
  new RegExp(`\\bfrom\\s+${TABLE}\\b`, 'gi'),
  new RegExp(`\\bjoin\\s+${TABLE}\\b`, 'gi'),
];

// Words the loose regexes catch that are never table names here: SQL keywords,
// `on conflict`, plpgsql `old`/`new`, and bare English from comments inside $$
// function bodies. No table in this schema has a bare name like `customer` — they
// are `customer_wallets`, `driver_registrations`, `shop_owners`, etc.
const SQL_KEYWORDS = new Set([
  'select', 'where', 'table', 'if', 'not', 'exists', 'public', 'only',
  'conflict', 'old', 'new', 'the', 'a', 'an', 'this', 'that', 'each',
  'request', 'customer', 'driver', 'shop', 'package', 'order', 'booking',
  'ui', 'localstorage', 'app', 'client', 'server', 'browser',
]);
// Schemas and catalogs that live outside this bundle and always exist.
const EXTERNAL_SCHEMAS = new Set(['storage', 'auth', 'extensions', 'pg_constraint', 'pg_class', 'pg_namespace', 'information_schema']);

for (const f of files) {
  if (f === SEED) continue;
  const sql = read(f).replace(/--.*$/gm, ''); // strip line comments so prose does not create edges
  let m;
  while ((m = reCreate.exec(sql))) {
    const t = m[1].toLowerCase();
    if (!creator.has(t)) creator.set(t, f);
  }
  const d = new Set();
  for (const re of reUses) {
    re.lastIndex = 0;
    while ((m = re.exec(sql))) {
      const t = m[1].toLowerCase();
      if (!SQL_KEYWORDS.has(t)) d.add(t);
    }
  }
  deps.set(f, d);
}

// Build edges: file -> files it must come after.
const after = new Map(files.filter((f) => f !== SEED).map((f) => [f, new Set()]));
const unresolved = new Map();
for (const [f, tables] of deps) {
  for (const t of tables) {
    const c = creator.get(t);
    if (c && c !== f) after.get(f).add(c);
    else if (!c) {
      if (!unresolved.has(f)) unresolved.set(f, new Set());
      unresolved.get(f).add(t);
    }
  }
}

// Kahn's algorithm, alphabetical tie-break.
const indeg = new Map([...after.keys()].map((f) => [f, after.get(f).size]));
const dependents = new Map([...after.keys()].map((f) => [f, []]));
for (const [f, set] of after) for (const c of set) dependents.get(c).push(f);

const ready = [...indeg].filter(([, n]) => n === 0).map(([f]) => f).sort();
const order = [];
while (ready.length) {
  const f = ready.shift();
  order.push(f);
  for (const d of dependents.get(f).sort()) {
    indeg.set(d, indeg.get(d) - 1);
    if (indeg.get(d) === 0) {
      ready.push(d);
      ready.sort();
    }
  }
}
const cycled = [...after.keys()].filter((f) => !order.includes(f));

// Emit.
fs.mkdirSync(OUT_DIR, { recursive: true });
const lines = [];
lines.push('-- InGo schema bundle. GENERATED by scripts/build-migration-bundle.js — do not edit by hand.');
lines.push(`-- ${order.length} files in dependency order. Paste the whole file into the SQL editor of a`);
lines.push('-- FRESH Supabase project. Not for the production project; that already has its schema.');
lines.push('--');
lines.push('-- Order (a file appears after every file that creates a table it touches):');
order.forEach((f, i) => lines.push(`--   ${String(i + 1).padStart(2, ' ')}. ${f}`));
if (cycled.length) {
  lines.push('--');
  lines.push('-- !! NOT INCLUDED, dependency cycle detected — apply these by hand and fix the generator:');
  cycled.forEach((f) => lines.push(`--   ${f}  (after: ${[...after.get(f)].join(', ')})`));
}
const external = new Map();
const unknown = new Map();
for (const [f, set] of unresolved) {
  for (const t of set) {
    const bucket = EXTERNAL_SCHEMAS.has(t) ? external : unknown;
    if (!bucket.has(f)) bucket.set(f, new Set());
    bucket.get(f).add(t);
  }
}
if (external.size) {
  lines.push('--');
  lines.push('-- Uses Supabase built-in schemas that every project already has (nothing to do):');
  for (const [f, set] of external) lines.push(`--   ${f}: ${[...set].join(', ')}`);
}
if (unknown.size) {
  lines.push('--');
  lines.push('-- !! Tables referenced but created by no file here. If a "relation does not exist"');
  lines.push('-- names one of these, the schema has a gap the generator could not see:');
  for (const [f, set] of unknown) lines.push(`--   ${f}: ${[...set].join(', ')}`);
}
lines.push('');

for (const f of order) {
  lines.push('');
  lines.push(`-- ============================================================================`);
  lines.push(`-- ${f}`);
  lines.push(`-- ============================================================================`);
  lines.push(read(f).trim());
  lines.push('');
}

if (files.includes(SEED)) {
  lines.push('');
  lines.push(`-- ============================================================================`);
  lines.push(`-- OPTIONAL — ${SEED}`);
  lines.push('-- Test driver for the driver portal: testdriver@bykea.test / TestDriver123!');
  lines.push('-- Only for a throwaway project. Never run against production.');
  lines.push(`-- ============================================================================`);
  lines.push(read(SEED).trim());
  lines.push('');
}

fs.writeFileSync(OUT, lines.join('\n'));

console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
console.log(`  ${order.length} files ordered, ${cycled.length} in cycles, ${unresolved.size} files with unresolved refs`);
if (cycled.length) console.log('  CYCLES:', cycled.join(', '));
process.exit(cycled.length ? 1 : 0);
