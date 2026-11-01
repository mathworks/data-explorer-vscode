// Copyright 2026 The MathWorks, Inc.
// PROBE, not for merge: does the window's name index, once a search has built it, read a clean
// document's file on that document's first edit?
import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { quiet, waitFor, wsUri } from './tools/hostHarness';

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
    console.log(`[PROBE] readFile ${uri.toString()}\n${new Error('stack').stack}`);
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

suite('PROBE: a built name index and the first edit of a clean document', () => {
  test('reads of the file on its first edit, before and after a search built the index', async function () {
    this.timeout(180000);
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    const counts: number[] = [];
    for (const [i, phase] of ['index not built', 'index built'].entries()) {
      if (i === 1) {
        await vscode.commands.executeCommand('dataExplorer.searchDataSources');
        await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
      }
      const dir = mkdtempSync(join(tmpdir(), 'dex-probe-'));
      const disk = new CountingFs(dir);
      const scheme = `dexprobe${i}`;
      const registered = vscode.workspace.registerFileSystemProvider(scheme, disk);
      const uri = vscode.Uri.from({ scheme, path: '/probe.sldd' });
      writeFileSync(disk.real(uri), readFileSync(wsUri('data.sldd').fsPath));
      const doc = await vscode.workspace.openTextDocument(uri);
      await quiet(1500, 'the open settling');
      disk.reads = 0;
      const events: { changes: number; dirty: boolean }[] = [];
      const sub = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === uri.toString()) events.push({ changes: e.contentChanges.length, dirty: e.document.isDirty });
      });
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), ' ');
      assert.ok(await vscode.workspace.applyEdit(edit));
      await waitFor('the document to be dirty', () => doc.isDirty);
      await quiet(1500, 'a read the edit causes');
      console.log(`[PROBE] ${phase}: reads=${disk.reads} events=${JSON.stringify(events)}`);
      counts.push(disk.reads);
      sub.dispose();
      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      registered.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
    assert.deepStrictEqual(counts, [0, 0], 'reads of the file on its first edit: before, after the index was built');
  });
});
