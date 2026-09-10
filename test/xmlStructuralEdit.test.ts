// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { DataModel, parseBinarySlddParts } from 'data-explorer-core';
import { findEntryObjectSpan } from '../src/host/xmlEntrySplice.js';
import {
  reserializeEntryXml,
  deleteEntryXml,
  deleteChildXml,
  addChildXml,
  pasteEntryXml,
  deleteEntriesByNameXml,
} from '../src/host/xmlStructuralEdit.js';

const binPath = fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url));
const bytes = readFileSync(binPath);

function load(uri: string): { model: any; xml: string } {
  DataModel.removeDataSource(uri);
  const zip = unzipSync(new Uint8Array(bytes));
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
  const content = parseBinarySlddParts(xml, meta);
  const model = DataModel.addDataSource(uri, content, { path: 'params.sldd' });
  return { model, xml };
}

function entryNames(model: any): string[] {
  return model.children.flatMap((s: any) => s.children.map((e: any) => e.name));
}
function firstEntry(model: any): any {
  return model.children.flatMap((s: any) => s.children)[0];
}
// The first entry that accepts children (a bus/struct/enum) — the only kind the
// add-child path applies to.
function container(model: any): any {
  return model.children
    .flatMap((s: any) => s.children)
    .find((e: any) => typeof e.canAddChild === 'function' && e.canAddChild());
}
// Reparse an edited chunk0.xml back through the real parser and list the entry
// names it yields — the check that matters, since the user's next open of the
// file goes through exactly this path.
function reparseModel(uri: string, xml: string): any {
  DataModel.removeDataSource(uri);
  const zip = unzipSync(new Uint8Array(bytes));
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
  return DataModel.addDataSource(uri, parseBinarySlddParts(xml, meta), { path: 'params.sldd' });
}
function reparse(uri: string, xml: string): string[] {
  return entryNames(reparseModel(uri, xml));
}
// A sibling entry's fragment must be byte-identical across an edit that doesn't touch it.
function siblingIdentical(oldXml: string, newXml: string, name: string): boolean {
  const a = findEntryObjectSpan(oldXml, name);
  const b = findEntryObjectSpan(newXml, name);
  if (!a || !b) return false;
  return oldXml.slice(a.offset, a.offset + a.length) === newXml.slice(b.offset, b.offset + b.length);
}

describe('deleteEntryXml', () => {
  it('removes the named entry, leaves siblings byte-identical', () => {
    const { model, xml } = load('mem://xse1');
    const names = entryNames(model);
    expect(names.length).toBeGreaterThanOrEqual(2);
    const victim = names[0];
    const survivor = names[1];
    const entry = firstEntry(model);
    const { newText } = deleteEntryXml(xml, entry);
    expect(findEntryObjectSpan(newText, victim)).toBeNull();
    expect(siblingIdentical(xml, newText, survivor)).toBe(true);
  });

  // Where the selection lands after a delete: deleting the FIRST row has no
  // previous sibling to fall back on, so it must select the row that moved up into
  // its place. Selecting nothing (or the section header) here would collapse the
  // user's place in the table on every delete of the topmost entry.
  it('selects the following entry when the first one is deleted', () => {
    const { model, xml } = load('mem://xse-sel-first');
    const section = model.getSection('design');
    const [victim, next] = section.children;
    const { selectId } = deleteEntryXml(xml, victim);
    expect(selectId).toBe(next.id);
  });

  // The previous sibling wins whenever there is one, so deleting the bottom row
  // walks the selection UP the table rather than off the end of it.
  it('selects the preceding entry when the last one is deleted', () => {
    const { model, xml } = load('mem://xse-sel-last');
    const section = model.getSection('design');
    const victim = section.children[section.children.length - 1];
    const previous = section.children[section.children.length - 2];
    const { selectId } = deleteEntryXml(xml, victim);
    expect(selectId).toBe(previous.id);
  });

  // Deleting a section's ONLY entry leaves no row to select, so the selection has
  // to fall back to the section header — the row id the table can always resolve.
  // Returning a dead entry id instead left the table with a selection pointing at
  // a row that no longer exists, and the Properties view kept showing the entry
  // the user had just deleted.
  it('falls back to the section header row when the section is emptied', () => {
    const { model, xml } = load('mem://xse-sel-only');
    const section = model.getSection('design');
    // Detach every sibling but one, so the victim is genuinely alone.
    const victim = section.children[0];
    for (const other of [...section.children].slice(1)) section.removeChild(other);
    expect(section.children).toEqual([victim]);
    const { selectId } = deleteEntryXml(xml, victim);
    expect(selectId).toBe('section:design');
  });
});

