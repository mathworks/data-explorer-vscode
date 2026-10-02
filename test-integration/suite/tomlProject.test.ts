// Copyright 2026 The MathWorks, Inc.
// R2026b's TOML project format (`matlab.project.DefinitionFiles.Toml`) inside a real VS
// Code. Everything about this format that can be decided from strings is already unit-
// tested (test/fileTypes.test.ts, test/manifest.test.ts, test/projectStore.test.ts,
// test/projectPageRender.test.ts). What is left is the part that only the running editor
// can answer, and it is the part the whole design turns on:
//
//   1. THE GLOB DIALECT. `SUPPORTED_GLOB` had to change shape for this format — a bare
//      FILENAME cannot be spelled inside a `**/*.{a,b}` suffix list, so the braces moved
//      outside and the pattern became a flat union of complete patterns,
//      `{**/*.sldd,…,**/matlab.toml}`. Whether that union expands the way we think is a
//      property of VS Code's matcher, not of `minimatch`, which is what the unit suite
//      has. A union VS Code read differently would mean either a project the tree never
//      lists, or — the failure this glob is SHAPED to avoid — every `Cargo.toml` and
//      `pyproject.toml` in the workspace discovered as a MATLAB project. Both decoys are
//      therefore written next to the real marker, so their absence from the results is
//      the matcher's answer and not an empty directory's.
//
//   2. THE EXPLORER DEFAULT. A `matlab.toml` is the one file this extension opens that it
//      must NOT own: the format is hand-edited, so a click in the Explorer has to land in
//      the plain text editor, and the project page is reached only through the Data
//      Explorer tree row or an explicit "Reopen Editor With…". The entire mechanism for
//      that is one word in package.json — `"priority": "option"` on the
//      `dataExplorer.projectView` entry — and NOTHING in the TypeScript can show it. A
//      manifest test can only read the word back; what a click does is VS Code's to say.
//      That makes this the most valuable assertion in the file: delete the word and every
//      other test in both suites still passes.
//
// The fixture is a MATLAB-WRITTEN project, copied verbatim from the parity artifact rather
// than hand-authored, because hand-typed TOML must never stand in for what MATLAB writes.
// Its own `name` key says "parityProject" while the folder it is committed in is called
// "tomlproject" — deliberately different, so the two naming rules can be told apart. They
// disagree BY DESIGN and both appear below: the tree's group label is the FOLDER (a file
// called `matlab.toml` in every project cannot label anything), and the page's title is
// the project's own declared NAME.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  buildProjectPage,
  parseProject,
  projectFallbackName,
  TOML_PROJECT_FILE,
} from 'data-explorer-core';
import { SUPPORTED_GLOB } from '../../src/common/fileTypes';
import { readProjectStore } from '../../src/host/projectStore';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';
import { SectionsTreeProvider } from '../../src/host/SectionsTreeProvider';

/** The committed fixture's folder name — what every FOLDER-derived surface must show. */
const FIXTURE_DIR = 'tomlproject';
/** The project's own declared name — what every NAME-derived surface must show. */
const DECLARED_NAME = 'parityProject';

// A scratch tree INSIDE the opened workspace folder, because the tree's own
// `findFiles(SUPPORTED_GLOB)` — no base pattern — searches workspace folders and nothing
// else, so the committed fixture beside `workspace/` is invisible to it (measured; see the
// glob test). Removed in suiteTeardown whether the tests pass or not: this workspace is
// shared by every integration file, and the suites that run after this one count exactly
// its four source fixtures, so a leaked directory would fail tests that have nothing to do
// with TOML. Already gitignored by the `test-integration/fixtures/workspace/*` rule.
const SCRATCH_DIR = 'tomlproj-scratch';

// The two decoys that give the glob something to reject. `.toml` is the configuration
// format of half the tooling a MATLAB repository sits beside, which is why the marker is
// matched by NAME and not by extension (src/common/fileTypes.ts says so at length).
const DECOYS = ['Cargo.toml', 'pyproject.toml'];

let scratchRoot: string; // <workspace>/tomlproj-scratch
let markerUri: vscode.Uri; // <workspace>/tomlproj-scratch/tomlproject/matlab.toml
let committedMarker: vscode.Uri; // the fixture where it is committed, OUTSIDE the workspace

function workspaceFolder(): vscode.WorkspaceFolder {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  return ws!;
}

function extensionUri(): vscode.Uri {
  const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
  assert.ok(ext, 'the extension must be present');
  return ext!.extensionUri;
}

/** Retry `probe` until it answers, for a search service that may not see a new file yet. */
async function pollFor<T>(
  probe: () => Promise<T | undefined>,
  message: string,
  timeoutMs = 20000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const got = await probe();
    if (got !== undefined) return got;
    assert.ok(Date.now() < deadline, message);
    await new Promise((r) => setTimeout(r, 100));
  }
}

function tabsFor(uri: vscode.Uri): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => (t.input as { uri?: vscode.Uri } | undefined)?.uri?.toString() === uri.toString());
}

