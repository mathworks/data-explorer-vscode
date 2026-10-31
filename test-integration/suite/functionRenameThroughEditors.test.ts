// Copyright 2026 The MathWorks, Inc.
// Renaming a service interface's function through the REAL text editor, the way the table asks
// for it: one `edit` message, through the provider's own message handler.
//
// A `Simulink.FunctionElement` is spelled twice in an architectural dictionary: in the data
// part, and in the System Composer catalog, which keeps its own copy of each function under
// the interface (`p_Name`, and the `p_FunctionPrototype` that declares the function by name).
// The text editor carries a function rename into the catalog as extra ranges in the same
// WorkspaceEdit. What only VS Code can say is that it reports that edit back as ONE change
// event holding all three ranges, which is what makes the rename a single step on its undo
// stack. The rest of the carry (each sequence of renames, the refusals, the undo, and the binary
// editor's member swap) is view's JSON and binary engines' tests now, graded there against
// core's own save, as the saved catalog is graded here.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { createSession, ingest } from 'data-explorer-core';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { childrenOf, ctx, fakePanel, isEntryRow, nameOf, token, waitFor, ws } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** The text fixture the unit suite asks the same questions of. */
const TEXT_FIXTURE = 'arch.sldd';

/** Sourced from `test/fixtures`, so the dictionary this asks about is the unit suite's. */
const fixtureUri = (name: string) => vscode.Uri.joinPath(ws(), '..', '..', '..', 'test', 'fixtures', name);

/** Written OUTSIDE the workspace folder, whose exact file set two other suites assert. */
const workingUri = (name: string) => vscode.Uri.joinPath(ws(), '..', name);

const CATALOG_KEY = '"__MW_TEXT_PART__/simulink/systemcomposer/interfaceDictionary"';

/** A textual dictionary's catalog part: from its key to the end of the text. */
function catalogPartOf(text: string): string {
  const at = text.indexOf(CATALOG_KEY);
  assert.ok(at > 0, 'the dictionary has a catalog part');
  return text.slice(at);
}

/** `text` with each `from` replaced by its `to`, checking first that `from` occurs exactly once. */
function replacedOnce(text: string, pairs: [from: string, to: string][]): string {
  return pairs.reduce((out, [from, to]) => {
    assert.strictEqual(out.split(from).length - 1, 1, `"${from}" occurs exactly once`);
    return out.replace(from, () => to);
  }, text);
}

/** One rename: of the entry `entry`, or of its function `fn`, to `to`. */
interface Step {
  entry: string;
  fn?: string;
  to: string;
}

const ONE_RENAME: Step[] = [{ entry: 'ServiceInterface', fn: 'f', to: 'compute' }];

/** The node `step` names in a tree of sections, entries and their rows. */
function nodeOf(root: any, step: Step): any {
  const entry = (root.children as any[]).flatMap((s: any) => s.children as any[]).find((e: any) => e.name === step.entry);
  assert.ok(entry, `core's tree has an entry named ${step.entry}`);
  if (step.fn === undefined) return entry;
  const fn = (entry.children as any[]).find((c: any) => c.name === step.fn);
  assert.ok(fn, `${step.entry} has a function named ${step.fn}`);
  return fn;
}

/** Core's own save of `content` after `steps` ran on a fresh session's tree. */
function coreSaved(content: Uint8Array, filename: string, steps: Step[]): any {
  const session = createSession();
  const src: any = ingest(session, content, { filename });
  steps.forEach((step) =>
    assert.strictEqual(
      nodeOf(src, step).setProperty('Name', step.to),
      true,
      `core accepts ${step.fn ?? step.entry} -> ${step.to}`,
    ),
  );
  const out = session.serializeSource(src.name);
  session.removeDataSource(src.name);
  assert.ok(out, 'core can write this dictionary');
  return out;
}

/** The row the table holds for `step`, from the newest paint that carries it. */
function rowOf(posts: any[], step: Step): any {
  for (let i = posts.length - 1; i >= 0; i--) {
    const msg = posts[i];
    if (msg.type !== 'setRows' && msg.type !== 'updateEntryRows') continue;
    const rows = msg.rows as any[];
    const entry = rows.find((r) => isEntryRow(r) && nameOf(r) === step.entry);
    if (!entry) continue;
    if (step.fn === undefined) return entry;
    const fn = childrenOf(rows, entry.ID).find((r) => nameOf(r) === step.fn);
    if (fn) return fn;
  }
  assert.fail(`the table was sent a row for ${step.fn ?? step.entry} under ${step.entry}`);
}

