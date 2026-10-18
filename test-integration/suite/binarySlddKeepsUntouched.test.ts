// Copyright 2026 The MathWorks, Inc.
// A binary .sldd edit keeps what it did not touch: the splice, undo and redo, and the save gate
// (the maintainer's D12 and its addendum).
//
//  - An edited entry is written by core's spliceEntryObject, laid out as the chunk is, with every
//    byte around it as it was. The provider used to splice the entry's four-space line over a span
//    that starts at `<Object`, so each edit added four more spaces in front of it, in any layout.
//  - Undo and redo rebuild the entry from the text they restore (core's readEntryFragment), so the
//    rebuilt entry still has the bytes it came from. Rebuilt from the undo record, it had none, and
//    the next edit of it wrote the whole entry from the model.
//  - The save gate compares the chunk with the chunk as last read or saved, entry by entry: every
//    entry no edit touched must be its bytes, and every edited one must keep the parts the edit did
//    not change (core's keptPartsViolations). An entry the check cannot read is refused, not passed.
//
// Everything here drives the real provider: the edits are the table's own `edit` messages, sent
// through a stand-in panel (tools/hostHarness), and undo and redo are the closures the provider
// handed to VS Code. A chunk is changed behind the provider's back only where a test needs bytes
// that no edit would write, which is what the gate is there to catch.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { unzipSync, zipSync } from 'fflate';
import { DataModel, serializeEntryToXml } from 'data-explorer-core';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { ctx, fakePanel, token, waitFor, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CHUNK = 'data/chunk0.xml';
/** MATLAB-written: LF, four-space indentation, 40 entries with UUIDs. */
const PARAMS = ['test', 'parity', 'artifacts', 'binary', 'params.sldd'];
/** One line, no UUIDs, and entries the writers spell differently from their bytes. */
const ONE_LINE = ['test', 'fixtures', 'object_array_binary.sldd'];

/** LF, four-space indentation, entries with UUIDs, and an entry ("a") holding a struct in a struct. */
const OBJECT_PROPS = ['test', 'fixtures', 'object_props_binary.sldd'];

const toCrlf = (xml: string) => xml.replace(/\n/g, '\r\n');
/** The chunk on one line: the whitespace between its tags removed, as a one-line file has none. */
const toOneLine = (xml: string) => xml.replace(/>\s+</g, '><');

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

/**
 * The `<Object>…</Object>` of the entry named `name` in `xml`, cut by hand: these fixtures' entries
 * hold no nested `<Object>`, so the first `</Object>` after the name closes it.
 */
function objectOf(xml: string, name: string): { start: number; end: number; text: string } {
  const at = xml.search(new RegExp(`<P Name="Name"( Class="char")?>${name}</P>`));
  assert.ok(at >= 0, `the chunk spells the entry "${name}"`);
  const start = xml.lastIndexOf('<Object Class="DD.ENTRY">', at);
  const end = xml.indexOf('</Object>', at) + '</Object>'.length;
  return { start, end, text: xml.slice(start, end) };
}

/** The LastMod stamp is the clock's, so two runs of the same edits differ in it and nowhere else. */
const withoutStamps = (xml: string) =>
  xml.replace(/(<P Name="LastMod" Class="char">)[^<]*(<\/P>)/g, '$1(stamp)$2');

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
    const refused = view.posts.find((m) => m.type === 'error' || m.type === 'validationError');
    assert.ok(!refused, `the ${columnId} edit of "${name}" was applied (${JSON.stringify(refused)})`);
    assert.notStrictEqual(doc.chunkXml, before, `the ${columnId} edit of "${name}" reached the document`);
  };
  const save = () => provider.saveCustomDocument(doc, token());
  const close = async () => {
    sub.dispose();
    view.close();
    doc.dispose();
    await vscode.workspace.fs.delete(uri);
  };
  return { doc, view, edits, entry, edit, save, close };
}

type Doc = Awaited<ReturnType<typeof open>>;

/** The node named `name` below `node`, depth first. */
function descendant(node: any, name: string): any {
  const stack: any[] = [...(node.children ?? [])];
  while (stack.length) {
    const next = stack.shift();
    if (next.name === name) return next;
    stack.unshift(...(next.children ?? []));
  }
  assert.fail(`"${node.name}" holds a node named "${name}"`);
}

