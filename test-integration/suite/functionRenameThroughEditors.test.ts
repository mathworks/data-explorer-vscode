// Copyright 2026 The MathWorks, Inc.
// Renaming a service interface's function through the REAL editors, the way the table asks
// for it: one `edit` message, through each provider's own message handler.
//
// A `Simulink.FunctionElement` is spelled twice in an architectural dictionary: in the data
// part, and in the System Composer catalog, which keeps its own copy of each function under
// the interface (`p_Name`, and the `p_FunctionPrototype` that declares the function by name).
// A rename that moved only the first would reopen as two functions MATLAB cannot reconcile.
// Each provider carries it in one branch of its edit handler: extra ranges in the same
// WorkspaceEdit in the text editor, and a member swap on the same undo step in the binary one.
//
// test/scRenameCarry.test.ts pins the helpers that branch calls, and archRenameCarry.test.ts
// pins what a save and an undo do with the member swap. Both compose the edit themselves, as
// the handler composes it, so neither one reaches the handler: with either provider put back
// to the one before the carry, all of their tests stay green. This file is the half they
// cannot be. It sends the message the table sends, through a fake panel, and grades what the
// provider wrote against core's own save of the same renames (`createSession` / `ingest` /
// `serializeSource`), which carries a function rename by itself.
//
// Measured, by putting one provider back to origin/main at a time and running this file: the
// four cases per editor that carry a rename fail, and the two that must write no catalog
// edit (a function the catalog does not list, a rename core refuses) pass, as controls.
//
// The text editor's undo is applied as the inverse of the one change event the rename fired,
// as ONE WorkspaceEdit, because the `undo` command does not take effect in this test host
// (see cutPasteUndo.test.ts). One event holding every range is what makes the rename a single
// step on VS Code's stack; the inverse shows those ranges are the whole rename.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { unzipSync, zipSync } from 'fflate';
import { SC_PART_XML, createSession, ingest } from 'data-explorer-core';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { childrenOf, ctx, fakePanel, isEntryRow, nameOf, settle, token, waitFor, ws } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** The text and binary fixtures the unit suite asks the same questions of. */
const TEXT_FIXTURE = 'arch.sldd';
const BINARY_FIXTURE = 'arch_service_binary.sldd';
const CHUNK_XML = 'data/chunk0.xml';

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

/** The sequences a rename has to get right in an editor that writes as it goes. */
const SEQUENCES: [label: string, steps: Step[]][] = [
  [
    'the interface renamed first, then its function',
    [
      { entry: 'ServiceInterface', to: 'Svc' },
      { entry: 'Svc', fn: 'f', to: 'compute' },
    ],
  ],
  [
    'a chain',
    [
      { entry: 'ServiceInterface', fn: 'f', to: 'compute' },
      { entry: 'ServiceInterface', fn: 'compute', to: 'step' },
    ],
  ],
];

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

