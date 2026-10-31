// Copyright 2026 The MathWorks, Inc.
//
// A real tab's dirty flag after a save, an undo past it, and a different edit, in the MAT-file and the
// compressed dictionary editors.
//
// VS Code keeps a custom editor's save point as an INDEX into its edit stack: the tab reads clean when
// the current edit's index is the saved one's. Save an edit, undo it, make a different one: the new edit
// takes the undone one's place, its index is the saved index, and VS Code shows the tab clean over a
// file that holds the first edit and not the second. Closing the tab then asks nothing, and the second
// edit is lost. (The JSON editor is a TextDocument, whose versions do not repeat, so it is not affected.)
//
// Only VS Code's own tab shows this, so the suite opens real ones (vscode.openWith) on the registered
// providers. Their edits come from their webviews, which a test cannot script, so each message is
// delivered the way the extension host delivers a webview's: through the webview's own message
// emitter. The suite finds each tab's webview by wrapping, for its own run only, the extension host's
// webview class (the `html` setter a provider sets the shell with, and `postMessage`, whose messages
// it keeps), and restores it afterwards. Undo is VS Code's `undo` command, which needs the window's
// focus, and a tab's webview loads only in a window that draws: on a desktop host whose window does
// neither (a sleeping display), the cases skip and say so; on CI (`CI` set), whose xvfb window does
// both, that is a failure.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isEntryRow, nameOf, quiet, waitFor, ws } from './tools/hostHarness';
import { matFixture, tableOf } from './tools/tables';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A webview the extension host made while the suite ran, and every message posted to it. */
interface Seen {
  webview: any;
  posts: any[];
}

const seen: Seen[] = [];
let restore: (() => void) | undefined;

/** Keep every webview a provider sets a shell on, with what it is sent; answer how to undo that. */
function watchWebviews(): () => void {
  const probe = vscode.window.createWebviewPanel('dataExplorer.savePointProbe', 'probe', { viewColumn: vscode.ViewColumn.Active, preserveFocus: true }, {});
  const proto = Object.getPrototypeOf(probe.webview);
  const emits = typeof (probe.webview as any)._onMessageEmitter?.fire === 'function';
  probe.dispose();
  const html = Object.getOwnPropertyDescriptor(proto, 'html');
  const post = proto.postMessage;
  assert.ok(
    emits && html?.set && html.get && typeof post === 'function',
    "the extension host's webview has the shape this suite drives: a `_onMessageEmitter`, an `html` accessor and `postMessage` on its class",
  );
  const entry = (webview: any): Seen => {
    let s = seen.find((x) => x.webview === webview);
    if (!s) seen.push((s = { webview, posts: [] }));
    return s;
  };
  Object.defineProperty(proto, 'html', {
    ...html,
    set(value: string) {
      entry(this);
      html.set!.call(this, value);
    },
  });
  proto.postMessage = function (message: any) {
    entry(this).posts.push(message);
    return post.call(this, message);
  };
  return () => {
    Object.defineProperty(proto, 'html', html);
    proto.postMessage = post;
  };
}

const tabOf = (uri: vscode.Uri): vscode.Tab | undefined =>
  vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputCustom && t.input.uri.toString() === uri.toString());

interface Kind {
  name: string;
  viewType: string;
  file: string;
  copy(to: string): void;
  /** The edited row, as the table holds it now. */
  row(posts: any[]): any;
  /** The value the first edit saves, and the different one made after undoing it. */
  values: [string, string];
}

const KINDS: Kind[] = [
  {
    name: 'a MAT-file',
    viewType: 'dataExplorer.matView',
    file: 'save_point.mat',
    copy: (to) => writeFileSync(to, matFixture('cases.mat')),
    row: (posts) => tableOf(posts).find((r) => r.parent == null && nameOf(r) === 'scalarD'),
    values: ['42', '43'],
  },
  {
    name: 'a compressed dictionary',
    viewType: 'dataExplorer.binarySlddView',
    file: 'save_point.sldd',
    copy: (to) => copyFileSync(join(ws().fsPath, '..', '..', '..', 'test', 'parity', 'artifacts', 'binary', 'params.sldd'), to),
    row: (posts) => tableOf(posts).find((r) => isEntryRow(r) && nameOf(r) === 'gravity'),
    values: ['9.7', '9.6'],
  },
];

suite('A real tab stays dirty after a save, an undo past it and a different edit', () => {
  let dir: string;

  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    dir = mkdtempSync(join(tmpdir(), 'dex-save-point-'));
    restore = watchWebviews();
  });

  suiteTeardown(() => {
    restore?.();
    rmSync(dir, { recursive: true, force: true });
  });

  for (const kind of KINDS) {
    test(`${kind.name}: the tab is dirty while the file lacks the second edit`, async function () {
      // A tab's webview is a process of its own; the first one of a run is the slow one to load.
      this.timeout(120_000);
      const path = join(dir, kind.file);
      kind.copy(path);
      const uri = vscode.Uri.file(path);
      const before = seen.length;
      await vscode.commands.executeCommand('vscode.openWith', uri, kind.viewType);
      try {
        let table: Seen | undefined;
        try {
          await waitFor(`${kind.file}'s table`, () => !!(table = seen.slice(before).find((s) => kind.row(s.posts))), 60_000);
        } catch (e) {
          if (process.env.CI) throw e;
          this.skip(); // this window did not load the tab's webview (a sleeping display): see the header
        }
        const view = table!;
        const dirty = () => tabOf(uri)?.isDirty;
        const shown = () => String(kind.row(view.posts)?.Value ?? '');
        const edit = (value: string) =>
          view.webview._onMessageEmitter.fire({ type: 'edit', rowId: kind.row(view.posts).ID, columnId: 'Value', oldValue: shown(), newValue: value });
        const [first, second] = kind.values;

        edit(first);
        await waitFor('the first edit to make the tab dirty', () => dirty() === true);
        assert.ok(await vscode.workspace.save(uri), 'the tab saved');
        await waitFor('the save to make the tab clean', () => dirty() === false);

        await vscode.commands.executeCommand('undo');
        try {
          await waitFor('the undo to make the tab dirty', () => dirty() === true && shown() !== first, 5000);
        } catch (e) {
          if (process.env.CI) throw e;
          this.skip(); // this window's `undo` does not reach the tab (no focus): see the header
        }

        edit(second);
        await waitFor('the second edit to reach the table', () => shown() === second);
        await quiet(1500, "VS Code's taking the second edit, which would read the tab clean");
        assert.strictEqual(dirty(), true, `the tab reads dirty: the file holds ${first}, the document ${second}, and closing it must ask`);

        // VS Code's stack is as it was: the second edit undoes and redoes, and the tab stays dirty
        // through both, until a save, which writes it and reads clean.
        await vscode.commands.executeCommand('undo');
        await waitFor('the undo of the second edit', () => shown() !== second && shown() !== first);
        assert.strictEqual(dirty(), true, 'still dirty after undoing it: the file holds the first edit');
        await vscode.commands.executeCommand('redo');
        await waitFor('the redo of the second edit', () => shown() === second);
        assert.strictEqual(dirty(), true, 'still dirty after redoing it');
        assert.ok(await vscode.workspace.save(uri), 'the tab saved again');
        await waitFor('the save to make the tab clean', () => dirty() === false);
      } finally {
        // Closed without a prompt whatever it reads: the tab made active again, then reverted and closed.
        if (tabOf(uri)) {
          await vscode.commands.executeCommand('vscode.openWith', uri, kind.viewType);
          await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        }
      }
    });
  }
});
