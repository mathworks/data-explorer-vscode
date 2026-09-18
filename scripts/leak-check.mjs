// Copyright 2026 The MathWorks, Inc.
// Leak check: nothing internal to MathWorks may reach this tree. The repository is
// public, so this guards the boundary on every push rather than on release — by the
// time a leak is tagged it is already fetchable, and git history keeps it there.
//
// Three phases, each guarding a different way internal material has actually escaped
// or could: a needle in prose or code, an internal registry URL regressed into the
// lockfile, and a local-only notes file force-added past .gitignore.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// `data-explorer-ts` is the internal codename for the subsystem this extension grew
// out of; the public name is "data explorer". The rest are internal infrastructure
// hostnames and the internal forge.
const NEEDLES = ['insidelabs', 'ipws', 'mw-npm-repository', 'gitlab', 'data-explorer-ts'];

// The lockfile must resolve against the PUBLIC registry. The npm registry configured
// in the dev environment here is the internal Artifactory, and it is the public one
// that is unreachable — so every `npm install` pulls internal `resolved` URLs in and
// they have to be rewritten back out. That rewrite is manual, which means it is
// forgettable, which is why it is asserted. Content-based `integrity` hashes stay
// valid across the rewrite, so a correct lockfile is still an installable one.
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';

// The single legitimate exception: the upstream data model is a git dependency, not a
// registry one, so it resolves to a GitHub URL by design.
const ALLOWED_GIT_PREFIX = 'git+ssh://git@github.com/mathworks/';

// Local-only files, kept out of the tree by .gitignore. Ignore rules do not apply to
// files already in the index, so a single `git add -f` — or a tool that does the
// equivalent — makes one tracked permanently and .gitignore goes on looking correct.
// These are the internal notes, so that is the leak with the highest cost.
const LOCAL_ONLY = ['CLAUDE.md', 'docs/superpowers/', 'docs/deep-work/', '.superpowers/'];

// Every phase runs and the exit code is decided at the end, so one failure does not
// mask what the later phases would have found. Reporting every leak at once matters
// when the caller is unattended and only gets one shot at the output.
let failed = false;
if (!checkNeedles()) failed = true;
if (!checkLockfileRegistry()) failed = true;
if (!checkLocalOnlyUntracked()) failed = true;
process.exit(failed ? 1 : 0);

// `git grep` rather than a filesystem walk: it scans tracked files only, so it needs
// no exclusion list for node_modules, dist/, or the gitignored notes — and "tracked"
// is exactly the set that can reach the remote. This file is excluded from its own
// scan because it necessarily spells the needles out as literals.
//
// Case-SENSITIVE, deliberately. Adding -i looks strictly safer and is not: `ipws` is
// four characters and turns up inside ordinary camelCase, so -i flags every call to
// `skipWs()` in src/webview/rowFilter.ts. A check that cries wolf on correct code gets
// muted, and a muted check guards nothing. The cost is that a shouted `GITLAB` would
// pass; the needles are lowercase everywhere they legitimately occur.
function checkNeedles() {
  let hits = '';
  try {
    hits = execFileSync(
      'git',
      ['grep', '-nI', '-E', NEEDLES.join('|'), '--', '.', ':(exclude)scripts/leak-check.mjs'],
      { encoding: 'utf8' },
    );
  } catch (e) {
    // git grep exits 1 when nothing matched — the success case.
    if (e.status === 1) {
      console.log(`OK: none of ${NEEDLES.length} internal needles appear in a tracked file`);
      return true;
    }
    throw e;
  }

  if (hits.trim()) {
    console.error('LEAK FAIL — internal references found in tracked files:');
    console.error(hits);
    console.error('Genericize the wording, or move the file out of the tree.');
    return false;
  }
  console.log(`OK: none of ${NEEDLES.length} internal needles appear in a tracked file`);
  return true;
}

// Walk the whole lockfile for `resolved` keys rather than reading the `packages` map
// directly: lockfileVersion 3 keeps them under `packages`, but v2 mirrors them under a
// legacy `dependencies` tree, and a walk covers a format change without noticing one.
function checkLockfileRegistry() {
  let lock;
  try {
    lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  } catch (e) {
    console.error(`LEAK CHECK INCONCLUSIVE — package-lock.json is unreadable: ${e.message}`);
    return false;
  }

  const bad = [];
  let checked = 0;
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'resolved' && typeof value === 'string') {
        checked += 1;
        if (!value.startsWith(PUBLIC_REGISTRY) && !value.startsWith(ALLOWED_GIT_PREFIX)) {
          bad.push(`${path || '<root>'}: ${value}`);
        }
      } else if (value && typeof value === 'object') {
        walk(value, `${path}/${key}`);
      }
    }
  };
  walk(lock, '');

  if (bad.length > 0) {
    const subject = bad.length === 1 ? 'entry does not' : `entries do not`;
    console.error(`LEAK FAIL — ${bad.length} lockfile ${subject} resolve to the public registry:`);
    for (const entry of bad) console.error(`  ${entry}`);
    console.error(
      `\nRewrite each \`resolved\` host to ${PUBLIC_REGISTRY} — the integrity hashes are\n` +
        'content-based and stay valid. An internal host here both names internal\n' +
        'infrastructure and breaks `npm ci` for everyone outside it.',
    );
    return false;
  }
  console.log(`OK: all ${checked} lockfile resolutions point at the public registry`);
  return true;
}

// `git ls-files` asks the index, which is the question that matters: .gitignore says
// what WOULD be ignored, the index says what will actually be pushed.
function checkLocalOnlyUntracked() {
  const tracked = execFileSync('git', ['ls-files', '--', ...LOCAL_ONLY], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

  if (tracked.length > 0) {
    console.error('LEAK FAIL — local-only files are tracked and would be pushed:');
    for (const file of tracked) console.error(`  ${file}`);
    console.error(
      '\nThese hold internal notes. Run `git rm --cached <file>` — and if any commit\n' +
        'already containing one has been pushed, the history needs rewriting too.',
    );
    return false;
  }
  console.log(`OK: none of ${LOCAL_ONLY.length} local-only paths are tracked`);
  return true;
}
