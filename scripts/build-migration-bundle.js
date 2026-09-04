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

/**
 * Read a migration as text without silently corrupting it.
 *
 * Two files (driver_registrations.sql, driver_registrations_driver_deposit_balance.sql)
 * contain a lone 0xC2 byte before "$10" — the orphaned lead byte of "£" (C2 A3)
 * left behind when "£10" was hand-edited to "$10". Node's 'utf8' decode turns that
 * into U+FFFD, which would then be pasted into the target database. Decode
 * strictly; on failure, drop stray lead bytes and decode again, and say so.
 */
const read = (f) => {
  const buf = fs.readFileSync(path.join(SRC, f));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    const cleaned = Buffer.from(buf.filter((b, i) => !(b === 0xc2 && (i + 1 >= buf.length || buf[i + 1] < 0x80))));
    console.warn(`  note: ${f} is not valid UTF-8 (orphaned 0xC2 before "$"); stray bytes dropped`);
    return new TextDecoder('utf-8', { fatal: false }).decode(cleaned);
  }
};

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
  // Found by the first real run: `comment on column public.x.col is ...` needs
  // the table and nothing above matched it.
  new RegExp(`comment\\s+on\\s+(?:table|column)\\s+${TABLE}`, 'gi'),
  new RegExp(`\\b(?:grant|revoke)\\s+[^;]*?\\bon\\s+(?:table\\s+)?${TABLE}`, 'gi'),
  new RegExp(`create\\s+(?:or\\s+replace\\s+)?(?:trigger|rule)\\s+\\S+[\\s\\S]*?\\bon\\s+${TABLE}`, 'gi'),
  new RegExp(`create\\s+(?:or\\s+replace\\s+)?view\\s+\\S+[\\s\\S]*?\\bfrom\\s+${TABLE}`, 'gi'),
  new RegExp(`truncate\\s+(?:table\\s+)?${TABLE}`, 'gi'),
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
  // object kinds that follow `grant … on` but are not tables
  'function', 'sequence', 'schema', 'type', 'all',
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

// Backstop: the regexes above name the statement types we know about. Any bare
// mention of a table that some file creates is treated as a dependency too, so
// a statement type nobody thought of (the first real run found `comment on
// column`) cannot slip a file above its table. Over-linking only adds edges;
// the sort tolerates that and reports the one thing it cannot: a cycle.
const knownTables = [...creator.keys()];
for (const f of files) {
  if (f === SEED) continue;
  const sql = read(f).replace(/--.*$/gm, '');
  for (const t of knownTables) {
    if (creator.get(t) === f) continue;
    if (new RegExp(`\\b${t}\\b`, 'i').test(sql)) deps.get(f).add(t);
  }
}

// Column-level dependencies, scoped to a table. Found by the second real run:
// driver_booking_assigned_at.sql backfills `where assigned_driver_id is not null`
// on customer_delivery_orders, but assigned_driver_id is ADDED by
// driver_booking_assignment.sql, which sorted one place later. Tables alone
// cannot see that. So: a file that does `alter table T add column C` must precede
// any other file that mentions BOTH T and C. Scoping by T keeps common column
// names (status, created_at) from linking unrelated files.
/**
 * "table.column" -> Set<file> that PROVIDE it: every file that `add column`s it
 * (this repo re-adds columns defensively with `if not exists` in several files),
 * plus the table's creator when it declares the column inline. Providers never
 * depend on each other through this rule — that was the source of 63 cycles on
 * the first attempt. Only a file that merely USES the column depends on providers.
 */
const columnProviders = new Map();
const reAddCol = new RegExp(
  `alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?${TABLE}\\s+add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?([a-z_][a-z0-9_]*)`,
  'gi',
);
const cleanSql = new Map();
for (const f of files) {
  if (f === SEED) continue;
  cleanSql.set(f, read(f).replace(/--.*$/gm, ''));
}
for (const [f, sql] of cleanSql) {
  let m;
  while ((m = reAddCol.exec(sql))) {
    const key = `${m[1].toLowerCase()}.${m[2].toLowerCase()}`;
    if (!columnProviders.has(key)) columnProviders.set(key, new Set());
    columnProviders.get(key).add(f);
  }
}
// The creator declares columns inline; if it mentions the column at all, it provides it.
for (const [key, providers] of columnProviders) {
  const [t, c] = key.split('.');
  const cf = creator.get(t);
  if (cf && new RegExp(`\\b${c}\\b`, 'i').test(cleanSql.get(cf) || '')) providers.add(cf);
}
/**
 * A column mention inside a plpgsql body ($$ … $$) is resolved when the function
 * is CALLED, not when it is created, so it is not a dependency at apply time.
 * Counting it produced a mutual edge between driver_booking_assignment.sql
 * (whose accept function sets assigned_at) and driver_booking_assigned_at.sql
 * (which backfills using assigned_driver_id) — a cycle that the real, working
 * apply order proves is not one. Only top-level statements count as column uses.
 */
const topLevelOnly = (sql) => sql.replace(/\$\$[\s\S]*?\$\$/g, ' ');
/**
 * A file USES table.column only if the column appears in the SAME top-level
 * statement that names the table (or qualified as table.column). File-wide
 * co-mention was wrong: customer_delivery_orders.sql declares its own
 * vehicle_type and also names driver_registrations, so it looked like a user of
 * driver_registrations.vehicle_type — which a later file adds — and that one
 * false edge put the table's creator inside a 20-file cycle.
 */
const usesColumn = (sql, t, c) => {
  const qualified = new RegExp(`\\b${t}\\.${c}\\b`, 'i');
  if (qualified.test(sql)) return true;
  // The statement must TARGET t. A `create table other (… references t …)`
  // names t but declares its own columns, so a column word inside it belongs to
  // `other`, never to t. That exact case (customer_delivery_orders declaring
  // requested_vehicle_type while referencing delivery_requests) is what kept the
  // table's creator inside a 20-file cycle through three wrong fixes.
  const targetsT = new RegExp(
    `^\\s*(?:update|insert\\s+into|delete\\s+from|truncate(?:\\s+table)?|alter\\s+table(?:\\s+only)?(?:\\s+if\\s+exists)?|comment\\s+on\\s+column|create\\s+(?:unique\\s+)?index\\s+(?:if\\s+not\\s+exists\\s+)?\\S+\\s+on)\\s+(?:public\\.)?${t}\\b`,
    'i',
  );
  const namesC = new RegExp(`\\b${c}\\b`, 'i');
  return sql.split(';').some((stmt) => targetsT.test(stmt) && namesC.test(stmt));
};
/** file -> Set<file> it must follow because it uses a column another file provides */
const columnDeps = new Map(files.filter((f) => f !== SEED).map((f) => [f, new Set()]));
for (const [f, rawSql] of cleanSql) {
  const sql = topLevelOnly(rawSql);
  for (const [key, providers] of columnProviders) {
    if (providers.has(f)) continue; // providers do not depend on each other here
    const [t, c] = key.split('.');
    if (usesColumn(sql, t, c)) {
      for (const p of providers) if (p !== f) columnDeps.get(f).add(p);
    }
  }
}

// Build edges: file -> files it must come after.
const after = new Map(files.filter((f) => f !== SEED).map((f) => [f, new Set()]));
for (const [f, set] of columnDeps) for (const a of set) after.get(f).add(a);
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
