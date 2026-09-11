// Copyright 2026 The MathWorks, Inc.
//
// Pure-transform coverage for structural edits (delete / add-child / paste),
// mirroring editWriteback.test.ts: drive the real modules (SlddModel, node
// mutation, entrySplice) against the real fixture, asserting valid JSON,
// semantic round-trip, and — critically — that untouched sibling entries stay
// byte-identical.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, findNode, invalidate } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';
import { findEntrySpan } from '../src/host/entrySplice.js';
import {
  deleteEntry,
  deleteChild,
  deleteChildren,
  addChild,
  pasteEntry,
  cloneForPaste,
} from '../src/host/structuralEdit.js';
import { mutateEntry } from '../src/host/entryOps.js';

const fixtureText = readFileSync(
  fileURLToPath(new URL('../test-integration/fixtures/workspace/data.sldd', import.meta.url)),
  'utf8',
);

function freshModel(uri: string) {
  invalidate(uri);
  return getModel(uri, 'data.sldd', fixtureText);
}

function rowNames(uri: string, text: string): string[] {
  invalidate(uri);
  const model = getModel(uri, 'data.sldd', text);
  return buildRows(model)
    .filter((r: any) => !String(r.ID).startsWith('section:'))
    .map((r: any) => r.Name?.label);
}

function isValidJson(text: string): boolean {
  try { JSON.parse(text); return true; } catch { return false; }
}

// Byte-identity of a sibling entry's span across the edit.
function siblingByteIdentical(oldText: string, newText: string, name: string): boolean {
  const a = findEntrySpan(oldText, name);
  const b = findEntrySpan(newText, name);
  if (!a || !b) return false;
  return oldText.slice(a.offset, a.offset + a.length) === newText.slice(b.offset, b.offset + b.length);
}

describe('deleteEntry', () => {
  it('removes a top-level entry, keeps valid JSON, siblings byte-identical', () => {
    const uri = 'test://del-entry.sldd';
    const model = freshModel(uri);
    const entry = findNode(uri, buildRows(model).find((r: any) => r.Name?.label === 'Number').ID);

    const { newText, selectId } = deleteEntry(fixtureText, entry);
    expect(isValidJson(newText)).toBe(true);
    expect(findEntrySpan(newText, 'Number')).toBeNull();
    // A different entry is unchanged byte-for-byte.
    expect(siblingByteIdentical(fixtureText, newText, 'PI')).toBe(true);
    // Reselects a neighbor (some other entry), not the deleted one.
    expect(selectId).not.toContain('Number');
  });
});

// The fixture's "Struct" entry is a StructNode with 2 children, canAddChild()
// and canRemoveChild() both true — used to exercise nested-child edits.
function structEntry(uri: string) {
  const model = freshModel(uri);
  const id = buildRows(model).find((r: any) => r.Name?.label === 'Struct' && !String(r.ID).startsWith('section:')).ID;
  return findNode(uri, id);
}

describe('deleteChild', () => {
  it('removes a nested child but keeps the owning entry present', () => {
    const uri = 'test://del-child.sldd';
    const parent = structEntry(uri);
    expect(parent.children.length).toBeGreaterThan(0);
    const child = parent.children[0];

    const { newText, selectId } = deleteChild(fixtureText, child);
    expect(isValidJson(newText)).toBe(true);
    // Owning entry still present; the deleted field's row id is not reselected.
    expect(findEntrySpan(newText, 'Struct')).not.toBeNull();
    expect(selectId).not.toBe(child.id);
    // Sibling entry untouched.
    expect(siblingByteIdentical(fixtureText, newText, 'PI')).toBe(true);
  });

  it('throws for a child whose parent forbids removal', () => {
    const uri = 'test://del-child-locked.sldd';
    const parent = structEntry(uri);
    const child = parent.children[0];
    // Force canRemoveChild false to hit the guard.
    parent.canRemoveChild = () => false;
    expect(() => deleteChild(fixtureText, child)).toThrow();
  });
});

