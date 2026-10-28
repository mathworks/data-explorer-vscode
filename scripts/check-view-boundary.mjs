// Copyright 2026 The MathWorks, Inc.
// View boundary: `src/view/` is staged here to become its own package, so it has to build
// with nothing but itself and that package's two dependencies. Any reach past that is a
// file the split would leave behind, and it is cheapest to find on the PR that adds it,
// not on the day the folder moves out.
//
// Two rules, each one the future package's edge:
//   * a file in src/view imports only src/view, `data-explorer-core`, `lit` and `lit/…` —
//     not the extension's host or webview code, and not core's Node-only entry;
//   * a file in src/view/model imports neither src/view/widgets nor lit. The model is the
//     DOM-free half, which a worker or a terminal UI can load without a browser page.
//
// Type-only imports count. The package has to resolve them too, and `import type` from the
// host is how a host type quietly becomes something the view cannot be built without.
// tsconfig.view-model.json is the other half: no DOM lib, so the model cannot NAME a DOM type.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dirname, '..');
const VIEW = 'src/view';
const MODEL = 'src/view/model/';
const WIDGETS = 'src/view/widgets/';

const toPosix = (p) => p.split(sep).join('/');
const isLit = (spec) => spec === 'lit' || spec.startsWith('lit/');

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(join(ROOT, dir)).sort()) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...sourceFiles(rel));
    else if (entry.endsWith('.ts')) found.push(rel);
  }
  return found;
}

// The repo-relative file a relative specifier names, or null. TS writes `.js` and means the
// `.ts` beside it.
function resolve(from, spec) {
  const base = toPosix(relative(ROOT, join(ROOT, dirname(from), spec)));
  const candidates = /\.js$/.test(base) ? [base.replace(/\.js$/, '.ts'), base] : [base, `${base}.ts`, `${base}/index.ts`];
  return candidates.find((c) => existsSync(join(ROOT, c)) && statSync(join(ROOT, c)).isFile()) ?? null;
}

function violation(file, spec) {
  if (!spec.startsWith('.')) {
    if (spec === 'data-explorer-core') return null;
    if (isLit(spec)) return file.startsWith(MODEL) ? 'the model is DOM-free and may not use lit' : null;
    if (spec.startsWith('data-explorer-core/')) return 'only core\'s browser entry, `data-explorer-core`, is allowed';
    return 'not a dependency the view package will have';
  }
  const target = resolve(file, spec);
  if (!target) return 'resolves to no file';
  if (!target.startsWith(`${VIEW}/`)) return `reaches ${target}, outside ${VIEW}/`;
  if (file.startsWith(MODEL) && target.startsWith(WIDGETS)) return `the model may not import a widget (${target})`;
  return null;
}

const files = sourceFiles(VIEW);
// A walk that read nothing would pass everything.
if (files.length === 0) {
  console.error(`VIEW BOUNDARY FAIL — no .ts files found under ${VIEW}/`);
  process.exit(1);
}

const failures = [];
for (const file of files) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  // TypeScript's own pre-processor, not a regex: comments here quote imports to explain
  // them, and a regex reads those as edges that no build ever sees.
  for (const { fileName: spec, pos } of ts.preProcessFile(text, true, true).importedFiles) {
    const reason = violation(file, spec);
    if (reason) failures.push(`${file}:${text.slice(0, pos).split('\n').length} ${spec} — ${reason}`);
  }
}

if (failures.length) {
  console.error('VIEW BOUNDARY FAIL — src/view reaches past what its package will have:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`OK: ${files.length} files in ${VIEW} import only themselves, data-explorer-core and lit`);