/** What core says when it refuses `step` on `content`. */
function coreRefusal(content: Uint8Array, filename: string, step: Step): string {
  const session = createSession();
  const src: any = ingest(session, content, { filename });
  const result = nodeOf(src, step).setProperty('Name', step.to);
  session.removeDataSource(src.name);
  assert.ok(result && typeof result === 'object' && result.error, 'core refuses this rename too');
  return String(result.reason);
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

const refusalsIn = (posts: any[]) => posts.filter((m) => m.type === 'validationError');
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
    // A rename that carried the catalog is several ranges, which takes the wide repaint; the
    // next step reads its row from that. A tail, not the work.
    await settle(300);
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

  for (const [label, steps] of SEQUENCES) {
    test(`writes the catalog core’s own save writes: ${label}`, async () => {
      const t = await openText(`fn_rename_text_${label.replace(/\W+/g, '_')}.sldd`);
      try {
        for (const step of steps) {
          assert.deepStrictEqual(problemsIn(await t.rename(step)), [], `${step.fn ?? step.entry} -> ${step.to} was accepted`);
        }
        assert.strictEqual(t.changes.length, steps.length, 'one write per rename');
        const core = coreSaved(enc(t.original), TEXT_FIXTURE, steps);
        assert.strictEqual(
          catalogPartOf(t.doc.getText()),
          catalogPartOf(core.text),
          'the catalog is the one core’s own save writes',
        );
      } finally {
        await t.close();
      }
    });
  }

  test('a function the catalog does not list leaves the catalog untouched', async () => {
    // `f2` is in the entry and not in the catalog, so the rename is the entry span alone.
    const step: Step = { entry: 'ServiceInterface', fn: 'f2', to: 'h' };
    const t = await openText('fn_rename_text_unlisted.sldd');
    try {
      assert.deepStrictEqual(problemsIn(await t.rename(step)), [], 'the rename was accepted');
      assert.strictEqual(t.changes.length, 1, 'one write');
      assert.strictEqual(t.changes[0].contentChanges.length, 1, 'of the entry span alone');
      const text = t.doc.getText();
      assert.ok(text.includes('"Prototype": "y = h(u,v)"'), 'the entry was renamed');
      assert.strictEqual(catalogPartOf(text), catalogPartOf(t.original), 'and the catalog is as read');
      assert.strictEqual(
        catalogPartOf(text),
        catalogPartOf(coreSaved(enc(t.original), TEXT_FIXTURE, [step]).text),
        'as core’s own save leaves it',
      );
    } finally {
      await t.close();
    }
  });

  test('a rename the Prototype cannot follow is refused with core’s reason, and writes nothing', async () => {
    const t = await openText('fn_rename_text_refused.sldd', (text) =>
      replacedOnce(text, [['"Prototype": "y = f(u,v)"', '"Prototype": "y = step(u,v)"']]),
    );
    try {
      const posts = await t.rename(ONE_RENAME[0]);
      const refusals = refusalsIn(posts);
      assert.strictEqual(refusals.length, 1, `one validationError (${JSON.stringify(posts.map((m) => m.type))})`);
      const reason = coreRefusal(enc(t.original), TEXT_FIXTURE, ONE_RENAME[0]);
      assert.ok(reason.startsWith("'f' cannot be renamed: its Prototype 'y = step(u,v)'"), reason);
      assert.strictEqual(refusals[0].reason, reason, 'carrying core’s own reason');
      assert.strictEqual(t.changes.length, 0, 'no write');
      assert.strictEqual(t.doc.getText(), t.original);
      assert.strictEqual(t.doc.isDirty, false);
    } finally {
      await t.close();
    }
  });

  test('undo is one step: the inverse of the one write brings back the original bytes', async () => {
    const t = await openText('fn_rename_text_undo.sldd');
    try {
      assert.deepStrictEqual(problemsIn(await t.rename(ONE_RENAME[0])), [], 'the rename was accepted');
      const core = coreSaved(enc(t.original), TEXT_FIXTURE, ONE_RENAME);
      assert.strictEqual(catalogPartOf(t.doc.getText()), catalogPartOf(core.text), 'the write carried the catalog');
      assert.strictEqual(t.changes.length, 1, 'in one write, so one step on the undo stack');

      // Each change's range is in the text before the write; in the text after it, a range
      // starts where it did plus what the changes before it grew or shrank by.
      const written = [...t.changes[0].contentChanges].sort((a, b) => a.rangeOffset - b.rangeOffset);
      const inverse = new vscode.WorkspaceEdit();
      let shift = 0;
      for (const c of written) {
        const start = c.rangeOffset + shift;
        inverse.replace(
          t.uri,
          new vscode.Range(t.doc.positionAt(start), t.doc.positionAt(start + c.text.length)),
          t.original.slice(c.rangeOffset, c.rangeOffset + c.rangeLength),
        );
        shift += c.text.length - c.rangeLength;
      }
      assert.ok(await vscode.workspace.applyEdit(inverse), 'the undo applied');
      await waitFor('the undo to land', () => t.changes.length === 2);
      assert.strictEqual(t.doc.getText(), t.original, 'the document is the bytes it opened with');
    } finally {
      await t.close();
    }
  });
});

// --- the binary editor -------------------------------------------------------------------