describe('reserializeEntryXml', () => {
  it('rebuilds an entry fragment containing its Name and no trailing newline', () => {
    const { model } = load('mem://xse2');
    const entry = firstEntry(model);
    const frag = reserializeEntryXml(entry);
    expect(frag).toContain('<Object Class="DD.ENTRY">');
    expect(frag).toContain('<P Name="Name" Class="char">' + entry.name + '</P>');
    expect(frag.endsWith('\n')).toBe(false);
  });
});

describe('deleteEntriesByNameXml', () => {
  it('removes multiple named entries, absent names are ignored', () => {
    const { model, xml } = load('mem://xse4');
    const names = entryNames(model).slice(0, 2);
    const out = deleteEntriesByNameXml(xml, [...names, 'Ghost']);
    for (const n of names) expect(findEntryObjectSpan(out, n)).toBeNull();
  });

  // REGRESSION (mirrors the JSON path). One entry can reach the move list under
  // the same name twice — the drag register dedupes by node identity, and a name
  // is not an identity. Every span used to be computed against the ORIGINAL xml,
  // so the second splice cut an offset range that by then belonged to the
  // FOLLOWING entry, destroying an entry the user never dragged and leaving
  // unbalanced <Object> tags (an unparseable chunk0.xml).
  it('a name listed twice removes that entry once and no neighbour', () => {
    const { model, xml } = load('mem://xse5');
    const before = entryNames(model);
    const victim = before[0];
    const neighbour = before[1];

    const out = deleteEntriesByNameXml(xml, [victim, victim]);
    expect(findEntryObjectSpan(out, victim)).toBeNull();
    // The entry that followed it in the document must survive, byte-identical.
    expect(siblingIdentical(xml, out, neighbour)).toBe(true);
    // The XML stays well-formed: exactly one <Object> disappeared, tags balanced.
    const open = (out.match(/<Object /g) ?? []).length;
    const close = (out.match(/<\/Object>/g) ?? []).length;
    expect(open).toBe(close);
    expect(open).toBe((xml.match(/<Object /g) ?? []).length - 1);
    // And it still reparses into a model with exactly one entry fewer.
    expect(reparse('mem://xse5b', out)).toEqual(before.slice(1));
  });

  it('removes the last two entries at once, keeping the document parseable', () => {
    // Multi-selecting the tail of the table and dragging it elsewhere is an
    // ordinary gesture; the remaining entries must all survive intact.
    const { model, xml } = load('mem://xse6');
    const before = entryNames(model);
    const out = deleteEntriesByNameXml(xml, before.slice(-2));
    expect(reparse('mem://xse6b', out)).toEqual(before.slice(0, -2));
  });

  it('empties the dictionary when every entry is moved out at once', () => {
    const { model, xml } = load('mem://xse7');
    const out = deleteEntriesByNameXml(xml, entryNames(model));
    expect(reparse('mem://xse7b', out)).toEqual([]);
  });
});

