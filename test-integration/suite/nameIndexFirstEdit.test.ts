// Copyright 2026 The MathWorks, Inc.
// The first edit of a clean dictionary, as the window's name index sees it.
//
// Once a search has built the index, every content change of an open data source reindexes that file
// (extension.ts, onDidChangeTextDocument → nameIndex.reindexFile), from the document's unsaved text
// rather than from disk. VS Code reports an edit to a CLEAN document while the document still reads
// clean, and its dirty flag only after, as an event that carries no change (measured on CI:
// `[{changes:1, dirty:false}, {changes:0, dirty:true}]`). A reindex that asks `isDirty` alone reads
// that first edit's file from disk: the whole file, on the first edit after every open or save, and
// the names the file had before the edit, which the search then offers until the next edit or a save.
//
// The index is the REGISTERED extension's, built by the real command and read back through it
// (tools/quickPicks): a search snapshot of the index each time it opens. The reads are counted through
// a file system of the test's own, as jsonBaselineFollowsDisk.test.ts counts them, since the reads go
// through `workspace.fs`, which cannot be wrapped.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { quiet, waitFor, wsUri } from './tools/hostHarness';
import { close, keepQuickPicks, search, typeQuery } from './tools/quickPicks';

/* eslint-disable @typescript-eslint/no-explicit-any */

const OLD = 'Number';
const NEW = 'NumberRenamedOnce';

/** `text` with the entry Number renamed, in one edit, as the table or the text editor makes it. */
function renamed(text: string): string {
  const next = text.replace(`"name": "${OLD}"`, `"name": "${NEW}"`);
  assert.notStrictEqual(next, text, `the fixture holds an entry named ${OLD}`);
  return next;
}

async function applyRename(doc: vscode.TextDocument): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), renamed(doc.getText()));
  assert.ok(await vscode.workspace.applyEdit(edit), 'the edit applied');
  await waitFor('the document to be dirty', () => doc.isDirty);
}

/** Discard the document's edit: it is never written. */
async function discard(doc: vscode.TextDocument): Promise<void> {
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

suite('the name index and the first edit of a clean dictionary', () => {
  let quickPicks: ReturnType<typeof keepQuickPicks> | undefined;

  /** The names the search offers from `uri` for `query`, through the real command. */
  async function namesIn(uri: vscode.Uri, query: string): Promise<string[]> {
    const s = await search(quickPicks!.picks);
    try {
      return (await typeQuery(s, query)).filter((i) => i.entry.sourceUri === uri.toString()).map((i) => i.label);
    } finally {
      await close(s);
    }
  }

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    quickPicks = keepQuickPicks();
    // The search builds the index; the reindex on a change does nothing before that.
    await close(await search(quickPicks.picks));
  });

  suiteTeardown(async () => {
    quickPicks?.restore();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('reads nothing from disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dex-first-edit-'));
    const disk = new CountingFs(dir);
    const registered = vscode.workspace.registerFileSystemProvider('dexfirstedit', disk);
    const uri = vscode.Uri.from({ scheme: 'dexfirstedit', path: '/first_edit.sldd' });
    writeFileSync(disk.real(uri), readFileSync(wsUri('data.sldd').fsPath));
    const doc = await vscode.workspace.openTextDocument(uri);
    try {
      assert.ok(!doc.isDirty, 'the document opens clean');
      await quiet(300, 'the open settling');
      disk.reads = 0;
      await applyRename(doc);
      await quiet(500, 'a read of the file the edit would cause');
      const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).map((t) => (t.input as any)?.uri?.toString());
      assert.strictEqual(disk.reads, 0, `the file was not read: the edit is in the document (tabs: ${JSON.stringify(tabs)})`);
    } finally {
      await discard(doc);
      registered.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a rename made in one edit is what the search offers, and not the name the file had', async () => {
    const uri = wsUri('name_index_first_edit.sldd');
    await vscode.workspace.fs.copy(wsUri('data.sldd'), uri, { overwrite: true });
    let doc: vscode.TextDocument | undefined;
    try {
      // The copy is seconds old: the index takes it in through the folder's watcher, or the build.
      await waitFor(`the search to offer ${OLD} from the copy`, async () => (await namesIn(uri, OLD)).includes(OLD));
      doc = await vscode.workspace.openTextDocument(uri);
      assert.ok(!doc.isDirty, 'the document opens clean');
      await applyRename(doc);
      let names: string[] = [];
      await waitFor(`the search to offer ${NEW}`, async () => (names = await namesIn(uri, OLD)).includes(NEW), 20000, () => JSON.stringify(names));
      assert.ok(!names.includes(OLD), `and not ${OLD}, which the file holds and the document no longer does (${JSON.stringify(names)})`);
    } finally {
      if (doc) await discard(doc);
      await vscode.workspace.fs.delete(uri);
    }
  });
});

/** A file system over a temporary folder, counting the whole-file reads made of it. */
class CountingFs implements vscode.FileSystemProvider {
  reads = 0;
  private readonly changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changed.event;
  constructor(private readonly root: string) {}
  real(uri: vscode.Uri): string {
    return join(this.root, uri.path);
  }
  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }
  stat(uri: vscode.Uri): vscode.FileStat {
    const st = statSync(this.real(uri));
    return { type: vscode.FileType.File, ctime: st.ctimeMs, mtime: st.mtimeMs, size: st.size };
  }
  readDirectory(): [string, vscode.FileType][] {
    return [];
  }
  createDirectory(): void {}
  readFile(uri: vscode.Uri): Uint8Array {
    this.reads++;
    return readFileSync(this.real(uri));
  }
  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    writeFileSync(this.real(uri), content);
  }
  delete(uri: vscode.Uri): void {
    rmSync(this.real(uri), { force: true });
  }
  rename(): void {}
}
