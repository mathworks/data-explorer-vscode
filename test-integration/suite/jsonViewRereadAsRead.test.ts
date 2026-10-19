// Copyright 2026 The MathWorks, Inc.
// An edit typed into a JSON .sldd's text view, of an entry whose text holds a hand-typed 1e400,
// as the real provider answers it (mathworks/data-explorer-core#140, F1-22).
//
// Opened from the file, such an entry is read as the file's own: core records the infinity that
// JSON.parse makes of 1e400, and a save writes it back as read. The text view's edit rebuilt the
// entry from its element text through `section.parseEntry`, which recorded nothing, so the entry
// the file read accepted was refused once re-read: its rows came back Modified for an edit that
// changed nothing, and the next table edit of it failed with "Cannot write ...".
//
// The entry carries full metadata (lastmod and modifiedby), so the re-read stamps none and its
// Modified mark can only come from its value. The ops themselves, and the control that an undo
// record and an insert op are still refused, are in test/jsonViewRereadAsRead.test.ts.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { chunkOf, ctx, fakePanel, quiet, token, waitFor, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const NAME = 'hugeExtent';
// A 1x1 struct whose field f is a cell declaring an extent of 1e400 rows, beside a plain field.
const VALUE =
  '{"_array_type": "Struct", "_dimensions": [1, 1], "_elements": [{"f": {"_array_type": "Cell", "_dimensions": [1e400, 0], "_elements": []}, "g": 1}], "_fields": ["f", "g"]}';

/** data.sldd with the entry added as hand-typed text, its metadata the fixture's own in full. */
async function dictionaryText(): Promise<string> {
  const json = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(wsUri('data.sldd'))));
  const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  const metadata = { ...entries[0].metadata, uuid: '00000000-0000-4000-8000-00000000f122' };
  assert.deepStrictEqual(Object.keys(metadata), ['uuid', 'namespace', 'lastmod', 'modifiedby', 'isderived']);
  entries.push({ name: NAME, metadata, value: '@@VALUE@@' });
  return JSON.stringify(json, null, 2).replace('"@@VALUE@@"', VALUE);
}

/** The `{...}` span of the entries[] element whose "name" is `name`. */
function spanOf(text: string, name: string): { offset: number; length: number } {
  const idx = text.indexOf(`"name": ${JSON.stringify(name)}`);
  assert.ok(idx >= 0, `the document spells the entry "${name}"`);
  const start = text.lastIndexOf('{', idx);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return { offset: start, length: i + 1 - start };
  }
  throw new Error(`no element span for "${name}"`);
}

const errorsIn = (posts: any[]): string[] =>
  posts.filter((m) => m.type === 'error' || m.type === 'validationError').map((m) => JSON.stringify(m));
const painted = (posts: any[]): string[] => posts.map((m) => m.type).filter((t) => /Rows$/.test(t));

/** The repaint of `entryRowId` a step sent, after checking it sent nothing else of note. */
function onlyEntryRepaint(posts: any[], entryRowId: string, step: string): any[] {
  assert.deepStrictEqual(errorsIn(posts), [], `${step}: no error was reported`);
  assert.ok(
    !posts.some((m) => m.type === 'setRows'),
    `${step}: the table was not rebuilt, so the entry sync did not fall back (saw ${JSON.stringify(painted(posts))})`,
  );
  const repaints = posts.filter((m) => m.type === 'updateEntryRows');
  assert.ok(repaints.length >= 1, `${step}: the entry was repainted`);
  const last = repaints[repaints.length - 1];
  assert.strictEqual(last.entryRowId, entryRowId, `${step}: over the run the table holds it under`);
  return last.rows;
}

