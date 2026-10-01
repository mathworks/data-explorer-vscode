// Copyright 2026 The MathWorks, Inc.
// Integration test for readProjectStore over a store that contains symlinks, run
// inside a real VS Code because the bug lives in what the genuine
// `vscode.workspace.fs.readDirectory` reports: FileType is a BITMASK, so a
// symlinked entry is `Directory | SymbolicLink` (65) or `File | SymbolicLink`
// (66), never the bare value. An `=== FileType.Directory` test therefore skips it
// silently and the project reads as if that part of its store did not exist.
// A stubbed fs cannot cover this — the composed value is the filesystem's answer,
// not ours — and `openProjectPath` in BinaryEditorProvider already masks for the
// same reason, so this is the second path of a rule that was only fixed on one.
//
// The fixture is built on disk at run time rather than committed: a checked-in
// symlink does not survive every checkout, and the point is to make the real
// filesystem produce the composed FileType.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildProjectPage, parseProject, projectNameOf } from 'data-explorer-core';
import { readProjectStore } from '../../src/host/projectStore';

let tmpRoot: string;
let prjUri: vscode.Uri;

// <tmp>/SymProj/              project root, holding the .prj marker
//   resources/project/
//     root/direct.xml         a plain directory holding a plain document
//     linkedDir -> outside/linked/      (holds inside.xml)
//     linkedFile.xml -> outside/target.xml
//   outside/                  the symlink targets, deliberately out of the store
function buildFixture(): void {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-projectstore-'));
  const projectRoot = path.join(tmpRoot, 'SymProj');
  const store = path.join(projectRoot, 'resources', 'project');
  const outside = path.join(projectRoot, 'outside');

  fs.mkdirSync(path.join(store, 'root'), { recursive: true });
  fs.mkdirSync(path.join(outside, 'linked'), { recursive: true });

  fs.writeFileSync(path.join(projectRoot, 'SymProj.prj'), 'PK');
  fs.writeFileSync(path.join(store, 'root', 'direct.xml'), '<direct/>');
  fs.writeFileSync(path.join(outside, 'linked', 'inside.xml'), '<inside/>');
  fs.writeFileSync(path.join(outside, 'target.xml'), '<target/>');

  fs.symlinkSync(path.join(outside, 'linked'), path.join(store, 'linkedDir'), 'dir');
  fs.symlinkSync(path.join(outside, 'target.xml'), path.join(store, 'linkedFile.xml'), 'file');

  prjUri = vscode.Uri.file(path.join(projectRoot, 'SymProj.prj'));
}

