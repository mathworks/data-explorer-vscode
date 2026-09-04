// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The floating shell around the grid. Two things here are easy to get subtly
// wrong and both are user-visible: dismissal (a popover that outlives the rows
// it describes shows stale data) and focus return (a keyboard user who opens the
// editor and closes it must land back on the glyph, not at the top of the tree).
//
// happy-dom has no layout engine, so every element's getBoundingClientRect() is
// all zeros. Positioning tests therefore stub the rects they care about, which
// is enough to pin the ARITHMETIC — the only part this file owns.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DexVariableEditor } from '../src/webview/components/dex-variable-editor.js';
import type { MatrixPayload } from '../src/webview/components/dex-matrix-grid.js';
import { DexMatrixGrid } from '../src/webview/components/dex-matrix-grid.js';

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

function payload(over: Partial<MatrixPayload> = {}): MatrixPayload {
  return { name: 'A', className: 'double', dims: [2, 2], cells: ['1', '2', '3', '4'], ...over };
}

// A focusable stand-in for the glyph, so focus-return is observable.
function makeAnchor(rect?: Partial<DOMRect>): HTMLElement {
  anchor = document.createElement('button');
  anchor.textContent = 'open';
  document.body.appendChild(anchor);
  if (rect) {
    const full = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...rect };
    anchor.getBoundingClientRect = () => ({ ...full, toJSON: () => full }) as DOMRect;
  }
  return anchor;
}

async function open(matrix = payload(), rect?: Partial<DOMRect>): Promise<DexVariableEditor> {
  editor = new DexVariableEditor();
  document.body.appendChild(editor);
  await editor.updateComplete;
  editor.show(makeAnchor(rect), matrix);
  await frame();
  await editor.updateComplete;
  return editor;
}

function grid(el: DexVariableEditor): DexMatrixGrid {
  return el.shadowRoot!.querySelector('dex-matrix-grid') as DexMatrixGrid;
}

