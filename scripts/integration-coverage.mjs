// Copyright 2026 The MathWorks, Inc.
// How much of src/ the integration suite runs, from the V8 profiles the extension host wrote
// under `vscode-test --coverage` (test-integration/captureCoverage.ts keeps them). Report only:
// no threshold, nothing fails on a number.
//
// Not vscode-test's own report. Its c8 pass matches `include`/`exclude` against the files that
// RAN (dist/extension.js, dist-test/suite/*.test.js), not the sources their maps lead back to,
// so a `src/**` filter keeps nothing. And c8 counts lines, each one counted as run unless V8
// says otherwise, comments and type declarations included. This converts with
// ast-v8-to-istanbul, which vitest's v8 coverage uses too: statements, branches and functions
// read from the code.
//
// What a file has to cover comes from the file, not from the bundles: each one is compiled on
// its own, the way vitest compiles it, so its totals are the ones `npm run test:coverage` gives
// it. What the bundles ran is then added onto those statements, functions and branches. A
// function the bundler dropped as unused still counts as not run, and a file no bundle carries
// shows at 0.
//
// Two copies of a host module can run: the extension's own, in dist/extension.js (activate(),
// the registered providers and commands), and the one a test file bundles for the providers it
// builds itself. Both land on the same src/ file, and their counts are added.
//
// Webview code (src/webview/) runs in the webview, not in the extension host: it is the unit
// suite's to measure.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import convert from 'ast-v8-to-istanbul';
import { transform } from 'esbuild';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import { parseAstAsync } from 'vite';

// The real path: V8 names a script by it, and on macOS the checkout may sit behind /tmp.
const root = realpathSync(process.cwd());
const out = join(root, 'coverage-integration');
const profiles = join(out, 'v8');

const rel = (path) => relative(root, path).split(sep).join('/');
/** A source this report measures: src/, less the webview's and declarations. */
const measured = (path) => {
  const r = rel(path);
  return r.startsWith('src/') && !r.startsWith('src/webview/') && r.endsWith('.ts') && !r.endsWith('.d.ts');
};
/** A script the extension host ran that can carry src/ code: the extension and the test files. */
const bundled = (path) => {
  const r = rel(path);
  return r === 'dist/extension.js' || (r.startsWith('dist-test/') && r.endsWith('.js'));
};

const names = existsSync(profiles) ? readdirSync(profiles).filter((n) => n.endsWith('.json')) : [];
if (names.length === 0) {
  console.error(`integration coverage: no V8 profiles in ${rel(profiles)}/; was the suite run with --coverage?`);
  process.exit(1);
}

// Every file's own statements, functions and branches, all at 0.
const tsconfigRaw = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'));
const sources = readdirSync(join(root, 'src'), { recursive: true })
  .map((f) => join(root, 'src', String(f)))
  .filter(measured)
  .sort();
const own = new Map();
for (const file of sources) {
  const { code, map } = await transform(readFileSync(file, 'utf8'), {
    loader: 'ts',
    format: 'esm',
    target: 'node18',
    sourcemap: 'external',
    sourcefile: file,
    tsconfigRaw,
  });
  const data = await convert({ code, sourceMap: JSON.parse(map), ast: await parseAstAsync(code), coverage: { url: pathToFileURL(file).href, functions: [] } });
  // A file of types and re-exports compiles to nothing a map can point into.
  own.set(file, data[file] ?? libCoverage.createFileCoverage(file).toJSON());
}

// A bundle places an item where the file does, with one exception: one that starts with a
// namespace import (`vscode.Uri.joinPath(…)`) starts, in a bundle, at the name after it (`Uri`),
// because esbuild maps no position to the import's local name there. Where it ends is the same.
// So a bundle's item is the file's own one that starts on its line, at or before it, and ends
// where it ends: the nearest such. (A branch is placed by its whole extent: the end of its first
// arm is where the second starts, which can be shifted the same way.) What matches nothing is
// code esbuild wrote and the file does not have: the `require` an import became, the
// `var X = class` a class became, an entry's export getters.
const KINDS = [
  ['statementMap', 's', (item) => item],
  ['fnMap', 'f', (item) => item.loc],
  ['branchMap', 'b', (item) => item.loc],
];
const placeOf = ({ start, end }) => `${start.line}|${end.line}|${end.column}`;
const places = new Map();
const placesIn = (file) => {
  if (!places.has(file)) {
    const mine = own.get(file);
    const byKind = {};
    for (const [mapKey, , locOf] of KINDS) {
      const at = new Map();
      for (const [id, item] of Object.entries(mine[mapKey])) {
        const loc = locOf(item);
        const key = placeOf(loc);
        if (!at.has(key)) at.set(key, []);
        at.get(key).push({ id, column: loc.start.column });
      }
      byKind[mapKey] = at;
    }
    places.set(file, byKind);
  }
  return places.get(file);
};
const addRun = (file, ran) => {
  const mine = own.get(file);
  const byKind = placesIn(file);
  for (const [mapKey, hitsKey, locOf] of KINDS) {
    for (const [id, item] of Object.entries(ran[mapKey])) {
      const loc = locOf(item);
      let match;
      for (const candidate of byKind[mapKey].get(placeOf(loc)) ?? []) {
        if (candidate.column <= loc.start.column && (!match || candidate.column > match.column)) match = candidate;
      }
      if (!match) continue;
      const hits = ran[hitsKey][id];
      if (hitsKey !== 'b') mine[hitsKey][match.id] += hits;
      else if (hits.length === mine.b[match.id].length) mine.b[match.id] = mine.b[match.id].map((n, i) => n + hits[i]);
    }
  }
};

// A bundle and its map, read once however many profiles name it.
const scripts = new Map();
const scriptAt = (path) => {
  if (!scripts.has(path)) {
    scripts.set(path, { code: readFileSync(path, 'utf8'), sourceMap: JSON.parse(readFileSync(`${path}.map`, 'utf8')) });
  }
  return scripts.get(path);
};

for (const name of names) {
  const profile = JSON.parse(readFileSync(join(profiles, name), 'utf8'));
  for (const ran of profile.result ?? []) {
    if (!ran.url.startsWith('file:')) continue;
    const path = fileURLToPath(ran.url);
    if (!bundled(path) || !existsSync(`${path}.map`)) continue;
    const { code, sourceMap } = scriptAt(path);
    const data = await convert({ code, sourceMap, ast: await parseAstAsync(code), coverage: { url: ran.url, functions: ran.functions } });
    for (const [file, fileCoverage] of Object.entries(data)) {
      if (own.has(file)) addRun(file, fileCoverage);
    }
  }
}

const context = libReport.createContext({ dir: out, coverageMap: libCoverage.createCoverageMap(Object.fromEntries(own)) });
for (const [reporter, options] of [
  ['text', { maxCols: 120 }],
  ['text-summary', {}],
  ['json-summary', {}],
  ['json', {}],
  ['html', {}],
]) {
  reports.create(reporter, options).execute(context);
}
console.log(`integration coverage: ${names.length} profile(s), ${scripts.size} bundle(s), ${sources.length} src files; reports in ${rel(out)}/`);