suite('Binary .sldd: an edit keeps what it did not touch (D12)', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  // --- (1) the splice --------------------------------------------------------------------

  for (const [label, fixture, transform, first] of [
    ['an LF chunk', PARAMS, undefined, 'MyAlias'],
    ['a CRLF chunk', PARAMS, toCrlf, 'MyAlias'],
    ['a one-line chunk', ONE_LINE, undefined, 'paramArray'],
  ] as const) {
    test(`three renames keep ${label}'s layout, and every byte outside the entry`, async () => {
      const uri = await workingCopy('d12_splice_copy.sldd', [...fixture], transform);
      const d = await open(uri);
      try {
        const original: string = d.doc.chunkXml;
        const at = objectOf(original, first);
        const before = original.slice(0, at.start);
        const after = original.slice(at.end);
        let name: string = first;
        for (const next of ['Renamed1', 'Renamed2', 'Renamed3']) {
          d.edit(name, 'Name', next);
          name = next;
          const chunk: string = d.doc.chunkXml;
          assert.ok(chunk.startsWith(before), `${next}: every byte before the entry is as it was`);
          assert.ok(chunk.endsWith(after), `${next}: every byte after the entry is as it was`);
          const object = chunk.slice(before.length, chunk.length - after.length);
          assert.ok(
            object.startsWith('<Object Class="DD.ENTRY">'),
            `${next}: the entry starts where it started, with no indentation crept in front of it ` +
              `(${JSON.stringify(object.slice(0, 40))})`,
          );
          assert.ok(object.endsWith('</Object>'), `${next}: and ends where an object ends`);
          assert.ok(object.includes(`>${next}<`), `${next}: the entry carries the new name`);
          if (transform === toCrlf) {
            assert.ok(!/(^|[^\r])\n/.test(object), `${next}: every line of the entry ends in CRLF, as the chunk's do`);
          }
          if (fixture === ONE_LINE) assert.ok(!object.includes('\n'), `${next}: the entry is still on the one line`);
        }
        await d.save();
        assert.strictEqual(await chunkOnDisk(uri), d.doc.chunkXml, 'and the save writes the chunk as edited');
      } finally {
        await d.close();
      }
    });
  }

  // The structural edits splice through xmlStructuralEdit, not the edit handler: adding a child to
  // a struct and deleting one from it. Entry "a" is a struct of `b` and of `c`, itself a struct.
  for (const [label, transform] of [
    ['an LF chunk', undefined],
    ['a CRLF chunk', toCrlf],
    ['a one-line chunk', toOneLine],
  ] as const) {
    for (const [gesture, act] of [
      ['adding a child', (d: Doc) => d.view.send({ type: 'addChild', rowId: descendant(d.entry('a'), 'c').id })],
      ['deleting a child', (d: Doc) => d.view.send({ type: 'delete', rowIds: [descendant(d.entry('a'), 'b').id] })],
    ] as const) {
      test(`${gesture} keeps ${label}'s layout, and every byte outside the entry`, async () => {
        const uri = await workingCopy('d12_structural_copy.sldd', OBJECT_PROPS, transform);
        const d = await open(uri);
        try {
          const original: string = d.doc.chunkXml;
          const at = objectOf(original, 'a');
          const before = original.slice(0, at.start);
          const after = original.slice(at.end);
          d.view.posts.length = 0;
          act(d);
          const refused = d.view.posts.find((m) => m.type === 'error' || m.type === 'validationError');
          assert.ok(!refused, `${gesture} was applied (${JSON.stringify(refused)})`);
          const chunk: string = d.doc.chunkXml;
          assert.notStrictEqual(chunk, original, `${gesture} reached the document`);
          assert.ok(chunk.startsWith(before), 'every byte before the entry is as it was');
          assert.ok(chunk.endsWith(after), 'every byte after the entry is as it was');
          const object = chunk.slice(before.length, chunk.length - after.length);
          assert.ok(
            object.startsWith('<Object Class="DD.ENTRY">'),
            `the entry starts where it started, with no indentation crept in front of it (${JSON.stringify(object.slice(0, 40))})`,
          );
          assert.ok(object.endsWith('</Object>'), 'and ends where an object ends');
          if (transform === toOneLine) assert.ok(!object.includes('\n'), 'the entry is still on the one line');
          await d.save();
          assert.strictEqual(await chunkOnDisk(uri), d.doc.chunkXml, 'and the save writes the chunk as edited');
        } finally {
          await d.close();
        }
      });
    }
  }

  // --- (2) undo and redo keep the entry's bytes -------------------------------------------

  test('an entry rebuilt by undo is written as the bytes it was read from, and a later edit keeps them', async () => {
    // The reference: one rename of the entry as the file was read.
    const refUri = await workingCopy('d12_undo_ref.sldd', ONE_LINE);
    const ref = await open(refUri);
    let expected: string;
    try {
      ref.edit('paramArray', 'Name', 'pB');
      expected = ref.doc.chunkXml;
    } finally {
      await ref.close();
    }

    const uri = await workingCopy('d12_undo_copy.sldd', ONE_LINE);
    const d = await open(uri);
    try {
      const original: string = d.doc.chunkXml;
      const bytes = objectOf(original, 'paramArray').text;
      d.edit('paramArray', 'Name', 'pA');
      d.edits[d.edits.length - 1].undo();
      assert.strictEqual(d.doc.chunkXml, original, 'undo restored the chunk');
      assert.strictEqual(
        serializeEntryToXml(d.entry('paramArray')).trim(),
        bytes,
        'the entry undo rebuilt is written as the bytes it came from, not regenerated from the model',
      );

      // The edit after the undo is the one that showed the loss: with no bytes to keep, the whole
      // entry was written from the model.
      d.edit('paramArray', 'Name', 'pB');
      assert.strictEqual(
        withoutStamps(d.doc.chunkXml),
        withoutStamps(expected),
        'renamed after an undo, the entry changes exactly as it does renamed straight from the file',
      );
      await d.save();
      assert.strictEqual(await chunkOnDisk(uri), d.doc.chunkXml, 'and that saves');
    } finally {
      await d.close();
    }
  });

  test('an entry rebuilt by redo is written as the bytes the edit wrote, and a later edit keeps them', async () => {
    // The reference: the same two renames, with no undo or redo between them.
    const refUri = await workingCopy('d12_redo_ref.sldd', ONE_LINE);
    const ref = await open(refUri);
    let expected: string;
    try {
      ref.edit('paramArray', 'Name', 'pA');
      ref.edit('pA', 'Name', 'pB');
      expected = ref.doc.chunkXml;
    } finally {
      await ref.close();
    }

    const uri = await workingCopy('d12_redo_copy.sldd', ONE_LINE);
    const d = await open(uri);
    try {
      d.edit('paramArray', 'Name', 'pA');
      const edited: string = d.doc.chunkXml;
      const editedBytes = objectOf(edited, 'pA').text;
      const rename = d.edits[d.edits.length - 1];
      rename.undo();
      rename.redo();
      assert.strictEqual(d.doc.chunkXml, edited, 'redo restored the edited chunk');
      assert.strictEqual(
        serializeEntryToXml(d.entry('pA')).trim(),
        editedBytes,
        'the entry redo rebuilt is written as the bytes the edit wrote, not regenerated from the model',
      );

      d.edit('pA', 'Name', 'pB');
      assert.strictEqual(
        withoutStamps(d.doc.chunkXml),
        withoutStamps(expected),
        'renamed after a redo, the entry changes exactly as it does with no undo and redo between',
      );
      await d.save();
      assert.strictEqual(await chunkOnDisk(uri), d.doc.chunkXml, 'and that saves');
    } finally {
      await d.close();
    }
  });

  test('an entry put back by undoing its delete keeps its bytes, and a later edit keeps them', async () => {
    const refUri = await workingCopy('d12_undelete_ref.sldd', ONE_LINE);
    const ref = await open(refUri);
    let expected: string;
    try {
      ref.edit('paramArray', 'Name', 'pB');
      expected = ref.doc.chunkXml;
    } finally {
      await ref.close();
    }

    const uri = await workingCopy('d12_undelete_copy.sldd', ONE_LINE);
    const d = await open(uri);
    try {
      const original: string = d.doc.chunkXml;
      const bytes = objectOf(original, 'paramArray').text;
      d.view.send({ type: 'delete', rowIds: [d.entry('paramArray').id] });
      assert.ok(!d.doc.chunkXml.includes('>paramArray<'), 'the delete reached the document');
      d.edits[d.edits.length - 1].undo();
      assert.strictEqual(d.doc.chunkXml, original, 'undo put the entry back in the chunk');
      assert.strictEqual(
        serializeEntryToXml(d.entry('paramArray')).trim(),
        bytes,
        'the entry undo put back is written as the bytes it was read from, not regenerated from the model',
      );
      d.edit('paramArray', 'Name', 'pB');
      assert.strictEqual(
        withoutStamps(d.doc.chunkXml),
        withoutStamps(expected),
        'renamed after the undone delete, the entry changes exactly as it does renamed straight from the file',
      );
      await d.save();
      assert.strictEqual(await chunkOnDisk(uri), d.doc.chunkXml, 'and that saves');
    } finally {
      await d.close();
    }
  });

  // --- (3) the save gate -----------------------------------------------------------------

  const U8 = '<P Name="Value" Class="uint8">200</P>';
  const u8Object = (xml: string) => objectOf(xml, 'u8Scalar').text;
  // Each a change to the chunk that no edit made, and the name the refusal has to give.
  const corruptions: [label: string, corrupt: (xml: string) => string, named: string, reread?: boolean][] = [
    ['a value of an entry no edit touched', (xml) => xml.replace(U8, U8.replace('200', '201')), '"u8Scalar"'],
    // The reader reads this as it reads the original, so no re-read could see it.
    ['only the spelling of an entry no edit touched', (xml) => xml.replace(U8, U8.replace(' Class', '  Class')), '"u8Scalar"'],
    // The table re-read the chunk (as it does when the webview reloads), so the model now holds the
    // changed value too, with the changed text as its bytes. Only what the edits recorded tells
    // this entry apart from an edited one.
    [
      'a value of an entry no edit touched, after the table re-read the chunk',
      (xml) => xml.replace(U8, U8.replace('200', '201')),
      '"u8Scalar"',
      true,
    ],
    ['an entry no edit removed', (xml) => xml.replace(u8Object(xml), ''), '"u8Scalar"'],
    [
      'an entry no edit added',
      (xml) => {
        const copy = u8Object(xml).replace('>u8Scalar<', '>u8Copy<').replace(/(<P Name="UUID" Class="char">)[^<]*/, '$1d12-copy');
        return xml.replace(u8Object(xml), u8Object(xml) + '\n    ' + copy);
      },
      '"u8Copy"',
    ],
    [
      'the dictionary’s own settings, outside every entry',
      (xml) => xml.replace('<P Name="AccessBaseWorkspace" Class="logical">0</P>', '<P Name="AccessBaseWorkspace" Class="logical">1</P>'),
      'outside its entries',
    ],
  ];
  for (const [label, corrupt, named, reread] of corruptions) {
    test(`a save that would change ${label} is refused, and the file kept`, async () => {
      const uri = await workingCopy('d12_gate_untouched.sldd', PARAMS);
      const d = await open(uri);
      try {
        d.edit('MyAlias', 'Name', 'MyAlias2');
        const edited: string = d.doc.chunkXml;
        const changed = corrupt(edited);
        assert.notStrictEqual(changed, edited, 'the test changed the chunk');
        const onDisk = await vscode.workspace.fs.readFile(uri);

        d.doc.chunkXml = changed;
        if (reread) {
          const posts = d.view.posts.length;
          d.view.send({ type: 'ready' });
          await waitFor('the table to be rebuilt', () => d.view.posts.slice(posts).some((m) => m.type === 'setRows'));
        }
        await assert.rejects(
          d.save(),
          (err: Error) => /^Refusing to save/.test(err.message) && err.message.includes(named),
          `the gate refuses, naming ${named}`,
        );
        assert.deepStrictEqual(await vscode.workspace.fs.readFile(uri), onDisk, 'and the file on disk is untouched');

        // The refusal is about those bytes, not about the edit: with them put back, it saves, and
        // the next edit and save are held to the chunk that save wrote.
        d.doc.chunkXml = edited;
        await d.save();
        assert.strictEqual(await chunkOnDisk(uri), edited, 'the edited chunk saves');
        d.edit('MyAlias2', 'Name', 'MyAlias3');
        await d.save();
        assert.strictEqual(await chunkOnDisk(uri), d.doc.chunkXml, 'and so does the next edit');
        // Undo past both saves: back to the file as it was opened, which saves too.
        d.edits[d.edits.length - 1].undo();
        d.edits[d.edits.length - 2].undo();
        await d.save();
        assert.strictEqual(
          await chunkOnDisk(uri),
          new TextDecoder().decode(unzipSync(onDisk)[CHUNK]),
          'undone past its saves, the document saves the chunk it was opened with',
        );
      } finally {
        await d.close();
      }
    });
  }

  test('a save that would change a part of an edited entry the edit did not touch is refused', async () => {
    const uri = await workingCopy('d12_gate_parts.sldd', PARAMS);
    const d = await open(uri);
    try {
      d.edit('gravity', 'Max', '200');
      const edited: string = d.doc.chunkXml;
      const onDisk = await vscode.workspace.fs.readFile(uri);
      const units = '<P Name="DocUnits" Class="char">m/s^2</P>';
      assert.ok(objectOf(edited, 'gravity').text.includes(units), 'the edited entry keeps its untouched units');

      d.doc.chunkXml = edited.replace(units, '<P Name="DocUnits" Class="char">m/s^3</P>');
      await assert.rejects(
        d.save(),
        (err: Error) =>
          /^Refusing to save/.test(err.message) && err.message.includes('"gravity"') && err.message.includes('DocUnits'),
        'the gate refuses, naming the entry and the part that would change',
      );
      assert.deepStrictEqual(await vscode.workspace.fs.readFile(uri), onDisk, 'and the file on disk is untouched');

      d.doc.chunkXml = edited;
      await d.save();
      assert.strictEqual(await chunkOnDisk(uri), edited, 'the edit itself saves');
    } finally {
      await d.close();
    }
  });

  test('a save is refused when the check cannot read an edited entry, rather than passed', async () => {
    // A processing instruction inside an entry: the reader reads past it, but the scan the check
    // reads an entry with does not, so core's keptPartsViolations answers [] without having
    // checked anything. Here the edit writes the entry whole from the model and drops the
    // instruction, so passing that [] would save a loss nobody asked for.
    const value = '<P Name="Value" Class="double">3.14</P>';
    const uri = await workingCopy('d12_gate_unchecked.sldd', PARAMS, (xml) =>
      xml.replace(value, value + '\n        <?keep this?>'),
    );
    const d = await open(uri);
    try {
      const onDisk = await vscode.workspace.fs.readFile(uri);
      d.edit('scalarD', 'Name', 'scalarE');
      await assert.rejects(
        d.save(),
        (err: Error) =>
          /^Refusing to save/.test(err.message) && err.message.includes('"scalarE"') && /cannot (be )?check/.test(err.message),
        'the gate refuses, and says the entry could not be checked',
      );
      assert.deepStrictEqual(await vscode.workspace.fs.readFile(uri), onDisk, 'and the file on disk is untouched');

      // What the message tells the user to do works: undo that edit, and the rest saves.
      d.edits[d.edits.length - 1].undo();
      d.edit('sglScalar', 'Name', 'sglRenamed');
      await d.save();
      assert.strictEqual(await chunkOnDisk(uri), d.doc.chunkXml, 'with that edit undone, another one saves');
      assert.ok(d.doc.chunkXml.includes('<?keep this?>'), 'and the entry nobody edited keeps its instruction');
    } finally {
      await d.close();
    }
  });

  // An entry the file does not hold has nothing of the file's to keep, so the refusal above is
  // not for it: a pasted, an added and a moved entry each save.
  const additions: [label: string, act: (d: Doc) => void][] = [
    [
      'a pasted entry',
      (d) => {
        d.view.send({ type: 'copy', rowIds: [d.entry('MyAlias').id] });
        d.view.send({ type: 'paste', rowId: d.entry('MyAlias').id });
      },
    ],
    [
      'an added entry',
      (d) => d.view.send({ type: 'addEntry', section: d.entry('MyAlias').parent.name, className: 'Simulink.Parameter', rename: false }),
    ],
    [
      'an entry moved to another section',
      (d) => {
        const sections = (DataModel.getDataSource(d.doc.srcId) as any).children.map((s: any) => s.name);
        const moved = d.entry('MyAlias');
        const other = sections.find((n: string) => n !== moved.parent.name);
        assert.ok(other, 'the dictionary has another section');
        d.view.send({ type: 'dragStart', rowIds: [moved.id] });
        d.view.send({ type: 'drop', rowId: 'section:' + other, mode: 'move' });
      },
    ],
  ];
  for (const [label, act] of additions) {
    test(`${label} saves`, async () => {
      const uri = await workingCopy('d12_gate_added.sldd', PARAMS);
      const d = await open(uri);
      try {
        const before: string = d.doc.chunkXml;
        d.view.posts.length = 0;
        act(d);
        const refused = () => d.view.posts.find((m) => m.type === 'error' || m.type === 'validationError');
        await waitFor('the edit to reach the document', () => d.doc.chunkXml !== before || !!refused());
        assert.ok(!refused(), `the edit was applied (${JSON.stringify(refused())})`);
        await d.save();
        assert.strictEqual(await chunkOnDisk(uri), d.doc.chunkXml, 'and the save writes the chunk as edited');
      } finally {
        await d.close();
      }
    });
  }

});
