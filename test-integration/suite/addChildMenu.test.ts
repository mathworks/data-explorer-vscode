// Copyright 2026 The MathWorks, Inc.
// Integration coverage for the "Add Child" context-menu wiring and the
// add-child model mutation, exercised INSIDE a real VS Code host against a real
// .sldd fixture read through the workspace API.
//
// Unlike the vitest unit suites, this bundle runs the production host pipeline
// (getModel -> rowBuilder -> buildContextMenuItems) end to end inside VS Code,
// proving the seam the unit tests stub out: the model's canAddChild()/
// canRemoveChild() flags flow through rowBuilder into the actual menu item's
// `disabled` state. It then drives the model's own addChildNode() + the owning
// entry's serialize() (exactly what structuralEdit.addChild does, minus the
// jsonc-parser text splice — which does not `require` cleanly in the Electron
// host and is already covered by the entrySplice/structuralEdit vitest suites)
// to assert the reserialized JSON has the right shape.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { getModel, findNode, invalidate } from '../../src/host/SlddModel';
import { buildRows } from '../../src/host/rowBuilder';
import { buildContextMenuItems, type ClipboardState } from '../../src/webview/menuItems';

const NO_CLIP: ClipboardState = { canPaste: false, mode: null };

async function readFixture(name: string): Promise<{ uri: string; text: string }> {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws, 'a workspace folder must be open');
  const fileUri = vscode.Uri.joinPath(ws.uri, name);
  const bytes = await vscode.workspace.fs.readFile(fileUri);
  return { uri: fileUri.toString(), text: Buffer.from(bytes).toString('utf8') };
}

// Build the row and live model node for a named top-level entry.
function entryRowAndNode(uri: string, text: string, name: string): { row: any; node: any } {
  invalidate(uri);
  const model = getModel(uri, 'params.sldd', text);
  const row = buildRows(model).find(
    (r: any) => r.Name?.label === name && !String(r.ID).startsWith('section:'),
  );
  assert.ok(row, `entry "${name}" is present`);
  return { row, node: findNode(uri, row.ID) };
}

// The Add Child menu item's disabled state for a named entry, computed through
// the real rowBuilder -> buildContextMenuItems path (editable document).
function addChildDisabled(uri: string, text: string, name: string): boolean {
  const { row } = entryRowAndNode(uri, text, name);
  const items = buildContextMenuItems(row, NO_CLIP, true);
  return items.find((i) => i.id === 'addChild')!.disabled === true;
}

// Walk up to the owning top-level entry (isEntry === true), mirroring
// structuralEdit.findOwningEntry.
function owningEntry(node: any): any {
  let e = node;
  while (e && !e.isEntry) e = e.parent;
  return e;
}

// Add a child to a container node and return the reserialized owning-entry
// value object — the same in-memory transform structuralEdit.addChild performs
// before the (jsonc-based) text splice.
function addChildAndSerialize(node: any): any {
  const entry = owningEntry(node);
  const child = node.addChildNode();
  assert.ok(child, 'a child node was created');
  return (entry.serialize() as any).value;
}

function findByArrayClass(o: any, arrayClass: string): any {
  if (o && typeof o === 'object') {
    if (o._array_class === arrayClass) return o;
    for (const k of Object.keys(o)) {
      const r = findByArrayClass(o[k], arrayClass);
      if (r) return r;
    }
  }
  return null;
}

suite('Add Child menu + model mutation (integration)', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  test('Add Child menu item is ENABLED for a Bus and DISABLED for a scalar', async () => {
    const { uri, text } = await readFixture('params.sldd');
    assert.strictEqual(addChildDisabled(uri, text, 'MyBus'), false, 'Bus enables Add Child');
    // MyNumType is a scalar numeric-type object: no children to add.
    assert.strictEqual(addChildDisabled(uri, text, 'MyNumType'), true, 'scalar disables Add Child');
  });

  test('Add Child on a Bus: dims grow and the new element gets a unique _id', async () => {
    const { uri, text } = await readFixture('params.sldd');
    const { node } = entryRowAndNode(uri, text, 'MyBus');
    const before = node.children.length;

    const value = addChildAndSerialize(node);
    JSON.parse(JSON.stringify(value)); // must be JSON-serializable
    const ei = findByArrayClass(value, 'Simulink.Bus')._elements[0]._properties.Elements_internal;
    assert.strictEqual(ei._elements.length, before + 1, 'element array grew by one');
    assert.deepStrictEqual(ei._dimensions, [before + 1, 1], 'dimensions track the count');
    const ids = ei._elements.map((e: any) => e._id);
    assert.ok(ids.every((id: any) => typeof id === 'string' && id.length > 0), 'all ids present');
    assert.strictEqual(new Set(ids).size, ids.length, 'all ids unique');
  });

  test('Add Child on an EnumType writes a string Value and grows dims', async () => {
    const { uri, text } = await readFixture('params.sldd');
    const { node } = entryRowAndNode(uri, text, 'MyEnum');
    const before = node.children.length;

    const value = addChildAndSerialize(node);
    const enumerals = findByArrayClass(value, 'Simulink.data.dictionary.EnumTypeDefinition')._elements[0]
      ._properties.Enumerals;
    assert.strictEqual(enumerals._elements.length, before + 1, 'enumeral array grew by one');
    assert.deepStrictEqual(enumerals._dimensions, [1, before + 1], 'dimensions track the count');
    assert.ok(
      enumerals._elements.every((e: any) => typeof e.Value === 'string'),
      'every enumeral Value is a string',
    );
  });

  test('the extension stays active after driving the add-child pipeline', () => {
    assert.ok(
      vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
      'extension remains active',
    );
  });
});
