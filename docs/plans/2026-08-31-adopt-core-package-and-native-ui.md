# Adopt data-explorer-core; make webview UI native to vscode

**Goal:** Replace the vendored `src/dex/` snapshot with (a) a dependency on the
public `data-explorer-core` package for the host/data-model layer, and (b)
first-class, separately-extractable webview UI components living natively in the
vscode repo.

**Architecture:** `src/dex/` (153 vendored files) splits along a clean seam that
already exists in the code:

- **Host/data-model layer** — `src/dex/core/` (4) + `src/dex/datamodel/` (140) =
  144 files. Every symbol the extension imports from here is already exported by
  `data-explorer-core`. → **Delete; import from the package.**
- **Webview UI layer** — `src/dex/components/` (5) + `src/dex/styles/` (3) = 8
  files. Core ships no UI (deliberately). The components import only `lit` and
  each other (plus one reverse-dep into `src/webview/dragMode.js`); they do NOT
  import the data-model layer. → **Move into the extension as native components.**

**Tech Stack:** TypeScript, Lit (webview), esbuild (host bundle, `bundle:true`),
vite (webview bundle, with `@core/@datamodel/@components/@graph` path aliases
pointing into `src/dex/`), GitHub dependency on `mathworks/data-explorer-core`.

**Key facts established during investigation:**
- Host import sites (11 files): all of `src/host/*` that touch dex + `src/webview/dropDecision.ts`. They import only from `../dex/core` (2) and `../dex/datamodel` (23 occurrences).
- UI import sites (3 files): `src/webview/table-main.ts`, `src/webview/pi-main.ts`, `src/webview/menuItems.ts`.
- The 5 components: `dex-tree-table.ts` (88 KB), `dex-context-menu.ts`, `dex-property-inspector.ts`, `dex-error-dialog.ts`, `dex-icon.ts`.
- The 3 styles: `global.css`, `focus.styles.ts`, `high-contrast.styles.ts`.
- `dex-tree-table.ts` imports `../../webview/dragMode.js` (reverse dep — resolves fine after the move since the target is unchanged; the relative path just changes).
- vite aliases `@core/@datamodel/@components/@graph` are only referenced *inside* `src/dex/`; extension code uses relative `../dex/...` imports, not aliases. So the aliases can be deleted outright (no extension code depends on them). `@graph` points at `src/dex/graph/`, which does not exist (0 files) and is unused — dead alias.
- Core (`data-explorer-core`) is PUBLIC at `github:mathworks/data-explorer-core`, tagged `v0.1.0`, but its `dist/` is gitignored and it has NO `prepare` script — so a git dependency will not build on install yet. **Prerequisite fix in the core repo.**
- The extension `.vsix` is fully bundled (esbuild `bundle:true` for host; vite for webview), so the published artifact stays self-contained — customers never run `npm install` against the git dep. Only local dev + release CI need repo access to core (public → no auth needed).

**Version compatibility check (must hold before starting):** the vendored
`src/dex/` was snapshotted from the same internal source that `data-explorer-core@0.1.0`
was curated from. Task 0 verifies the exported symbols match what the extension
imports; if any symbol differs, STOP and reconcile (bump core, re-tag) before
proceeding.

---

## Prerequisite (core repo): add `prepare` script

**Files:**
- Modify: `~/projects/data-explorer-core/package.json`

- [ ] **Step 1: Add prepare script so git-dep consumers build `dist/` on install**

In `data-explorer-core/package.json` `scripts`, add:

```json
"prepare": "npm run build",
```

Rationale: `dist/` is gitignored. When npm installs a git dependency it runs the
dependency's `prepare` script (with devDeps available), so `tsc` emits `dist/`
into the consumer's `node_modules/data-explorer-core/`. Without this, imports of
`data-explorer-core` resolve to a missing `./dist/index.js`.

- [ ] **Step 2: Verify prepare works via a clean pack-and-install dry run**

Run (in core repo):
```bash
npm run build && node -e "require('fs').accessSync('dist/index.js')" && echo "dist OK"
```
Expected: `dist OK`.