suite('a TOML-format MATLAB project in a real VS Code', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();

    const source = path.join(extensionUri().fsPath, 'test-integration/fixtures', FIXTURE_DIR);
    committedMarker = vscode.Uri.file(path.join(source, TOML_PROJECT_FILE));
    assert.ok(fs.existsSync(committedMarker.fsPath), 'the committed fixture must be present');

    // The fixture folder is copied WITH ITS NAME, not into the scratch root: the project's
    // group label is its parent folder, so flattening it would label the project
    // "tomlproj-scratch" and the folder-naming assertion would be testing the scratch
    // name instead of the fixture's.
    scratchRoot = path.join(workspaceFolder().uri.fsPath, SCRATCH_DIR);
    fs.rmSync(scratchRoot, { recursive: true, force: true }); // a previous crashed run
    fs.cpSync(source, path.join(scratchRoot, FIXTURE_DIR), { recursive: true });
    for (const decoy of DECOYS) {
      fs.writeFileSync(path.join(scratchRoot, decoy), '[package]\nname = "not-a-matlab-project"\n');
    }
    markerUri = vscode.Uri.file(path.join(scratchRoot, FIXTURE_DIR, TOML_PROJECT_FILE));
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('VS Code\'s own matcher expands the brace union: the bare marker matches, no other .toml does', async () => {
    const folder = workspaceFolder();

    // MEASURED, 2026-10-02, and not what was expected: a `RelativePattern` whose base is
    // the COMMITTED fixture directory — a sibling of `workspace/`, outside every workspace
    // folder — finds the marker anyway (1 file). An explicit `base` does not merely NARROW
    // the workspace search, it redirects it, so `findFiles` can be pointed at any directory
    // on disk. The docs only describe the narrowing use, so this is logged and not asserted:
    // a VS Code that stopped doing it would not be a regression in this extension.
    //
    // The copy into the workspace is still what the rest of this suite needs, for a
    // DIFFERENT reason than the one it was created for: the tree calls
    // `findFiles(SUPPORTED_GLOB)` with no base at all, and that form is workspace-only —
    // which the project-group test below measures in passing, since it finds exactly ONE
    // project group where the committed sibling would have made two.
    const outside = await vscode.workspace.findFiles(
      new vscode.RelativePattern(vscode.Uri.joinPath(committedMarker, '..'), SUPPORTED_GLOB),
    );
    console.log(
      `[tomlProject] findFiles outside any workspace folder: ${outside.length} file(s)` +
        ` — ${JSON.stringify(outside.map((u) => path.basename(u.fsPath)))}`,
    );

    const inside = await pollFor(async () => {
      const hits = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, SUPPORTED_GLOB));
      return hits.some((u) => u.fsPath === markerUri.fsPath) ? hits : undefined;
    }, 'the supported glob never matched the copied matlab.toml');

    // Non-vacuity: both decoys really are on disk beside the marker, so their absence
    // below is the matcher rejecting them rather than nothing being there to reject.
    for (const decoy of DECOYS) {
      assert.ok(fs.existsSync(path.join(scratchRoot, decoy)), `${decoy} was written`);
      assert.ok(
        !inside.some((u) => path.basename(u.fsPath) === decoy),
        `${decoy} must not be discovered — a .toml EXTENSION would have admitted it`,
      );
    }

    // And the rest of the union still works, which the same string is responsible for:
    // the four source fixtures in this workspace are matched by their extensions.
    const names = new Set(inside.map((u) => path.basename(u.fsPath)));
    for (const existing of ['binary.sldd', 'data.sldd', 'model.slx']) {
      assert.ok(names.has(existing), `${existing} is still matched by the brace union`);
    }
  }).timeout(60000);

  test('an Explorer click on a matlab.toml opens the PLAIN TEXT editor', async () => {
    // `vscode.open` is what the Explorer runs: it picks the DEFAULT editor for the
    // resource. The project page must not be it — see the header. The only thing holding
    // this is `"priority": "option"` in package.json; raise it to "default" and this is
    // the single test that notices.
    await vscode.commands.executeCommand('vscode.open', markerUri);

    const tabs = tabsFor(markerUri);
    assert.strictEqual(tabs.length, 1, 'exactly one tab opened for the marker');
    const input = tabs[0].input;
    assert.ok(
      input instanceof vscode.TabInputText,
      `a matlab.toml must open as text, got ${input?.constructor?.name}`,
    );
    assert.ok(
      !(input instanceof vscode.TabInputCustom),
      'no custom editor may claim a matlab.toml by default: the file is hand-edited',
    );

    // And it really is editable text in there, not a byte view that happens to report a
    // text tab: the document the editor resolved is the file's own content.
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === markerUri.fsPath);
    assert.ok(doc, 'the text editor resolved a TextDocument for the marker');
    assert.ok(doc!.getText().includes(`name = "${DECLARED_NAME}"`), 'and it holds the TOML source');
  }).timeout(60000);

  test('the project page is still REACHABLE, by an explicit openWith', async () => {
    // The other half of "never automatic": optional must not mean unavailable. This is the
    // call the tree row makes (openProjectMarker in BinaryEditorProvider) and the one
    // "Reopen Editor With… → Data Explorer" makes.
    await vscode.commands.executeCommand(
      'vscode.openWith',
      markerUri,
      BinaryEditorProvider.projectViewType,
    );

    const tabs = tabsFor(markerUri);
    assert.strictEqual(tabs.length, 1, 'exactly one tab opened for the marker');
    const input = tabs[0].input;
    assert.ok(input instanceof vscode.TabInputCustom, 'the page is a custom editor');
    assert.strictEqual(
      (input as vscode.TabInputCustom).viewType,
      'dataExplorer.projectView',
      'and it is the project view type, not the binary one',
    );
    // Pinned as a literal as well as through the constant: this id is also spelled in
    // package.json's `customEditors` and in its `when` clauses, which no import reaches.
    assert.strictEqual(BinaryEditorProvider.projectViewType, 'dataExplorer.projectView');
  }).timeout(60000);

  test('the tree discovers the project and labels it after its FOLDER', async () => {
    // Through the provider, so this is the real `findFiles` → `graphSourcesOf` →
    // `readProjectStore` → `parseProject` path and not a re-implementation of it. A fresh
    // provider per attempt because the graph is cached on the instance; the file is
    // seconds old, so a slow search service must read as slow rather than as a missing
    // feature (the same shape as the .prj case in sectionsTree.test.ts).
    const group = await pollFor(async () => {
      const fresh = new SectionsTreeProvider(extensionUri());
      const projects = (await fresh.getChildren()).filter((r) => r.groupKind === 'project');
      return projects.length > 0 ? projects : undefined;
    }, 'the matlab.toml never produced a project group in the tree');

    // ONE, which also measures what the glob test could not assert: the provider's
    // base-less `findFiles` reaches the scratch copy and NOT the committed fixture beside
    // `workspace/`, or there would be two project groups here.
    assert.strictEqual(group.length, 1, 'one project group for the one marker in the workspace');
    assert.strictEqual(
      group[0].label,
      FIXTURE_DIR,
      'a TOML project is named after its parent folder',
    );
    // Spelled out, because these are the two labels the obvious reductions produce and
    // either would be a project row the user cannot tell from the next one: every project
    // in this format has a definition file with the identical name.
    assert.notStrictEqual(group[0].label, TOML_PROJECT_FILE);
    assert.notStrictEqual(group[0].label, 'matlab');

    // The header is also the row that OPENS the page, so it must carry the marker itself.
    assert.ok(group[0].uriString, 'the project header is openable');
    assert.strictEqual(vscode.Uri.parse(group[0].uriString!).fsPath, markerUri.fsPath);
  }).timeout(60000);

  test('the page renders from the real file on disk, named by its own `name` key', async () => {
    // End to end over the host read: the bytes come off the filesystem through
    // `vscode.workspace.fs`, and the page is the one BinaryEditorProvider builds in
    // getHtml. The two naming rules are asserted side by side on purpose — the folder
    // name is the FALLBACK, used only when the document declares nothing, so a page
    // showing "tomlproject" here would mean the declared name had been dropped.
    const store = await readProjectStore(markerUri);
    assert.deepStrictEqual(
      Object.keys(store),
      [TOML_PROJECT_FILE],
      'a TOML project is ONE file, keyed by core\'s own constant',
    );

    const fallback = projectFallbackName(markerUri.path);
    assert.strictEqual(fallback, FIXTURE_DIR, 'the fallback really is the folder name');

    const parsed = parseProject(store, fallback);
    assert.deepStrictEqual(parsed.warnings, [], 'a MATLAB-written project parses cleanly');

    const page = buildProjectPage(parsed);
    assert.strictEqual(page.name, DECLARED_NAME, 'the page shows the DECLARED name');
    assert.strictEqual(page.format, 'toml');
    assert.strictEqual(page.formatLabel, TOML_PROJECT_FILE, 'the format reads as its file name');
    // `null`, not 0: this format records no member list at all, so there is no number to
    // show — and 0 would state the opposite, that the project contains nothing.
    assert.strictEqual(page.memberCount, null);

    // The one thing a TOML project says about its members, and it says it the other way
    // round: a label DECLARES its files instead of each file carrying its labels.
    const labels = page.categories.flatMap((c) => c.labels);
    const checked = labels.find((l) => l.id === 'Review/Checked');
    assert.ok(checked, `expected a Review/Checked label, got ${JSON.stringify(labels.map((l) => l.id))}`);
    assert.deepStrictEqual(checked!.declaredFiles, ['utils/helper.m']);
    assert.ok(
      fs.existsSync(path.join(scratchRoot, FIXTURE_DIR, 'utils', 'helper.m')),
      'and that declared file is really in the fixture, so the path is not a typo on both sides',
    );
  }).timeout(60000);
});
