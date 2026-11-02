// Copyright 2026 The MathWorks, Inc.
//
// The save-conflict prompt's two answers, in a real tab of each editor that follows its file on
// disk (diskFollow.ts): the compressed dictionary and the MAT-file. Edit, have another program write
// the file, save: the save is refused, and the prompt asks whether to overwrite.
//
//  - Revert is VS Code's own revert of the tab (revertInVsCode: the tab is made active, then
//    `workbench.action.files.revert`). That is what drops the edits from VS Code's stack and shows
//    the tab clean; the provider's revert called on its own reloads the document and leaves the tab
//    dirty. The tab then shows the file as the other program wrote it, and nothing is written.
//  - Overwrite saves again through VS Code (`workspace.save`), which writes over the version the
//    user was asked about and shows the tab clean.
//
// Both reach the provider VS Code registered, through its tab, so only a real tab shows either: a
// provider a test builds around a fake panel (binarySlddOutsideChange.test.ts,
// matOutsideChange.test.ts) has no tab to revert or to save. The tabs are driven as
// customEditorSavePoint.test.ts drives them: each tab's webview is found by wrapping, for this
// suite's run only, the extension host's webview class, and an edit is delivered through the
// webview's own message emitter. The prompt is the registered provider's `askSaveConflict`, an
// error notification with the two buttons, which a test cannot click; so while a test saves,
// `window.showErrorMessage` answers it for the user. The extension and this suite are handed the
// same `vscode` API object (the extension host gives one to each extension, by the folder a module
// is loaded from, and the suite is loaded from the extension's), so the provider's call reaches the
// answer. A desktop window that does not draw loads no webview, and the cases skip and say so; on
// CI (`CI` set), whose xvfb window draws, that is a failure.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { isEntryRow, nameOf, quiet, waitFor, ws } from './tools/hostHarness';
import { entryOf, matFixture, readMat, readSldd, tableOf } from './tools/tables';

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
  const probe = vscode.window.createWebviewPanel('dataExplorer.saveConflictProbe', 'probe', { viewColumn: vscode.ViewColumn.Active, preserveFocus: true }, {});
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

/** Write the file as another program would, with an mtime later than any the view has seen. */
function writeOutside(path: string, bytes: Uint8Array): void {
  const before = statSync(path).mtimeMs;
  writeFileSync(path, bytes);
  const later = new Date(Math.max(Date.now(), before) + 2000);
  utimesSync(path, later, later);
}

/** VS Code's own wording, which the providers' prompt quotes (diskConflict.conflictMessage). */
const conflictMessage = (file: string) =>
  `Failed to save '${file}': The content of the file is newer. Do you want to overwrite the file with your changes?`;

interface Kind {
  name: string;
  viewType: string;
  file: string;
  copy(to: string): void;
  /** The edited row, as the table holds it now. */
  row(posts: any[]): any;
  /** The Value the edit gives it. */
  value: string;
  /** What the other program writes. */
  outside(): Uint8Array;
  /** The table shows what the other program wrote, and not the edited row. */
  showsOutside(posts: any[]): boolean;
  /** The edited row's Value, as core reads it back from a file's bytes. */
  savedValue(bytes: Uint8Array): string | undefined;
}

const KINDS: Kind[] = [
  {
    name: 'a MAT-file',
    viewType: 'dataExplorer.matView',
    file: 'conflict.mat',
    copy: (to) => writeFileSync(to, matFixture('cases.mat')),
    row: (posts) => tableOf(posts).find((r) => r.parent == null && nameOf(r) === 'scalarD'),
    value: '42',
    // Variables p, q, str and x; no scalarD.
    outside: () => matFixture('pv_basic.mat'),
    showsOutside: (posts) => {
      const top = tableOf(posts).filter((r) => r.parent == null).map(nameOf);
      return top.includes('p') && !top.includes('scalarD');
    },
    savedValue: (bytes) => readMat(bytes, (mat) => (mat.children as any[]).find((v) => v.name === 'scalarD')?.toRow().Value),
  },
  {
    name: 'a compressed dictionary',
    viewType: 'dataExplorer.binarySlddView',
    file: 'conflict.sldd',
    copy: (to) => copyFileSync(join(ws().fsPath, '..', '..', '..', 'test', 'parity', 'artifacts', 'binary', 'params.sldd'), to),
    row: (posts) => tableOf(posts).find((r) => isEntryRow(r) && nameOf(r) === 'gravity'),
    value: '9.7',
    // The workspace's binary.sldd: one entry, Kp.
    outside: () => new Uint8Array(readFileSync(join(ws().fsPath, 'binary.sldd'))),
    showsOutside: (posts) => {
      const entries = tableOf(posts).filter(isEntryRow).map(nameOf);
      return entries.includes('Kp') && !entries.includes('gravity');
    },
    savedValue: (bytes) => readSldd(bytes, (dict) => entryOf(dict, 'gravity')?.toRow().Value),
  },
];