Then simulate a git-dep install into a scratch dir:
```bash
cd /tmp && rm -rf dexcore-test && mkdir dexcore-test && cd dexcore-test
npm init -y >/dev/null
npm install "github:mathworks/data-explorer-core#v0.1.0"
node -e "import('data-explorer-core').then(m=>console.log('exports:', Object.keys(m).length))"
```
Expected: installs without error, prints a non-zero export count. If `prepare`
didn't run (older npm, or `--ignore-scripts`), this reveals it here rather than
in the extension build.

- [ ] **Step 3: Commit and tag**

```bash
cd ~/projects/data-explorer-core
git add package.json
git commit -m "Add prepare script so git-dependency consumers build dist on install"
```

**Decision needed:** because the extension will pin `data-explorer-core#v0.1.0`,
the `prepare` script must be reachable from that tag. Either (a) move the `v0.1.0`
tag to include this commit (acceptable — not yet consumed anywhere), or (b) cut
`v0.1.1` and pin that. **Recommend (b) `v0.1.1`** — never move a published tag,
even an unconsumed one; it sets a bad precedent. Pin the extension to `v0.1.1`.

---

## Task 0: Compatibility gate — verify core exports match extension imports

**Files:** none (verification only)

- [ ] **Step 1: Enumerate every symbol the extension imports from the host layer**

Run (in vscode repo):
```bash
grep -rhoE "import \{[^}]+\} from '\.\./dex/(core|datamodel)[^']*'" src --include="*.ts" \
  | grep -v "^src/dex/"
grep -rn "import .* from '\.\./dex/(core|datamodel)" src --include="*.ts" | grep -v "^src/dex/"
```
Record the full symbol set. Known set from investigation:
`DataModel` (default), `parseBinarySldd`, `parseBinarySlddParts`, `parseSlx`,
`parseMat`, `parseProject`, `serializeEntryToXml`, `generateUuid`,
`getSectionMetadata`, `schemaColumnLabels`, `kindForClass`, `ModelBlockNode`
(default), plus the side-effect import `../dex/datamodel/node/NodeClassMap.js`,
and type-only imports (`RowData`, `PropClass`, `PropInfo`, etc.).

- [ ] **Step 2: Confirm each is exported by data-explorer-core**

Cross-check against core's `src/index.ts` export list (already read; it exports
all of the above). Confirm the side-effect `NodeClassMap` registration happens on
`import 'data-explorer-core'` (core's index.ts does `import './datamodel/node/NodeClassMap.js'`
at top — so importing the package barrel triggers registration; individual deep
imports are NOT part of the public API).

- [ ] **Step 3: GO/NO-GO**

If every runtime symbol + the NodeClassMap side-effect is covered by the package
barrel `data-explorer-core` (and Node subpath `data-explorer-core/node` if any fs
loader is needed — the extension does its own file IO, so likely not), proceed.
If ANY symbol is only reachable via a deep path core doesn't re-export, STOP and
add the export to core first (new core release).

---

## Task 1: Add the core dependency and repoint host-layer imports

**Files:**
- Modify: `package.json` (add dependency)
- Modify: `src/host/SlddModel.ts`, `src/host/slxStructure.ts`,
  `src/host/structuralIndex.ts`, `src/host/xmlStructuralEdit.ts`,
  `src/host/rowBuilder.ts`, `src/host/nameIndex.ts`, `src/host/usageGraph.ts`,
  `src/host/sectionRules.ts`, `src/host/BinarySlddEditorProvider.ts`,
  `src/host/structuralEdit.ts`, `src/webview/dropDecision.ts`

- [ ] **Step 1: Add the dependency**

In `package.json` `dependencies`:
```json
"data-explorer-core": "github:mathworks/data-explorer-core#v0.1.1"
```
Then `npm install`. Expected: clones core, runs its `prepare` (builds `dist/`),
resolves. Verify: `node -e "require('data-explorer-core')"` (from repo root, after
build) — but note it's ESM; a resolution check is `ls node_modules/data-explorer-core/dist/index.js`.

- [ ] **Step 2: Repoint each host import to the package barrel**

Mechanical rewrite. Examples (apply the analogous change in each file):

`src/host/SlddModel.ts`:
```ts
// before
import '../dex/datamodel/node/NodeClassMap.js';
import DataModel from '../dex/core/DataModel.js';
import { parseBinarySldd } from '../dex/datamodel/parser/BinarySlddParser.js';
// after
import { DataModel, parseBinarySldd } from 'data-explorer-core';
```
(The bare `import 'data-explorer-core'` barrel already runs NodeClassMap
registration as a side effect, so the standalone NodeClassMap import is dropped —
importing any value from the barrel triggers it. Keep one value import per file,
or add a bare `import 'data-explorer-core';` if a file only used the side effect.)