suite('readProjectStore over a symlinked store', () => {
  suiteSetup(() => {
    buildFixture();
  });

  suiteTeardown(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // The premise, asserted so this suite can never pass vacuously: if VS Code ever
  // reported a bare FileType for a symlink, the assertions below would hold even
  // with an equality check and would be testing nothing.
  test('vscode reports a symlinked entry as a COMPOSED FileType, not a bare one', async () => {
    const store = vscode.Uri.joinPath(prjUri, '..', 'resources', 'project');
    const byName = new Map(await vscode.workspace.fs.readDirectory(store));

    const dirType = byName.get('linkedDir');
    const fileType = byName.get('linkedFile.xml');
    assert.ok(dirType !== undefined && fileType !== undefined, 'both links are listed');

    assert.ok(dirType! & vscode.FileType.SymbolicLink, 'linked dir carries SymbolicLink');
    assert.ok(dirType! & vscode.FileType.Directory, 'linked dir carries Directory');
    assert.notStrictEqual(
      dirType,
      vscode.FileType.Directory,
      'a symlinked directory does not equal FileType.Directory — the bug',
    );

    assert.ok(fileType! & vscode.FileType.SymbolicLink, 'linked file carries SymbolicLink');
    assert.ok(fileType! & vscode.FileType.File, 'linked file carries File');
    assert.notStrictEqual(
      fileType,
      vscode.FileType.File,
      'a symlinked file does not equal FileType.File — the bug',
    );
  });

  test('a symlinked directory in the store is descended into', async () => {
    const files = await readProjectStore(prjUri);
    assert.strictEqual(
      files['resources/project/linkedDir/inside.xml'],
      '<inside/>',
      'a document under a symlinked store folder is read',
    );
  });

  test('a symlinked document in the store is read', async () => {
    const files = await readProjectStore(prjUri);
    assert.strictEqual(
      files['resources/project/linkedFile.xml'],
      '<target/>',
      'a symlinked store document is read',
    );
  });

  test('plain entries still work, and nothing extra is invented', async () => {
    const files = await readProjectStore(prjUri);
    assert.strictEqual(files['resources/project/root/direct.xml'], '<direct/>');
    assert.deepStrictEqual(
      Object.keys(files).sort(),
      [
        'resources/project/linkedDir/inside.xml',
        'resources/project/linkedFile.xml',
        'resources/project/root/direct.xml',
      ],
      'exactly the three store documents, and the targets are not reached twice',
    );
  });
});

// What the customer actually sees. The synthetic fixture above proves the walk reads
// the bytes; this proves the PAGE is whole, over a real MATLAB-written store, by
// pinning the invariant BETWEEN the two paths rather than either one's output: a
// project whose store is partly symlinked must render exactly what the same project
// renders with no symlink in it.
//
// Measured on this fixture before the fix: 17 of the 32 store documents were read —
// 15 lost, and the page rendered 308 bytes instead of 671. `parseProject` raised
// **no warnings** for any of them, because a document that was never listed is not a
// document that failed to parse; nothing downstream can tell the difference. That is
// why the warnings assertion below is part of the test rather than the whole of it:
// the only thing that catches this loss is comparing the page against the page.
suite('a symlinked store renders the same project page', () => {
  let plainPrj: vscode.Uri;
  let linkedPrj: vscode.Uri;
  let linkRoot: string;

  suiteSetup(() => {
    const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
    assert.ok(ext, 'the extension must be present');
    const source = path.join(ext!.extensionUri.fsPath, 'test/parity/artifacts/project/LibProj');

    linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-projectpage-'));
    const plain = path.join(linkRoot, 'plain', 'LibProj');
    const linked = path.join(linkRoot, 'linked', 'LibProj');
    fs.cpSync(source, plain, { recursive: true });
    fs.cpSync(source, linked, { recursive: true });

    // Relocate one hash folder and the top-level manifest out of the store, then
    // link them back in — one case for each branch of the walk. The folder is
    // chosen by sort order so the test does not drift with directory iteration.
    const store = path.join(linked, 'resources', 'project');
    const hashDir = fs
      .readdirSync(store, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'root')
      .map((e) => e.name)
      .sort()[0];
    assert.ok(hashDir, 'the real store has at least one hash folder to relocate');

    const outside = path.join(linked, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    for (const [name, kind] of [
      [hashDir, 'dir'],
      ['Project.xml', 'file'],
    ] as const) {
      fs.renameSync(path.join(store, name), path.join(outside, name));
      fs.symlinkSync(path.join(outside, name), path.join(store, name), kind);
    }

    plainPrj = vscode.Uri.file(path.join(plain, 'LibProj.prj'));
    linkedPrj = vscode.Uri.file(path.join(linked, 'LibProj.prj'));
  });

  suiteTeardown(() => {
    fs.rmSync(linkRoot, { recursive: true, force: true });
  });

  async function pageFor(prj: vscode.Uri) {
    const files = await readProjectStore(prj);
    const parsed = parseProject(files, projectNameOf(path.basename(prj.fsPath)));
    return { files, parsed, page: buildProjectPage(parsed) };
  }

  test('the plain copy is a real project, so the comparison is not vacuous', async () => {
    const { files, parsed, page } = await pageFor(plainPrj);
    assert.ok(
      Object.keys(files).length > 10,
      `the real store has many documents, got ${Object.keys(files).length}`,
    );
    assert.deepStrictEqual(parsed.warnings, [], 'the unmodified project parses cleanly');
    assert.ok(JSON.stringify(page).length > 200, 'the page has substance to compare');
  });

  test('the symlinked copy loses no store document', async () => {
    const plainFiles = Object.keys((await pageFor(plainPrj)).files).sort();
    const linkedFiles = Object.keys((await pageFor(linkedPrj)).files).sort();
    assert.deepStrictEqual(linkedFiles, plainFiles);
  });

  test('the symlinked copy renders an identical page, with no warnings', async () => {
    const plainPage = (await pageFor(plainPrj)).page;
    const linked = await pageFor(linkedPrj);
    assert.deepStrictEqual(linked.parsed.warnings, [], 'no document failed to make the trip');
    assert.deepStrictEqual(linked.page, plainPage);
  });
});