describe('addChild', () => {
  it('adds a child to a struct entry and keeps valid JSON', () => {
    const uri = 'test://add-child.sldd';
    const node = structEntry(uri);
    expect(node.canAddChild()).toBe(true);
    const before = node.children.length;

    const { newText, selectId } = addChild(fixtureText, node);
    expect(isValidJson(newText)).toBe(true);
    expect(node.children.length).toBe(before + 1);
    expect(selectId).toBeTruthy();
    expect(siblingByteIdentical(fixtureText, newText, 'PI')).toBe(true);
  });

  it('throws for a node that cannot have children', () => {
    const uri = 'test://add-child-scalar.sldd';
    const model = freshModel(uri);
    const scalar = findNode(uri, buildRows(model).find((r: any) => r.Name?.label === 'Number').ID);
    expect(() => addChild(fixtureText, scalar)).toThrow();
  });
});

describe('pasteEntry', () => {
  it('pastes a uniquely-named copy as a new top-level entry', () => {
    const uri = 'test://paste.sldd';
    const model = freshModel(uri);
    const src = findNode(uri, buildRows(model).find((r: any) => r.Name?.label === 'Number').ID);
    const payload = src.serialize() as Record<string, unknown>;
    const section = src.parent;

    const { newText, selectId } = pasteEntry(fixtureText, section, payload);
    expect(isValidJson(newText)).toBe(true);
    // Original still present; a uniquely-named copy now exists.
    const names = rowNames(uri, newText);
    expect(names).toContain('Number');
    expect(names).toContain('Number1');
    expect(selectId).toContain('Number1');
    // Untouched sibling stays byte-identical.
    expect(siblingByteIdentical(fixtureText, newText, 'PI')).toBe(true);
  });

  it('cross-section paste rewrites the namespace so the entry lands in the target section', () => {
    const uri = 'test://paste-xsection.sldd';
    const model = freshModel(uri);
    const src = findNode(uri, buildRows(model).find((r: any) => r.Name?.label === 'Number').ID);
    const payload = src.serialize() as Record<string, unknown>;
    // Target "Other Data" (present on every SlddNode even when empty) — a section
    // in a DIFFERENT namespace from Design, which is what the rebind has to rewrite.
    // Not Configurations: it holds config objects only, so a variable no longer
    // reaches the rebind there at all (see the allow-list describes below).
    const other = model.children.find((s: any) => s.name === 'other');
    expect(other).toBeTruthy();

    // The namespace is derived from the target section, not passed in.
    const { newText } = pasteEntry(fixtureText, other, payload);
    expect(isValidJson(newText)).toBe(true);
    // After reparse the pasted entry is a child of other, not design.
    invalidate(uri);
    const reparsed = getModel(uri, 'data.sldd', newText);
    const otherEntries = reparsed.children.find((s: any) => s.name === 'other').children.map((c: any) => c.name);
    expect(otherEntries).toContain('Number');
  });

  it('rebinds the section even when the payload declares no metadata at all', () => {
    // `metadata` is null for an entry whose source .sldd never declared one (a row
    // hand-added in the text view round-trips as `"metadata": null`). Skipping the
    // namespace rebind for those left the pasted entry with no namespace, so
    // getSectionKey fell through to its 'design' default: pasting into another
    // section put the entry in Design Data instead, as if the paste had gone to the
    // wrong section entirely.
    const uri = 'test://paste-nometa.sldd';
    const model = freshModel(uri);
    const other = model.children.find((s: any) => s.name === 'other');
    expect(other).toBeTruthy();

    const { newText } = pasteEntry(fixtureText, other, { name: 'Hand', value: 5 });
    expect(isValidJson(newText)).toBe(true);

    invalidate(uri);
    const reparsed = getModel(uri, 'data.sldd', newText);
    const sectionOf = (name: string) =>
      reparsed.children.find((s: any) => s.children.some((c: any) => c.name === name))?.name;
    expect(sectionOf('Hand')).toBe('other');
  });

  it('gives the pasted copy a fresh unique uuid, not the source uuid', () => {
    const uri = 'test://paste-uuid.sldd';
    const model = freshModel(uri);
    const src = findNode(uri, buildRows(model).find((r: any) => r.Name?.label === 'Number').ID);
    const payload = src.serialize() as Record<string, unknown>;
    const sourceUuid = (payload.metadata as any).uuid as string;
    const section = src.parent;

    const { newText } = pasteEntry(fixtureText, section, payload);
    invalidate(uri);
    const reparsed = getModel(uri, 'data.sldd', newText);
    const copy = buildRows(reparsed)
      .filter((r: any) => !String(r.ID).startsWith('section:'))
      .map((r: any) => findNode(uri, r.ID))
      .find((n: any) => n && n.name === 'Number1');
    expect(copy).toBeTruthy();
    const copyUuid = (copy.metadata as any).uuid as string;

    // A new uuid was generated — it must differ from the source's.
    expect(copyUuid).not.toBe(sourceUuid);
    // ...and follow the current uuid pattern (8-4-4-4-12 lowercase hex).
    expect(copyUuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // The source entry keeps its own uuid.
    expect(payload.metadata).toBeTruthy();
  });

  it('delete + undo restores the original uuid (parse never regenerates it)', () => {
    // Undo is native text-level undo: it restores the pre-delete bytes verbatim,
    // and reparsing reads the uuid straight from the text. This guards that
    // invariant — deleting an entry and restoring the original text must yield
    // the original uuid, and parsing the same text is stable w.r.t. uuid.
    const uri = 'test://delete-undo.sldd';
    const model = freshModel(uri);
    const src = findNode(uri, buildRows(model).find((r: any) => r.Name?.label === 'Number').ID);
    const originalUuid = (src.serialize() as any).metadata.uuid as string;

    const entry = findNode(uri, buildRows(model).find((r: any) => r.Name?.label === 'Number').ID);
    const { newText } = deleteEntry(fixtureText, entry);
    // The entry is gone from the deleted text...
    expect(rowNames(uri, newText)).not.toContain('Number');

    // ...and "undo" (restoring the original bytes) brings back the original uuid.
    invalidate(uri);
    const restored = getModel(uri, 'data.sldd', fixtureText);
    const back = buildRows(restored)
      .filter((r: any) => !String(r.ID).startsWith('section:'))
      .map((r: any) => findNode(uri, r.ID))
      .find((n: any) => n && n.name === 'Number');
    expect((back.serialize() as any).metadata.uuid).toBe(originalUuid);
  });

  it('pastes into a dictionary whose entries array is EMPTY', () => {
    // The first paste into an empty array must NOT be prefixed with a comma —
    // `[,{...}]` is not JSON. Reachable two ways the user hits routinely: a
    // freshly created dictionary, and one whose every entry was just deleted or
    // moved out. Getting it wrong corrupts the file on the very first paste.
    const uri = 'test://paste-into-empty.sldd';
    const root = JSON.parse(fixtureText);
    root.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries = [];
    const emptyText = JSON.stringify(root, null, 2);

    invalidate(uri);
    const empty = getModel(uri, 'data.sldd', emptyText);
    expect(empty.children.every((s: any) => s.children.length === 0)).toBe(true);

    const donor = freshModel('test://paste-into-empty-src.sldd');
    const src = donor.children.flatMap((s: any) => s.children).find((e: any) => e.name === 'Number');
    const { newText } = pasteEntry(emptyText, empty.getSection('design'), src.serialize());
    expect(isValidJson(newText)).toBe(true);
    expect(rowNames(uri, newText)).toEqual(['Number']);
  });

  it('cloneForPaste produces an independent copy', () => {
    const original = { name: 'X', metadata: { uuid: '1' }, value: { a: 1 } };
    const clone = cloneForPaste(original);
    (clone.metadata as any).uuid = '2';
    expect((original.metadata as any).uuid).toBe('1');
  });
});

// Every structural edit resolves its target by NAME in the live document text,
// while the model it was handed came from an EARLIER read of that text. The two
// can disagree: the user (or another extension) can edit the .sldd in the text
// view, or on disk, between the table's last repaint and the click. The span
// finders then return null, and these guards are what turn that into a readable
// error message instead of a corrupt splice at offset 0 or a silent no-op.
//
// Each test asserts the MESSAGE too, because the message is the whole user-facing
// product of the guard — SlddTextEditorProvider surfaces it verbatim as
// "Failed to apply edit: <message>" in the table.
describe('structural edits against text the model no longer matches', () => {
  // The fixture with every mention of "Number" renamed — exactly what a rename in
  // the text view produces while the table still holds the old model.
  const renamed = (from: string, to: string) => fixtureText.replace(new RegExp(`"${from}"`, 'g'), `"${to}"`);

  it('deleteEntry names the entry it could not find', () => {
    const uri = 'test://stale-delete.sldd';
    const model = freshModel(uri);
    const entry = findNode(uri, buildRows(model).find((r: any) => r.Name?.label === 'Number').ID);
    expect(() => deleteEntry(renamed('Number', 'NumberRenamed'), entry)).toThrow(
      'Could not locate entry "Number" to delete.',
    );
  });

  it('addChild names the entry whose text it could not find', () => {
    // The owning entry is reserialized and spliced over its span, so a missing
    // span here would otherwise overwrite the wrong bytes.
    const uri = 'test://stale-add-child.sldd';
    const node = structEntry(uri);
    expect(() => addChild(fixtureText.replace('"name": "Struct"', '"name": "Renamed"'), node)).toThrow(
      'Could not locate entry "Struct" text.',
    );
  });

  it('deleteChild names the entry whose text it could not find', () => {
    const uri = 'test://stale-del-child.sldd';
    const parent = structEntry(uri);
    expect(() =>
      deleteChild(fixtureText.replace('"name": "Struct"', '"name": "Renamed"'), parent.children[0]),
    ).toThrow('Could not locate entry "Struct" text.');
  });

  it('pasteEntry reports a missing entries array rather than inserting at offset 0', () => {
    // A hand-edited or partially-written .sldd can be valid JSON yet not have the
    // entries array at the expected path. Inserting anyway would write the entry
    // into the middle of an unrelated object.
    const uri = 'test://no-entries-array.sldd';
    const model = freshModel(uri);
    const src = findNode(uri, buildRows(model).find((r: any) => r.Name?.label === 'Number').ID);
    const noEntries = fixtureText.replace('"entries"', '"entriesX"');
    expect(isValidJson(noEntries)).toBe(true); // still parses — only the path is wrong
    expect(() => pasteEntry(noEntries, src.parent, src.serialize() as Record<string, unknown>)).toThrow(
      'Could not locate the entries array.',
    );
  });
});

// The paste gates. Both are reachable from an ordinary drag or Cmd+V — the
// webview's dropDecision predicts them so the cursor already says no-drop, but
// the host must enforce them anyway: a keyboard paste never consults the
// predictor, and drop feedback alone is advisory.
describe('pasteEntry rejects what the target section cannot hold', () => {
  const archText = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');
  const archModel = (uri: string) => {
    invalidate(uri);
    return getModel(uri, 'arch.sldd', archText);
  };

  it('names both the class and the section when the class has no home there', () => {
    // A Service Interface exists only in Architectural Data. Pasting one into
    // Design Data would produce an entry Simulink cannot load.
    const model = archModel('test://paste-disallowed.sldd');
    const payload = {
      name: 'Svc',
      metadata: { uuid: 'u' },
      value: { _array_class: 'Simulink.ServiceBus', _elements: [{ _properties: {} }] },
    };
    expect(() => pasteEntry(archText, model.getSection('design'), payload)).toThrow(
      'A "Simulink.ServiceBus" entry is not allowed in Design Data.',
    );
  });

  it('names the entry when a non-scalar variable would become an invalid Constant', () => {
    // A plain MATLAB variable pasted into Architectural Data is reclassed to a
    // Constant, which must be scalar-numeric — an array cannot be one. Without
    // this the document would hold a Constant Simulink rejects.
    const model = archModel('test://paste-nonscalar.sldd');
    const payload = { name: 'Arr', metadata: { uuid: 'u' }, value: [1, 2, 3] };
    expect(() => pasteEntry(archText, model.getSection('arch'), payload)).toThrow(
      "The value for constant 'Arr' must be scalar and numeric.",
    );
  });
});

// A payload with no `_array_class` — a plain MATLAB variable or a struct — used to
// walk straight past the allow-list, because the gate asked "what class is this?"
// and treated "none" as "no restriction". Configurations lists only the four config
// classes, so the one section that most needs the question was the one never asked:
// a double could be copied or dragged into Configurations, which Simulink cannot
// load. The gate now asks what the payload will BECOME in the target section, which
// is always something the allow-list has an opinion about.
describe('pasteEntry gates a classless payload against the allow-list too', () => {
  const designEntry = (uri: string, name: string) => {
    const model = freshModel(uri);
    const entry = (model.getSection('design').children as any[]).find((c) => c.name === name);
    return { model, payload: entry.serialize() as Record<string, unknown> };
  };

  it('refuses a plain MATLAB variable in Configurations', () => {
    // The reported defect: a numeric entry copied/moved into Configurations, which
    // may only hold a ConfigSet or a ConfigSetRef.
    const { model, payload } = designEntry('test://paste-var-config.sldd', 'Number');
    expect(() => pasteEntry(fixtureText, model.getSection('config'), payload)).toThrow(
      'A MATLAB variable is not allowed in Configurations.',
    );
  });

  it('refuses a MATLAB struct in Configurations', () => {
    const { model, payload } = designEntry('test://paste-struct-config.sldd', 'Struct');
    expect(() => pasteEntry(fixtureText, model.getSection('config'), payload)).toThrow(
      'A MATLAB variable is not allowed in Configurations.',
    );
  });

  it('refuses a MATLAB struct in Architectural Data', () => {
    // Arch holds a Constant, not a struct: wrapDerivedVariable deliberately leaves a
    // StructNode alone, so this entry would sit in Architectural Data as a struct —
    // which its allow-list has never permitted. The webview's predictor has always
    // said no-drop here; the host used to disagree and accept a keyboard paste.
    const { model, payload } = designEntry('test://paste-struct-arch.sldd', 'Struct');
    expect(() => pasteEntry(fixtureText, model.getSection('arch'), payload)).toThrow(
      /must be scalar and numeric/,
    );
  });

  it('still accepts a plain MATLAB variable in Design Data and in Other Data', () => {
    // The sections whose allow-lists DO name MatlabVariable must be unaffected —
    // making the gate total must not start refusing an ordinary copy.
    for (const section of ['design', 'other']) {
      const { model, payload } = designEntry(`test://paste-var-${section}.sldd`, 'Number');
      expect(() => pasteEntry(fixtureText, model.getSection(section), payload), section).not.toThrow();
    }
  });

  it('still converts a scalar-numeric variable into a Constant in Architectural Data', () => {
    // The Design→Arch conversion this gate must not break: the payload is classless,
    // so the token it is judged by is the Constant it becomes, which arch allows.
    const { model, payload } = designEntry('test://paste-var-arch.sldd', 'Number');
    expect(() => pasteEntry(fixtureText, model.getSection('arch'), payload)).not.toThrow();
  });
});

describe('deleteChild / addChild on a node that does not support it', () => {
  it('refuses to add a child to a scalar with an actionable message', () => {
    const uri = 'test://add-child-scalar-msg.sldd';
    const model = freshModel(uri);
    const scalar = findNode(uri, buildRows(model).find((r: any) => r.Name?.label === 'Number').ID);
    expect(() => addChild(fixtureText, scalar)).toThrow('This item cannot have children added.');
  });

  it('refuses to delete a top-level entry through the nested-child path', () => {
    // deleteChild's caller picks the path from node.isEntry; an entry routed here
    // has a SECTION as its parent, which has no canRemoveChild.
    const uri = 'test://del-child-entry.sldd';
    const model = freshModel(uri);
    const entry = findNode(uri, buildRows(model).find((r: any) => r.Name?.label === 'Number').ID);
    expect(() => deleteChild(fixtureText, entry)).toThrow('This item cannot be deleted.');
  });
});

// deleteEntry picks the row to select after the deletion: the previous sibling,
// else the next, else the section header. The last arm only happens when the
// deleted entry was the section's ONLY entry — the table would otherwise be told
// to select a row that no longer exists, leaving the Property Inspector showing
// the entry the user just deleted.
describe('deleteEntry reselection', () => {
  it('falls back to the section header when the section had a single entry', () => {
    const uri = 'test://del-last-in-section.sldd';
    const model = freshModel(uri);
    // arch is empty in this fixture; paste one entry in so it holds exactly one.
    const src = findNode(uri, buildRows(model).find((r: any) => r.Name?.label === 'Number').ID);
    const arch = model.children.find((s: any) => s.name === 'arch');
    const { newText } = pasteEntry(fixtureText, arch, src.serialize() as Record<string, unknown>);

    invalidate(uri);
    const reparsed = getModel(uri, 'data.sldd', newText);
    const solo = reparsed.children.find((s: any) => s.name === 'arch').children[0];
    expect(solo).toBeTruthy();
    expect(deleteEntry(newText, solo).selectId).toBe('section:arch');
  });
});

// Any entry by name, off a model the caller already has. Straight down the tree rather
// than through buildRows + findNode: two entries of ONE model is what the same-entry
// guard needs to be tested against, and structEntry builds a fresh model per call.
function entryNamed(model: any, name: string) {
  return model.children.flatMap((s: any) => s.children).find((e: any) => e.name === name);
}

describe('deleteChildren', () => {
  it('removes every named child and splices the owning entry ONCE', () => {
    // Two deleteChild calls would each look for the entry's span, and the second would
    // look in text the first had already rewritten — so the span it found would be the
    // wrong length and its write would land over the entry's neighbour.
    const uri = 'test://del-children.sldd';
    const entry = entryNamed(freshModel(uri), 'Struct');
    const [a, b] = entry.children;
    expect(b, 'the fixture’s Struct has two fields').toBeTruthy();

    const result = mutateEntry(entry, () => deleteChildren(fixtureText, [a, b]));

    // The text is valid JSON and the entry holds neither field — the check a double
    // splice fails. Read back through a reparse rather than as a substring, because this
    // fixture's fields are named "a" and "b": every entry in the document contains those
    // letters, so `not.toContain` could not tell a survivor from an unrelated byte.
    expect(isValidJson(result.newText)).toBe(true);
    invalidate(uri);
    const reparsed = getModel(uri, 'data.sldd', result.newText);
    const struct = reparsed.children
      .flatMap((s: any) => s.children)
      .find((e: any) => e.name === 'Struct');
    expect(struct.children.map((c: any) => c.name)).toEqual([]);
    // The neighbouring entry is byte-identical — that is where a second splice's stale
    // span would have written.
    expect(siblingByteIdentical(fixtureText, result.newText, 'PI')).toBe(true);
    expect(entry.children).toHaveLength(0);
  });

  it('selects a surviving sibling, not a row it just deleted', () => {
    // reselectAfterRemoval answers per removal, so the LAST answer can name a node that
    // an earlier removal already took away. The selection has to survive the gesture.
    // NestedStruct, not Struct: it has three fields, so two removals still leave one — the
    // only shape in which the survivor arm runs at all.
    const uri = 'test://del-children-select.sldd';
    const entry = entryNamed(freshModel(uri), 'NestedStruct');
    const doomed = entry.children.slice(0, 2);
    const surviving = entry.children.slice(2).map((c: any) => c.id);

    const result = mutateEntry(entry, () => deleteChildren(fixtureText, doomed));

    if (surviving.length) expect(surviving).toContain(result.selectId);
    else expect(result.selectId).toBe(entry.id);
  });

  it('refuses children of two different entries', () => {
    // One splice can only rewrite one entry. A caller that mixed entries would silently
    // lose the other's removals from the text while keeping them in the model.
    const uri = 'test://del-children-mixed.sldd';
    const model = freshModel(uri);
    const a = entryNamed(model, 'Struct').children[0];
    const b = entryNamed(model, 'NestedStruct').children[0];
    expect(() => deleteChildren(fixtureText, [a, b])).toThrow(
      'These items are not all in the same entry.',
    );
  });

  it('refuses a child that cannot be deleted', () => {
    // Same guard deleteChild has (removeChildFromModel), stated as one predicate so the
    // group check and the single check cannot come to disagree.
    const uri = 'test://del-children-refuse.sldd';
    const entry = entryNamed(freshModel(uri), 'Number');
    expect(() => deleteChildren(fixtureText, [entry])).toThrow('This item cannot be deleted.');
  });

  it('leaves the model untouched when only ONE of the group is refused', () => {
    // Every check runs over the whole group before anything is removed. Validating as it
    // went would remove the first field and then throw, and the live model would keep
    // that removal until the next re-parse — a table showing a delete the file never got.
    const uri = 'test://del-children-atomic.sldd';
    const entry = entryNamed(freshModel(uri), 'Struct');
    const before = entry.children.map((c: any) => c.name);
    expect(before.length).toBeGreaterThan(1);
    // The entry itself is not a removable child, so the group is refused — after the
    // first element has already been accepted.
    expect(() => deleteChildren(fixtureText, [entry.children[0], entry])).toThrow(
      'This item cannot be deleted.',
    );
    expect(entry.children.map((c: any) => c.name)).toEqual(before);
  });
});