`src/host/rowBuilder.ts`:
```ts
import { ModelBlockNode, schemaColumnLabels } from 'data-explorer-core';
```
`src/host/xmlStructuralEdit.ts` / `structuralEdit.ts` / `sectionRules.ts`:
```ts
import { serializeEntryToXml, generateUuid, getSectionMetadata } from 'data-explorer-core';
```
`src/webview/dropDecision.ts`:
```ts
import { kindForClass } from 'data-explorer-core';
```
Parsers in `slxStructure.ts`, `structuralIndex.ts`, `nameIndex.ts`,
`usageGraph.ts`, `BinarySlddEditorProvider.ts`: pull `parseSlx`, `parseMat`,
`parseBinarySldd`, `parseProject`, `parseBinarySlddParts` from `data-explorer-core`.

Type-only imports become `import type { RowData, PropInfo, ... } from 'data-explorer-core';`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS. Failures here are almost certainly a symbol not re-exported by
core (→ back to Task 0 Step 3) or a default-vs-named mismatch (`DataModel` and
`ModelBlockNode` are default exports in the source but core re-exports them as
NAMED — `export { default as DataModel }` — so import them as named from the
package, not default).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/host src/webview/dropDecision.ts
git commit -m "Depend on data-explorer-core for the host/data-model layer"
```

---

## Task 2: Make the webview UI native and componentized

**Files:**
- Create: `src/webview/components/dex-tree-table.ts` (moved)
- Create: `src/webview/components/dex-context-menu.ts` (moved)
- Create: `src/webview/components/dex-property-inspector.ts` (moved)
- Create: `src/webview/components/dex-error-dialog.ts` (moved)
- Create: `src/webview/components/dex-icon.ts` (moved)
- Create: `src/webview/components/styles/global.css` (moved)
- Create: `src/webview/components/styles/focus.styles.ts` (moved)
- Create: `src/webview/components/styles/high-contrast.styles.ts` (moved)
- Modify: `src/webview/table-main.ts`, `src/webview/pi-main.ts` (import paths)
- Delete: `src/dex/` entirely (after Task 1 + this task remove all references)

**Design for future extraction:** place all UI under a single self-contained
`src/webview/components/` directory (widgets + their styles), with NO imports that
reach back up into extension-specific code. The one existing reverse-dep
(`dragMode`) is resolved in Step 3 so the directory becomes a clean extraction
unit — a future `data-explorer-ui` repo is a directory move.

- [ ] **Step 1: Move the 8 UI files with git mv (preserve history)**

```bash
mkdir -p src/webview/components/styles
git mv src/dex/components/dex-tree-table.ts        src/webview/components/
git mv src/dex/components/dex-context-menu.ts      src/webview/components/
git mv src/dex/components/dex-property-inspector.ts src/webview/components/
git mv src/dex/components/dex-error-dialog.ts      src/webview/components/
git mv src/dex/components/dex-icon.ts              src/webview/components/
git mv src/dex/styles/global.css                  src/webview/components/styles/
git mv src/dex/styles/focus.styles.ts             src/webview/components/styles/
git mv src/dex/styles/high-contrast.styles.ts     src/webview/components/styles/
```

- [ ] **Step 2: Fix intra-component style imports**

The components import `../styles/high-contrast.styles.js` and
`../styles/focus.styles.js`. After the move, styles live at
`src/webview/components/styles/`, so from a component at
`src/webview/components/*.ts` the path becomes `./styles/high-contrast.styles.js`
and `./styles/focus.styles.js`. Update those two import lines in
`dex-context-menu.ts` and `dex-property-inspector.ts` (grep to find exact files):

```bash
grep -rn "styles/high-contrast\|styles/focus" src/webview/components/*.ts
```
Rewrite `../styles/` → `./styles/`.

- [ ] **Step 3: Resolve the dragMode reverse-dependency**

`dex-tree-table.ts` imports `../../webview/dragMode.js`. Two options — pick to
serve future extraction:
- **(Recommended)** Move `dragMode` INTO the component unit:
  `git mv src/webview/dragMode.ts src/webview/components/dragMode.ts`, then update
  the tree-table import to `./dragMode.js` and update any OTHER importers of
  `dragMode` (find them: `grep -rn "webview/dragMode\|'./dragMode" src`) to the
  new path. This keeps `components/` free of upward imports.
- (Alternative) Leave `dragMode` in `src/webview/` and update the tree-table
  import to the correct relative path `../dragMode.js`. Simpler now, but the
  component still reaches outside its directory → worse for extraction.

Confirm which importers exist before moving:
```bash
grep -rn "dragMode" src --include="*.ts" | grep -v "src/dex"
```

- [ ] **Step 4: Repoint the webview entry files**

`src/webview/table-main.ts`:
```ts
// before
import '../dex/styles/global.css';
import '../dex/components/dex-tree-table.js';
import '../dex/components/dex-context-menu.js';
import '../dex/components/dex-error-dialog.js';
// after
import './components/styles/global.css';
import './components/dex-tree-table.js';
import './components/dex-context-menu.js';
import './components/dex-error-dialog.js';
```
`src/webview/pi-main.ts`:
```ts
// before
import '../dex/styles/global.css';
import '../dex/components/dex-property-inspector.js';
// after
import './components/styles/global.css';
import './components/dex-property-inspector.js';
```
`src/webview/menuItems.ts` imports a TYPE from `dex-context-menu`:
```ts
import type { ContextMenuItem } from './components/dex-context-menu.js';
```

- [ ] **Step 5: Delete the now-empty vendored tree and its build aliases**

```bash
git rm -r src/dex
```
Update `vite.config.ts`: remove the `resolve.alias` block entirely (the
`@core/@datamodel/@components/@graph` aliases pointed into `src/dex/` and are
referenced only from within `src/dex/`, which no longer exists). Verify nothing
else uses them: `grep -rn "@core/\|@datamodel/\|@components/\|@graph/" src` → empty.

Also update the local CLAUDE.md note about `src/dex/` being a vendored copy (that
file is gitignored/local-only — update it so future context is accurate; do NOT
commit it).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS. Failures = a missed import path (grep `dex/` across `src` should
now return nothing except possibly comments: `grep -rn "dex/" src --include="*.ts"`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Make webview UI native: move dex components/styles into src/webview/components"
```

---

## Task 3: Full build + test verification

**Files:** none (verification)

- [ ] **Step 1: Confirm no dangling dex references**

```bash
grep -rn "dex/" src --include="*.ts" --include="*.css" --include="*.html"
```
Expected: nothing (or only unrelated substrings). Any `../dex/` import is a bug.

- [ ] **Step 2: Host bundle**

Run: `npm run build:host`
Expected: `dist/extension.js` written, no unresolved imports. esbuild bundles
`data-explorer-core` from `node_modules` into the output.

- [ ] **Step 3: Web bundle**

Run: `npm run build:web`
Expected: `dist/web/extension.js` written. (Core is fs-free in its main entry, so
the browser bundle must NOT pull in `data-explorer-core/node`. Confirm no host
file imports the `/node` subpath.)

- [ ] **Step 4: Webview bundle**

Run: `npm run build:webview`
Expected: vite builds `dist/webview/{table,pi}.js` with the components inlined.

- [ ] **Step 5: Full build + unit tests**

Run: `npm run build && npm test`
Expected: build green, all unit tests pass.

- [ ] **Step 6: Integration suite**

Run: `npm run test:integration` (needs a display; `xvfb-run` on Linux)
Expected: PASS. This is the real proof the extension activates and the editors
open with the package-sourced host layer + native UI.

- [ ] **Step 7: VSIX sanity + self-containment check**

Run: `npm run package`
Then confirm the `.vsix` bundles core (not a dangling git-dep reference):
```bash
npx vsce ls | grep -i "extension.js"   # host bundle present
# The .vsix must NOT contain node_modules/data-explorer-core — it's bundled into extension.js
```
Expected: packaged `.vsix` is self-contained; a customer installing it needs no
access to the core repo.

---

## Updating core in the future (versioning policy)

**Decision: exact pins + manual two-repo bump.** The extension pins an exact core
tag (`github:mathworks/data-explorer-core#vX.Y.Z`); core is expected to be stable
and update infrequently, so the manual bump cost is negligible and buys
reproducible, tested-together releases of a shipped product.

When a bug is fixed (or any change made) in core:

1. **Core repo:** fix → bump `version` in `package.json` → commit → tag `vX.Y.Z+1`
   (→ `npm publish`, if/once core is on npm).
2. **vscode repo:** change the pinned ref (`#vX.Y.Z` → `#vX.Y.Z+1`), run
   `npm install`, then `npm run build && npm test && npm run test:integration`,
   and commit the bump together with the passing state. Until this step lands, the
   extension keeps building against the OLD core — fixes do NOT flow automatically.
   The integration run here is the checkpoint that proves the core change works in
   the extension before it reaches a customer.

**Local co-development:** when actively changing core and the extension together,
use `npm link` (or an npm workspace) against a local core checkout for fast
iteration WITHOUT retagging each cycle; bump the committed pin only when cutting a
real core version. This keeps the committed state pinned and reproducible while
allowing fast local edits.

**When to revisit (switch to auto-flowing `^` ranges):** only once BOTH (a) core
is published to the npm registry (git deps don't support semver ranges), and
(b) core's API has stabilized enough that patch releases are reliably safe. Then
the extension can move to `"data-explorer-core": "^0.x"` so compatible fixes flow
on `npm install`, with `npm ci` in the release workflow guarding reproducibility.

## Rollback

Each task is a separate commit on a feature branch. If integration tests fail
irrecoverably, `git reset --hard` to before Task 1 restores the vendored `src/dex/`
exactly (it's all in history). The core-repo `prepare` addition is independent and
harmless to leave in place.

## Execution notes (what actually happened — 2026-08-31)

Migration executed and verified LOCALLY (unpushed, per user directive). Two
material discoveries deviated from the plan as written:

1. **Prerequisite: `prepare` alone was insufficient.** This dev box's global
   npmrc sets `ignore-scripts=true`, so npm skips a git dep's `prepare` build on
   install — leaving consumers with no `dist/`. Enterprise npm setups commonly do
   this. Fix: the core repo now **commits a prebuilt `dist/`** (un-ignored) so the
   git dep resolves unconditionally; `prepare` is kept for scripts-enabled/registry
   paths. Core cut **v0.1.2** (dist committed, leak-clean, 281 tests green) — the
   extension pins **`#v0.1.2`**, NOT v0.1.1. Verified end-to-end: install under
   `ignore-scripts=true` yields a working `dist/index.js`.

2. **Task 2 Step 5 could NOT `git rm -r src/dex`.** 64 test files import deep
   `src/dex` internals (node classes, NodeRegistry, resolveSourcePath…) that core's
   barrel deliberately does not export. Per user decision, took the **incremental**
   path: `src/dex/{core,datamodel}` is retained as a **test-only** tree (it no
   longer ships in the `.vsix` — the host imports the package, and esbuild bundles
   core into `extension.js`). The 8 host tests that failed did so via a
   **dual-class-identity** problem (host uses core's classes + DataModel singleton;
   tests used src/dex's copies → `instanceof` and the shared cache diverge). Fixed
   with the least-invasive change and NO core-API expansion: `findNodeBinarySelection`
   repointed to the package (its 3 symbols are all on the barrel); `constantNode`
   host-path assertions switched from `instanceof` to a `constructor.name` proxy.
   Full src/dex deletion + relocating the 47 pure-data-model tests to core is
   deferred (tracked as a follow-up task).

**Final verified state (local):** typecheck ✓, build (webview+host) ✓, web bundle
✓, 1261/1261 unit tests ✓ (112 files), integration suite 62 passing (exit 0),
VSIX 135 files / 356 KB — self-contained, core inlined, no `node_modules` or
`src/dex` shipped.

## Observations / future work (out of scope — do NOT do now)

- Extract `src/webview/components/` into a `data-explorer-ui` repo once a second
  front-end needs it. The directory is structured for a clean lift-and-shift after
  Task 2.
- Consider moving the UI components to depend on core's DTO types
  (`NodeDTO`/`PropDTO`) instead of ad-hoc message shapes, to formalize the
  host↔webview contract. Not required for this migration.
- `vite.config.ts` still hardcodes `__APP_VERSION__`/`__BUILD_DATE__` literals —
  unrelated, leave alone.