/** A working copy of the binary fixture (its members rewritten by `edit` first), open in the real provider. */
async function openBinary(copyName: string, edit?: (zip: Record<string, Uint8Array>) => void) {
  const zip = unzipSync(await vscode.workspace.fs.readFile(fixtureUri(BINARY_FIXTURE)));
  edit?.(zip);
  const bytes = zipSync(zip);
  const uri = workingUri(copyName);
  await vscode.workspace.fs.writeFile(uri, bytes);
  const provider = new BinarySlddEditorProvider(ctx());
  const edits: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];
  const sub = provider.onDidChangeCustomDocument((e) => edits.push(e));
  const doc: any = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
  const view = fakePanel();
  await provider.resolveCustomEditor(doc, view.panel, token());
  // No waits in here: this provider answers `ready` and `edit` synchronously.
  view.send({ type: 'ready' });
  assert.ok(view.posts.some((m) => m.type === 'setRows'), 'the first paint sent the whole table');

  /** Send one rename; the posts it caused. */
  const rename = (step: Step): any[] => {
    const row = rowOf(view.posts, step);
    const mark = view.posts.length;
    view.send(renameMessage(row, step.to));
    return view.posts.slice(mark);
  };

  /** Save, and read back the members the file now holds. */
  const save = async (): Promise<Record<string, Uint8Array>> => {
    await provider.saveCustomDocument(doc, token());
    return unzipSync(await vscode.workspace.fs.readFile(uri));
  };

  const close = async () => {
    view.close();
    sub.dispose();
    doc.dispose();
    await vscode.workspace.fs.delete(uri);
  };
  return { doc, bytes, original: zip, edits, rename, save, close };
}

/** The catalog member core's own save writes after `steps`. */
const coreSavedMember = (bytes: Uint8Array, steps: Step[]): string => {
  const out = coreSaved(bytes, BINARY_FIXTURE, steps);
  assert.strictEqual(out.kind, 'binary');
  return dec(unzipSync(out.bytes)[SC_PART_XML]);
};

