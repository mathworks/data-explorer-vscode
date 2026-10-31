// Copyright 2026 The MathWorks, Inc.
// A binary .sldd edit keeps what it did not touch (the maintainer's D12 and its addendum), where
// VS Code's half of a save takes part: an edit made while a save is writing, a save the disk check
// refuses, and the reload that follows a change made outside the editor. The splice, undo and redo,
// and the gate's own cases are view's binary engine's tests now (its keepsUntouched.test.ts).
//
// The save gate compares the chunk with the chunk as last read or saved, entry by entry: every entry
// no edit touched must be its bytes, and every edited one must keep the parts the edit did not
// change (core's keptPartsViolations). An entry the check cannot read is refused, not passed.
//
// Everything here drives the real provider: the edits are the table's own `edit` messages, sent
// through a stand-in panel (tools/hostHarness), and undo and redo are the closures the provider
// handed to VS Code. A chunk is changed behind the provider's back only where a test needs bytes
// that no edit would write, which is what the gate is there to catch.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { readFileSync, statSync, utimesSync, writeFileSync } from 'fs';
import { unzipSync, zipSync } from 'fflate';
import { DataModel } from 'data-explorer-core';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { ctx, fakePanel, token, waitFor, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CHUNK = 'data/chunk0.xml';
/** MATLAB-written: LF, four-space indentation, 40 entries with UUIDs. */
const PARAMS = ['test', 'parity', 'artifacts', 'binary', 'params.sldd'];

/** A working copy of a repository fixture in the workspace, its chunk changed by `transform`. */
async function workingCopy(name: string, fixture: string[], transform?: (xml: string) => string): Promise<vscode.Uri> {
  const zip = unzipSync(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(ctx().extensionUri, ...fixture)));
  if (transform) zip[CHUNK] = new TextEncoder().encode(transform(new TextDecoder().decode(zip[CHUNK])));
  const uri = wsUri(name);
  await vscode.workspace.fs.writeFile(uri, zipSync(zip));
  return uri;
}

async function chunkOnDisk(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(unzipSync(await vscode.workspace.fs.readFile(uri))[CHUNK]);
}

/** A document open in its own provider, painted through a stand-in panel. */
async function open(uri: vscode.Uri) {
  const provider = new BinarySlddEditorProvider(ctx());
  const doc: any = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
  const edits: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];
  const sub = provider.onDidChangeCustomDocument((e) => edits.push(e));
  const view = fakePanel();
  await provider.resolveCustomEditor(doc, view.panel, token());
  view.send({ type: 'ready' });
  await waitFor('the first paint', () => view.posts.some((m) => m.type === 'setRows'));
  const root = () => DataModel.getDataSource(doc.srcId) as any;
  const entry = (name: string) => {
    const found = root()
      .children.flatMap((s: any) => s.children)
      .find((e: any) => e.name === name);
    assert.ok(found, `the model holds the entry "${name}"`);
    return found;
  };
  /** One cell edit of entry `name`, as the table sends it. The handler is synchronous. */
  const edit = (name: string, columnId: string, newValue: string) => {
    const before = doc.chunkXml;
    view.posts.length = 0;
    view.send({ type: 'edit', rowId: entry(name).id, columnId, oldValue: '', newValue });
    const refused = view.posts.find((m) => m.type === 'error' || m.type === 'validationError' || m.type === 'refused');
    assert.ok(!refused, `the ${columnId} edit of "${name}" was applied (${JSON.stringify(refused)})`);
    assert.notStrictEqual(doc.chunkXml, before, `the ${columnId} edit of "${name}" reached the document`);
  };
  const save = () => provider.saveCustomDocument(doc, token());
  const revert = () => provider.revertCustomDocument(doc, token());
  const close = async () => {
    sub.dispose();
    view.close();
    doc.dispose();
    await vscode.workspace.fs.delete(uri);
  };
  return { provider, doc, view, edits, entry, edit, save, revert, close };
}

type Doc = Awaited<ReturnType<typeof open>>;

