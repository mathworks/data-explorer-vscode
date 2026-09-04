// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModelFromBytes, getModel, getProjectModel, invalidate, findNode } from '../src/host/SlddModel.js';
import { buildRows } from '../src/host/rowBuilder.js';

function bytes(name: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

// The relpath-keyed text map projectStore.readProjectStore builds from a .prj's
// sibling resources/project/** tree — reproduced here with plain fs so the
// project path is testable without vscode (readProjectStore is the only
// vscode-coupled half).
function projectStore(projectName: string): Record<string, string> {
  const root = fileURLToPath(new URL(`./parity/artifacts/project/${projectName}/resources/project`, import.meta.url));
  const files: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`, `${prefix}/${e.name}`);
      else files[`${prefix}/${e.name}`] = readFileSync(`${dir}/${e.name}`, 'utf8');
    }
  };
  walk(root, 'resources/project');
  return files;
}

describe('getModelFromBytes', () => {
  it('parses an .slx into a model node with the 5 sections', () => {
    const node: any = getModelFromBytes('test://m.slx', 'm.slx', bytes('model_with_refs.slx'));
    const sectionNames = (node.children ?? []).map((c: any) => c.name);
    expect(sectionNames).toEqual(['blocks', 'workspace', 'config', 'references', 'dataSources']);
  });

  it('parses a compressed .sldd into a dictionary node with sections', () => {
    const node: any = getModelFromBytes('test://c.sldd', 'compressed.sldd', bytes('compressed.sldd'));
    expect(Array.isArray(node.children)).toBe(true);
  });

  it('parses a non-zip .sldd supplied as bytes (UTF-8 JSON)', () => {
    const json = JSON.stringify({
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': {
          __MW_TEXT_content: { entries: [], 'Dictionary References': [], AllowAccessBWS: false },
        },
      },
    });
    const b = new TextEncoder().encode(json);
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const node: any = getModelFromBytes('test://plain.sldd', 'plain.sldd', ab);
    expect(Array.isArray(node.children)).toBe(true);
  });

  it('caches by uriString: a second call returns the same instance', () => {
    const uri = 'test://cache.slx';
    invalidate(uri);
    const a = getModelFromBytes(uri, 'cache.slx', bytes('model_with_refs.slx'));
    const b = getModelFromBytes(uri, 'cache.slx', bytes('model_with_refs.slx'));
    expect(a).toBe(b);
  });

  it('invalidate() forces a fresh parse (new instance)', () => {
    const uri = 'test://reparse.slx';
    invalidate(uri);
    const a = getModelFromBytes(uri, 'reparse.slx', bytes('model_with_refs.slx'));
    invalidate(uri);
    const b = getModelFromBytes(uri, 'reparse.slx', bytes('model_with_refs.slx'));
    expect(a).not.toBe(b);
  });

  it('a corrupt .slx no longer throws: it parses as an EMPTY model', () => {
    // BEHAVIOUR CHANGE, data-explorer-core v1.1.0. This used to throw ("invalid zip
    // data") and BinaryEditorProvider.post() caught it to show a "Failed to parse"
    // banner. Now addModelSource routes through parseModel, which sniffs the ZIP
    // magic, finds none, and hands the bytes to the classic-`.mdl` text reader —
    // and that reader tolerates anything: no `Model {` node just means an empty
    // model. So a truncated or corrupt .slx renders as a table of empty section
    // headers with no banner, which reads as "this model is empty" rather than
    // "this file is broken".
    //
    // The rule belongs upstream, not here: the host cannot tell a corrupt file from
    // a genuinely empty model without re-deriving what a model looks like, which is
    // the parser's job. The fix is a validity guard in core's parseClassicMdl
    // (no Model and no Library node => not a model => throw); when core ships it,
    // this test goes back to expecting a throw.
    const node = getModelFromBytes('test://bad.slx', 'bad.slx', new ArrayBuffer(4));
    const rows = buildRows(node);
    // What the user actually sees: the model's section headers, every one of them
    // empty. Asserting BOTH halves so the test cannot pass vacuously — a shape
    // change that produced no rows at all would be a different bug, not a pass.
    const sectionRows = rows.filter((r: any) => String(r.ID).startsWith('section:'));
    expect(sectionRows.length).toBeGreaterThan(0);
    expect(rows.length).toBe(sectionRows.length);
  });

  it('routes a .mat through addMatSource (minimal valid empty MAT)', () => {
    // Level-5 MAT: 128-byte header with little-endian 'IM' at bytes 126-127,
    // then an 8-byte zero terminator => zero variables. Exercises the .mat branch.
    const buf = new Uint8Array(136);
    const header = 'MATLAB 5.0 MAT-file, test';
    for (let i = 0; i < header.length; i++) buf[i] = header.charCodeAt(i);
    buf[124] = 0x00; buf[125] = 0x01; // version
    buf[126] = 0x49; buf[127] = 0x4d; // 'IM' little-endian indicator
    // bytes 128..135 remain zero => terminator (dataType=0, numBytes=0)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    invalidate('test://e.mat');
    const node: any = getModelFromBytes('test://e.mat', 'e.mat', ab);
    expect(node).toBeTruthy();
    expect(Array.isArray(node.children)).toBe(true);
    expect(node.children.length).toBe(0); // no variables
  });
});

describe('getProjectModel', () => {
  it('parses a real .prj resource store into its four sections', () => {
    const uri = 'test://LibProj.prj';
    invalidate(uri);
    const node: any = getProjectModel(uri, 'LibProj.prj', projectStore('LibProj'));
    expect((node.children ?? []).map((c: any) => c.name)).toEqual(['files', 'path', 'labels', 'references']);
    // The store must actually have been read, not silently dropped: a project
    // with no parsed members renders as an empty tree, which is what a broken
    // relpath convention (readProjectStore vs. parseProject) would look like.
    expect(node.children.some((c: any) => c.children.length > 0)).toBe(true);
  });

  it('caches by uriString: a second call returns the same instance', () => {
    // The .prj tree is re-read on every tree expand; without the cache each
    // expansion would re-parse the whole resource store.
    const uri = 'test://LibProj-cache.prj';
    invalidate(uri);
    const files = projectStore('LibProj');
    expect(getProjectModel(uri, 'LibProj.prj', files)).toBe(getProjectModel(uri, 'LibProj.prj', files));
  });
});

describe('getModel (JSON text path, unchanged)', () => {
  it('parses JSON .sldd text into a dictionary node', () => {
    invalidate('test://json.sldd');
    const json = JSON.stringify({
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': {
          __MW_TEXT_content: { entries: [], 'Dictionary References': [], AllowAccessBWS: false },
        },
      },
    });
    const node: any = getModel('test://json.sldd', 'json.sldd', json);
    expect(Array.isArray(node.children)).toBe(true);
  });
});

// Every provider re-reads a file by calling invalidate() then getModel() on the
// SAME uri, which re-registers one srcId in DataModel. findNode then answers a
// webview selection out of DataModel's global id registry, so what that registry
// holds after a re-read is a host-visible contract, not a core detail.
describe('re-reading a uri leaves no node from the discarded tree resolvable', () => {
  const uri = 'test://reread.sldd';
  const fixtureText = readFileSync(
    fileURLToPath(new URL('../test-integration/fixtures/workspace/data.sldd', import.meta.url)),
    'utf8',
  );

  // The same file with one named entry removed — an external edit, or our own
  // save, followed by the re-read the document-change handler triggers.
  function without(name: string): string {
    const root = JSON.parse(fixtureText);
    const content = root.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;
    content.entries = content.entries.filter((e: { name: string }) => e.name !== name);
    return JSON.stringify(root, null, 2);
  }

  const entry = (model: any, name: string): any =>
    model.flatten().find((n: any) => n.name === name);

  it('stops resolving an entry the re-read file no longer contains', () => {
    // The registry is keyed by node id, and a re-registration used to add the new
    // tree's ids without removing the old tree's — so a deleted entry stayed
    // resolvable forever. A selection or a queued edit aimed at that id then found
    // a live-looking node in a tree nothing else referenced: the edit applied to
    // the orphan, reported success, and was absent from the saved file.
    invalidate(uri);
    const before = getModel(uri, 'reread.sldd', fixtureText);
    const removed = entry(before, 'Array1');
    expect(removed).toBeTruthy();

    invalidate(uri);
    getModel(uri, 'reread.sldd', without('Array1'));

    expect(findNode(uri, removed.id)).toBeNull();
  });

  // Guards the ORDER of the fix rather than the original symptom: de-indexing the
  // outgoing tree has to happen before indexing the incoming one, or removing the
  // old ids would also remove the identical ids the new tree just registered and
  // every surviving entry would stop resolving.
  it('resolves a surviving entry to the new tree, not the discarded one', () => {
    invalidate(uri);
    const before = getModel(uri, 'reread.sldd', fixtureText);
    const kept = entry(before, 'Array');

    invalidate(uri);
    const after: any = getModel(uri, 'reread.sldd', without('Array1'));
    expect(after).not.toBe(before);

    const resolved = findNode(uri, kept.id);
    expect(resolved).not.toBeNull();
    // Same id, different object: the node the id now names belongs to the tree the
    // table is actually showing.
    expect(resolved).not.toBe(kept);
    expect(after.flatten()).toContain(resolved);
    expect(before.flatten()).not.toContain(resolved);
  });
});
