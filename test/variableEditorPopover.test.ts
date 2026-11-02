// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The inspector webview's Variable Editor, over the VS Code port. The editor itself, its glyph
// and connectInspector's wiring are view's, and view proves them (test/variableEditorWidget.test.ts,
// test/matrixOpenGlyph.test.ts, test/connectInspector.test.ts). What stays here is vscodePort.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  DexVariableEditor,
  defineVariableEditor,
  type MatrixDescriptor,
  type MatrixPayload,
  DexMatrixGrid,
} from 'data-explorer-view/variable-editor';
import { connectInspector } from 'data-explorer-view/property-inspector';
import { inspectorFeed } from 'data-explorer-view/model';
import { vscodePort } from '../src/webview/vscodePort.js';

defineVariableEditor();

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

let editor: DexVariableEditor | null = null;
let anchor: HTMLElement | null = null;

afterEach(() => {
  editor?.remove();
  anchor?.remove();
  editor = null;
  anchor = null;
  vi.restoreAllMocks();
});

// What a ROW carries: everything needed to title the panel and to ask for the
// rest. The cells are fetched when a panel opens — see view's connectTable / connectInspector.
function descriptor(over: Partial<MatrixDescriptor> = {}): MatrixDescriptor {
  return { name: 'A', className: 'double', dims: [2, 2], nodeId: 'n1', ...over };
}

function payload(over: Partial<MatrixPayload> = {}): MatrixPayload {
  return { ...descriptor(), cells: ['1', '2', '3', '4'], ...over };
}

// The host's answer to `requestMatrix`, as the window message the webview sees.
function cells(matrix: MatrixPayload): any {
  return { type: 'matrixCells', nodeId: matrix.nodeId, matrix };
}

// A focusable stand-in for the glyph the editor is anchored on.
function makeAnchor(): HTMLElement {
  anchor = document.createElement('button');
  anchor.textContent = 'open';
  document.body.appendChild(anchor);
  return anchor;
}

function grid(el: DexVariableEditor): DexMatrixGrid {
  return el.shadowRoot!.querySelector('dex-matrix-grid') as DexMatrixGrid;
}

describe("the inspector webview's wiring: view's connectInspector over the VS Code port", () => {
  // connectInspector owns both directions: the glyph's event out as a `requestMatrix`, and the
  // host's `matrixCells` back in as a deliver(). view proves that over a plain port
  // (test/connectInspector.test.ts); this drives it through the port pi-main.ts gives it,
  // vscodePort, which these three are the only tests of: its postMessage out, its window
  // listener in, and that listener's removal.
  let source: HTMLElement | null = null;
  let posted: any[] = [];

  afterEach(() => {
    source?.remove();
    source = null;
    posted = [];
  });

  const post = (m: unknown) => { posted.push(m); };

  async function wire() {
    source = document.createElement('div');
    document.body.appendChild(source);
    editor = new DexVariableEditor();
    document.body.appendChild(editor);
    await editor.updateComplete;
    const feed = inspectorFeed(vscodePort({ postMessage: post }));
    const handle = connectInspector(source as any, feed, { variableEditor: editor, empty: () => {} });
    // What connecting says first: the inspector is up (`ready`). The tests are about what follows.
    posted.length = 0;
    return {
      dispose: () => {
        handle.dispose();
        feed.dispose();
      },
    };
  }

  function fire(detail: any): void {
    source!.dispatchEvent(new CustomEvent('dex-matrix-open', { detail, bubbles: true, composed: true }));
  }

  function hostSays(data: any): void {
    window.dispatchEvent(new MessageEvent('message', { data }));
  }

  it('asks the host for the cells of exactly the node that was opened', async () => {
    const handle = await wire();
    fire({ matrix: descriptor({ name: 'Mat', nodeId: 'node-9' }), anchorEl: makeAnchor() });
    expect(posted).toEqual([{ type: 'requestMatrix', nodeId: 'node-9' }]);
    handle.dispose();
  });

  it('delivers the host’s answer into the open editor', async () => {
    const handle = await wire();
    fire({ matrix: descriptor({ nodeId: 'n1' }), anchorEl: makeAnchor() });
    await frame();
    hostSays(cells(payload({ nodeId: 'n1' })));
    await frame();
    await editor!.updateComplete;
    await editor!.updateComplete;
    expect(grid(editor!).matrix!.cells).toEqual(['1', '2', '3', '4']);
    handle.dispose();
  });

  it('stops listening in both directions after dispose', async () => {
    const handle = await wire();
    handle.dispose();
    fire({ matrix: descriptor(), anchorEl: makeAnchor() });
    await frame();
    await editor!.updateComplete;
    expect(editor!.hasAttribute('open')).toBe(false);
    expect(posted).toEqual([]);
    const spy = vi.spyOn(editor!, 'deliver');
    hostSays(cells(payload()));
    await frame();
    expect(spy).not.toHaveBeenCalled();
  });
});
