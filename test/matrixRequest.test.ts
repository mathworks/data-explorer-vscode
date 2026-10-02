// Copyright 2026 The MathWorks, Inc.
//
// THE ONE ANSWER TO `requestMatrix`, SHARED BY ALL FOUR WEBVIEW HOSTS.
//
// A row carries a MatrixDescriptor — name, class, shape, node id — and no cells. The
// cells arrive only when a Variable Editor panel actually opens, because a 1000x1000
// entry is 4 MB of cell strings and ~240 ms to produce, paid per row stamped rather
// than per panel opened. See matrixPayload.ts.
//
// Three table providers and the Property Inspector all open that panel, which makes
// this the shape of defect this codebase keeps relearning: one rule, four paths. So
// the answer is ONE function, asserted here once, and messageDispatch.test.ts is what
// makes all four call it. What this file owns is the function's own contract:
//
//   - it answers with the cells the ROW's own rule produces, never a second
//     resolution of which node owns the matrix;
//   - it echoes the nodeId, so a late answer to a closed panel can be dropped;
//   - it fails SPOKEN, not silent: a node that cannot be found or cannot lay out
//     comes back with a message, because a glyph that opens an empty grid is worse
//     than one that says why.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel } from 'data-explorer-core';
import { getModel, getModelFromBytes, invalidate } from '../src/host/SlddModel.js';
import { answerMatrixRequest, matrixCellsMessage } from '../src/host/matrixRequest.js';

