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
import { deleteEntry, deleteChild, addChild, pasteEntry, cloneForPaste } from '../src/host/structuralEdit.js';

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

    const { newText, selectId } = pasteEntry(fixtureText, section, payload, undefined);
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
    // Target the "config" section (present on every SlddNode even when empty).
    const config = model.children.find((s: any) => s.name === 'config');
    expect(config).toBeTruthy();

    const NS_CONFIG = 'a3b2532e-8e6e-47f5-94fb-b15daf666a84';
    const { newText } = pasteEntry(fixtureText, config, payload, NS_CONFIG);
    expect(isValidJson(newText)).toBe(true);
    // After reparse the pasted entry is a child of config, not design.
    invalidate(uri);
    const reparsed = getModel(uri, 'data.sldd', newText);
    const configEntries = reparsed.children.find((s: any) => s.name === 'config').children.map((c: any) => c.name);
    expect(configEntries).toContain('Number');
  });

  it('cloneForPaste produces an independent copy', () => {
    const original = { name: 'X', metadata: { uuid: '1' }, value: { a: 1 } };
    const clone = cloneForPaste(original);
    (clone.metadata as any).uuid = '2';
    expect((original.metadata as any).uuid).toBe('1');
  });
});