// Same hazard as the JSON path: the model was built from an earlier read of
// chunk0.xml, and every edit re-locates its target by NAME in the text it is
// handed. A binary .sldd cannot be edited in a text view, but the in-memory
// chunkXml and the model are refreshed on separate paths, and a cross-document
// move edits a document whose table may never have been opened. When a name no
// longer resolves, these guards produce the message BinarySlddEditorProvider
// shows verbatim instead of splicing over the wrong bytes.
describe('XML structural edits against text the model no longer matches', () => {
  // Rename an entry in the text only — the model still carries the old name.
  const withRenamed = (xml: string, from: string, to: string) =>
    xml.replace(new RegExp(`>${from}<`, 'g'), `>${to}<`);

  it('deleteEntryXml names the entry it could not find', () => {
    const { model, xml } = load('mem://xse-stale-del');
    const entry = firstEntry(model);
    expect(() => deleteEntryXml(withRenamed(xml, entry.name, 'Renamed'), entry)).toThrow(
      `Could not locate entry "${entry.name}" to delete.`,
    );
  });

  it('addChildXml names the entry whose text it could not find', () => {
    // The whole owning entry is reserialized over its span, so a missing span
    // would otherwise overwrite an unrelated fragment.
    const { model, xml } = load('mem://xse-stale-add');
    const bus = container(model);
    expect(() => addChildXml(withRenamed(xml, bus.name, 'Gone'), bus)).toThrow(
      `Could not locate entry "${bus.name}" text.`,
    );
  });

  it('refuses to add a child to a scalar entry', () => {
    const { model, xml } = load('mem://xse-scalar');
    const scalar = model.children
      .flatMap((s: any) => s.children)
      .find((e: any) => typeof e.canAddChild !== 'function' || !e.canAddChild());
    expect(scalar).toBeTruthy();
    expect(() => addChildXml(xml, scalar)).toThrow('This item cannot have children added.');
  });

  it('refuses to delete a top-level entry through the nested-child path', () => {
    // deleteChildXml's caller picks the path from node.isEntry; an entry routed
    // here has a SECTION as its parent, which has no canRemoveChild.
    const { model, xml } = load('mem://xse-child-entry');
    expect(() => deleteChildXml(xml, firstEntry(model))).toThrow('This item cannot be deleted.');
  });
});

// A delete is two halves — the text splice in deleteEntryXml, and a `remove` op on
// the model beside it — and which runs first is the CALLER's discipline rather than
// something this function is told. BinarySlddEditorProvider.applyDeleteEntry splices
// first on purpose, because the splice picks the row to select next out of the
// victim's siblings and the victim has to still be among them. Reverse the two (or
// route a node that some earlier failed edit already detached) and the entry arrives
// here with no parent at all: the naive `entry.parent.children` throws, and a delete
// that has ALREADY happened in the model comes back to the user as "Failed to apply
// edit" with the entry's <Object> still in the file and its row gone from the table.
// The fragment has to come out either way; only the selection is forfeit.
describe('deleteEntryXml on an entry the model has already detached', () => {
  it('still removes the fragment, and asks for no selection it cannot resolve', () => {
    const { model, xml } = load('mem://xse-detached');
    const section = model.getSection('design');
    const victim = section.children[0];
    const survivor = section.children[1];
    const victimName = victim.name;
    // Exactly what applyEntryOps' `remove` does to it: section.removeChild, which nulls
    // the removed node's parent.
    section.removeChild(victim);
    expect(victim.parent, 'the entry is genuinely off the tree').toBeFalsy();

    const { newText, selectId } = deleteEntryXml(xml, victim);
    // The delete still happened, and it took exactly the one fragment it was aimed at.
    expect(findEntryObjectSpan(newText, victimName)).toBeNull();
    expect(siblingIdentical(xml, newText, survivor.name)).toBe(true);
    expect(reparse('mem://xse-detached2', newText)).not.toContain(victimName);
    // No siblings left to walk and no section to name, so the selection falls all the
    // way back to a bare section row id — a row the table will not find, which is the
    // honest answer here and is why the provider keeps the entry attached.
    expect(selectId).toBe('section:');
  });
});

// pasteEntryXml inserts a NEW entry, which needs a place to put it: the offset
// just before the trailing DD.DICTIONARYREFERENCE / DD.Dictionary objects. A
// chunk0.xml missing both is what a truncated or partially-written file looks
// like — it still parses into a full model, so nothing upstream notices, and
// inserting at a guessed offset would corrupt the document.
describe('XML insert path with no insertion point', () => {
  it('pasteEntryXml reports the missing insertion point', () => {
    const { model, xml } = load('mem://xse-noins-paste');
    // Both trailing structural objects stripped. The entries themselves are
    // intact — asserted below — so the file still yields a complete model and
    // the failure is genuinely insert-only.
    const stripped = xml
      .replace(/[ \t]*<Object Class="DD\.DICTIONARYREFERENCE">[\s\S]*?<\/Object>\n?/g, '')
      .replace(/[ \t]*<Object Class="DD\.Dictionary">[\s\S]*?<\/Object>\n?/g, '');
    expect(reparse('mem://xse-noins-reparse', stripped).length).toBe(entryNames(model).length);

    const payload = firstEntry(model).serialize() as Record<string, unknown>;
    expect(() => pasteEntryXml(stripped, model.getSection('design'), payload)).toThrow(
      'Could not locate the insertion point.',
    );
  });
});