suite("The save-conflict prompt's answers, in a real tab", () => {
  let dir: string;

  suiteSetup(async () => {
    // A skip is for a desktop window; on CI the same miss must fail, which needs `CI` to reach this host.
    assert.ok(!process.env.GITHUB_ACTIONS || process.env.CI, 'on GitHub Actions, CI is set in the extension host');
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
    dir = mkdtempSync(join(tmpdir(), 'dex-save-conflict-'));
    restore = watchWebviews();
  });

  suiteTeardown(async () => {
    restore?.();
    await quiet(200, 'the closed tabs’ watchers to stop watching before their directory goes');
    rmSync(dir, { recursive: true, force: true });
  });

  for (const kind of KINDS) {
    for (const answer of ['Revert', 'Overwrite'] as const) {
      const outcome =
        answer === 'Revert'
          ? 'the tab reads clean and shows the file as the other program wrote it, which stays as it is'
          : 'the edit is written over the other program’s version, and the tab reads clean';
      test(`${kind.name}: ${answer}: ${outcome}`, async function () {
        // A tab's webview is a process of its own; the first one of a run is the slow one to load.
        this.timeout(120_000);
        const path = join(dir, `${answer.toLowerCase()}-${kind.file}`);
        kind.copy(path);
        const uri = vscode.Uri.file(path);
        const before = seen.length;
        const window = vscode.window as any;
        const show = window.showErrorMessage;
        const asked: string[] = [];
        await vscode.commands.executeCommand('vscode.openWith', uri, kind.viewType);
        try {
          let table: Seen | undefined;
          try {
            await waitFor(`${basename(path)}'s table`, () => !!(table = seen.slice(before).find((s) => kind.row(s.posts))), 60_000);
          } catch (e) {
            if (process.env.CI) throw e;
            console.log(`[saveConflictInTab] SKIPPING ${kind.name}: this window did not load the tab's webview (a sleeping display).`);
            this.skip();
          }
          const view = table!;
          const dirty = () => tabOf(uri)?.isDirty;
          const shown = () => kind.row(view.posts)?.Value;

          view.webview._onMessageEmitter.fire({ type: 'edit', rowId: kind.row(view.posts).ID, columnId: 'Value', oldValue: String(shown()), newValue: kind.value });
          await waitFor('the edit to make the tab dirty', () => dirty() === true && shown() === kind.value);
          const outside = kind.outside();
          writeOutside(path, outside);

          // The user's answer to the prompt; any other error is shown as it would be.
          window.showErrorMessage = (message: unknown, ...items: unknown[]) => {
            if (message !== conflictMessage(basename(path))) return show.call(window, message, ...items);
            asked.push(message);
            return Promise.resolve(answer);
          };
          const saved = await Promise.resolve(vscode.workspace.save(uri)).catch(() => undefined);
          assert.strictEqual(saved, undefined, 'the save was refused');
          await waitFor('the prompt', () => asked.length > 0);

          if (answer === 'Revert') {
            await waitFor('the revert to read the tab clean', () => dirty() === false);
            await waitFor('the table to show the file on disk', () => kind.showsOutside(view.posts));
            assert.deepStrictEqual(new Uint8Array(readFileSync(path)), outside, 'the other program’s file is the file, byte for byte');
          } else {
            await waitFor('the save to read the tab clean', () => dirty() === false);
            assert.strictEqual(kind.savedValue(new Uint8Array(readFileSync(path))), kind.value, 'the edit is on disk');
            assert.ok(!kind.showsOutside(view.posts), 'and the table still shows the document, not the file it overwrote');
            assert.strictEqual(shown(), kind.value);
          }
          assert.deepStrictEqual(asked, [conflictMessage(basename(path))], 'asked once, in VS Code’s words');
        } finally {
          window.showErrorMessage = show;
          // Closed without a prompt whatever it reads: a tab a failed case left dirty is reverted.
          if (tabOf(uri)) {
            await vscode.commands.executeCommand('vscode.openWith', uri, kind.viewType);
            const close = tabOf(uri)?.isDirty ? 'workbench.action.revertAndCloseActiveEditor' : 'workbench.action.closeActiveEditor';
            await vscode.commands.executeCommand(close);
            await waitFor(`${basename(path)}'s tab to close`, () => !tabOf(uri));
          }
        }
      });
    }
  }
});