suite('Binary .sldd: an edit keeps what it did not touch (D12)', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  // --- the save gate ---------------------------------------------------------------------

  const U8 = '<P Name="Value" Class="uint8">200</P>';
  const PI_VALUE = '<P Name="Value" Class="double">3.14</P>';

  // An edit made while a save is writing. The save gates and zips the text before its first await,
  // so that edit is not in what it writes. VS Code calls saved what the document holds when the save
  // resolves, so the save writes again before it does (settledSave.ts), held to the text it wrote
  // first, with that edit counted as an edit. The save is started and not awaited until the edit is
  // made, as when the user edits while the write is still in flight.
  test('an edit made while a save is writing is written by that save, held to the text it wrote first', async () => {
    const uri = await workingCopy('d12_gate_during_write.sldd', PARAMS);
    const d = await open(uri);
    try {
      d.edit('MyAlias', 'Name', 'MyAliasR');
      const saving = d.save();
      d.edit('sglScalar', 'Name', 'sglR');
      await saving;
      const written = await chunkOnDisk(uri);
      assert.strictEqual(written, d.doc.chunkXml, 'the save wrote the document as it stood when it resolved');
      assert.ok(written.includes('>MyAliasR<') && written.includes('>sglR<'), 'with the edit made during it');
      assert.strictEqual(d.doc.edits.dirty, false, 'and the document is clean, as VS Code shows it');
    } finally {
      await d.close();
    }
  });

  test('an edit made while a save is writing, of an entry the check cannot read, fails that save after its first write', async () => {
    // The text the save wrote first still holds the instruction, as the file did, and the edit made
    // during the write drops it. Held to the text the document had moved on to instead, the write
    // the save makes again for that edit would find nothing changed and pass the loss.
    const uri = await workingCopy('d12_gate_during_write_unchecked.sldd', PARAMS, (xml) =>
      xml.replace(PI_VALUE, PI_VALUE + '\n        <?keep this?>'),
    );
    const d = await open(uri);
    try {
      d.edit('sglScalar', 'Name', 'sglR');
      const first: string = d.doc.chunkXml;
      const saving = d.save();
      d.edit('scalarD', 'Name', 'scalarE');
      assert.ok(!d.doc.chunkXml.includes('<?keep this?>'), 'the edit made during the write wrote the entry whole, without its instruction');
      await assert.rejects(
        saving,
        (err: Error) =>
          /^Refusing to save/.test(err.message) && err.message.includes('"scalarE"') && /cannot (be )?check/.test(err.message),
        'the save is refused for that edit, and says the entry could not be checked',
      );
      assert.strictEqual(await chunkOnDisk(uri), first, 'its first write stands, without the edit made during it');
      assert.ok(first.includes('<?keep this?>'), 'so the file keeps the instruction');
      assert.strictEqual(d.doc.edits.dirty, true, 'and the document stays dirty, as VS Code keeps it after a failed save');

      const onDisk = await vscode.workspace.fs.readFile(uri);
      await assert.rejects(
        d.save(),
        (err: Error) =>
          /^Refusing to save/.test(err.message) && err.message.includes('"scalarE"') && /cannot (be )?check/.test(err.message),
        'the next save is refused too',
      );
      assert.deepStrictEqual(await vscode.workspace.fs.readFile(uri), onDisk, 'and the file on disk is untouched');

      // Undo that edit, as the message says, and the file saves with the instruction.
      d.edits[d.edits.length - 1].undo();
      await d.save();
      assert.strictEqual(await chunkOnDisk(uri), first, 'with the edit undone, the document saves as it was written');
    } finally {
      await d.close();
    }
  });

  // The same window in a save that fails after its gate: the file changed on disk since it was
  // read, so the disk check refuses the save before it writes (binarySlddOutsideChange). A save
  // that fails wrote nothing, so the edits it took go back, joining the edit made during it rather
  // than replacing it. The user answers Overwrite, and the save after that writes.
  /** Change the file behind the editor, as another program would: other bytes, and a later mtime. */
  function changeOutside(uri: vscode.Uri): void {
    const before = statSync(uri.fsPath).mtimeMs;
    const zip = unzipSync(readFileSync(uri.fsPath));
    zip[CHUNK] = new TextEncoder().encode(new TextDecoder().decode(zip[CHUNK]).replace('>MyAlias<', '>MyAliasOutside<'));
    writeFileSync(uri.fsPath, zipSync(zip));
    const later = new Date(Math.max(Date.now(), before) + 2000);
    utimesSync(uri.fsPath, later, later);
  }
  /** A save the disk check refuses, with `during` made while it is in flight, answered Overwrite. */
  async function refusedByTheDisk(d: Doc, during: () => void): Promise<void> {
    const asked: string[] = [];
    d.provider.askSaveConflict = async (message: string) => {
      asked.push(message);
      return 'Overwrite';
    };
    changeOutside(d.doc.uri);
    const saving = d.save();
    during();
    await assert.rejects(saving, (err) => err instanceof vscode.CancellationError, 'the save is refused, as the file changed on disk');
    await waitFor('the Overwrite answer', () => asked.length === 1 && d.doc.overwriteStamp !== undefined);
  }

  test('an edit made while a save is writing joins the edits it gives back when the disk check refuses it', async () => {
    const uri = await workingCopy('d12_gate_during_refused_write.sldd', PARAMS);
    const d = await open(uri);
    try {
      d.edit('MyAlias', 'Name', 'MyAliasR');
      await refusedByTheDisk(d, () => d.edit('sglScalar', 'Name', 'sglR'));

      await d.save();
      const written = await chunkOnDisk(uri);
      assert.strictEqual(written, d.doc.chunkXml, 'the save after Overwrite writes the document');
      assert.ok(written.includes('>MyAliasR<') && written.includes('>sglR<'), 'with both edits');
    } finally {
      await d.close();
    }
  });

  test('an edit made while a save is writing, of an entry the check cannot read, is refused after the disk check refused that save', async () => {
    // And after the table re-reads the chunk, which builds the entry's node from the edit's text,
    // so only the record made at the edit still says the file's entry cannot be checked.
    const uri = await workingCopy('d12_gate_during_refused_write_unchecked.sldd', PARAMS, (xml) =>
      xml.replace(PI_VALUE, PI_VALUE + '\n        <?keep this?>'),
    );
    const d = await open(uri);
    try {
      d.edit('sglScalar', 'Name', 'sglR');
      await refusedByTheDisk(d, () => d.edit('scalarD', 'Name', 'scalarE'));
      assert.ok(!d.doc.chunkXml.includes('<?keep this?>'), 'the edit made during the write wrote the entry whole, without its instruction');
      const posts = d.view.posts.length;
      d.view.send({ type: 'ready' });
      await waitFor('the table to be rebuilt', () => d.view.posts.slice(posts).some((m) => m.type === 'setRows'));

      const onDisk = await vscode.workspace.fs.readFile(uri);
      assert.ok((await chunkOnDisk(uri)).includes('<?keep this?>'), 'the file holds the instruction');
      await assert.rejects(
        d.save(),
        (err: Error) =>
          /^Refusing to save/.test(err.message) && err.message.includes('"scalarE"') && /cannot (be )?check/.test(err.message),
        'the save after Overwrite is refused, and says the entry could not be checked',
      );
      assert.deepStrictEqual(await vscode.workspace.fs.readFile(uri), onDisk, 'and the file on disk is untouched');

      // Undo that edit, as the message says, and the rest saves with the instruction.
      d.edits[d.edits.length - 1].undo();
      await d.save();
      const written = await chunkOnDisk(uri);
      assert.strictEqual(written, d.doc.chunkXml, 'with that edit undone, the document saves');
      assert.ok(written.includes('>sglR<') && written.includes('<?keep this?>'), 'with the other edit, and the instruction');
    } finally {
      await d.close();
    }
  });

  // An edit counts only against the chunk it was made to. A save, a revert, and the reload that
  // follows a change made outside the editor with nothing unsaved each replace that chunk, so the
  // next save is held to the new one with nothing edited against it yet: an entry edited before
  // it and not since must be its bytes again. Once the table has re-read a chunk changed under
  // the editor, the model holds the changed value too, and only the record of edits tells such an
  // entry apart from an edited one. The save and the revert are view's binary engine's tests now;
  // the reload stays here, where VS Code's watcher brings the change in.
  const replacements: [label: string, replace: (d: Doc) => Promise<void>, named: string][] = [
    [
      'the reload after a change outside the editor',
      async (d) => {
        // Undone, so nothing is unsaved, and the editor follows the change silently.
        d.edits[d.edits.length - 1].undo();
        changeOutside(d.doc.uri);
        await waitFor('the reload', () => d.doc.chunkXml.includes('>MyAliasOutside<'));
      },
      '"u8Scalar"',
    ],
  ];
  for (const [label, replace, named] of replacements) {
    test(`an entry edited before ${label} is held to its bytes again, after the table re-read a chunk that changed it`, async () => {
      const uri = await workingCopy('d12_gate_edits_forgotten.sldd', PARAMS);
      const d = await open(uri);
      try {
        d.edit('u8Scalar', 'Name', 'u8X');
        await replace(d);
        assert.strictEqual(d.doc.chunkXml, await chunkOnDisk(uri), 'the document holds the file as it is now');

        d.edit('sglScalar', 'Name', 'sglR');
        const edited: string = d.doc.chunkXml;
        d.doc.chunkXml = edited.replace(U8, U8.replace('200', '201'));
        assert.notStrictEqual(d.doc.chunkXml, edited, 'the test changed the chunk');
        const posts = d.view.posts.length;
        d.view.send({ type: 'ready' });
        await waitFor('the table to be rebuilt', () => d.view.posts.slice(posts).some((m) => m.type === 'setRows'));

        const onDisk = await vscode.workspace.fs.readFile(uri);
        await assert.rejects(
          d.save(),
          (err: Error) =>
            /^Refusing to save/.test(err.message) && err.message.includes(`entry ${named} `) && err.message.includes('no edit changed it'),
          `the gate refuses, naming ${named} as an entry no edit changed`,
        );
        assert.deepStrictEqual(await vscode.workspace.fs.readFile(uri), onDisk, 'and the file on disk is untouched');

        // With the value put back, the edit made since saves.
        d.doc.chunkXml = edited;
        await d.save();
        assert.strictEqual(await chunkOnDisk(uri), edited, 'with the value put back, the edit saves');
      } finally {
        await d.close();
      }
    });
  }
});