// The XML paste gates must match the JSON path's exactly (they are the same two
// checks over the same shared helper); a divergence would mean the same drag
// behaved differently depending on which .sldd format the user opened.
describe('pasteEntryXml rejects what the target section cannot hold', () => {
  it('names both the class and the section when the class has no home there', () => {
    const { model, xml } = load('mem://xse-paste-disallowed');
    const payload = {
      name: 'Svc',
      metadata: { uuid: 'u' },
      value: { _array_class: 'Simulink.ServiceBus', _elements: [{ _properties: {} }] },
    };
    expect(() => pasteEntryXml(xml, model.getSection('design'), payload)).toThrow(
      'A "Simulink.ServiceBus" entry is not allowed in Design Data.',
    );
  });

  it('names the entry when a non-scalar variable would become an invalid Constant', () => {
    const { model, xml } = load('mem://xse-paste-nonscalar');
    const payload = { name: 'Arr', metadata: { uuid: 'u' }, value: [1, 2, 3] };
    expect(() => pasteEntryXml(xml, model.getSection('arch'), payload)).toThrow(
      "The value for constant 'Arr' must be scalar and numeric.",
    );
  });
});

// A paste rebinds the entry to the section it lands in: fresh uuid (it is a new
// object, not a second reference to the source's) and the target's namespace +
// isderived, which is what actually decides which section the file reloads it into.
describe('pasteEntryXml rebinds the pasted entry to the target section', () => {
  it('gives the copy a new uuid and the target section namespace', () => {
    const { model, xml } = load('mem://xse-rebind');
    const source = firstEntry(model);
    const payload = source.serialize() as Record<string, unknown>;
    const sourceUuid = (payload.metadata as Record<string, unknown>).uuid;
    const { newText } = pasteEntryXml(xml, model.getSection('arch'), payload);

    const pasted = model.getSection('arch').children.at(-1);
    expect(pasted.metadata.uuid).not.toBe(sourceUuid);
    expect(pasted.metadata.isderived).toBe('1');
    // The source entry keeps its own uuid — the payload is cloned, never aliased.
    expect(source.metadata.uuid).toBe(sourceUuid);
    // Reloading the edited text puts the copy in Architectural Data, where it was
    // dropped, and leaves the original in Design.
    const reloaded = reparseModel('mem://xse-rebind2', newText);
    expect(reloaded.getSection('arch').children.map((c: any) => c.name)).toEqual([pasted.name]);
    expect(reloaded.getSection('design').children.map((c: any) => c.name)).toContain(source.name);
  });

  // REGRESSION. The rebind was skipped entirely when the payload carried no
  // metadata — which is what an entry declares in a .sldd that never wrote a
  // metadata block (hand-added in the text view, then copied). The pasted entry
  // then had NO namespace, so reloading fell back to Design: dropping such a row
  // onto Architectural Data made it appear in Design Data instead, as if the paste
  // had silently gone to the wrong section.
  it('rebinds a payload that carries no metadata at all', () => {
    const { model, xml } = load('mem://xse-nometa');
    const payload: Record<string, unknown> = { name: 'HandKp', metadata: null, value: 42 };
    const { newText } = pasteEntryXml(xml, model.getSection('arch'), payload);

    const reloaded = reparseModel('mem://xse-nometa2', newText);
    expect(reloaded.getSection('arch').children.map((c: any) => c.name)).toEqual(['HandKp']);
    expect(reloaded.getSection('design').children.map((c: any) => c.name)).not.toContain('HandKp');
  });

  // A payload with no usable name still has to become a real, named entry: the
  // file format has no way to express a nameless one, and a blank Name row cannot
  // be selected or edited afterwards.
  it('names an unnamed payload rather than writing a blank Name', () => {
    const { model, xml } = load('mem://xse-noname');
    const payload: Record<string, unknown> = { metadata: null, value: 1 };
    const { newText, selectId } = pasteEntryXml(xml, model.getSection('design'), payload);
    expect(selectId).toContain('/Entry');
    expect(reparseModel('mem://xse-noname2', newText).getSection('design').children.map((c: any) => c.name)).toContain(
      'Entry',
    );
  });
});