suite('A JSON .sldd re-reads an edited entry from its text as the file read does', () => {
  test('an entry holding 1e400: the text edit syncs unmodified, and a table edit after it writes', async () => {
    const uri = wsUri('json_reread_as_read_copy.sldd');
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(await dictionaryText()));
    const view = fakePanel();
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
      view.send({ type: 'ready' });
      await waitFor('the first paint', () => view.posts.some((m) => m.type === 'setRows'));
      const opened = view.posts.filter((m) => m.type === 'setRows').pop().rows as any[];
      const entryRow = opened.find((r: any) => String(r.ID).endsWith(`/${NAME}`));
      assert.ok(entryRow, `the table has a row for ${NAME}`);
      assert.notStrictEqual(entryRow.Status, 'Modified', 'it opens unmodified, as the file read accepts it');

      // 1. An edit in the text view, inside the entry's element: a space before the 1e400. The
      // element still spells the same entry, so nothing about it changed.
      view.posts.length = 0;
      const before = doc.getText();
      const at = before.indexOf('1e400');
      assert.ok(at >= 0 && before.indexOf('1e400', at + 1) < 0, 'the document spells 1e400 once');
      const typed = new vscode.WorkspaceEdit();
      typed.insert(uri, doc.positionAt(at), ' ');
      assert.ok(await vscode.workspace.applyEdit(typed), 'the text edit applied');
      await waitFor('the text edit to repaint', () =>
        view.posts.some((m) => m.type === 'updateEntryRows' || m.type === 'setRows'),
      );
      await quiet(200, 'a rebuild or an error after the entry repaint');
      const synced = onlyEntryRepaint(view.posts, entryRow.ID, 'the text edit');
      const syncedEntry = synced.find((r: any) => r.ID === entryRow.ID);
      assert.ok(syncedEntry, 'the repaint carries the entry’s own row');
      assert.notStrictEqual(
        syncedEntry.Status,
        'Modified',
        'the re-read entry is what the file read made of the same text, so it is not Modified',
      );
      const gRow = synced.find((r: any) => r.parent === entryRow.ID && r.Name?.label === 'g');
      assert.ok(gRow, `the repaint carries the field g (${JSON.stringify(synced.map((r: any) => r.ID))})`);
      assert.strictEqual(gRow.Value, '1');

      // 2. A table edit of the same entry, after the re-read: the field beside the extent.
      view.posts.length = 0;
      const version = doc.version;
      view.send({ type: 'edit', rowId: gRow.ID, columnId: 'Value', oldValue: '1', newValue: '2' });
      await waitFor(
        'the table edit to reach the document, or be refused',
        () => doc.version > version || errorsIn(view.posts).length > 0,
      );
      // The edit paints its entry before it writes, and again from the write's own change event;
      // that second paint has to land here, not inside the undo's below.
      await waitFor(
        'the write’s own change event to repaint the entry',
        () =>
          errorsIn(view.posts).length > 0 ||
          view.posts.filter((m) => m.type === 'updateEntryRows' || m.type === 'setRows').length >= 2,
      );
      assert.deepStrictEqual(errorsIn(view.posts), [], 'the table edit was not refused');
      assert.ok(doc.version > version, 'the table edit reached the document');
      const written = chunkOf(doc.getText()).entries.find((e: any) => e.name === NAME);
      assert.strictEqual(written?.value?._elements?.[0]?.g, 2, 'the document holds the edited field');
      assert.deepStrictEqual(
        written.value._elements[0].f._dimensions,
        [null, 0],
        'and the extent written back as the file read writes it',
      );
      const span = spanOf(doc.getText(), NAME);
      assert.strictEqual(span.offset, spanOf(before, NAME).offset, 'only that entry’s own span changed');

      // 3. The undo of that table edit: the bytes it wrote over, 1e400 and all, written back over
      // what it wrote. The host recognises its own edit coming back and re-reads the element, which
      // is the document's text again, so the entry is as the file read made it: not Modified.
      const typedText = before.slice(0, at) + ' ' + before.slice(at);
      const original = typedText.slice(span.offset, span.offset + spanOf(typedText, NAME).length);
      assert.ok(original.includes(' 1e400'), 'the bytes the table edit wrote over hold the typed text');
      view.posts.length = 0;
      const undo = new vscode.WorkspaceEdit();
      undo.replace(
        uri,
        new vscode.Range(doc.positionAt(span.offset), doc.positionAt(span.offset + span.length)),
        original,
      );
      assert.ok(await vscode.workspace.applyEdit(undo), 'the undo applied');
      await waitFor('the undo to repaint', () =>
        view.posts.some((m) => m.type === 'updateEntryRows' || m.type === 'setRows'),
      );
      await quiet(200, 'a rebuild or an error after the entry repaint');
      assert.strictEqual(doc.getText(), typedText, 'the document is back to the typed text');
      const undone = onlyEntryRepaint(view.posts, entryRow.ID, 'the undo');
      const undoneEntry = undone.find((r: any) => r.ID === entryRow.ID);
      assert.ok(undoneEntry, 'the repaint carries the entry’s own row');
      assert.notStrictEqual(undoneEntry.Status, 'Modified', 'back to what the file read made of it');
      assert.strictEqual(undone.find((r: any) => r.ID === gRow.ID)?.Value, '1', 'with the field back');
    } finally {
      view.close();
      // Saved before it is deleted: VS Code answers the delete of a DIRTY document by opening a
      // tab on it, to keep the unsaved text, and a tab left open changes the Usage graph's inputs
      // for whichever suite runs next (its first edit then repaints twice).
      const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      if (open?.isDirty) await open.save();
      await vscode.workspace.fs.delete(uri);
    }
  }).timeout(60000);
});