suite('A service function rename through the binary editor carries into the catalog', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  test('one rename swaps the member for one with the function’s p_Name and p_FunctionPrototype, on one undo step', async () => {
    const b = await openBinary('fn_rename_binary_one.sldd');
    try {
      assert.deepStrictEqual(problemsIn(b.rename(ONE_RENAME[0])), [], 'the rename was accepted');
      assert.strictEqual(b.edits.length, 1, 'one edit');
      assert.ok(b.doc.chunkXml.includes('y = compute(u)'), 'the entry’s Prototype follows the Name');
      assert.strictEqual(
        dec(b.doc.zipMeta[SC_PART_XML]),
        replacedOnce(dec(b.original[SC_PART_XML]), [
          ['<p_FunctionPrototype>y = f(u)</p_FunctionPrototype>', '<p_FunctionPrototype>y = compute(u)</p_FunctionPrototype>'],
          ['<p_Name>f</p_Name>\n        </p_FunctionElements>', '<p_Name>compute</p_Name>\n        </p_FunctionElements>'],
        ]),
        'the catalog moves at the function’s two sites: the data interface named f stays',
      );

      const saved = await b.save();
      assert.ok(dec(saved[CHUNK_XML]).includes('y = compute(u)'), 'the saved chunk holds the rename');
      assert.strictEqual(
        dec(saved[SC_PART_XML]),
        coreSavedMember(b.bytes, ONE_RENAME),
        'the saved catalog is the one core’s own save writes',
      );
    } finally {
      await b.close();
    }
  });

  for (const [label, steps] of SEQUENCES) {
    test(`writes the catalog core’s own save writes: ${label}`, async () => {
      const b = await openBinary(`fn_rename_binary_${label.replace(/\W+/g, '_')}.sldd`);
      try {
        for (const step of steps) {
          assert.deepStrictEqual(problemsIn(b.rename(step)), [], `${step.fn ?? step.entry} -> ${step.to} was accepted`);
        }
        assert.strictEqual(b.edits.length, steps.length, 'one edit per rename');
        const saved = await b.save();
        assert.strictEqual(
          dec(saved[SC_PART_XML]),
          coreSavedMember(b.bytes, steps),
          'the saved catalog is the one core’s own save writes',
        );
      } finally {
        await b.close();
      }
    });
  }

  test('a function the catalog does not list leaves the member untouched', async () => {
    // The catalog stops listing `g`: drop its function element, so `g` is in the chunk alone.
    const b = await openBinary('fn_rename_binary_unlisted.sldd', (zip) => {
      const xml = dec(zip[SC_PART_XML]);
      const listed = xml.match(/\n *<p_FunctionElements [^>]*uuid="fe-g">[\s\S]*?<\/p_FunctionElements>/g) ?? [];
      assert.strictEqual(listed.length, 1, 'the fixture’s catalog lists g once');
      zip[SC_PART_XML] = enc(xml.replace(listed[0], ''));
    });
    const step: Step = { entry: 'ServiceInterface', fn: 'g', to: 'h' };
    try {
      const member = b.doc.zipMeta[SC_PART_XML];
      assert.deepStrictEqual(problemsIn(b.rename(step)), [], 'the rename was accepted');
      assert.strictEqual(b.edits.length, 1, 'one edit');
      assert.ok(b.doc.chunkXml.includes('[a,b] = h(g)'), 'the entry was renamed');
      assert.strictEqual(b.doc.zipMeta[SC_PART_XML], member, 'and the member is the one read, unswapped');
      const saved = await b.save();
      assert.deepStrictEqual(saved[SC_PART_XML], b.original[SC_PART_XML], 'so the save writes it as read');
      assert.strictEqual(dec(saved[SC_PART_XML]), coreSavedMember(b.bytes, [step]), 'as core’s own save leaves it');
    } finally {
      await b.close();
    }
  });

  test('a rename the Prototype cannot follow is refused with core’s reason, and writes nothing', async () => {
    const b = await openBinary('fn_rename_binary_refused.sldd', (zip) => {
      zip[CHUNK_XML] = enc(replacedOnce(dec(zip[CHUNK_XML]), [['>y = f(u)<', '>y = step(u)<']]));
    });
    try {
      const chunk = b.doc.chunkXml;
      const member = b.doc.zipMeta[SC_PART_XML];
      const posts = b.rename(ONE_RENAME[0]);
      const refusals = refusalsIn(posts);
      assert.strictEqual(refusals.length, 1, `one validationError (${JSON.stringify(posts.map((m) => m.type))})`);
      const reason = coreRefusal(b.bytes, BINARY_FIXTURE, ONE_RENAME[0]);
      assert.ok(reason.startsWith("'f' cannot be renamed: its Prototype 'y = step(u)'"), reason);
      assert.strictEqual(refusals[0].reason, reason, 'carrying core’s own reason');
      assert.strictEqual(b.edits.length, 0, 'no edit');
      assert.strictEqual(b.doc.chunkXml, chunk, 'the chunk is as read');
      assert.strictEqual(b.doc.zipMeta[SC_PART_XML], member, 'and so is the member');
    } finally {
      await b.close();
    }
  });

  test('undo is one step, and puts the member back byte for byte', async () => {
    const b = await openBinary('fn_rename_binary_undo.sldd');
    try {
      const chunk = b.doc.chunkXml;
      const member = b.doc.zipMeta[SC_PART_XML];
      assert.deepStrictEqual(problemsIn(b.rename(ONE_RENAME[0])), [], 'the rename was accepted');
      assert.strictEqual(b.edits.length, 1, 'one edit, so one step on the undo stack');
      assert.strictEqual(
        dec(b.doc.zipMeta[SC_PART_XML]),
        coreSavedMember(b.bytes, ONE_RENAME),
        'the edit swapped in core’s catalog',
      );

      b.edits[0].undo();
      assert.strictEqual(b.doc.chunkXml, chunk, 'undo restored the chunk');
      assert.strictEqual(b.doc.zipMeta[SC_PART_XML], member, 'and the member read from the file');
      const saved = await b.save();
      assert.deepStrictEqual(saved[SC_PART_XML], b.original[SC_PART_XML], 'which a save writes byte for byte');
    } finally {
      await b.close();
    }
  });
});