/** The `edit` message the table posts for a committed rename of `row`. */
const renameMessage = (row: any, to: string) => ({
  type: 'edit',
  rowId: row.ID,
  columnId: 'Name',
  oldValue: nameOf(row),
  newValue: to,
});

const problemsIn = (posts: any[]) => posts.filter((m) => m.type === 'error' || m.type === 'validationError');

// --- the text editor ---------------------------------------------------------------------

/** A working copy of the text fixture (rewritten by `edit` first), open in the real provider. */
async function openText(copyName: string, edit: (text: string) => string = (text) => text) {
  const original = edit(dec(await vscode.workspace.fs.readFile(fixtureUri(TEXT_FIXTURE))));
  const uri = workingUri(copyName);
  await vscode.workspace.fs.writeFile(uri, enc(original));
  const doc = await vscode.workspace.openTextDocument(uri);
  const changes: vscode.TextDocumentChangeEvent[] = [];
  const sub = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.toString() === uri.toString() && e.contentChanges.length > 0) changes.push(e);
  });
  const view = fakePanel();
  await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
  view.send({ type: 'ready' });
  await waitFor('the first paint', () => view.posts.some((m) => m.type === 'setRows'));

  /** Send one rename and wait for it to be written or refused; the posts it caused. */
  const rename = async (step: Step): Promise<any[]> => {
    const row = rowOf(view.posts, step);
    const mark = view.posts.length;
    const version = doc.version;
    view.send(renameMessage(row, step.to));
    await waitFor(
      `the rename to ${step.to} to be written or refused`,
      () => doc.version > version || problemsIn(view.posts.slice(mark)).length > 0,
    );
    // A write paints the entry before it is made, and again from its own change event: a
    // rename that carried the catalog is several ranges, which takes the wide repaint, and the
    // next step reads its row from that. A refusal paints the entry back, once.
    const paints = () => view.posts.slice(mark).filter((m) => m.type === 'setRows' || m.type === 'updateEntryRows').length;
    await waitFor(`the repaint after the rename to ${step.to}`, () => paints() >= (doc.version > version ? 2 : 1));
    return view.posts.slice(mark);
  };

  const close = async () => {
    view.close();
    sub.dispose();
    await vscode.workspace.fs.delete(uri);
  };
  return { uri, doc, original, changes, rename, close };
}

suite('A service function rename through the text editor carries into the catalog', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  test('one rename writes the function’s p_Name and p_FunctionPrototype, in the same write as the entry', async () => {
    const t = await openText('fn_rename_text_one.sldd');
    try {
      const posts = await t.rename(ONE_RENAME[0]);
      assert.deepStrictEqual(problemsIn(posts), [], 'the rename was accepted');

      assert.strictEqual(t.changes.length, 1, 'one write');
      assert.strictEqual(t.changes[0].contentChanges.length, 3, 'holding the entry span, p_Name and p_FunctionPrototype');
      const text = t.doc.getText();
      assert.ok(text.includes('"Prototype": "y = compute(u,v)"'), 'the entry’s Prototype follows the Name');
      assert.strictEqual(
        catalogPartOf(text),
        replacedOnce(catalogPartOf(t.original), [
          ['"p_FunctionPrototype": "y = f(u,v)"', '"p_FunctionPrototype": "y = compute(u,v)"'],
          ['"p_Name": "f"', '"p_Name": "compute"'],
        ]),
        'the catalog moves at the function’s two sites and nowhere else',
      );

      const core = coreSaved(enc(t.original), TEXT_FIXTURE, ONE_RENAME);
      assert.strictEqual(core.kind, 'text');
      assert.ok(await t.doc.save(), 'the document saved');
      const onDisk = dec(await vscode.workspace.fs.readFile(t.uri));
      assert.strictEqual(
        catalogPartOf(onDisk),
        catalogPartOf(core.text),
        'the saved catalog is the one core’s own save writes',
      );
    } finally {
      await t.close();
    }
  });

});

// --- the binary editor -------------------------------------------------------------------