function bytes(name: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

function descend(node: any): any[] {
  return [node, ...(node.children ?? []).flatMap(descend)];
}

// A webview that records what the host posted to it.
function spy() {
  const posts: any[] = [];
  return { posts, postMessage: (m: any) => { posts.push(m); return Promise.resolve(true); } };
}

// Two fixtures, because they answer different halves: `numeric_json.sldd` holds the
// bare `Matrix` entry (a 2x2 that owns its own value), `mcos/all.sldd` holds
// `ParamMat` (an object whose matrix is on its Value child).
const URI = 'mr://numeric_json.sldd';
function model(): any {
  invalidate(URI);
  const text = readFileSync(fileURLToPath(new URL('./fixtures/numeric_json.sldd', import.meta.url)), 'utf8');
  return getModel(URI, 'numeric_json.sldd', text);
}

const MCOS_URI = 'mr://all.sldd';
function mcosModel(): any {
  invalidate(MCOS_URI);
  return getModelFromBytes(MCOS_URI, 'all.sldd', bytes('mcos/all.sldd'));
}

describe('answerMatrixRequest', () => {
  it('sends the cells of the matrix the row owns', () => {
    const matrix = descend(model()).find((n) => n.name === 'Matrix');
    const web = spy();
    answerMatrixRequest(web, URI, matrix.id);
    expect(web.posts.length).toBe(1);
    const msg = web.posts[0];
    expect(msg.type).toBe('matrixCells');
    expect(msg.nodeId).toBe(matrix.id);
    expect(msg.matrix.dims).toEqual([2, 2]);
    expect(msg.matrix.cells).toEqual(['1', '2', '3', '4']);
    expect(msg.message).toBeUndefined();
  });

  it('resolves a property row’s Value child exactly as the row did', () => {
    // `ParamMat` shows its Value's literal; the matrix is one level down. The webview
    // sends the ROW's node id, and this re-runs matrixForRow on it rather than asking
    // the webview to have resolved the owner — one rule, not two that agree today.
    const paramMat = descend(mcosModel()).find((n) => n.name === 'ParamMat');
    const web = spy();
    answerMatrixRequest(web, MCOS_URI, paramMat.id);
    const msg = web.posts[0];
    expect(msg.nodeId).toBe(paramMat.id);
    expect(msg.matrix.name).toBe('ParamMat.Value');  // the title the glyph promised
    expect(msg.matrix.cells).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('says so when the node cannot be found, rather than going quiet', () => {
    // The panel is already open and waiting. No answer at all leaves a spinner
    // forever; an answer with no cells and no reason leaves an empty grid.
    model();
    const web = spy();
    answerMatrixRequest(web, URI, `${URI}/design/NoSuchEntry`);
    expect(web.posts.length).toBe(1);
    expect(web.posts[0].nodeId).toBe(`${URI}/design/NoSuchEntry`);
    expect(web.posts[0].matrix).toBeUndefined();
    expect(typeof web.posts[0].message).toBe('string');
    expect(web.posts[0].message.length).toBeGreaterThan(0);
  });

  it('says so when the node is real but owns no grid', () => {
    const scalar = descend(mcosModel()).find((n) => n.name === 'Param');
    const web = spy();
    answerMatrixRequest(web, MCOS_URI, scalar.id);
    expect(web.posts[0].matrix).toBeUndefined();
    expect(typeof web.posts[0].message).toBe('string');
  });

  it('answers a node resolved from a DIFFERENT uri, which is what a second tab is', () => {
    // findNode prefers the global registry, keyed by the full node id, so an id from
    // one document resolves whichever provider registered it. The uri is the fallback
    // path's key only — and a wrong one must not turn a good id into a failure.
    const matrix = descend(model()).find((n) => n.name === 'Matrix');
    const web = spy();
    answerMatrixRequest(web, 'mr://not-this-one.sldd', matrix.id);
    expect(web.posts[0].matrix.cells).toEqual(['1', '2', '3', '4']);
  });

  it('never throws, whatever the webview sends', () => {
    // The nodeId comes off a postMessage, so it is whatever the renderer said it was.
    // An exception here would escape into the provider's onDidReceiveMessage chain and
    // take the rest of that message's handling with it.
    model();
    for (const id of ['', 'nonsense', '../../etc/passwd', 'a'.repeat(10000)]) {
      const web = spy();
      expect(() => answerMatrixRequest(web, URI, id as any)).not.toThrow();
      expect(web.posts.length).toBe(1);
      expect(web.posts[0].matrix).toBeUndefined();
    }
  });

  it('answers a matrix core never expanded, which is the whole reason for the fetch', () => {
    // A 300x300 double: 90,000 elements, nine times core's MAX_EXPANDED_ELEMENTS, so
    // the node has no element children at all. The cells come from displayElements.
    const uri = 'mr://big.mat';
    DataModel.removeDataSource(uri);
    const mat = DataModel.addMatSourceParsed(uri, {
      header: 'MATLAB 5.0',
      variables: [{
        name: 'Big', className: 'double', dimensions: [300, 300], isComplex: false,
        isLogical: false, value: Array.from({ length: 90000 }, (_, i) => i), fields: null,
      }],
    }, { path: uri });
    const big = (mat.children ?? [])[0];
    expect(big.children.length).toBe(0);
    const web = spy();
    answerMatrixRequest(web, uri, big.id);
    expect(web.posts[0].matrix.cells.length).toBe(90000);
    expect(new Set(web.posts[0].matrix.cells).size).toBe(90000);
  });
});

describe('every host that answers requestMatrix answers it from here', () => {
  // messageDispatch.test.ts pins that the three TABLE providers have a branch for it.
  // This pins the other half, and reaches the fourth host it does not cover: that the
  // branch answers through this module rather than assembling an envelope of its own.
  //
  // The Property Inspector is why that is not automatic. It is handed a node and never
  // learns which document it came from, so it cannot call `answerMatrixRequest` — it
  // resolves its own node and calls `matrixCellsMessage`. A second envelope written
  // there would be a panel that says something different about the same failure, in
  // the pane most likely to be open beside the table.
  const HOSTS = [
    'src/host/SlddTextEditorProvider.ts',
    'src/host/BinarySlddEditorProvider.ts',
    'src/host/BinaryEditorProvider.ts',
    'src/host/PropertiesViewProvider.ts',
  ];

  for (const file of HOSTS) {
    it(`${file.replace('src/host/', '')} builds no matrixCells envelope of its own`, () => {
      const src = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');
      expect(src).toMatch(/msg\??\.type === 'requestMatrix'/);
      expect(src).toMatch(/answerMatrixRequest|matrixCellsMessage/);
      // The literal, nowhere but here. A host that writes `{ type: 'matrixCells' ... }`
      // itself has started a second rule, whatever it happens to say today.
      const own = [...src.matchAll(/'matrixCells'/g)].length;
      expect(own, `${file} spells the matrixCells envelope itself`).toBe(0);
    });
  }

  it('is the only module that names the message at all', () => {
    const builder = readFileSync(
      fileURLToPath(new URL('../src/host/matrixRequest.ts', import.meta.url)), 'utf8');
    expect([...builder.matchAll(/'matrixCells'/g)].length).toBeGreaterThan(0);
  });

  it('answers a node it was handed directly, which is the inspector’s whole path', () => {
    const paramMat = descend(mcosModel()).find((n) => n.name === 'ParamMat');
    const msg = matrixCellsMessage(paramMat.id, paramMat);
    expect(msg.type).toBe('matrixCells');
    expect(msg.matrix!.name).toBe('ParamMat.Value');
    expect(msg.matrix!.cells).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('refuses a node of null in the same words as a node that will not grid', () => {
    // What the inspector sends when the id does not match what is on screen. It must
    // be the SAME answer a bad node gets, or the panel has two failure modes to tell
    // apart for no reason the user can see.
    const scalar = descend(mcosModel()).find((n) => n.name === 'Param');
    expect(matrixCellsMessage('x', null)).toEqual(matrixCellsMessage('x', scalar));
  });
});