function docKey(k: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

describe('opening and closing', () => {
  it('is closed and renders nothing before show()', async () => {
    editor = new DexVariableEditor();
    document.body.appendChild(editor);
    await editor.updateComplete;
    expect(editor.hasAttribute('open')).toBe(false);
    expect(editor.shadowRoot!.querySelector('dex-matrix-grid')).toBeNull();
  });

  it('marks itself open and hands the payload to the grid', async () => {
    const el = await open(payload({ dims: [2, 3], cells: ['1', '2', '3', '4', '5', '6'] }));
    expect(el.hasAttribute('open')).toBe(true);
    expect(grid(el).matrix!.cells).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('titles itself name — dims class, the way MATLAB describes a variable', async () => {
    const el = await open(payload({ name: 'ParamMat.Value', className: 'double', dims: [2, 3], cells: ['1', '2', '3', '4', '5', '6'] }));
    expect(el.shadowRoot!.querySelector('.title')!.textContent!.trim()).toBe('ParamMat.Value — 2x3 double');
  });

  it('titles an N-D variable with every extent', async () => {
    const el = await open(payload({ name: 'Nd', dims: [2, 2, 2], cells: ['1', '2', '3', '4', '5', '6', '7', '8'] }));
    expect(el.shadowRoot!.querySelector('.title')!.textContent!.trim()).toBe('Nd — 2x2x2 double');
  });

  it('closes on Escape and returns focus to the anchor', async () => {
    const el = await open();
    docKey('Escape');
    await el.updateComplete;
    expect(el.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(anchor);
  });

  it('closes on the close button and returns focus to the anchor', async () => {
    const el = await open();
    el.shadowRoot!.querySelector<HTMLButtonElement>('.close')!.click();
    await el.updateComplete;
    expect(el.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(anchor);
  });

  it('closes on an outside mousedown but NOT on one inside itself', async () => {
    const el = await open();
    el.shadowRoot!.querySelector('.panel')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(el.hasAttribute('open')).toBe(true);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.hasAttribute('open')).toBe(false);
  });

  it('closes when close() is called directly, e.g. because new rows arrived', async () => {
    const el = await open();
    el.close();
    await el.updateComplete;
    expect(el.hasAttribute('open')).toBe(false);
  });

  it('does not steal focus back on a close it did not cause', async () => {
    // setRows closes the editor while the user is somewhere else entirely.
    // Yanking focus to a glyph that may no longer exist would be worse than
    // leaving it where it is, so focus returns only when focus is still inside.
    const el = await open();
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    el.close();
    await el.updateComplete;
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('unhooks its document listeners on close', async () => {
    // A leaked keydown listener would close the NEXT editor instantly.
    const el = await open();
    el.close();
    await el.updateComplete;
    const spy = vi.spyOn(el, 'close');
    docKey('Escape');
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('reopening on a second anchor swaps the payload and the focus-return target', async () => {
    const el = await open(payload({ name: 'First' }));
    const second = document.createElement('button');
    document.body.appendChild(second);
    el.show(second, payload({ name: 'Second', dims: [1, 2], cells: ['9', '8'] }));
    await frame();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.title')!.textContent!.trim()).toBe('Second — 1x2 double');
    expect(grid(el).matrix!.cells).toEqual(['9', '8']);
    docKey('Escape');
    await el.updateComplete;
    expect(document.activeElement).toBe(second);
    second.remove();
  });
});

describe('focus goes into the grid so the arrow keys work immediately', () => {
  it('focuses the first cell on open', async () => {
    const el = await open();
    expect(grid(el).shadowRoot!.activeElement!.textContent!.trim()).toBe('1');
  });

  it('leaves Escape working from inside the grid', async () => {
    // The grid deliberately does not handle Escape; this is the other half of
    // that contract, asserted from the shell's side.
    const el = await open();
    grid(el).shadowRoot!.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }),
    );
    await el.updateComplete;
    expect(el.hasAttribute('open')).toBe(false);
  });
});

describe('positioning is below-left of the anchor, clamped into the viewport', () => {
  const viewport = (w: number, h: number) => {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
  };

  // The panel's own size has to be stubbed too — happy-dom reports 0x0.
  function stubPanel(el: DexVariableEditor, width: number, height: number): void {
    const panel = el.shadowRoot!.querySelector('.panel') as HTMLElement;
    const r = { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height };
    panel.getBoundingClientRect = () => ({ ...r, toJSON: () => r }) as DOMRect;
  }

  it('sits 4px below the anchor, left edges aligned', async () => {
    viewport(1000, 800);
    editor = new DexVariableEditor();
    document.body.appendChild(editor);
    await editor.updateComplete;
    const a = makeAnchor({ left: 100, right: 116, top: 200, bottom: 216, width: 16, height: 16 });
    editor.show(a, payload());
    await editor.updateComplete;
    stubPanel(editor, 200, 150);
    editor.reposition();
    expect(editor.style.left).toBe('100px');
    expect(editor.style.top).toBe('220px');
  });

  it('pulls left when the panel would run off the right edge', async () => {
    viewport(400, 800);
    editor = new DexVariableEditor();
    document.body.appendChild(editor);
    await editor.updateComplete;
    editor.show(makeAnchor({ left: 350, right: 366, top: 100, bottom: 116, width: 16, height: 16 }), payload());
    await editor.updateComplete;
    stubPanel(editor, 200, 150);
    editor.reposition();
    expect(editor.style.left).toBe('192px');   // 400 - 200 - 8
  });

  it('flips above the anchor when there is no room below', async () => {
    viewport(1000, 300);
    editor = new DexVariableEditor();
    document.body.appendChild(editor);
    await editor.updateComplete;
    editor.show(makeAnchor({ left: 10, right: 26, top: 250, bottom: 266, width: 16, height: 16 }), payload());
    await editor.updateComplete;
    stubPanel(editor, 200, 150);
    editor.reposition();
    expect(editor.style.top).toBe('96px');     // 250 - 150 - 4
  });

  it('never positions off the top-left, even with no room anywhere', async () => {
    viewport(120, 100);
    editor = new DexVariableEditor();
    document.body.appendChild(editor);
    await editor.updateComplete;
    editor.show(makeAnchor({ left: 4, right: 20, top: 4, bottom: 20, width: 16, height: 16 }), payload());
    await editor.updateComplete;
    stubPanel(editor, 400, 300);
    editor.reposition();
    expect(Number.parseInt(editor.style.left, 10)).toBeGreaterThanOrEqual(0);
    expect(Number.parseInt(editor.style.top, 10)).toBeGreaterThanOrEqual(0);
  });

  it('closes on a scroll anywhere, rather than floating away from its anchor', async () => {
    const el = await open();
    window.dispatchEvent(new Event('scroll'));
    await el.updateComplete;
    expect(el.hasAttribute('open')).toBe(false);
  });
});
